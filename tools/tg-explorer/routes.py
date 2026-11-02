"""Analyse des chemins d'une capture, écran par écran.

Même logique que backend/src/services/captureCheck.js, sans la partie réplique (propre
à la plateforme) : un embranchement est un écran capturé qui a des routes à suivre (ses
boutons, les textes de son clavier, les commandes écrites dans son texte). Chaque route
est capturée (elle a ouvert un écran enregistré), jouée sans nouvel écran (une alerte,
le même écran), en file, en échec, laissée de côté exprès (liste d'exclusion, le même
bouton sur le même écran au chiffre près, un bouton qui ouvre toujours le même écran)
ou manquante. Les routes manquantes ou en échec qu'on sait rejouer portent un « retry » :
c'est ce que la complétion (explore.py --complete) relance.

À garder en accord avec captureCheck.js : tools/tg-explorer et la plateforme doivent
compter les mêmes chemins.
"""
import json
import re

ROUTE = {"callback", "keyboard"}
LINK = {"url", "login_url", "web_app", "copy", "switch_inline", "pay", "request_contact",
        "request_location", "request_poll", "request_users", "request_chat"}
COVERED = {"captured", "end", "equivalent"}
# Même règle qu'explore.py : une commande écrite dans un texte
COMMAND = re.compile(r"(?<![\w/])/[A-Za-z][A-Za-z0-9_]{0,31}")
BACK = re.compile(r"⇇|⇆|^\W*back\b", re.I)


def norm(label):
    """Un libellé ou un texte sans ses nombres : « Page 1 of 3 » et « Page 2 of 3 » sont la même route."""
    return re.sub(r"\d+(?:[.,]\d+)?", "#", str(label or "").strip())


def template_of(s):
    """L'écran au chiffre près (texte et libellés des boutons), comme captureCheck.js."""
    shown = [s.get("html") or "", [[b.get("text") or "" for b in row] for row in s.get("buttons") or []]]
    return norm(json.dumps(shown, ensure_ascii=False, separators=(",", ":")))


def step_label(b):
    """Le libellé que porte l'étape de ce bouton : [texte], ou le texte tapé."""
    return b["text"] if b.get("kind") == "keyboard" else f"[{b['text']}]"


def is_back(b):
    return bool(BACK.search(b.get("text") or "")) or str(b.get("data") or "").startswith("/back_")


def target_of(screens, screen, button):
    """L'écran qu'ouvre un bouton : le plus proche écran suivant atteint par ce libellé."""
    label = step_label(button)
    later = [s for s in screens if s["order"] > screen["order"] and label in (s.get("sources") or [])]
    return min(later, key=lambda s: s["order"]) if later else None


def check(data, state=None):
    state = state or {}
    screens = sorted(data.get("screens") or [], key=lambda s: s["order"])
    steps = data.get("steps") or []
    ignored = set(data.get("ignored") or [])
    paths = state.get("paths") or {}
    origin = state.get("origin") or {}
    label_results = state.get("label_results") or {}
    queued = []
    for a in state.get("queue") or []:
        if a[0] == "cb":
            queued.append({"label": f"[{a[3]}]", "from": origin.get(a[2])})
        elif a[0] == "goto":
            queued.append({"label": f"[{a[3]}]", "from": a[1]})
        else:
            queued.append({"label": a[1], "from": None})
    opened = {src for s in screens for src in s.get("sources") or []}
    template = {s["key"]: template_of(s) for s in screens}

    # Un bouton ne compte comme couvert ailleurs que sur le même écran au chiffre près
    # (l'explorateur ne l'y joue qu'une fois), ou s'il a toujours ouvert le même écran
    covered_on = {}
    for st in steps:
        if st.get("error") or not st.get("from") or st["from"] not in template:
            continue
        covered_on.setdefault(template[st["from"]], set()).add(norm(st["action"]))

    def always_same(b):
        k = label_results.get(norm(b["text"]))
        return bool(k) and k.get("played", 0) >= 2 and len(k.get("screens") or []) == 1

    def command_status(cmd):
        tried = [st for st in steps if st["action"] == cmd]
        if cmd in opened:
            return {"status": "captured"}
        if cmd in ignored:
            return {"status": "ignored"}
        if any(not st.get("error") for st in tried):
            return {"status": "end"}
        if any(q["label"] == cmd for q in queued):
            return {"status": "pending"}
        if tried:
            return {"status": "failed", "error": tried[-1].get("error")}
        return {"status": "missing"}

    crossroads = []
    commands_seen = set()
    for s in screens:
        routes = []
        for b in (cell for row in s.get("buttons") or [] for cell in row):
            kind = b.get("kind")
            if kind not in ROUTE and kind not in LINK:
                continue
            route = {"label": b["text"], "kind": kind, "status": "missing"}
            if kind in LINK:
                route["status"] = "link"
            elif b.get("disabled"):
                route["status"] = "disabled"
            else:
                label = step_label(b)
                target = target_of(screens, s, b)
                tried = [st for st in steps if st["action"] == label and (not st.get("from") or st["from"] == s["key"])]
                if target:
                    route["status"] = "captured"
                    route["target"] = target["key"]
                elif b["text"] in ignored or label in ignored:
                    route["status"] = "ignored"
                elif any(not st.get("error") for st in tried):
                    route["status"] = "end"
                elif any(q["label"] == label and (not q["from"] or q["from"] == s["key"]) for q in queued):
                    route["status"] = "pending"
                elif tried:
                    route["status"] = "failed"
                    route["error"] = tried[-1].get("error")
                elif is_back(b) or norm(label) in covered_on.get(template[s["key"]], set()) or always_same(b):
                    route["status"] = "equivalent"
                # Ce qu'on sait rejouer : un texte tapé, ou un bouton d'un écran dont le chemin est connu
                if route["status"] not in COVERED and route["status"] != "ignored":
                    if kind == "keyboard":
                        route["retry"] = {"text": b["text"]}
                    elif s["key"] in paths:
                        route["retry"] = {"screen": s["key"], "label": b["text"]}
            routes.append(route)
        # Les commandes écrites dans le texte sont des routes aussi (vues une fois, là où elles apparaissent)
        for cmd in dict.fromkeys(COMMAND.findall(s.get("raw") or "")):
            if cmd in commands_seen:
                continue
            commands_seen.add(cmd)
            route = {"label": cmd, "kind": "command", **command_status(cmd)}
            if route["status"] not in COVERED and route["status"] != "ignored":
                route["retry"] = {"cmd": cmd}
            routes.append(route)
        if routes:
            crossroads.append({"key": s["key"], "order": s["order"], "routes": routes})

    # Le menu de commandes du bot : chaque commande a ouvert un écran, ou non
    commands = []
    for c in (data.get("profile") or {}).get("commands") or []:
        cmd = "/" + str(c.get("command") if isinstance(c, dict) else c).lstrip("/")
        entry = {"command": cmd, **command_status(cmd)}
        if entry["status"] not in COVERED and entry["status"] != "ignored":
            entry["retry"] = {"cmd": cmd}
        commands.append(entry)

    routes = [r for c in crossroads for r in c["routes"]]
    counted = [r for r in routes if (r["kind"] in ROUTE or r["kind"] == "command") and r["status"] not in ("disabled", "ignored")]
    counted += [c for c in commands if c["status"] != "ignored"]
    covered = sum(r["status"] in COVERED for r in counted)

    def count(status):
        return sum(r["status"] == status for r in routes) + sum(c["status"] == status for c in commands)

    summary = {
        "crossroads": len(crossroads), "screens": len(screens), "routes": len(counted), "covered": covered,
        "coverage": round(covered / len(counted) * 100) if counted else 100,
        "captured": count("captured"), "end": count("end"), "equivalent": count("equivalent"),
        "pending": count("pending"), "failed": count("failed"), "missing": count("missing"),
        "ignored": count("ignored"), "links": count("link"),
        "textCommands": sum(r["kind"] == "command" for r in routes),
        "retryable": sum("retry" in r for r in routes) + sum("retry" in c for c in commands),
    }
    return {"bot": data.get("bot"), "summary": summary, "crossroads": crossroads, "commands": commands}


def retry_items(report):
    """Les routes à relancer, dans l'ordre des écrans, puis les commandes du menu.
    Une même commande (vue dans un texte et dans le menu) n'est relancée qu'une fois."""
    items = [r["retry"] for c in report["crossroads"] for r in c["routes"] if "retry" in r]
    items += [c["retry"] for c in report["commands"] if "retry" in c]
    return list({json.dumps(it, sort_keys=True): it for it in items}.values())
