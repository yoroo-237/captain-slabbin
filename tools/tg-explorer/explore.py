"""Parcours automatique d'un bot Telegram avec la session créée par login.py.

Envoie /start, rejoue chaque bouton inline, envoie les boutons de clavier et
les commandes trouvées dans les textes. Puis analyse les chemins (routes.py) et
complète ceux qui manquent : les routes manquantes ou en échec sont relancées, en
--complete passes au plus, tant qu'il en reste de nouvelles. Écrit :
  <out>/data.json    tous les écrans, toutes les étapes, ce qui a été ignoré
  <out>/check.json   l'analyse des chemins : couverture, routes manquantes
  <out>/media/       les images et fichiers reçus
  <out>/report.html  une page de lecture façon chat
  <out>/state.json   file d'attente : relancer reprend là où le parcours s'est arrêté
                     (--fresh pour tout recommencer)

Les boutons qui ressemblent à un achat, un paiement ou une suppression sont
ignorés pour ne rien déclencher chez le bot parcouru (voir --skip / --allow).

Usage : python explore.py QTMARKETBOT --out M:\\tmp\\qt-capture
"""
import argparse
import asyncio
import time
import base64
import hashlib
import html
import json
import re
from collections import deque
from pathlib import Path

from telethon import errors
from telethon.tl import functions, types

from common import make_client, normalize_bot
from routes import check, retry_items

# Seulement ce qui détruit ou vide quelque chose (suppression, retrait de fonds). Achats,
# paiements, confirmations, panier, commandes, checkout et dépôt sont parcourus : le
# compte n'a pas de carte liée. A resserrer avec --strict si le bot a un vrai solde.
DEFAULT_SKIP = r"delete|remove|clear|empty|withdraw|supprimer|retirer|vider|effacer"
# Ancienne liste, large : ignore aussi tout ce qui contient cart, order, checkout, deposit...
STRICT_SKIP = (
    r"buy|pay|checkout|order|confirm|cart|purchase|delete|remove|cancel|withdraw|deposit|"
    r"acheter|payer|commander|panier|supprimer|annuler"
)
COMMAND = re.compile(r"(?<![\w/])/[A-Za-z][A-Za-z0-9_]{0,31}")
# Un retour mène à un écran déjà vu : chaque libellé de retour n'est joué qu'une fois
BACK = re.compile(r"^\W*(⇇|⇆|<<?\s*back\b|back\b)", re.I)
IMAGE_EXT = (".jpg", ".jpeg", ".png", ".webp", ".gif")
SAVE_EVERY = 10
RECONNECT_TRIES, RECONNECT_WAIT = 20, 30  # secondes entre deux essais quand le réseau tombe
# Une action qui ne finit pas (Telegram ou le bot ne répond pas) est abandonnée après ce
# délai : la capture continue avec la suivante au lieu de caler
STEP_TIMEOUT = 120
# Un bot lent (QT Market) modifie la page bien après le clic : on attend ce changement
EDIT_WAIT = 15
# Jamais pressés par le parcours ni la complétion : les paliers de quantité d'un produit
# (« 1oz—$50⁰⁰ », ils mettent le produit au panier) et ce qui les suit (comme la règle
# « manual » de QT Market dans backend/src/tg/profiles.js)
HAND_ONLY = re.compile(r"—\s*\$\s*\d|^\W*remove product from cart|^\W*add product notes|"
                       r"^\W*enter shipping details|^\W*apply vouchers?", re.I)
DEFAULT_CAPTURES = Path(__file__).with_name("captures")


class RouteLost(Exception):
    """Une route à relancer dont l'écran ou le bouton n'est plus retrouvé."""


def label_of(action):
    """Le libellé d'une action dans le journal : la commande ou le texte, [le bouton]."""
    return f"[{action[3]}]" if action[0] in ("cb", "goto") else action[1]


def stop_requested(args):
    """L'interface demande l'arrêt en créant ce fichier : la capture est alors écrite
    normalement, alors qu'un arrêt brutal du processus sous Windows perdrait la fin."""
    return bool(args.stop_file) and Path(args.stop_file).exists()


def compile_skip(args):
    """Motif des actions à ne pas jouer : défaut + --skip, moins ce que --allow rend permis."""
    parts = [] if args.no_default_skip else [STRICT_SKIP if args.strict else DEFAULT_SKIP]
    parts += args.skip
    skip = re.compile("|".join(parts), re.I) if parts else None
    allow = re.compile("|".join(args.allow), re.I) if args.allow else None
    return skip, allow


class Explorer:
    def __init__(self, client, bot, out, args):
        self.client, self.bot, self.out, self.args = client, bot, out, args
        self.skip, self.allow = compile_skip(args)
        self.media_dir = out / "media"
        if not args.no_media:
            self.media_dir.mkdir(parents=True, exist_ok=True)
        self.screens = {}
        self.steps = []
        self.ignored = []
        self.queue = deque()
        self.seen = set()
        self.per_prefix = {}
        self.media_cache = {}
        self.last_id = 0
        self.profile = {}
        # Retour sur un écran : le chemin qui y mène depuis le départ, et l'écran
        # d'où vient chaque bouton (un bot qui modifie son message efface les autres)
        self.button_screen = {}  # données d'un bouton -> l'écran (au chiffre près) qui le porte
        self.answered = set()    # écrans dont la question ou le captcha a déjà reçu une réponse
        self.retried = set()     # boutons déjà remis en file après un échec
        self.joined = []         # canaux rejoints parce que le bot l'exigeait
        self.inline = None       # ce que le bot propose en mode inline (@bot …)
        self.label_results = {}  # libellé -> {"played": n, "screens": [clés obtenues]}
        self.skipped_known = 0
        self.paths = {}       # clé d'écran -> [["cmd"|"text"|"cb", valeur], ...]
        self.origin = {}      # données du bouton (base64) -> clé de l'écran qui le porte
        self.templates = set()  # écrans au chiffre près (quantité, prix, page…)

    # ---- file d'actions -------------------------------------------------

    def is_skipped(self, label):
        if not self.skip or not self.skip.search(label or ""):
            return False
        return not (self.allow and self.allow.search(label))

    def enqueue(self, action):
        kind = action[0]
        key = ("cb", action[2]) if kind == "cb" else ("send", action[1])
        label = action[-1] if kind == "cb" else action[1]
        if key in self.seen:
            return
        if HAND_ONLY.search(label or ""):
            self.seen.add(key)
            return
        if kind == "cb":
            # Le même bouton sur le même écran (données différentes à chaque affichage) : une fois
            same = ("btn", self.button_screen.get(action[2]), self.norm(label))
            if same in self.seen:
                return
            self.seen.add(same)
            # Un bouton présent partout (retour, accueil, panier…) qui a déjà mené deux fois au
            # même écran : il y mènera encore, inutile de le rejouer depuis chaque écran
            known = self.label_results.get(self.norm(label))
            if known and known["played"] >= 2 and len(known["screens"]) == 1:
                self.skipped_known += 1
                return
        if kind == "cb" and BACK.search(label or ""):
            key = ("back", label.strip())
            if key in self.seen:
                return
        # Un bouton « ✅ » peut cacher confirm_order : on filtre aussi ses données
        tested = f"{label} {action[2].decode('utf-8', 'replace')}" if kind == "cb" else label
        if self.is_skipped(tested):
            self.seen.add(key)
            self.ignored.append(label)
            return
        if kind == "cmd":
            if self.args.no_commands:
                return
            prefix = re.sub(r"\d+$", "", action[1])
            if self.args.max_per_prefix and self.per_prefix.get(prefix, 0) >= self.args.max_per_prefix:
                return
            self.per_prefix[prefix] = self.per_prefix.get(prefix, 0) + 1
        self.seen.add(key)
        self.queue.append(action)

    # ---- capture d'un message -------------------------------------------

    async def save_media(self, msg):
        if self.args.no_media or not msg.media or isinstance(
                msg.media, (types.MessageMediaWebPage, types.MessageMediaEmpty)):
            return None
        file = msg.file
        if file and file.size and file.size > self.args.max_media_mb * 1024 * 1024:
            return None
        media_id = str(getattr(msg.photo or msg.document, "id", msg.id))
        if media_id not in self.media_cache:
            path = await self.client.download_media(msg, file=str(self.media_dir / media_id))
            self.media_cache[media_id] = Path(path).name if path else None
        return self.media_cache[media_id]

    @staticmethod
    def describe_button(b, markup):
        """Une cellule du clavier, quelle que soit la couche Telegram (b.type en récent).
        Tous les boutons que Telegram permet sont décrits (voir l'API Bot : InlineKeyboardButton,
        KeyboardButton) ; seuls les boutons de rappel et les textes du clavier sont joués."""
        cell = {"text": b.text}
        kind = getattr(b, "type", b)
        name = type(kind).__name__
        keyboard = isinstance(markup, types.ReplyKeyboardMarkup)
        # Couleur et icône du bouton (API 9.4 : KeyboardButtonStyle), bouton désactivé (API 10.3)
        style = getattr(b, "style", None)
        if style is not None:
            for flag, color in (("bg_danger", "danger"), ("bg_success", "success"), ("bg_primary", "primary")):
                if getattr(style, flag, False):
                    cell["style"] = color
                    break
            if getattr(style, "icon", None):
                cell["icon"] = str(style.icon)
        if getattr(b, "disabled", False) or getattr(kind, "disabled", False):
            cell["disabled"] = True
        if "Callback" in name and hasattr(kind, "data"):
            cell.update(kind="callback", data=kind.data.decode("utf-8", "replace"))
            if getattr(kind, "requires_password", False):
                cell["password"] = True
            return cell, ("cb", None, kind.data, b.text)
        if "WebView" in name:          # web_app (inline ou clavier) : une Mini App
            cell.update(kind="web_app", url=getattr(kind, "url", ""))
            return cell, None
        if "UrlAuth" in name:          # login_url : connexion sur un site
            cell.update(kind="login_url", url=getattr(kind, "url", ""))
            return cell, None
        if "Url" in name and hasattr(kind, "url"):
            cell.update(kind="url", url=kind.url)
            return cell, None
        if "Copy" in name:             # copy_text : copie un texte (adresse, code…)
            cell.update(kind="copy", copy=getattr(kind, "copy_text", ""))
            return cell, None
        if "SwitchInline" in name:     # recherche en mode inline
            cell.update(kind="switch_inline", query=getattr(kind, "query", ""), same_chat=bool(getattr(kind, "same_peer", False)))
            return cell, None
        if "RequestPhone" in name:
            cell["kind"] = "request_contact"
            return cell, None
        if "RequestGeoLocation" in name:
            cell["kind"] = "request_location"
            return cell, None
        if "RequestPoll" in name:
            cell.update(kind="request_poll", quiz=bool(getattr(kind, "quiz", False)))
            return cell, None
        if "RequestPeer" in name:      # request_users / request_chat
            peer = type(getattr(kind, "peer_type", None)).__name__
            cell.update(kind="request_chat" if "Chat" in peer or "Broadcast" in peer else "request_users")
            return cell, None
        if "Game" in name:
            cell["kind"] = "game"
            return cell, None
        if "Buy" in name:
            cell["kind"] = "pay"
            return cell, None
        if "UserProfile" in name:
            cell.update(kind="user_profile", user_id=getattr(kind, "user_id", None))
            return cell, None
        if keyboard and name in ("KeyboardButton", "KeyboardButtonType", "ButtonTypeDefault"):
            cell["kind"] = "keyboard"
            return cell, ("text", b.text)
        cell["kind"] = name
        return cell, None

    # Un captcha ou une question : le bot attend un texte avant de continuer
    MATH = re.compile(r"(-?\d+)\s*([+\-x×*/÷])\s*(-?\d+)\s*(?:=|\?|$)")
    CODE = re.compile(r"(?:code|captcha|enter|type|tape[zr]?|saisi[sr]|recopie[zr]?)\W{0,12}[«\"'`]?([A-Za-z0-9]{4,10})[»\"'`]?\b", re.I)
    ASKS = [
        (re.compile(r"quantit|how many|amount of|combien", re.I), "1"),
        (re.compile(r"post ?code|zip", re.I), "10001"),
        (re.compile(r"\bcity\b|ville", re.I), "New York"),
        (re.compile(r"\bstate\b|r[ée]gion", re.I), "NY"),
        (re.compile(r"address|street|adresse|\brue\b", re.I), "1 Test Street"),
        (re.compile(r"\bname\b|\bnom\b", re.I), "Test"),
        (re.compile(r"e-?mail", re.I), "test@example.com"),
        (re.compile(r"phone|t[ée]l[ée]phone", re.I), "+10000000000"),
        (re.compile(r"voucher|coupon|promo", re.I), "TEST"),
    ]
    ASKING = re.compile(r"\b(send|enter|type|reply|write|provide|input|solve|answer|envoye[zr]|entre[zr]|tape[zr]|[ée]cri(?:s|vez)|r[ée]ponde[zr]|r[ée]sou[ds])\b", re.I)
    JOIN = re.compile(r"\b(join|subscribe|rejoin|abonne)", re.I)

    def prompt_answer(self, text, markup_info):
        """La réponse de test à un captcha ou à une question, ou None."""
        raw = text or ""
        m = self.MATH.search(raw)
        if m and re.search(r"captcha|solve|r[ée]sou|calcul|human|humain|=|\?", raw, re.I):
            a, op, b = int(m.group(1)), m.group(2), int(m.group(3))
            value = {"+": a + b, "-": a - b, "x": a * b, "×": a * b, "*": a * b}.get(op)
            if value is None and b:
                value = a // b
            return str(value)
        m = self.CODE.search(raw)
        if m and re.search(r"captcha|code|v[ée]rif|human|humain", raw, re.I):
            return m.group(1)
        forced = (markup_info or {}).get("type") == "force_reply"
        if forced or self.ASKING.search(raw):
            for pattern, answer in self.ASKS:
                if pattern.search(raw + " " + ((markup_info or {}).get("placeholder") or "")):
                    return answer
            if forced:
                return "1"
        return None

    async def handle_gate(self, key, msg, rows):
        """Ce qui bloque un parcours : un captcha ou une question (on y répond par une valeur
        de test, en tête de file), un canal à rejoindre (on le rejoint une fois, puis le bouton
        « j'ai rejoint » est joué comme les autres)."""
        if key in self.answered:
            return
        answer = self.prompt_answer(msg.raw_text, self.describe_markup(msg.reply_markup))
        if answer is not None:
            self.answered.add(key)
            self.queue.appendleft(("text", answer))
            print(f"  question ou captcha détecté : réponse « {answer} » envoyée ensuite")
        if self.args.no_join or not self.JOIN.search(msg.raw_text or ""):
            return
        links = [c.get("url", "") for row in rows for c in row if c.get("kind") == "url"]
        links += re.findall(r"(?:https?://)?t\.me/[^\s)\]]+", msg.raw_text or "")
        for link in links:
            m = re.search(r"t\.me/(?:joinchat/|\+)([\w-]+)|t\.me/([A-Za-z][\w]{3,31})(?:[/?]|$)", link)
            if not m:
                continue
            target = m.group(1) or m.group(2)
            if target in self.joined or target.lower() in ("share", "addstickers", self.args.bot.lower()):
                continue
            try:
                if m.group(1):
                    await self.client(functions.messages.ImportChatInviteRequest(target))
                else:
                    await self.client(functions.channels.JoinChannelRequest(target))
                self.joined.append(target)
                print(f"  canal rejoint (exigé par le bot) : {target}")
                await asyncio.sleep(self.args.wait)
            except errors.UserAlreadyParticipantError:
                self.joined.append(target)
            except errors.RPCError as e:
                print(f"  impossible de rejoindre {target} : {type(e).__name__}")

    async def read_inline(self):
        """Le mode inline (@bot …) : ce que le bot propose pour une recherche vide et pour
        quelques mots de son propre vocabulaire."""
        try:
            me = await self.client.get_entity(self.bot)
            placeholder = getattr(me, "bot_inline_placeholder", None)
            if not placeholder:
                return
            results, seen = [], set()
            for q in ["", *list({w for s in list(self.screens.values())[:5] for w in re.findall(r"[A-Za-z]{4,}", s.get("raw", ""))})[:3]]:
                try:
                    found = await self.client.inline_query(me, q)
                except errors.RPCError:
                    continue
                for r in found[:20]:
                    rid = getattr(r.result, "id", None) or r.title
                    if rid in seen:
                        continue
                    seen.add(rid)
                    results.append({"query": q, "title": r.title or "", "description": r.description or "",
                                     "text": getattr(getattr(r.result, "send_message", None), "message", "") or "",
                                     "url": getattr(r.result, "url", None)})
            self.inline = {"placeholder": placeholder, "results": results[:60]}
            print(f"Mode inline : {len(results)} résultat(s) lu(s)")
        except errors.RPCError as e:
            print(f"Mode inline illisible ({type(e).__name__}).")

    @staticmethod
    def describe_markup(markup):
        """Les réglages du clavier : persistant, redimensionné, à usage unique, texte
        d'invite, réponse forcée, clavier retiré."""
        if isinstance(markup, types.ReplyKeyboardMarkup):
            return {"type": "keyboard", "resize": bool(markup.resize), "one_time": bool(markup.single_use),
                    "persistent": bool(getattr(markup, "persistent", False)), "placeholder": getattr(markup, "placeholder", None) or ""}
        if isinstance(markup, types.ReplyKeyboardForceReply):
            return {"type": "force_reply", "placeholder": getattr(markup, "placeholder", None) or ""}
        if isinstance(markup, types.ReplyKeyboardHide):
            return {"type": "remove_keyboard"}
        return None

    @staticmethod
    def _txt(v):
        """Un texte Telethon : chaîne, ou TextWithEntities (couches récentes)."""
        return v if isinstance(v, str) else getattr(v, "text", "") or ""

    def describe_content(self, msg):
        """Ce que le message porte en plus du texte : sondage, facture, position, lieu,
        contact, dé, média payant ; et l'album auquel il appartient."""
        m = msg.media
        out = {}
        if isinstance(m, types.MessageMediaPoll):
            poll = m.poll
            out["poll"] = {"question": self._txt(poll.question), "options": [self._txt(a.text) for a in poll.answers],
                           "quiz": bool(getattr(poll, "quiz", False)), "multiple": bool(getattr(poll, "multiple_choice", False))}
        elif isinstance(m, types.MessageMediaInvoice):
            out["invoice"] = {"title": m.title, "description": m.description, "currency": m.currency,
                              "amount": m.total_amount, "test": bool(getattr(m, "test", False))}
        elif isinstance(m, types.MessageMediaVenue):
            out["venue"] = {"title": m.title, "address": m.address, "lat": getattr(m.geo, "lat", None), "long": getattr(m.geo, "long", None)}
        elif isinstance(m, (types.MessageMediaGeo, types.MessageMediaGeoLive)):
            out["location"] = {"lat": getattr(m.geo, "lat", None), "long": getattr(m.geo, "long", None), "live": isinstance(m, types.MessageMediaGeoLive)}
        elif isinstance(m, types.MessageMediaContact):
            out["contact"] = {"name": " ".join(x for x in (m.first_name, m.last_name) if x), "phone": m.phone_number}
        elif isinstance(m, types.MessageMediaDice):
            out["dice"] = {"emoji": m.emoticon, "value": m.value}
        elif type(m).__name__ == "MessageMediaPaidMedia":
            out["paid_media"] = {"stars": getattr(m, "stars_amount", None), "count": len(getattr(m, "extended_media", []) or [])}
        elif type(m).__name__ in ("MessageMediaToDo", "MessageMediaChecklist"):
            todo = getattr(m, "todo", None)
            out["checklist"] = {"title": self._txt(getattr(todo, "title", "")), "items": [self._txt(getattr(i, "title", "")) for i in getattr(todo, "list", []) or []]}
        if msg.grouped_id:
            out["album"] = str(msg.grouped_id)
        return out

    @staticmethod
    def media_type(msg):
        """photo, video, animation (GIF), voice, audio, sticker, document… ou None."""
        if msg.photo:
            return "photo"
        for kind in ("sticker", "gif", "video_note", "video", "voice", "audio", "document"):
            if getattr(msg, kind, None):
                return "animation" if kind == "gif" else kind
        return None

    @staticmethod
    def norm(label):
        """Un libellé sans ses nombres : « 🛒 £0.00 » et « 🛒 £8.00 » sont le même bouton."""
        return re.sub(r"\d+(?:[.,]\d+)?", "#", (label or "").strip())

    @staticmethod
    def template(text_html, rows):
        """L'écran sans ses nombres : « 5.00 pcs [£35.00] » et « 6.00 pcs [£42.00] »
        sont le même écran, dont les boutons ne sont donc joués qu'une fois."""
        labels = [[c.get("text", "") for c in row] for row in rows]
        raw = json.dumps([text_html, labels], ensure_ascii=False)
        return hashlib.sha1(re.sub(r"\d+(?:[.,]\d+)?", "#", raw).encode()).hexdigest()[:12]

    async def capture(self, msg, source, path=None):
        rows = []
        markup = msg.reply_markup
        children = []
        # L'écran au chiffre près, connu avant les boutons : il sert à ne jouer chaque bouton
        # qu'une fois par écran
        tkey_now = None
        if isinstance(markup, (types.ReplyInlineMarkup, types.ReplyKeyboardMarkup)):
            tkey_now = self.template(msg.text or "", [[{"text": b.text} for b in row.buttons] for row in markup.rows])
        if isinstance(markup, (types.ReplyInlineMarkup, types.ReplyKeyboardMarkup)):
            for row in markup.rows:
                cells = []
                for b in row.buttons:
                    cell, child = self.describe_button(b, markup)
                    if child and child[0] == "cb":
                        child = ("cb", msg.id, child[2], child[3])
                        self.button_screen[child[2]] = tkey_now
                    if child:
                        children.append(child)
                    cells.append(cell)
                rows.append(cells)

        text_html = msg.text or ""
        media = await self.save_media(msg)
        markup_info = self.describe_markup(markup)
        # Ce que l'écran montre (texte, libellés, image), sans les données cachées des boutons :
        # beaucoup de bots y mettent un jeton qui change à chaque affichage, et le même écran
        # passerait pour un nouveau à chaque fois (boucle)
        shown = [[{k: v for k, v in c.items() if k not in ("data",)} for c in row] for row in rows]
        key = hashlib.sha1(json.dumps([text_html, shown, media], ensure_ascii=False).encode()).hexdigest()[:12]
        if key not in self.screens:
            tkey = self.template(text_html, rows)
            repeat = tkey in self.templates
            self.templates.add(tkey)
            if path is not None and key not in self.paths:
                self.paths[key] = path
            self.screens[key] = {
                "key": key,
                "order": len(self.screens) + 1,
                "message_id": msg.id,
                "date": msg.date.isoformat(),
                "html": text_html,
                "raw": msg.raw_text or "",
                "media": media,
                "media_type": self.media_type(msg) if media else None,
                "markup": markup_info,
                **self.describe_content(msg),
                "buttons": rows,
                "sources": [source],
            }
            # Captcha, question du bot, canal à rejoindre : traités avant le reste de la file
            if not repeat:
                await self.handle_gate(key, msg, rows)
            # Le même écran à un nombre près : ses boutons sont déjà en file ou joués
            if not repeat:
                for child in children:
                    if child[0] == "cb":
                        self.origin[base64.b64encode(child[2]).decode()] = key
                    self.enqueue(child)
                for cmd in COMMAND.findall(msg.raw_text or ""):
                    self.enqueue(("cmd", cmd))
        elif source not in self.screens[key]["sources"]:
            self.screens[key]["sources"].append(source)
        return key

    # ---- exécution ------------------------------------------------------

    @staticmethod
    def has_callback(msg, data):
        markup = msg and msg.reply_markup
        if not isinstance(markup, types.ReplyInlineMarkup):
            return False
        return any(getattr(getattr(b, "type", b), "data", None) == data
                   for row in markup.rows for b in row.buttons)

    async def button_message(self, msg_id, data):
        """Telegram refuse un callback absent du clavier actuel du message (DATA_INVALID).
        Si le message a été modifié depuis, on cherche un message récent qui porte encore ce bouton."""
        msg = await self.client.get_messages(self.bot, ids=msg_id)
        if self.has_callback(msg, data):
            return msg_id
        async for recent in self.client.iter_messages(self.bot, limit=30):
            if not recent.out and self.has_callback(recent, data):
                return recent.id
        return msg_id

    async def recent_buttons(self, limit=10):
        """Les boutons des derniers messages du bot, lus en une seule requête
        (Telegram limite le nombre de lectures de l'historique)."""
        out = []
        for recent in await self.client.get_messages(self.bot, limit=limit):
            markup = recent.reply_markup
            if recent.out or not isinstance(markup, types.ReplyInlineMarkup):
                continue
            out.append((recent.id, [(b.text, getattr(getattr(b, "type", b), "data", None))
                                    for row in markup.rows for b in row.buttons]))
        return out

    def pick(self, shown, label, data=None):
        """Dans des boutons déjà lus : par les données, le libellé, puis le libellé aux chiffres près."""
        for test in (lambda t, d: d == data or (label and t == label),
                     lambda t, d: label and self.norm(t) == self.norm(label)):
            for msg_id, buttons in shown:
                for text, bdata in buttons:
                    if bdata is not None and test(text, bdata):
                        return msg_id, bdata
        return None

    async def find_button(self, label, data=None, limit=10):
        """Le message récent du bot qui montre ce bouton."""
        return self.pick(await self.recent_buttons(limit), label, data)

    async def wait_button(self, label, data=None, timeout=6.0):
        """Le bouton, attendu le temps que le bot affiche ou modifie son écran
        (une lecture toutes les 1,5 s, pas plus)."""
        waited = 0.0
        while True:
            found = await self.find_button(label, data)
            if found or waited >= timeout:
                return found
            await asyncio.sleep(1.5)
            waited += 1.5

    async def go_back_to(self, data, label):
        """Le bot a remplacé l'écran qui portait ce bouton : on refait le chemin qui y
        mène (/start, puis les boutons), sans enregistrer ces écrans de passage."""
        return await self.reach(self.origin.get(base64.b64encode(data).decode()), label, data)

    async def reach(self, screen, label, data=None):
        """Affiche l'écran `screen` et y trouve le bouton `label` : depuis le dernier
        carrefour encore visible, sinon par le chemin complet."""
        path = self.paths.get(screen)
        if not path:
            return None
        # Le bouton est encore affiché quelque part : aucun chemin à refaire
        shown = await self.recent_buttons()
        here = self.pick(shown, label, data)
        if here:
            return here
        # Sinon on repart du dernier carrefour encore affiché (l'étape la plus avancée
        # du chemin dont le bouton est visible), pas de /start
        i = 0
        for j in range(len(path) - 1, -1, -1):
            if path[j][0] == "cb" and self.pick(shown, path[j][1]):
                i = j
                break
        print(f"  retour sur l'écran du bouton [{label}] ({len(path) - i} étape(s){' sur ' + str(len(path)) if i else ''})")
        found = await self.replay(path, i, data, label)
        if not found and i:
            # Le carrefour visible était périmé : chemin complet depuis le début
            print(f"  carrefour périmé : chemin complet ({len(path)} étape(s))")
            found = await self.replay(path, 0, data, label)
        if not found:
            print(f"  écran du bouton [{label}] introuvable après le retour")
        return found

    async def replay(self, path, i, data, label):
        """Rejoue le chemin à partir de l'étape i, puis attend le bouton voulu."""
        while i < len(path):
            kind, value = path[i]
            if kind in ("cmd", "text"):
                await self.client.send_message(self.bot, value)
                i += 1
                await asyncio.sleep(min(self.args.wait, 1.5))
                continue
            # Le bouton voulu est peut-être déjà là (raccourci) ; une seule lecture pour les deux
            shown = await self.recent_buttons()
            if self.pick(shown, label, data):
                break
            found = self.pick(shown, value) or await self.wait_button(value, timeout=4.5)
            if not found:
                # Une étape qui ne s'affiche plus (conditions déjà acceptées, âge déjà
                # confirmé…) : on saute à la première étape suivante visible
                later = None
                shown = await self.recent_buttons()
                for j in range(i + 1, len(path)):
                    if path[j][0] == "cb" and self.pick(shown, path[j][1]):
                        later = j
                        break
                if later is None:
                    break
                i = later
                continue
            try:
                await self.client(functions.messages.GetBotCallbackAnswerRequest(peer=self.bot, msg_id=found[0], data=found[1]))
            except errors.BotResponseTimeoutError:
                pass
            except errors.RPCError as e:
                print(f"  étape [{value}] refusée ({type(e).__name__})")
            i += 1
            await asyncio.sleep(min(self.args.wait, 1.5))
        latest = await self.client.get_messages(self.bot, limit=1)
        if latest:
            self.last_id = max(self.last_id, latest[0].id)
        return await self.wait_button(label, data)

    async def snapshot(self, msg_id):
        """Ce que montre un message : change quand le bot le modifie."""
        m = await self.client.get_messages(self.bot, ids=msg_id)
        if not m:
            return None
        rows = getattr(m.reply_markup, "rows", None) or []
        keys = [[b.text, base64.b64encode(b.data).decode() if getattr(b, "data", None) else None] for r in rows for b in r.buttons]
        return json.dumps([str(m.edit_date or ""), m.message or "", keys], ensure_ascii=False)

    async def wait_change(self, msg_id, before):
        """Après un clic : jusqu'à ce que le message pressé change ou que le bot en envoie un
        nouveau, EDIT_WAIT secondes au plus (une page relue trop tôt est l'ancienne, et
        ses pages suivantes ne sont jamais trouvées)."""
        waited = 0.0
        while waited < EDIT_WAIT:
            if before is not None and await self.snapshot(msg_id) != before:
                return
            latest = await self.client.get_messages(self.bot, limit=1)
            if latest and latest[0].id > self.last_id and not latest[0].out:
                return
            await asyncio.sleep(1.5)
            waited += 1.5

    async def perform(self, action):
        alert = None
        if action[0] in ("cmd", "text"):
            await self.client.send_message(self.bot, action[1])
        elif action[0] == "goto":
            _, screen, _, label = action
            found = await self.reach(screen, label)
            if not found:
                raise RouteLost(label)
            msg_id, data = found
            self.seen.add(("cb", data))
            self.origin[base64.b64encode(data).decode()] = screen
            self.before = (msg_id, await self.snapshot(msg_id))
            try:
                answer = await self.client(functions.messages.GetBotCallbackAnswerRequest(peer=self.bot, msg_id=msg_id, data=data))
            except errors.BotResponseTimeoutError:
                return None, msg_id
            return answer.message or (f"url: {answer.url}" if answer.url else None), msg_id
        else:
            _, msg_id, data, _label = action
            msg_id = await self.button_message(msg_id, data)
            current = await self.client.get_messages(self.bot, ids=msg_id)
            if not self.has_callback(current, data):
                found = await self.go_back_to(data, _label)
                if found:
                    msg_id, data = found
            self.before = (msg_id, await self.snapshot(msg_id))
            try:
                answer = await self.client(functions.messages.GetBotCallbackAnswerRequest(
                    peer=self.bot, msg_id=msg_id, data=data))
            except errors.BotResponseTimeoutError:
                # Le clic est parti, le bot n'a juste pas confirmé à temps : il modifie
                # souvent le message quand même, donc on le relit comme un clic réussi
                return None, msg_id
            alert = answer.message or (f"url: {answer.url}" if answer.url else None)
            return alert, msg_id
        return alert, None

    async def step(self, action):
        label = label_of(action)
        error = alert = pressed = None
        self.before = None
        for attempt in range(2):
            try:
                alert, pressed = await self.perform(action)
                break
            except errors.FloodWaitError:
                # Telegram impose une pause : elle se fait dans run(), hors du délai par action
                raise
            except RouteLost:
                error = "RouteLost"
                break
            except errors.RPCError as e:
                # Bouton périmé, bot muet, message supprimé… : on note et on passe à la suite
                error = type(e).__name__
                if action[0] == "cb" and isinstance(e, (errors.DataInvalidError, errors.MessageIdInvalidError)) \
                        and action[2] not in self.retried:
                    # Rejoué une fois en fin de file : l'écran aura peut-être été retrouvé d'ici là
                    self.retried.add(action[2])
                    self.queue.append(action)
                    error += " (nouvel essai plus tard)"
                break
        await asyncio.sleep(self.args.wait)
        if pressed and not error and self.before and self.before[0] == pressed:
            await self.wait_change(pressed, self.before[1])

        # Le chemin des écrans obtenus : celui de l'écran du bouton, plus ce bouton
        start = None
        if action[0] == "cb":
            start = self.origin.get(base64.b64encode(action[2]).decode())
        elif action[0] == "goto":
            start = action[1]
        if start is not None or action[0] in ("cb", "goto"):
            base = self.paths.get(start)
            path = base + [["cb", action[3]]] if base is not None else None
        else:
            path = [[action[0] if action[0] == "text" else "cmd", action[1]]]
        keys = []
        fresh = await self.client.get_messages(self.bot, min_id=self.last_id, limit=50)
        for msg in reversed(fresh):
            self.last_id = max(self.last_id, msg.id)
            if not msg.out:
                keys.append(await self.capture(msg, label, path))
        # The message the bot edited in place (a button under it was pressed): the app
        # shows the new screen in that same message, not as a new one
        edited_key = None
        if pressed:
            edited = await self.client.get_messages(self.bot, ids=pressed)
            if edited:
                edited_key = await self.capture(edited, label, path)
                keys.append(edited_key)
        if action[0] in ("cb", "goto") and not error:
            known = self.label_results.setdefault(self.norm(action[3]), {"played": 0, "screens": []})
            known["played"] += 1
            for k in keys:
                if k not in known["screens"]:
                    known["screens"].append(k)
        step = {"action": label, "alert": alert, "error": error, "screens": keys}
        if start:
            step["from"] = start
        # The button's exact callback data, same form as a screen's button data
        # (utf-8 decoded): lets the replica graph match a button to its edge without
        # label collisions. Only inline taps carry data.
        if action[0] == "cb":
            step["data"] = action[2].decode("utf-8", "replace")
        if edited_key and edited_key not in keys[:-1]:
            step["edited"] = edited_key
        self.steps.append(step)
        print(f"{len(self.steps):>4}  {label[:60]:<60} -> {len(keys)} écran(s){'  ' + error if error else ''}")

    async def run(self):
        if not self.steps:
            latest = await self.client.get_messages(self.bot, limit=1)
            self.last_id = latest[0].id if latest else 0
            for cmd in self.args.start:
                self.enqueue(("cmd", cmd))
        elif not self.queue:
            # Commandes restées sans réponse (délai dépassé, pause de Telegram) : rejouées
            failed = [st["action"] for st in self.steps
                      if st.get("error") in ("Timeout", "FloodWaitError") and not st["action"].startswith("[")]
            if not self.screens:
                failed = list(self.args.start) + failed
            for value in dict.fromkeys(failed):
                self.queue.append(("cmd", value))
            if self.queue:
                print(f"{len(self.queue)} commande(s) restée(s) sans réponse : rejouée(s).")
            else:
                print("Capture déjà complète : rien à rejouer (--fresh pour tout recommencer).")
        done = len(self.steps)
        while self.queue and len(self.steps) - done < self.args.max_actions:
            if stop_requested(self.args):
                print("Arrêt demandé.")
                break
            action = self.queue.popleft()
            try:
                await asyncio.wait_for(self.step(action), STEP_TIMEOUT)
            except errors.FloodWaitError as e:
                # Pause imposée par Telegram : l'action repart en tête de file, la capture
                # est enregistrée, et le parcours reprend tout seul à la fin de la pause
                self.queue.appendleft(action)
                self.save_state()
                if not await self.flood_pause(e.seconds):
                    print("Arrêt demandé pendant la pause : relancez (sans « Tout recommencer ») pour reprendre ici.")
                    break
                continue
            except asyncio.TimeoutError:
                label = label_of(action)
                self.steps.append({"action": label, "alert": None, "error": "Timeout", "screens": []})
                print(f"{len(self.steps):>4}  {label[:60]:<60} -> sans réponse après {STEP_TIMEOUT}s : passée")
                continue
            except (ConnectionError, OSError) as e:
                # Réseau coupé : l'action repart en tête de file, la capture est écrite,
                # puis on attend que la connexion revienne au lieu de s'arrêter
                self.queue.appendleft(action)
                self.save_state()
                print(f"Connexion perdue ({type(e).__name__}) : capture enregistrée, nouvel essai en cours…")
                if not await self.reconnect():
                    print("Pas de réseau depuis plusieurs minutes : arrêt. Relancez pour reprendre là où le parcours s'est arrêté.")
                    break
                continue
            except Exception as e:  # une erreur sur une action ne doit pas arrêter toute la capture
                label = label_of(action)
                self.steps.append({"action": label, "alert": None, "error": type(e).__name__, "screens": []})
                print(f"{len(self.steps):>4}  {label[:60]:<60} -> erreur {type(e).__name__} : {str(e)[:80]} (action passée)")
                continue
            if len(self.steps) % SAVE_EVERY == 0:
                self.save_state()
        if self.skipped_known:
            print(f"{self.skipped_known} bouton(s) déjà connus non rejoués (ils mènent toujours au même écran).")
        if self.queue:
            print(f"{len(self.queue)} action(s) non jouée(s) : relancez pour continuer là où le parcours s'est arrêté.")

    async def flood_pause(self, seconds):
        """Attend la fin de la pause imposée par Telegram (un arrêt reste possible).
        La capture ne peut pas aller plus vite : toute requête pendant la pause l'allonge."""
        until = time.strftime("%H:%M", time.localtime(time.time() + seconds))
        print(f"  pause imposée par Telegram : {seconds}s, reprise vers {until} (capture enregistrée)")
        left = seconds + 2
        while left > 0:
            if stop_requested(self.args):
                return False
            await asyncio.sleep(min(30, left))
            left -= 30
            if left > 0 and left % 300 < 30:
                print(f"  … encore {left // 60} min de pause imposée")
        print("  pause terminée : le parcours reprend")
        return True

    def add_retries(self, items):
        """Les routes choisies dans la vérification : un bouton d'un écran (on retourne
        sur cet écran puis on appuie), une commande ou un texte ; jouées en premier."""
        added = 0
        for item in reversed(items):
            if item.get("screen") in self.screens and item.get("label"):
                self.queue.appendleft(("goto", item["screen"], None, item["label"]))
            elif str(item.get("cmd", "")).startswith("/"):
                self.queue.appendleft(("cmd", item["cmd"]))
            elif item.get("text"):
                self.queue.appendleft(("text", item["text"]))
            else:
                continue
            added += 1
        print(f"{added} route(s) à relancer, jouées en premier.")

    async def complete(self):
        """Après le parcours : analyse les chemins (routes.py) et relance les routes
        manquantes ou en échec, en --complete passes au plus. Chaque route n'est relancée
        qu'une fois : si elle échoue encore, elle reste « en échec » dans check.json."""
        tried = set()
        for n in range(1, self.args.complete + 1):
            # Arrêt demandé, ou --max-actions atteint : la reprise continuera la file d'abord
            if stop_requested(self.args) or self.queue:
                return
            report = self.check()
            s = report["summary"]
            items = [it for it in retry_items(report) if json.dumps(it, sort_keys=True) not in tried
                     and not HAND_ONLY.search(it.get("label") or it.get("text") or "")]
            if not items:
                print(f"Chemins : {s['covered']}/{s['routes']} couverts ({s['coverage']} %), rien à compléter.")
                return
            print(f"Complétion {n}/{self.args.complete} : {s['covered']}/{s['routes']} chemins couverts, {len(items)} à relancer.")
            tried.update(json.dumps(it, sort_keys=True) for it in items)
            self.add_retries(items)
            await self.run()
        s = self.check()["summary"]
        print(f"Chemins après complétion : {s['covered']}/{s['routes']} couverts ({s['coverage']} %).")

    async def reconnect(self, tries=RECONNECT_TRIES):
        """Attend le retour du réseau (environ 10 minutes au plus), sans rien rejouer."""
        for i in range(tries):
            if stop_requested(self.args):
                return False
            await asyncio.sleep(RECONNECT_WAIT)
            try:
                if not self.client.is_connected():
                    await self.client.connect()
                await self.client.get_me()
                print("Connexion rétablie : le parcours continue.")
                return True
            except (ConnectionError, OSError) as e:
                print(f"  toujours pas de réseau ({i + 1}/{tries}) : {type(e).__name__}")
        return False

    # ---- reprise --------------------------------------------------------

    def save_state(self):
        def pack(action):
            return [base64.b64encode(x).decode() if isinstance(x, bytes) else x for x in action]
        state = {
            "queue": [pack(a) for a in self.queue],
            "seen": [[k, base64.b64encode(v).decode() if isinstance(v, bytes) else v] for k, v in (s for s in self.seen if len(s) == 2)],
            "seen_buttons": [list(s) for s in self.seen if len(s) == 3],
            "per_prefix": self.per_prefix, "media_cache": self.media_cache,
            "last_id": self.last_id, "ignored": self.ignored,
            "paths": self.paths, "origin": self.origin, "label_results": self.label_results,
            "edit_waited": True,
        }
        (self.out / "state.json").write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
        self.write_data()

    def load_state(self):
        state_file, data_file = self.out / "state.json", self.out / "data.json"
        if not (state_file.exists() and data_file.exists()):
            print("Rien à reprendre : nouveau parcours.")
            return
        state = json.loads(state_file.read_text(encoding="utf-8"))
        data = json.loads(data_file.read_text(encoding="utf-8"))
        self.steps = data["steps"]
        self.profile = data.get("profile") or {}
        self.inline = data.get("inline")
        self.joined = data.get("joined") or []
        self.screens = {s["key"]: s for s in data["screens"]}
        self.per_prefix, self.media_cache = state["per_prefix"], state["media_cache"]
        self.last_id, self.ignored = state["last_id"], state["ignored"]
        self.paths, self.origin = state.get("paths", {}), state.get("origin", {})
        self.label_results = state.get("label_results", {})
        if not state.get("edit_waited"):
            self.mark_read_too_early()
        self.templates = {self.template(s.get("html", ""), s.get("buttons", [])) for s in self.screens.values()}
        # Les données de callback sont des octets, encodés en base64 dans le JSON
        for action in state["queue"]:
            if action[0] == "cb":
                action[2] = base64.b64decode(action[2])
            self.queue.append(tuple(action))
        for kind, value in state["seen"]:
            self.seen.add((kind, base64.b64decode(value) if kind == "cb" else value))
        for item in state.get("seen_buttons", []):
            self.seen.add(tuple(item))
        # Une file enregistrée par une ancienne version garde un retour par écran : un seul par libellé
        played = {s["action"] for s in self.steps}
        queued, self.queue, dropped = list(self.queue), deque(), 0
        tiers = 0
        for action in queued:
            # Paliers de quantité mis en file par une ancienne version : jamais pressés
            if action[0] in ("cb", "goto") and HAND_ONLY.search(action[3] or ""):
                tiers += 1
                continue
            if action[0] == "cb" and BACK.search(action[3] or ""):
                key = ("back", action[3].strip())
                if key in self.seen or f"[{action[3]}]" in played:
                    dropped += 1
                    continue
                self.seen.add(key)
            self.queue.append(action)
        print(f"Reprise : {len(self.steps)} actions déjà jouées, {len(self.queue)} en attente"
              f"{f' ({dropped} retours en double retirés)' if dropped else ''}"
              f"{f' ({tiers} paliers de quantité retirés : jamais pressés)' if tiers else ''}.")

    def mark_read_too_early(self):
        """Capture faite avant l'attente de la modification (wait_change) : un bouton qui n'a
        rien ouvert, ou seulement l'écran où il était, a sans doute été relu trop tôt (les
        pages suivantes d'une liste de produits). Marqué en échec, une fois, pour que la
        complétion le rejoue."""
        n = 0
        for s in self.steps:
            action = str(s.get("action", ""))
            if not action.startswith("[") or HAND_ONLY.search(action):
                continue
            if any(k != s.get("from") for k in s.get("screens") or []):
                continue
            s["error"] = "ReadTooEarly"
            self.label_results.pop(self.norm(action[1:-1]), None)
            n += 1
        if n:
            print(f"{n} bouton(s) lu(s) trop tôt par l'ancienne version : rejoué(s) à la complétion.")

    async def read_profile(self):
        """Ce que le bot montre de lui-même : nom, description, commandes du menu, photo.
        Sert à la réplique du bot (même profil, même menu de commandes)."""
        try:
            full = await self.client(functions.users.GetFullUserRequest(self.bot))
            user = full.users[0] if full.users else self.bot
            info = full.full_user.bot_info
            photo = intro_photo = None
            if not self.args.no_media:
                path = await self.client.download_profile_photo(self.bot, file=str(self.media_dir / "profile"))
                photo = Path(path).name if path else None
                # L'image montrée au-dessus de la description, avant /start
                if info and getattr(info, "description_photo", None):
                    path = await self.client.download_media(info.description_photo, file=str(self.media_dir / "intro"))
                    intro_photo = Path(path).name if path else None
            menu = getattr(info, "menu_button", None) if info else None
            self.profile = {
                "name": " ".join(x for x in (user.first_name, user.last_name) if x),
                "username": user.username or "",
                "about": full.full_user.about or "",
                "description": (info.description if info else "") or "",
                "commands": [{"command": c.command, "description": c.description} for c in (info.commands if info else []) or []],
                "photo": photo,
                "intro_photo": intro_photo,
                # Bouton à gauche du champ de saisie : la liste des commandes ou une web app
                "menu_button": {"text": getattr(menu, "text", ""), "url": getattr(menu, "url", "")} if menu and hasattr(menu, "url") else None,
            }
            print(f"Profil : {self.profile['name']} · {len(self.profile['commands'])} commande(s)"
                  f"{' · photo' if photo else ''}{' · image d’accueil' if intro_photo else ''}")
        except errors.RPCError as e:
            print(f"Profil du bot illisible ({type(e).__name__}) : la capture continue sans.")

    # ---- sorties --------------------------------------------------------

    def data(self):
        return {"bot": self.args.bot, "profile": self.profile, "inline": self.inline, "joined": self.joined,
                "steps": self.steps, "ignored": sorted(set(self.ignored)),
                "screens": sorted(self.screens.values(), key=lambda s: s["order"])}

    def check(self):
        """Les chemins de la capture telle qu'elle est (routes.py), file d'attente comprise."""
        queue = [[base64.b64encode(x).decode() if isinstance(x, bytes) else x for x in a] for a in self.queue]
        return check(self.data(), {"paths": self.paths, "origin": self.origin, "queue": queue})

    def write_data(self):
        data = self.data()
        (self.out / "data.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        (self.out / "check.json").write_text(json.dumps(self.check(), ensure_ascii=False, indent=2), encoding="utf-8")
        return data["screens"]

    def write(self):
        self.save_state()
        screens = sorted(self.screens.values(), key=lambda s: s["order"])

        cards = []
        for s in screens:
            img = ""
            if s["media"] and s["media"].lower().endswith(IMAGE_EXT):
                img = f'<img src="media/{html.escape(s["media"])}" alt="">'
            elif s["media"]:
                img = f'<p class="file">Fichier : <a href="media/{html.escape(s["media"])}">{html.escape(s["media"])}</a></p>'
            buttons = "".join(
                '<div class="row">' + "".join(
                    f'<span class="btn {c["kind"]}" title="{html.escape(c.get("data") or c.get("url") or "")}">'
                    f'{html.escape(c["text"])}</span>' for c in row) + "</div>"
                for row in s["buttons"])
            body = s["html"].replace("\n", "<br>")
            cards.append(
                f'<section id="s{s["order"]}"><header>#{s["order"]} · via '
                f'{html.escape(", ".join(s["sources"]))}</header>{img}'
                f'<div class="text">{body}</div><div class="kb">{buttons}</div></section>')

        ignored = sorted(set(self.ignored))
        skipped = (f'<section><header>Actions ignorées ({len(ignored)})</header><div class="text">'
                   f'{html.escape(" · ".join(ignored))}</div></section>') if ignored else ""
        page = f"""<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Parcours @{html.escape(self.args.bot)}</title><style>
body{{margin:0;background:#0e1621;color:#e9eef3;font:15px/1.45 system-ui,sans-serif}}
main{{max-width:560px;margin:0 auto;padding:16px}}
h1{{font-size:18px}} section{{background:#182533;border-radius:12px;margin:0 0 18px;overflow:hidden}}
header{{font-size:12px;color:#7f91a4;padding:8px 12px}} img{{display:block;width:100%}}
.text{{padding:10px 12px;word-wrap:break-word}} .text a{{color:#6ab2f2}}
.kb{{padding:0 6px 6px}} .row{{display:flex;gap:4px;margin-top:4px}}
.btn{{flex:1;text-align:center;background:#2b5278;border-radius:6px;padding:7px 4px;font-size:13px}}
.btn.url::after{{content:" ↗"}} .btn.keyboard{{background:#26313d}} .file{{padding:0 12px}}
</style></head><body><main><h1>@{html.escape(self.args.bot)} : {len(screens)} écrans, {len(self.steps)} actions</h1>
{''.join(cards)}{skipped}</main></body></html>"""
        (self.out / "report.html").write_text(page, encoding="utf-8")


def parse_args():
    parser = argparse.ArgumentParser(description="Parcourt un bot Telegram et enregistre ses écrans.")
    parser.add_argument("bots", nargs="+", metavar="bot",
                        help="un ou plusieurs bots (QTMARKETBOT, @QTMARKETBOT ou lien t.me)")
    parser.add_argument("--out", help="dossier de sortie (un seul bot) ; sinon <captures-dir>/<bot>")
    parser.add_argument("--captures-dir", default=str(DEFAULT_CAPTURES),
                        help=f"racine des captures, un sous-dossier par bot (défaut : {DEFAULT_CAPTURES})")
    parser.add_argument("--profile", default="explorer", help="session créée par login.py --profile")
    parser.add_argument("--start", action="append", metavar="CMD",
                        help="message(s) de départ, répétable (défaut : /start)")
    parser.add_argument("--wait", type=float, default=2.5, help="secondes d'attente après chaque action")
    parser.add_argument("--max-actions", type=int, default=200)
    parser.add_argument("--max-per-prefix", type=int, default=0,
                        help="nombre max de commandes d'une même famille (/p1, /p2...)")
    parser.add_argument("--no-commands", action="store_true", help="ne pas envoyer les commandes trouvées dans les textes")
    parser.add_argument("--retry", metavar="FICHIER", help="routes à relancer (JSON écrit par la vérification)")
    parser.add_argument("--complete", type=int, default=3, metavar="N",
                        help="passes de complétion après le parcours : routes manquantes relancées (0 = aucune)")
    parser.add_argument("--no-join", action="store_true", help="ne pas rejoindre les canaux que le bot exige")
    parser.add_argument("--no-inline", action="store_true", help="ne pas lire le mode inline du bot")
    parser.add_argument("--no-media", action="store_true", help="ne pas télécharger les images et fichiers")
    parser.add_argument("--max-media-mb", type=int, default=20, help="taille max d'un média téléchargé")
    parser.add_argument("--skip", action="append", default=[], metavar="REGEX",
                        help="motif supplémentaire à ne jamais jouer, répétable")
    parser.add_argument("--strict", action="store_true",
                        help="liste d'exclusion large : ignore aussi panier, commandes, checkout, dépôt")
    parser.add_argument("--no-default-skip", action="store_true",
                        help="retirer la liste par défaut (suppression, vidage, retrait de fonds)")
    parser.add_argument("--allow", action="append", default=[], metavar="REGEX",
                        help="motif à jouer malgré la liste d'exclusion, répétable")
    parser.add_argument("--fresh", action="store_true",
                        help="tout recommencer : efface la capture existante au lieu de la reprendre")
    parser.add_argument("--resume", action="store_true", help=argparse.SUPPRESS)  # reprise par défaut désormais
    parser.add_argument("--stop-file", metavar="PATH",
                        help="s'arrêter proprement dès que ce fichier existe (utilisé par les interfaces)")
    args = parser.parse_args()
    if args.out and len(args.bots) > 1:
        parser.error("--out ne vaut que pour un seul bot ; utilisez --captures-dir pour plusieurs")
    args.bots = [normalize_bot(b) for b in args.bots]
    args.start = args.start or ["/start"]
    return args


async def explore_bot(client, name, args):
    out = Path(args.out) if args.out else Path(args.captures_dir) / name.lower()
    out.mkdir(parents=True, exist_ok=True)
    args = argparse.Namespace(**{**vars(args), "bot": name})
    print(f"== @{name} -> {out}")
    explorer = Explorer(client, await client.get_entity(name), out, args)
    # Une capture existante est reprise : rien de ce qui a déjà été joué ne l'est à nouveau
    if not args.fresh:
        explorer.load_state()
    if args.retry:
        explorer.add_retries(json.loads(Path(args.retry).read_text(encoding="utf-8")))
    await explorer.read_profile()
    try:
        await explorer.run()
        await explorer.complete()
        if not args.no_inline:
            await explorer.read_inline()
    finally:
        explorer.write()
        print(f"Rapport : {out / 'report.html'}")


async def main():
    args = parse_args()
    if args.stop_file:
        Path(args.stop_file).unlink(missing_ok=True)
    # Coupures réseau : Telethon réessaie plus longtemps avant d'abandonner
    client, _ = make_client(args.profile, connection_retries=10, retry_delay=5)
    client.parse_mode = "html"
    await client.connect()
    try:
        if not await client.is_user_authorized():
            print("Pas de session : lance d'abord login.py.")
            return
        for name in args.bots:
            if stop_requested(args):
                break
            try:
                await explore_bot(client, name, args)
            except (ValueError, errors.RPCError) as e:
                print(f"Bot @{name} inaccessible : {e}")
    finally:
        await client.disconnect()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Interrompu : la capture partielle a été écrite.")
    except (ConnectionError, OSError) as e:
        print(f"Connexion à Telegram impossible ({e}). La capture est enregistrée : relancez quand le réseau est revenu.")
        raise SystemExit(1)
