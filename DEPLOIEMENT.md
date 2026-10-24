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

---

## 3. Captain Slabbin (nouveau projet)

### 3.1 Créer le dépôt GitHub et pousser
1. Sur github.com, créez un dépôt **privé et vide**, sans README ni `.gitignore`.
2. Poussez le code :
   ```
   cd M:\Travail\mario
   git remote add origin https://github.com/<votre-compte>/<nom-du-depot>.git
   git push -u origin main
   ```

### 3.2 Backend sur Railway
1. Créez un **New Project → Deploy from GitHub repo** et choisissez le dépôt.
2. Dans les Settings du service, mettez **Root Directory** à `backend`. C'est indispensable : le build lit `backend/railway.toml` et `backend/.nixpacks.toml`.
3. Ajoutez une base de données : **+ New → Database → PostgreSQL**.
4. Dans **Networking → Generate Domain**, générez l'URL publique du backend.
5. Dans les **Variables** du service backend (la liste complète est dans `backend/.env.example`) :

| Variable | Valeur |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `NODE_ENV` | `production` |
| `JWT_SECRET` | chaîne aléatoire longue¹ |
| `JWT_REFRESH_SECRET` | une autre chaîne aléatoire longue¹ |
| `FRONTEND_URL` | URL Vercel exacte, ex. `https://captain-slabbin.vercel.app` |
| `PUBLIC_URL` | URL Railway du backend (pour les webhooks crypto) |
| `SITE_PASSWORD` | `CSC` (mot de passe de la porte d'accès) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | compte admin |
| `SUPERADMIN_USERNAME` / `SUPERADMIN_PASSWORD` | compte superadmin |
| `SEED_DEMO_PRODUCTS` | `true` (20 produits de démo) ou `false` |
| `TELEGRAM_BOT_TOKEN` | jeton du bot (voir 3.5) |
| `TELEGRAM_CHAT_ID` | id du chat de la boutique (voir 3.5) |
| `BLOCKCYPHER_TOKEN` | compte blockcypher.com |
| `BTC_HD_SEED` / `ETH_HD_SEED` | phrases BIP39 de 12 mots (à garder secrètes) |
| `ALCHEMY_API_KEY`, `ALCHEMY_SIGNING_KEY`, `ALCHEMY_AUTH_TOKEN`, `ALCHEMY_WEBHOOK_ID` | compte alchemy.com (ETH) |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | hébergement des images produits² |

¹ Pour générer une chaîne : `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
² Sans Cloudinary, les images envoyées dans `uploads/` sont **perdues à chaque redéploiement** Railway.

6. Définissez `ADMIN_PASSWORD` et `SUPERADMIN_PASSWORD` **avant** le premier déploiement. Sinon, des mots de passe aléatoires sont générés et n'apparaissent qu'une fois dans les logs du build.
7. Ce que fait chaque déploiement : `prisma migrate deploy`, puis le seed. Le seed crée les réglages et les catégories sans écraser vos modifications, crée les comptes staff s'ils n'existent pas, et ajoute le catalogue de démo seulement si la base est vide.
8. Pour vérifier, ouvrez `https://<backend>.up.railway.app/health` : la réponse doit être `{"status":"ok", ...}`.

### 3.3 Frontend sur Vercel
1. Faites **Add New → Project** et importez le même dépôt.
2. Réglez le projet :
   - **Root Directory** : `frontend` ;
   - **Framework Preset** : Vite (build `vite build`, sortie `dist`) ;
   - **Environment Variable** : `VITE_API_URL` = `https://<backend>.up.railway.app` (sans `/api` à la fin).
3. Lancez **Deploy**. Le fichier `vercel.json` gère déjà les routes de l'application (`/s/...`, `/p/...`, `/account/...`, `/admin/...`).
4. Si vous ajoutez un domaine personnalisé, mettez `FRONTEND_URL` à jour sur Railway puis redéployez le backend.

> **CORS** : le backend n'accepte que `FRONTEND_URL` et sa variante `www`. Les URL de prévisualisation Vercel (`…-git-…vercel.app`) seront refusées : testez sur l'URL de production.

### 3.4 Premier passage dans l'admin
1. Ouvrez `<site>/login`. Cette page est accessible sans le mot de passe de la porte.
2. Connectez-vous avec le compte admin : vous arrivez sur `/admin`.
3. **Admin → Settings**, onglet **Storefront** :
   - mot de passe de la boutique (vide = porte désactivée) ;
   - numéro de téléphone du bandeau « Text us now » ;
   - nom d'utilisateur Telegram de la boutique, ouvert par le bouton « Send order on Telegram » ;
   - id du chat Telegram pour les notifications ;
   - lien Signal ;
   - pop-up promo (activée ou non, et son texte).
4. Onglet **Shipping** : frais de livraison et seuil de livraison gratuite (30 $ et 1 000 $ par défaut).
5. Onglet **Crypto** : adresses de destination de la boutique (BTC, LTC, DOGE, ETH, XMR).
6. Avec le compte **superadmin**, page **Deposit Commission** : taux de commission et adresses de réserve.
7. **Products** : remplacez les produits de démo. Pour chaque produit :
   - SKU ;
   - prix « Was price » : s'il est renseigné, le produit apparaît dans **Fire Sale** ;
   - unité (« per lb ») et badge ;
   - case « Featured » pour l'afficher sur l'accueil.
8. **Categories** : vous pouvez ajouter une image de bannière (740×225) par catégorie. Sans image, une plaque métallisée est générée automatiquement.

### 3.5 Telegram
1. Dans Telegram, ouvrez **@BotFather**, tapez `/newbot` et récupérez le jeton → variable `TELEGRAM_BOT_TOKEN`.
2. Créez un groupe ou un canal pour la boutique et **ajoutez-y le bot** (en admin si c'est un canal).
3. Envoyez un message dans ce groupe, puis ouvrez `https://api.telegram.org/bot<JETON>/getUpdates` et relevez `chat.id` (un groupe a un id négatif, ex. `-1001234567890`).
4. Collez cet id dans **Admin → Settings → Storefront → Telegram chat ID**, ou dans la variable `TELEGRAM_CHAT_ID`.
5. Pour tester, ajoutez un produit au panier puis cliquez sur « Send order on Telegram ». La commande doit apparaître dans le groupe, et dans **Admin → Telegram Orders** avec la mention « delivered ».

Ce que le bot poste dans le groupe :
- les **commandes Telegram** (y compris celles des invités), avec le Telegram du client s'il est connecté et l'a renseigné dans son profil ;
- les **commandes payées** avec le wallet ;
- les **nouveaux messages** de la messagerie interne.

### 3.6 Crypto (dépôts automatiques)
- **BTC / LTC / DOGE** : il faut `BLOCKCYPHER_TOKEN`, `BTC_HD_SEED` et `PUBLIC_URL` (pour que BlockCypher appelle `/api/webhooks/blockcypher`).
- **ETH** : il faut `ETH_HD_SEED` et les clés Alchemy. Dans Alchemy, créez un webhook « Address Activity » qui pointe vers `https://<backend>/api/webhooks/alchemy`.
- **XMR** : renseignez l'adresse dans **Settings → Crypto**. Les dépôts XMR sont confirmés à la main dans **Admin → Deposits**.
- Avant d'ouvrir au public, faites **un petit dépôt de test**, puis un **sweep admin** et un **sweep superadmin**, et vérifiez les transactions sur un explorateur de blocs.

---

## 4. Vérifications après mise en ligne (pour les 3 projets)

- [ ] Un client voit son solde en crypto et sa valeur en USD qui évolue.
- [ ] Le pourcentage de frais est affiché avant un dépôt.
- [ ] Un dépôt de test crédite le montant net (reçu − commission).
- [ ] Une commande débite la bonne quantité de crypto, au cours affiché au moment du paiement.
- [ ] Les montants « à balayer » côté admin correspondent à la part des clients.
- [ ] Les montants « à balayer » côté superadmin correspondent à la commission.
- [ ] Les anciens clients ont retrouvé leur solde, converti en crypto.
- [ ] Captain Slabbin : la porte (mot de passe CSC + 21 ans) et sa fumée s'affichent, `/login` est accessible directement, une facture Telegram arrive dans le groupe, et la messagerie fonctionne dans les deux sens.

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
