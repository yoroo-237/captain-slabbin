# tg-explorer

Parcourt n'importe quel bot Telegram avec votre compte utilisateur et enregistre
ses écrans (textes, boutons, images). La sortie se donne ensuite à
`backend/scripts/import-bot-capture.js` (style) et
`backend/scripts/import-products-from-capture.js` (produits).

Le dossier est autonome : copiez-le (ou clonez le dépôt) sur n'importe quel PC,
tout ce que l'outil crée reste dedans, rien n'est écrit dans le profil Windows.

| Dans `tools/tg-explorer/` | Contenu | Git |
|---|---|---|
| `.env` | API_ID, API_HASH, PHONE, BOT_USERNAME (modèle : `.env.example`) | ignoré |
| `sessions/` | sessions Telegram, une par profil (**secret** : équivaut à être connecté) | ignoré |
| `captures/` | une capture par bot | ignoré |
| `.venv/` | Python isolé de l'outil | ignoré |
| `.cache/` | caches pip, npm, Python et fichiers temporaires | ignoré |
| `web/node_modules/`, `web/ui/dist/` | interface web installée et construite | ignorés |

## Installation sur un nouveau PC

Prérequis : [Python 3.8+](https://www.python.org/downloads/) (case « Add python.exe
to PATH ») et [Node.js LTS](https://nodejs.org). Puis double-clic sur `lancer.bat`
(`./lancer.sh` sur macOS / Linux). Le premier lancement crée `.venv`, installe les
dépendances, crée `.env` depuis `.env.example` et l'ouvre pour le remplir
(API_ID et API_HASH : https://my.telegram.org, rubrique API development tools),
construit l'interface puis l'ouvre sur http://127.0.0.1:5174.

Pour reprendre une session existante sans retaper de code, copiez aussi le dossier
`sessions/` (à transporter comme un mot de passe).

En ligne de commande, utilisez le Python de l'outil : `.venv\Scripts\python.exe`
(Windows) ou `.venv/bin/python` (macOS / Linux) à la place de `python` ci-dessous.

## Connexion (une fois par profil)

```powershell
python login.py                    # session « explorer »
python login.py --profile autre    # un second compte
```

Telegram envoie un code dans l'application : tapez-le dans le terminal (et le
mot de passe 2FA s'il y en a un). Depuis l'interface, le bouton « Se connecter »
ouvre `connexion.bat`, qui fait la même chose (aussi utilisable en double-clic).

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

Le compte n'ayant pas de carte liée, le parcours joue presque tout : panier,
commandes, checkout, dépôt, achat, paiement, confirmation. Il n'ignore que ce qui
détruit ou vide quelque chose : delete, remove, clear, withdraw, supprimer,
retirer, vider, effacer. Attention : acheter,
payer ou confirmer peut créer des commandes ou des factures en attente chez le bot
parcouru, et débiter un éventuel solde interne.

`--strict` (case « Mode strict » dans l'interface) remet l'ancienne liste large
(buy, pay, checkout, order, confirm, cart, purchase, delete, remove, cancel,
withdraw, deposit et leurs équivalents français), à utiliser si le bot a un vrai
solde. `--skip REGEX` en exclut une de plus, `--allow REGEX` en rejoue une précise.
Les actions ignorées sont dans `data.json` (`ignored`) et en bas de `report.html`.

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

## Ce que font les imports

- **Style** met à jour le style nommé dans « Style mis à jour » (`QT Market` par
  défaut, `--merge-into`) : seulement les pages d'information et les images
  d'accueil et de menu. Rayons, textes et panier du style restent ; une image
  choisie à la main dans l'admin n'est pas remplacée. Une clé PGP de la capture
  n'est jamais copiée (le style garde la vôtre). Champ vide : crée ou remplace
  entièrement un style « Imported bot ».
- **Produits** retrouve chaque produit par son nom (les codes `/p0_14IBX`
  changent à chaque session) : textes, prix et formats sont mis à jour, une photo
  changée chez le bot remplace l'ancienne (pas une photo mise à la main).
- Chaque image n'est envoyée qu'une fois sur Cloudinary : `captures/<bot>/uploads.json`
  retient ce qui est déjà en ligne.
- Des doublons laissés par un ancien import se fusionnent avec
  `node scripts/dedupe-capture-products.js [--dry]` (dans `backend/`).
Pour modifier l'interface : `npm run dev` (http://127.0.0.1:5175, avec le serveur lancé à côté).
