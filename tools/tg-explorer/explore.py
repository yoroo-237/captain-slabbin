"""Parcours automatique d'un bot Telegram avec la session créée par login.py.

Envoie /start, rejoue chaque bouton inline, envoie les boutons de clavier et
les commandes trouvées dans les textes, puis écrit :
  <out>/data.json    tous les écrans, toutes les étapes, ce qui a été ignoré
  <out>/media/       les images et fichiers reçus
  <out>/report.html  une page de lecture façon chat
  <out>/state.json   file d'attente, pour reprendre avec --resume

Les boutons qui ressemblent à un achat, un paiement ou une suppression sont
ignorés pour ne rien déclencher chez le bot parcouru (voir --skip / --allow).

Usage : python explore.py QTMARKETBOT --out M:\\tmp\\qt-capture
"""
import argparse
import asyncio
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

# Seulement ce qui détruit ou vide quelque chose (suppression, retrait de fonds). Achats,
# paiements, confirmations, panier, commandes, checkout et dépôt sont parcourus : le
# compte n'a pas de carte liée. A resserrer avec --strict si le bot a un vrai solde.
DEFAULT_SKIP = r"delete|remove|clear|withdraw|supprimer|retirer|vider|effacer"
# Ancienne liste, large : ignore aussi tout ce qui contient cart, order, checkout, deposit...
STRICT_SKIP = (
    r"buy|pay|checkout|order|confirm|cart|purchase|delete|remove|cancel|withdraw|deposit|"
    r"acheter|payer|commander|panier|supprimer|annuler"
)
COMMAND = re.compile(r"(?<![\w/])/[A-Za-z][A-Za-z0-9_]{0,31}")
IMAGE_EXT = (".jpg", ".jpeg", ".png", ".webp", ".gif")
SAVE_EVERY = 10
DEFAULT_CAPTURES = Path(__file__).with_name("captures")


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
            if self.per_prefix.get(prefix, 0) >= self.args.max_per_prefix:
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
        """Une cellule du clavier, quelle que soit la couche Telegram (b.type en récent)."""
        cell = {"text": b.text}
        kind = getattr(b, "type", b)
        name = type(kind).__name__
        if "Callback" in name and hasattr(kind, "data"):
            cell.update(kind="callback", data=kind.data.decode("utf-8", "replace"))
            return cell, ("cb", None, kind.data, b.text)
        if "Url" in name and hasattr(kind, "url"):
            cell.update(kind="url", url=kind.url)
            return cell, None
        if isinstance(markup, types.ReplyKeyboardMarkup) and name in ("KeyboardButton", "KeyboardButtonType"):
            cell["kind"] = "keyboard"
            return cell, ("text", b.text)
        cell["kind"] = name
        return cell, None

    async def capture(self, msg, source):
        rows = []
        markup = msg.reply_markup
        children = []
        if isinstance(markup, (types.ReplyInlineMarkup, types.ReplyKeyboardMarkup)):
            for row in markup.rows:
                cells = []
                for b in row.buttons:
                    cell, child = self.describe_button(b, markup)
                    if child and child[0] == "cb":
                        child = ("cb", msg.id, child[2], child[3])
                    if child:
                        children.append(child)
                    cells.append(cell)
                rows.append(cells)

        text_html = msg.text or ""
        media = await self.save_media(msg)
        key = hashlib.sha1(json.dumps([text_html, rows, media], ensure_ascii=False).encode()).hexdigest()[:12]
        if key not in self.screens:
            self.screens[key] = {
                "key": key,
                "order": len(self.screens) + 1,
                "message_id": msg.id,
                "date": msg.date.isoformat(),
                "html": text_html,
                "raw": msg.raw_text or "",
                "media": media,
                "buttons": rows,
                "sources": [source],
            }
            for child in children:
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

    async def perform(self, action):
        alert = None
        if action[0] in ("cmd", "text"):
            await self.client.send_message(self.bot, action[1])
        else:
            _, msg_id, data, _label = action
            msg_id = await self.button_message(msg_id, data)
            answer = await self.client(functions.messages.GetBotCallbackAnswerRequest(
                peer=self.bot, msg_id=msg_id, data=data))
            alert = answer.message or (f"url: {answer.url}" if answer.url else None)
            return alert, msg_id
        return alert, None

    async def step(self, action):
        label = action[1] if action[0] != "cb" else f"[{action[3]}]"
        error = alert = pressed = None
        for attempt in range(2):
            try:
                alert, pressed = await self.perform(action)
                break
            except errors.FloodWaitError as e:
                print(f"  attente imposée par Telegram : {e.seconds}s")
                await asyncio.sleep(e.seconds + 1)
                error = type(e).__name__ if attempt else None
            except errors.RPCError as e:
                # Bouton périmé, bot muet, message supprimé… : on note et on passe à la suite
                error = type(e).__name__
                break
        await asyncio.sleep(self.args.wait)

        keys = []
        fresh = await self.client.get_messages(self.bot, min_id=self.last_id, limit=50)
        for msg in reversed(fresh):
            self.last_id = max(self.last_id, msg.id)
            if not msg.out:
                keys.append(await self.capture(msg, label))
        if pressed:
            edited = await self.client.get_messages(self.bot, ids=pressed)
            if edited:
                keys.append(await self.capture(edited, label))
        self.steps.append({"action": label, "alert": alert, "error": error, "screens": keys})
        print(f"{len(self.steps):>4}  {label[:60]:<60} -> {len(keys)} écran(s){'  ' + error if error else ''}")

    async def run(self):
        if not self.steps:
            latest = await self.client.get_messages(self.bot, limit=1)
            self.last_id = latest[0].id if latest else 0
            for cmd in self.args.start:
                self.enqueue(("cmd", cmd))
        while self.queue and len(self.steps) < self.args.max_actions:
            if stop_requested(self.args):
                print("Arrêt demandé.")
                break
            await self.step(self.queue.popleft())
            if len(self.steps) % SAVE_EVERY == 0:
                self.save_state()
        if self.queue:
            print(f"{len(self.queue)} action(s) non jouée(s) (reprise : --resume).")

    # ---- reprise --------------------------------------------------------

    def save_state(self):
        def pack(action):
            return [base64.b64encode(x).decode() if isinstance(x, bytes) else x for x in action]
        state = {
            "queue": [pack(a) for a in self.queue],
            "seen": [[k, base64.b64encode(v).decode() if isinstance(v, bytes) else v] for k, v in self.seen],
            "per_prefix": self.per_prefix, "media_cache": self.media_cache,
            "last_id": self.last_id, "ignored": self.ignored,
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
        self.screens = {s["key"]: s for s in data["screens"]}
        self.per_prefix, self.media_cache = state["per_prefix"], state["media_cache"]
        self.last_id, self.ignored = state["last_id"], state["ignored"]
        # Les données de callback sont des octets, encodés en base64 dans le JSON
        for action in state["queue"]:
            if action[0] == "cb":
                action[2] = base64.b64decode(action[2])
            self.queue.append(tuple(action))
        for kind, value in state["seen"]:
            self.seen.add((kind, base64.b64decode(value) if kind == "cb" else value))
        print(f"Reprise : {len(self.steps)} actions déjà jouées, {len(self.queue)} en attente.")

    # ---- sorties --------------------------------------------------------

    def write_data(self):
        screens = sorted(self.screens.values(), key=lambda s: s["order"])
        (self.out / "data.json").write_text(json.dumps(
            {"bot": self.args.bot, "steps": self.steps, "ignored": sorted(set(self.ignored)),
             "screens": screens}, ensure_ascii=False, indent=2), encoding="utf-8")
        return screens

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
    parser.add_argument("--max-per-prefix", type=int, default=12,
                        help="nombre max de commandes d'une même famille (/p1, /p2...)")
    parser.add_argument("--no-commands", action="store_true", help="ne pas envoyer les commandes trouvées dans les textes")
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
    parser.add_argument("--resume", action="store_true", help="reprendre le parcours enregistré dans --out")
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
    if args.resume:
        explorer.load_state()
    try:
        await explorer.run()
    finally:
        explorer.write()
        print(f"Rapport : {out / 'report.html'}")


async def main():
    args = parse_args()
    if args.stop_file:
        Path(args.stop_file).unlink(missing_ok=True)
    client, _ = make_client(args.profile)
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
