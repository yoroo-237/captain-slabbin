# Captain Slabbin

Boutique en ligne inspirée de mrslabbin.com (code d'accès CSC), construite sur la même base que *shop-react* et *clone (BOTB)* :

- **frontend/** : React 18 + Vite. Boutique au thème sombre Captain Slabbin et admin sous `/admin`.
- **backend/** : Express + Prisma + PostgreSQL (modules ESM).

## Fonctionnalités

- **Porte d'accès** : mot de passe (CSC par défaut) et confirmation 21+ avant de voir quoi que ce soit. L'API refuse le catalogue sans le jeton de la porte.
- **Navigation sans compte**. Le compte se crée au checkout (en ligne, sans perdre le panier) ou sur `/account/create` : un nom d'utilisateur et un mot de passe, rien d'autre.
- **Commande : payée dans l'app, facture sur Telegram**. Le client paie toujours depuis son wallet crypto. Ensuite, le bot poste la facture (copie de la commande) dans le chat Telegram de la boutique, et l'écran de confirmation propose « Open Telegram ».
- **Aucune information client** : ni nom, ni email, ni adresse. Seul le Telegram (nom d'utilisateur ou id) est demandé, facultatif, au checkout s'il n'est pas déjà dans le profil ; il est alors enregistré et ajouté aux factures.
- **Design** : thèmes sombre et clair, logo qui fume en continu, transition de fumée entre les pages et au changement de thème, UX adaptée au marché américain.
- **Wallet à solde dynamique** : le client détient la crypto déposée, moins la commission. Le solde affiché vaut quantité × cours actuel et se met à jour toutes les 30 s.
- **Commission prélevée à la recharge** : c'est le client qui la supporte. L'admin balaie la part créditée au client vers l'adresse de la boutique. Le superadmin balaie la commission vers l'adresse de réserve. Les deux sweeps sont totalement séparés.
- **Conversion figée à l'achat** : le total en USD est converti au cours du moment, et cette quantité de crypto est débitée.
- **Messagerie interne** : un fil par client avec l'équipe (`/account/messages`, et `/admin/messages` côté staff). Chaque nouveau message client est aussi notifié sur Telegram.
- **Admin** : produits (SKU, prix barré = étagère Fire Sale, badge, unité), commandes, messages, dépôts, utilisateurs, réglages de la boutique. **Superadmin** : taux de commission, adresses de réserve, sweep de la commission.

## Démarrage local

```bash
# backend
cd backend
cp .env.example .env        # remplir DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET
npm install
npx prisma migrate deploy
node prisma/seed.js         # réglages, catégories, comptes staff, catalogue de démo
npm run dev                 # http://localhost:4000

# frontend
cd ../frontend
echo "VITE_API_URL=http://localhost:4000" > .env.local
npm install
npm run dev                 # http://localhost:5173
```

Le seed affiche une seule fois le mot de passe des comptes `admin` et `superadmin` s'il n'est pas défini dans `.env`.

## Configuration à faire (production)

1. **Base de données** : créer une base Postgres et renseigner `DATABASE_URL`. Le déploiement Railway lance `migrate deploy` puis le seed (voir `backend/.nixpacks.toml`).
2. **Secrets** : générer `JWT_SECRET` et `JWT_REFRESH_SECRET`, et définir `ADMIN_PASSWORD` et `SUPERADMIN_PASSWORD`.
3. **Telegram** :
   - créer un bot avec @BotFather et copier son jeton dans `TELEGRAM_BOT_TOKEN` ;
   - ajouter le bot au groupe ou au canal de la boutique, puis récupérer l'id du chat (par exemple en envoyant un message puis en ouvrant `https://api.telegram.org/bot<TOKEN>/getUpdates`) ;
   - le saisir dans **Admin → Settings → Storefront → Telegram chat ID** ;
   - au même endroit : nom d'utilisateur Telegram public de la boutique, numéro « Text us now », lien Signal et pop-up promo.
4. **Mot de passe de la boutique** : `SITE_PASSWORD`, ou **Admin → Settings → Storefront**. Vide = porte désactivée.
5. **Crypto** :
   - `BLOCKCYPHER_TOKEN`, `BTC_HD_SEED` / `ETH_HD_SEED`, les clés Alchemy et `PUBLIC_URL` pour les webhooks ;
   - les adresses de destination de la boutique dans **Admin → Settings → Crypto** ;
   - les adresses de réserve et le taux de commission dans **Admin → Deposit Commission** (superadmin uniquement).
6. **Frontend** : définir `VITE_API_URL` avec l'URL du backend. Sur Vercel, `vercel.json` gère les routes SPA. Définir `FRONTEND_URL` côté backend pour le CORS.
7. **Catalogue** : remplacer les produits de démo depuis l'admin (ou `SEED_DEMO_PRODUCTS=false` sur une base vide). Une image de catégorie (740×225) peut être ajoutée par catégorie. Sans image, une plaque métallisée est générée.
