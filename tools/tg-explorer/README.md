# tg-explorer

Parcourt n'importe quel bot Telegram avec votre compte utilisateur et enregistre
ses écrans (textes, boutons, images). La sortie se donne ensuite à
`backend/scripts/import-bot-capture.js` (style) et
`backend/scripts/import-products-from-capture.js` (produits).

Rien de secret n'est dans ce dossier : les clés et la session restent dans
`C:\Users\Miguel\.tg-explorer\` (ou dans un `.env` ignoré par git).

## Installation (une fois)

```powershell
cd M:\Travail\mario\tools\tg-explorer
python -m pip install -r requirements.txt
```

La configuration se lit, dans l'ordre : variables d'environnement, `.env` à côté
des scripts, `C:\Users\Miguel\.tg-explorer\config.env` :

```
API_ID=...
API_HASH=...
PHONE=+...
```

(API_ID et API_HASH viennent de https://my.telegram.org, rubrique API development tools.)

## Connexion (une fois par profil)

```powershell
python login.py                    # session « explorer »
python login.py --profile autre    # un second compte
```

Telegram envoie un code dans l'application : tapez-le dans le terminal (et le
mot de passe 2FA s'il y en a un).

## Parcours

```powershell
python explore.py QTMARKETBOT
python explore.py BOT1 BOT2 @BOT3     # plusieurs bots d'un coup
```

Chaque bot a son dossier de capture, créé automatiquement :
`tools/tg-explorer/captures/<bot en minuscules>/` (ignoré par git). Changez la
racine avec `--captures-dir`, ou fixez un dossier précis avec `--out` (un seul bot).
Un bot introuvable est signalé, puis le suivant continue.

Le bot peut s'écrire `QTMARKETBOT`, `@QTMARKETBOT` ou `https://t.me/QTMARKETBOT?start=x`.

| Option | Effet |
|---|---|
| `--profile NOM` | session créée par `login.py --profile NOM` |
| `--start CMD` | message(s) de départ, répétable (défaut `/start`), ex. `--start "/start ref42"` |
| `--wait 2.5` | secondes entre deux actions |
| `--max-actions 200` | nombre maximal d'actions jouées |
| `--max-per-prefix 12` | combien de /p1, /p2… au plus |
| `--no-commands` | ne pas envoyer les commandes trouvées dans les textes |
| `--no-media`, `--max-media-mb 20` | ne pas télécharger les médias / taille maximale |
| `--skip REGEX` | motif supplémentaire à ne jamais jouer (répétable) |
| `--allow REGEX` | motif à jouer malgré la liste d'exclusion (répétable) |
| `--no-default-skip` | retire la liste d'exclusion par défaut (à utiliser avec prudence) |
| `--resume` | reprend le parcours enregistré dans `--out` |
| `--stop-file PATH` | s'arrête proprement (capture écrite) dès que ce fichier existe ; utilisé par le bouton **Arrêter** |

Sortie : `data.json` (écrans, étapes, actions ignorées), `media/` (images),
`report.html` (lecture façon chat), `state.json` (file d'attente pour `--resume`).
L'écriture se fait aussi en cas de Ctrl+C ou d'erreur, et tous les 10 pas.

## Ce que le parcours ne touche pas

Par défaut, tout bouton ou commande contenant buy, pay, checkout, order, confirm,
cart, purchase, delete, remove, cancel, withdraw, deposit (et leurs équivalents
français) est ignoré, pour ne rien acheter ni supprimer. La liste des actions
ignorées est dans `data.json` (`ignored`) et en bas de `report.html`. Ces écrans
(`/cart`, `/orders`, paiement) se capturent à la main, ou avec `--allow` quand
vous savez que c'est sans danger, par exemple `--allow "^/cart$"`.

## Interface web

Double-clic sur `lancer.bat` (installe et construit la première fois, puis ouvre
http://127.0.0.1:5174), ou à la main :

```powershell
cd web
npm install; npm run build     # une fois
npm start
```

Une interface React locale (serveur Node sans dépendance, écoute sur 127.0.0.1
uniquement) pour : saisir un ou plusieurs bots, régler les options, lancer la
**connexion** (ouvre une console où taper le code Telegram, il ne passe pas par la
page), **explorer** avec le journal en direct et un bouton **Arrêter**, voir les
captures de chaque bot (écrans, images, actions en attente) avec **Rapport**,
**Reprendre**, et les imports **Style** / **Produits** vers le backend. La case
« essai » est cochée par défaut (`--dry` : rien n'est écrit) ; décochée, une
confirmation est demandée. Variables : `PORT`, `PYTHON`, `CAPTURES_DIR`.
Pour modifier l'interface : `npm run dev` (http://127.0.0.1:5175, avec le serveur lancé à côté).
