# Guide de mise en production — les 3 projets

Ce guide couvre les trois boutiques qui partagent la même logique de wallet :

| Projet | Dossier local | Dépôt | Branche de prod | Hébergement |
|---|---|---|---|---|
| **Captain Slabbin** (nouveau) | `M:\Travail\mario` | à créer | `main` | Railway (backend) + Vercel (frontend) |
| **shop-react** | `M:\Projets\Mario\shop-react` | `yoroo-237/chadsflooring` | `main` | Railway |
| **clone (BOTB)** | `M:\Projets\duc\clone\react-src` | `yoroo-237/botb` | `master` | Railway + Vercel |

Les modifications de shop-react et de clone sont **déjà commitées et fusionnées** dans leur branche de prod, en local. Il reste à les pousser, dans l'ordre indiqué plus bas.

---

## Les règles communes aux 3 projets

- **Solde dynamique** : le client détient la crypto déposée. Le solde affiché vaut quantité × cours actuel et se met à jour toutes les 30 s.
- **Commission prélevée à la recharge** : c'est le client qui la paie. Un dépôt de 0,01 BTC avec 10 % de commission crédite 0,009 BTC.
- **Deux sweeps séparés** :
  - l'**admin** balaie la part créditée au client vers l'adresse de la boutique ;
  - le **superadmin** balaie la commission vers l'adresse de réserve ;
  - l'admin ne voit plus aucune donnée de commission.
- **Achat** : le total en USD est converti au cours du moment, et cette quantité de crypto est débitée (conversion figée).
- **Commande** : toujours payée dans l'app, puis la facture part sur Telegram (bot vers le chat de la boutique, et bouton « Open Telegram » sur la confirmation). Aucune information client n'est demandée : seul le Telegram, facultatif, s'il n'est pas déjà dans le profil.
- **Anciens soldes en USD** : ils sont convertis en crypto par le script `scripts/convert-balances-to-crypto.js`, au cours du jour de la conversion.

---

## 0. Sécurité — à faire en premier

Le remote git de shop-react contient un **jeton GitHub en clair**.

1. Révoquez-le : GitHub → Settings → Developer settings → Personal access tokens → supprimer le jeton.
2. Retirez-le du remote :
   ```
   cd M:\Projets\Mario\shop-react
   git remote set-url origin https://github.com/yoroo-237/chadsflooring.git
   ```
3. Pour pousser, authentifiez-vous avec Git Credential Manager (fenêtre de connexion GitHub) ou un nouveau jeton, mais jamais écrit dans l'URL.

---

## 1. shop-react (production existante)

> ⚠️ **L'ordre est important.** La production synchronise le schéma avec `prisma db push`, qui n'est **pas** lancé au déploiement. Si le code part avant le schéma, le site plante (tables `WalletHolding`, etc. absentes).

### 1.1 Appliquer le schéma sur la base de production
Les changements sont seulement des ajouts (aucune donnée supprimée), et l'ancien code continue de fonctionner après.

```
cd M:\Projets\Mario\shop-react\backend
set DATABASE_URL=<URL Postgres de PRODUCTION>
npx prisma db push --skip-generate
```

### 1.2 Pousser le code
```
cd M:\Projets\Mario\shop-react
git push origin main
```
Attendez que le déploiement Railway soit terminé.

### 1.3 Convertir les anciens soldes USD en crypto
Gardez le même `DATABASE_URL` de production qu'à l'étape 1.1. Sinon le script part sur la base locale du `.env`.
```
cd M:\Projets\Mario\shop-react\backend
node scripts/convert-balances-to-crypto.js            # affiche le plan, n'écrit rien
node scripts/convert-balances-to-crypto.js --apply    # applique la conversion
```
- Chaque solde est converti dans la crypto du dernier dépôt du client, ou en BTC s'il n'en a pas. Pour forcer une devise : `--currency=LTC`.
- Le script peut être relancé : les soldes déjà convertis sont ignorés.
- Aucune commission n'est prélevée sur ces anciens soldes.

### 1.4 Régler la commission
Connectez-vous en **superadmin** → page **Super Admin** :
- taux de commission par dépôt (10 % par défaut) ;
- adresses de réserve BTC, LTC, DOGE et ETH.

L'admin, lui, renseigne les adresses de la boutique dans **Settings → Crypto**.

### 1.5 Facture Telegram
Après chaque paiement, le bot poste la facture dans le chat Telegram de la boutique. Variables du backend :

| Variable | Valeur |
|---|---|
| `TELEGRAM_BOT_TOKEN` | jeton du bot : **@BotFather** → `/newbot` |
| `TELEGRAM_CHAT_ID` | id du chat : ajoutez le bot au groupe, envoyez un message, ouvrez `https://api.telegram.org/bot<JETON>/getUpdates` et relevez `chat.id` (négatif pour un groupe) |
| `TELEGRAM_SHOP_USERNAME` | nom d'utilisateur Telegram public de la boutique, pour le bouton « Open Telegram » (ou réglage `telegram_username` en base) |

Sans ces variables, les commandes passent quand même ; le client voit simplement un message lui demandant d'ouvrir Telegram.

---

## 2. clone (BOTB)

Ici la migration s'applique **automatiquement** au déploiement (`prisma migrate deploy` dans `.nixpacks.toml`), donc pas d'étape manuelle avant le push.

### 2.1 Pousser le code
Utilisez un compte qui a accès à `yoroo-237/botb` :
```
cd M:\Projets\duc\clone\react-src
git push origin master
```

### 2.2 Convertir les anciens soldes USD
Une fois le déploiement terminé :
```
cd M:\Projets\duc\clone\react-src\backend
set DATABASE_URL=<URL Postgres de PRODUCTION>
node scripts/convert-balances-to-crypto.js
node scripts/convert-balances-to-crypto.js --apply
```

### 2.3 Régler la commission
Connectez-vous en **superadmin** → **Deposit Commission** : taux et adresses de réserve.

### 2.4 Facture Telegram
Après chaque paiement, le bot poste la facture dans le chat Telegram de la boutique. Variables du backend :

| Variable | Valeur |
|---|---|
| `TELEGRAM_BOT_TOKEN` | jeton du bot : **@BotFather** → `/newbot` |
| `TELEGRAM_CHAT_ID` | id du chat : ajoutez le bot au groupe, envoyez un message, ouvrez `https://api.telegram.org/bot<JETON>/getUpdates` et relevez `chat.id` (négatif pour un groupe) |
| `TELEGRAM_SHOP_USERNAME` | nom d'utilisateur Telegram public de la boutique, pour le bouton « Open Telegram » (ou réglage `telegram_username` en base) |

Sans ces variables, les commandes passent quand même ; le client voit simplement un message lui demandant d'ouvrir Telegram.


---

## 3. Captain Slabbin (nouveau projet)

### 3.1 Créer le dépôt GitHub et pousser
1. Sur github.com, créez un dépôt **privé et vide**, sans README ni `.gitignore`.
2. Poussez le code :
   ```
   cd M:\Travail\mario
   git remote add origin https://github.com/yoroo-237/captain-slabbin.git
   git push -u origin main
   ```

### 3.2 Backend sur Railway
1. Créez un **New Project → Deploy from GitHub repo** et choisissez le dépôt.
2. Dans les **Settings** du service :
   - **Root Directory** : `/backend` ;
   - **Builder** : Railpack (par défaut). Il lance `npm ci`, `npm run build` (`prisma generate`) puis `npm start` : laissez **Build Command** et **Start Command** vides ;
   - **Deploy → Add pre-deploy step** : `npm run db:deploy` (migrations + seed, avant chaque nouvelle version, quand la base est joignable). **Sans cette étape la base reste vide** et toutes les routes répondent « Internal server error » ;
   - **Healthcheck Path** : `/health`.
3. Ajoutez une base de données : **+ New → Database → PostgreSQL**.
4. **Settings → Networking → Custom Domain** : ajoutez `api.<votre-domaine>` (ex. `api.captainslabbin.shop`). Railway affiche une cible : créez chez votre registrar un enregistrement **CNAME** `api` vers cette cible. (À défaut, **Generate Domain** donne une URL `*.up.railway.app`.)
5. Dans les **Variables** du service backend (Raw Editor ; la liste complète est dans `backend/.env.example`) :

| Variable | Valeur |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `NODE_ENV` | `production` |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | deux chaînes aléatoires longues¹ |
| `FRONTEND_URL` | domaine du site, ex. `https://captainslabbin.shop` |
| `PUBLIC_URL` | domaine du backend, ex. `https://api.captainslabbin.shop` (webhooks crypto et Telegram) |
| `SITE_PASSWORD` | mot de passe de la porte d'accès (modifiable ensuite dans l'admin) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | premier compte admin³ |
| `SUPERADMIN_USERNAME` / `SUPERADMIN_PASSWORD` | premier compte superadmin³ |
| `SEED_DEMO_PRODUCTS` | `true` (20 produits de démo) ou `false` |
| `BLOCKCYPHER_TOKEN` | jeton **actif** du compte blockcypher.com |
| `BTC_HD_SEED` / `ETH_HD_SEED` | deux phrases BIP39 de 12 mots, propres à ce projet¹ |
| `ALCHEMY_API_KEY` | clé de l'app Alchemy de ce projet (voir 3.6) |
| `ALCHEMY_AUTH_TOKEN` | jeton Notify du compte Alchemy (`alcht_…`) |
| `ALCHEMY_SIGNING_KEY` / `ALCHEMY_WEBHOOK_ID` | du webhook créé pour ce projet (`whsec_…` / `wh_…`) |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | compte Cloudinary² |
| `XMR_ADDRESS` | adresse Monero de réception |

Le bot Telegram ne se configure plus par variables : tout se fait dans l'admin (voir 3.5).

¹ Pour générer les secrets, depuis `backend/` (pas `frontend/`) :
```
node -e "const c=require('crypto'),b=require('bip39');console.log('JWT_SECRET='+c.randomBytes(32).toString('hex'));console.log('JWT_REFRESH_SECRET='+c.randomBytes(32).toString('hex'));console.log('BTC_HD_SEED='+b.generateMnemonic(128));console.log('ETH_HD_SEED='+b.generateMnemonic(128))"
```
Ne réutilisez jamais les phrases d'un autre projet : elles contrôlent les fonds.

² Un compte Cloudinary peut servir à plusieurs projets (mêmes trois valeurs) ; Captain Slabbin range ses fichiers dans le dossier `captain-slabbin/`. Le backend envoie les fichiers directement avec la clé et le secret : aucun « upload preset » n'est nécessaire. Sans Cloudinary, les images vont dans `uploads/` et sont **perdues à chaque redéploiement** Railway.

³ Les comptes staff sont créés **une seule fois**, au premier déploiement. Ensuite le seed ne les touche plus : un identifiant ou un mot de passe changé dans **Admin → My account** survit aux redéploiements. Mot de passe perdu : ajoutez `RESET_STAFF_PASSWORDS=true`, redéployez (le compte des variables est restauré avec son mot de passe), puis **retirez** la variable. Si un déploiement précédent avait créé d'autres comptes (`admin`, `superadmin`…), désactivez-les dans **Admin → Users**.

6. Ce que fait chaque déploiement : l'étape pre-deploy `npm run db:deploy` lance `prisma migrate deploy` puis le seed. Le seed crée les réglages et les catégories sans écraser vos modifications, crée les comptes staff s'ils n'ont jamais été créés, et ajoute le catalogue de démo seulement si la base est vide.
7. Pour vérifier, ouvrez `https://api.<votre-domaine>/health` : la réponse doit être `{"status":"ok", ...}`.

### 3.3 Frontend sur Vercel
1. Faites **Add New → Project** et importez le même dépôt.
2. Réglez le projet :
   - **Root Directory** : `frontend` ;
   - **Framework Preset** : Vite (build `vite build`, sortie `dist`) ;
   - **Environment Variable** : `VITE_API_URL` = `https://api.<votre-domaine>` (sans `/api` à la fin).
3. Lancez **Deploy**. Le fichier `vercel.json` gère déjà les routes de l'application (`/s/...`, `/p/...`, `/account/...`, `/admin/...`).
4. **Settings → Domains** : ajoutez `<votre-domaine>` et `www.<votre-domaine>`, et créez chez votre registrar les enregistrements que Vercel indique.

> **CORS** : le backend n'accepte que `FRONTEND_URL` et sa variante `www`. Les URL de prévisualisation Vercel (`…-git-…vercel.app`) seront refusées : testez sur le domaine de production.

### 3.4 Premier passage dans l'admin
1. Ouvrez `<site>/login`. Cette page est accessible sans le mot de passe de la porte.
2. Connectez-vous avec le compte admin : vous arrivez sur `/admin`. Le superadmin a accès à tout ce que fait l'admin, plus la page **Deposit Commission**.
3. **Admin → My account** (ou clic sur votre nom en haut) : changez identifiant et mot de passe si besoin.
4. **Admin → Settings**, onglet **Storefront** :
   - mot de passe de la boutique (vide = porte désactivée) ;
   - téléphone, nom d'utilisateur Telegram public de la boutique (ouvert par « Open Telegram » après paiement), lien Signal ;
   - email, adresse, ville, État, ZIP et horaires de la boutique ;
   - texte About, messages du bandeau d'annonces, lignes de la bannière promo, pop-up promo.
5. Onglet **Telegram bot** : voir 3.5.
6. Onglet **Shipping** : frais de livraison et seuil de livraison gratuite (30 $ et 1 000 $ par défaut).
7. Onglet **Crypto** : adresses de destination de la boutique (BTC, LTC, DOGE, ETH, XMR).
8. Avec le compte **superadmin**, page **Deposit Commission** : taux de commission et adresses de réserve.
9. **Products** : remplacez les produits de démo (SKU, prix barré = Fire Sale, unité, badge, « Featured », photos et vidéos).
10. **Categories** : image de bannière facultative par catégorie.

### 3.5 Telegram (depuis l'admin, aucune variable)
1. Bot neuf : dans Telegram, **@BotFather** → `/newbot` → copiez le jeton. Ou prenez le jeton d'un bot existant.
2. **Admin → Telegram bot** (menu System) : collez le jeton, **Check**, puis **Link this bot**. Un chat n'est pas nécessaire à ce stade.
   - Si le bot est déjà relié à une autre application, l'admin le signale ; cochez la case pour le reprendre.
   - **Apply the Captain Slabbin look** (facultatif) renomme le bot et lui donne la description de la boutique. Le catalogue, l'achat et les commandes marchent dans les deux cas. Il pose aussi la photo de profil Captain Slabbin ; **Upload my own (JPG)** en met une autre. L'image d'accueil (vue avant « Start ») ne se change que dans @BotFather : la page admin la fournit avec la marche à suivre.
3. Ajoutez le bot au groupe ou au canal de la boutique (en admin pour un canal) : il le choisit tout seul pour les commandes et les messages, et y poste une confirmation. La liste **Orders and messages go to** permet d'en changer.
4. **Post new products to** (facultatif) : un canal suivi par vos clients ; chaque nouveau produit y est publié avec sa photo, son prix et un bouton « Buy in the bot ».

Ce que fait le bot :
- **Pour les clients**, en conversation privée (`t.me/<bot>`) : `/start` demande la confirmation 21+ et ouvre le compte (rien à saisir, le compte est lié à leur Telegram) ; catalogue par rayon avec photos, quantité, **paiement depuis le portefeuille**, ajout de fonds (adresse BTC/LTC/ETH/DOGE/XMR), suivi des commandes (`/wallet`, `/orders`, `/deals`). Le bot les prévient quand un dépôt arrive et à chaque changement de statut de commande (avec le numéro de suivi). Le bouton « My account on the site » les connecte au site en un tap.
- **Clients déjà inscrits sur le site** : **Account → Profile → Connect Telegram** lie leur compte en un tap.
- **Pour la boutique**, dans le groupe : la facture de chaque commande payée (bouton « Open order ») et les nouveaux messages (bouton « Reply in admin »).
- Les commandes passées dans le bot sont sans livraison : l'équipe organise la remise sur Telegram. Pour une livraison à une adresse, le client commande sur le site.

### 3.5 bis SEO (Google, orienté USA)
Ce qui est en place :
- **Vitrine publique indexable** : accueil, About, FAQ et une page par rayon (`/s/flower`, `/s/fire-sale`…), avec bannière, texte et liens. Le visiteur confirme seulement « 21+ ». Produits, prix, panier et comptes restent derrière la porte (code aléatoire) et ne sont pas indexés (`noindex` + `robots.txt`).
- **Au build** (`npm run build` → `scripts/prerender.mjs`) : une page HTML par page publique avec son titre, sa description, l'URL canonique, les aperçus de partage (Open Graph / Twitter) et les données structurées (OnlineStore, WebSite, BreadcrumbList, CollectionPage, FAQPage), plus `sitemap.xml` et `robots.txt`. Les rayons et la FAQ sont lus sur l'API au moment du build : **redéployez le frontend après avoir ajouté ou renommé un rayon**.
- Langue `en-US`, `hreflang` en-us, `geo.region` US, textes « shipped across the USA ».

À faire une fois :
1. **Vercel → Settings → Domains** : gardez `www.captainslabbin.shop` comme domaine principal (l'autre redirige vers lui). Les URL canoniques utilisent `https://www.captainslabbin.shop` ; pour en changer, ajoutez la variable `SITE_URL` dans Vercel.
2. **Google Search Console** (search.google.com/search-console) : *Add property* → **Domain** → `captainslabbin.shop` ; ajoutez chez votre registrar l'enregistrement **TXT** indiqué, puis **Verify**.
3. Search Console → **Sitemaps** : soumettez `https://www.captainslabbin.shop/sitemap.xml`.
4. **Bing Webmaster Tools** (bing.com/webmasters) : *Import from Google Search Console*.
5. Vérifiez un aperçu : collez `https://www.captainslabbin.shop/s/flower` dans Telegram, il doit afficher la bannière et le titre.

### 3.6 Crypto (dépôts automatiques)
- **BTC / LTC / DOGE** : `BLOCKCYPHER_TOKEN`, `BTC_HD_SEED` et `PUBLIC_URL` (BlockCypher appelle `/api/webhooks/blockcypher`).
- **ETH** : `ETH_HD_SEED` et les clés Alchemy.
  1. Alchemy → **Create new app**, chaîne **Ethereum → Mainnet** ; les services cochés par défaut conviennent (seul Webhooks sert). La clé de l'app → `ALCHEMY_API_KEY`.
  2. **Notify → Create Webhook → Address Activity**, Ethereum Mainnet, URL `https://api.<votre-domaine>/api/webhooks/alchemy`. Le webhook créé donne le **Signing Key** (`whsec_…`) et le **Webhook ID** (`wh_…`). Le jeton Notify du compte (`alcht_…`) est en haut de la page Notify.
- **XMR** : `XMR_ADDRESS` et l'adresse dans **Settings → Crypto**. Les dépôts XMR sont confirmés à la main dans **Admin → Deposits**.
- Avant d'ouvrir au public : **un petit dépôt de test** par crypto, un **sweep admin**, un **sweep superadmin**, et vérification sur un explorateur de blocs.

---

## 3 bis. Plateforme des bots (dashboard séparé)

Une plateforme à part qui ne gère que des bots Telegram : bots, styles, captures (le travail de tg-explorer, depuis le navigateur), catalogues, commandes, clients, dépôts et **ses propres retraits**. Même code que Captain Slabbin, mais un **déploiement séparé** avec **sa propre base**, ses propres seeds de wallet et ses propres adresses de retrait : rien n'est partagé avec le site.

Un seul service Railway fait tout : l'API, le dashboard (même adresse) et les captures (Python + Telethon dans l'image).

### 3 bis.1 Créer le service
1. Dans Railway, dans un **nouveau projet** (pas celui du site) : **New → GitHub repo**, le même dépôt.
2. **Settings** du service :
   - **Root Directory** : `/` (la racine du dépôt) ;
   - variable `RAILWAY_DOCKERFILE_PATH` = `bots.Dockerfile` (Railway construit alors avec ce Dockerfile) ;
   - **Healthcheck Path** : `/health` (il répond `"platform":"bots"`).
   - Pas de pre-deploy step : l'image applique les migrations et le seed à chaque démarrage.
3. **+ New → Database → PostgreSQL** dans ce projet : une base **neuve**, jamais celle du site.
4. **Volume** : clic droit sur le service → **Attach volume**, point de montage `/data`. Les captures et la session Telegram y sont gardées entre deux déploiements. Sans volume, il faut se reconnecter à Telegram et refaire les captures après chaque déploiement.
5. **Networking → Custom Domain** : par exemple `bots.<votre-domaine>`, avec un CNAME chez le registrar.

### 3 bis.2 Variables
| Variable | Valeur |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (la base de ce projet) |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | deux longues valeurs **différentes de celles du site** |
| `FRONTEND_URL`, `PUBLIC_URL` | l'adresse de la plateforme, ex. `https://bots.<votre-domaine>` (la même pour les deux) |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SUPERADMIN_USERNAME`, `SUPERADMIN_PASSWORD` | les comptes du dashboard, créés au premier démarrage |
| `BTC_HD_SEED`, `ETH_HD_SEED` | **de nouvelles seeds**, jamais celles du site : sinon les deux plateformes donneraient les mêmes adresses de dépôt |
| `BLOCKCYPHER_TOKEN`, `XMR_ADDRESS` | comme pour le site (section 3.6) |
| `ALCHEMY_*` | un **nouveau** webhook Alchemy vers `https://bots.<votre-domaine>/api/webhooks/alchemy` |
| `CLOUDINARY_*` | pour les images des produits importés (le même compte que le site convient) |
| `TELEGRAM_WEBHOOK_SECRET` | une valeur au hasard |
| `API_ID`, `API_HASH` | ceux de https://my.telegram.org (API development tools), pour les captures |

`PLATFORM=bots` et les dossiers des captures sont déjà réglés dans `bots.Dockerfile`.

### 3 bis.3 Premier passage
1. Ouvrez `https://bots.<votre-domaine>` et connectez-vous avec `ADMIN_*` ou `SUPERADMIN_*`.
2. **Retraits** : adresses de retrait BTC, LTC, DOGE, ETH et XMR de la plateforme. Le superadmin règle la commission et ses adresses dans **Commission**.
3. **Bots** : collez le jeton de chaque bot. **Un bot ne peut être branché qu'à un seul serveur** : un bot repris du site doit d'abord être délié dans l'admin du site, sinon les deux se le disputent.
4. **Captures** : à l'étape 1, entrez le numéro du compte Telegram qui parcourt les bots, puis le code que Telegram envoie dans son application, puis le mot de passe 2FA s'il y en a un. Ensuite, explorez un bot, puis **Importer le style** et **Importer les produits** (essayez d'abord en mode **Essai**). Le style s'applique à un bot dans **Bots**.
5. Les bots de la plateforme n'affichent aucun lien vers un site web, puisqu'il n'y en a pas.

En local : `cd backend` puis `PLATFORM=bots npm run dev`, et dans un second terminal `cd frontend` puis `npm run dev:bots` (http://localhost:5176). Utilisez une base locale à part.

---

## 4. Vérifications après mise en ligne (pour les 3 projets)

- [ ] Un client voit son solde en crypto et sa valeur en USD qui évolue.
- [ ] Le pourcentage de frais est affiché avant un dépôt.
- [ ] Un dépôt de test crédite le montant net (reçu − commission).
- [ ] Une commande débite la bonne quantité de crypto, au cours affiché au moment du paiement.
- [ ] Les montants « à balayer » côté admin correspondent à la part des clients.
- [ ] Les montants « à balayer » côté superadmin correspondent à la commission.
- [ ] Les anciens clients ont retrouvé leur solde, converti en crypto.
- [ ] Pour les 3 projets : une commande payée envoie sa facture dans le groupe Telegram, et le checkout ne demande rien d'autre que le Telegram (facultatif).
- [ ] Captain Slabbin : la porte (mot de passe + 21 ans) et sa fumée s'affichent, le logo de l'en-tête fume, le footer brûle, les changements de page et de thème passent par la fumée, `/login` est accessible directement, la messagerie fonctionne dans les deux sens, et **Send a test message** (onglet Telegram bot) arrive dans le groupe.
- [ ] Captain Slabbin : un identifiant et un mot de passe changés dans **My account** tiennent après un redéploiement.

---

## 5. Développement local (rappel)

```
# backend
cd M:\Travail\mario\backend
copy .env.example .env      # remplir DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET
npm install
npx prisma migrate deploy
node prisma/seed.js
npm run dev                 # http://localhost:4000

# frontend
cd M:\Travail\mario\frontend
echo VITE_API_URL=http://localhost:4000> .env.local
npm install
npm run dev                 # http://localhost:5173
```

Bases de test créées sur le Postgres local pendant le développement, que vous pouvez supprimer : `shop_wallet_test`, `clone_wallet_test`, `slabbin_dev`.
