# Guide de mise en production : ScamWatch

Plateforme de signalement des comptes Telegram frauduleux, avec portefeuille crypto à jetons.

| | |
|---|---|
| **Dossier local** | `M:\Travail\mario\scamwatch` |
| **Dépôt** | `yoroo-237/captain-slabbin`, dossier `scamwatch/` |
| **Branche** | `feat/scamwatch` (ou `main` après fusion) |
| **Hébergement** | Railway, **projet séparé** des boutiques : un seul service (API + site) et sa base Postgres |
| **Adresse** | un sous-domaine, ex. `scamwatch.<votre-domaine>` |

---

## Les règles du projet

- **Consultation gratuite** : la liste et la recherche des comptes signalés sont publiques, sans compte.
- **Signaler coûte des jetons** : il faut un compte (nom d'utilisateur + mot de passe) et un solde suffisant.
- **Solde en crypto, au cours du direct** : comme dans les boutiques, le client détient la crypto déposée. Sa valeur en USD suit le marché, et ses jetons aussi : `jetons = solde en USD / prix du jeton`.
- **Paiement d'un signalement** : `jetons par signalement × prix du jeton`, débité en crypto au cours du moment. Le débit et l'enregistrement se font ensemble : un signalement refusé (doublon, compte protégé, erreur) ne coûte rien.
- **Pas de commission** : 100 % de chaque dépôt revient au super admin (MKO). Un seul balayage par crypto, vers vos adresses de réserve.
- **Preuves** : un compte peut être re-signalé tant que chaque signalement apporte une preuve nouvelle (lien ou capture jamais envoyés pour ce compte). Sans preuve, une limite par utilisateur et par compte (1 par défaut).
- **Liste blanche** : les comptes et bots que vous y mettez ne peuvent pas être signalés et n'apparaissent pas dans la liste publique.

---

## 0. Sécurité, à faire en premier

1. **Mot de passe super admin** : il n'est jamais écrit dans le code, seulement dans la variable Railway `SUPERADMIN_PASSWORD`. Choisissez un mot de passe **long et aléatoire** (20 caractères ou plus). Celui envoyé dans la conversation (`Admin001@`) est trop court et doit être considéré comme connu : ne l'utilisez pas.
2. **Seeds du portefeuille** : générez **de nouvelles seeds** pour ScamWatch (voir 1.3). Les adresses sont dérivées sur une branche à part (`m/44'/coin'/7'/0/<n° de dépôt>`), donc une seed partagée avec une boutique ne crée pas de collision, mais une seed dédiée limite les dégâts si l'une fuit.
3. **Boutiques** : leurs webhooks de dépôt créditent sans vérifier la blockchain (voir la section 6). À corriger avant d'ouvrir ScamWatch au public, puisque vous y renvoyez vos utilisateurs.

---

## 1. Déployer sur Railway

### 1.1 Pousser le code
```
cd M:\Travail\mario
git push origin feat/scamwatch
```
Pour déployer depuis `main`, fusionnez d'abord la branche (pull request sur GitHub, ou `git checkout main && git merge feat/scamwatch && git push origin main`).

### 1.2 Créer le service
1. Railway → **New Project** (un projet **neuf**, pas celui des boutiques).
2. **+ New → Database → PostgreSQL** : une base neuve, réservée à ScamWatch.
3. **+ New → GitHub Repo** → `yoroo-237/captain-slabbin`, puis dans les **Settings** du service :
   - **Root Directory** : `scamwatch` ;
   - **Branch** : `feat/scamwatch` (ou `main` après fusion) ;
   - **Builder** : Dockerfile (détecté automatiquement) ;
   - **Healthcheck Path** : `/api/health`.
   - Pas de pre-deploy step : au démarrage, l'image applique le schéma (`prisma db push`) puis crée ou met à jour le compte super admin.
4. **Settings → Networking → Custom Domain** : `scamwatch.<votre-domaine>`. Railway affiche une cible : créez chez votre registrar un enregistrement **CNAME** `scamwatch` vers cette cible.

### 1.3 Variables
Dans les **Variables** du service (Raw Editor). La liste complète est aussi dans `scamwatch/backend/.env.example`.

| Variable | Valeur |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `IP_SALT` | chaîne aléatoire¹, **à ne plus jamais changer** ensuite |
| `JWT_SECRET` | chaîne aléatoire de 32 caractères ou plus¹, différente de celles des boutiques |
| `SUPERADMIN_USERNAME` | `mko` |
| `SUPERADMIN_PASSWORD` | votre mot de passe long et aléatoire² |
| `BTC_HD_SEED` | phrase BIP39 de 12 mots, propre à ScamWatch¹ (BTC, LTC, DOGE) |
| `ETH_HD_SEED` | autre phrase BIP39 de 12 mots¹ |
| `BLOCKCYPHER_TOKEN` | jeton **actif** du compte blockcypher.com (vérification et balayage BTC/LTC/DOGE) |
| `ALCHEMY_API_KEY` | clé d'une app Alchemy Ethereum Mainnet (vérification et balayage ETH) |
| `PUBLIC_URL` | `https://scamwatch.<votre-domaine>` (facultatif : webhooks BlockCypher) |
| `ALCHEMY_WEBHOOK_ID`, `ALCHEMY_AUTH_TOKEN`, `ALCHEMY_SIGNING_KEY` | facultatif : webhook ETH (voir 3.2) |

Ne définissez pas `PORT` : Railway le fournit.

¹ Pour tout générer d'un coup, depuis `scamwatch\backend` (après `npm install`) :
```
node -e "const c=require('crypto'),b=require('bip39');console.log('IP_SALT='+c.randomBytes(24).toString('hex'));console.log('JWT_SECRET='+c.randomBytes(32).toString('hex'));console.log('BTC_HD_SEED='+b.generateMnemonic(128));console.log('ETH_HD_SEED='+b.generateMnemonic(128))"
```
Gardez une copie des deux seeds hors ligne : elles contrôlent les fonds déposés. Ne les réutilisez jamais ailleurs.

² Le compte super admin est **recréé à chaque démarrage** à partir de ces deux variables. Pour changer de mot de passe, modifiez `SUPERADMIN_PASSWORD` et redéployez. Mot de passe perdu : même chose.

### 1.4 Vérifier
Ouvrez `https://scamwatch.<votre-domaine>/api/health` : la réponse doit être `{"ok":true}`. Dans les logs Railway, la ligne `[auth] super admin "mko" ready` confirme la création du compte.

---

## 2. Premier passage dans l'admin

1. Ouvrez `https://scamwatch.<votre-domaine>/#login` et connectez-vous avec `mko` et votre mot de passe. Vous arrivez sur l'espace **Admin**.
2. Onglet **Réglages** :
   - **Prix d'un jeton (USD)** : 1 $ par défaut ;
   - **Jetons par signalement** : 1 par défaut (0 = gratuit) ;
   - **Signalements sans preuve par utilisateur et par compte** : 1 par défaut (0 = illimité) ;
   - **Durée de validité d'une adresse de dépôt** : 12 h par défaut.
3. Onglet **Portefeuille** → **Adresses de réserve** : vos adresses BTC, LTC, DOGE, ETH, où partent les balayages. L'adresse **XMR** reçoit directement les dépôts Monero ; sans elle, la recharge XMR est indisponible.
4. Onglet **Liste blanche** : ajoutez vos propres bots et comptes officiels (`@pseudo`, lien `t.me` ou ID numérique), avec une note facultative.

Le super admin signale sans payer, ce qui est pratique pour tester.

---

## 3. Crypto

### 3.1 Comment un dépôt est crédité
1. Le client choisit une crypto dans **Portefeuille → Recharger** et reçoit une adresse qui lui est propre.
2. Le serveur lit ce que l'adresse a reçu **sur la blockchain** : quand le client clique sur « J'ai payé, vérifier », toutes les 30 s tant que la page est ouverte, et toutes les 5 minutes en arrière-plan. Le crédit a lieu après 1 confirmation.
3. Les webhooks (BlockCypher, Alchemy) ne font que déclencher cette lecture : **le montant écrit dans un webhook n'est jamais crédité**, donc un faux webhook ne peut rien créditer.
4. Une adresse expire après le délai réglé ; une dernière vérification est faite avant de la fermer.
5. **XMR** : pas de lecture automatique. Dans **Admin → Portefeuille → Dépôts**, saisissez le montant reçu sur le dépôt concerné, puis **Créditer**.

### 3.2 Webhook ETH (facultatif)
Sans webhook, la vérification toutes les 5 minutes suffit. Pour un crédit plus rapide :
1. Alchemy → **Notify → Create Webhook → Address Activity**, Ethereum Mainnet, URL `https://scamwatch.<votre-domaine>/api/webhooks/alchemy`.
2. Copiez le **Signing Key** (`whsec_…`) dans `ALCHEMY_SIGNING_KEY`, le **Webhook ID** (`wh_…`) dans `ALCHEMY_WEBHOOK_ID`, et le jeton Notify du compte (`alcht_…`) dans `ALCHEMY_AUTH_TOKEN`.
Un appel sans signature valide est refusé.

### 3.3 Balayer les fonds vers vos adresses
**Admin → Portefeuille → Balayage** : pour chaque crypto, le montant en attente et le nombre d'adresses. **Balayer** envoie tout le contenu de chaque adresse de dépôt vers votre adresse de réserve ; les frais de réseau sont pris sur le montant. Les derniers balayages s'affichent avec leur hash de transaction.

### 3.4 Avant d'ouvrir au public
- [ ] Un petit dépôt de test par crypto (BTC, LTC, DOGE, ETH), crédité tout seul.
- [ ] Un dépôt XMR crédité à la main.
- [ ] Un balayage par crypto, vérifié sur un explorateur de blocs.

---

## 4. Vérifications après mise en ligne

- [ ] Sans compte, la liste et la recherche s'affichent, et le formulaire propose « Se connecter pour signaler ».
- [ ] Un compte créé a 0 jeton, et un signalement est refusé avec un lien « Recharger ».
- [ ] Après un dépôt, le solde en USD et le nombre de jetons s'affichent dans l'en-tête et dans **Portefeuille**.
- [ ] Un signalement débite le bon nombre de jetons et apparaît dans l'**Historique**.
- [ ] La même capture envoyée deux fois sur un compte est refusée, et rien n'est débité.
- [ ] Un compte de la liste blanche ne peut pas être signalé et n'apparaît pas dans la liste publique.
- [ ] Dans **Modération**, les captures s'ouvrent, et Confirmer / Rejeter mettent à jour la liste publique (badge « Confirmé », compte rejeté masqué).
- [ ] Après un redéploiement, la connexion `mko` fonctionne toujours et les réglages sont conservés.

---

## 5. Développement local

```
cd M:\Travail\mario\scamwatch\backend
copy .env.example .env      # DATABASE_URL, JWT_SECRET, SUPERADMIN_*, et les clés crypto voulues
npm install
npx prisma db push
npm run dev                 # http://localhost:4100

cd M:\Travail\mario\scamwatch\frontend
npm install
npm run dev                 # http://localhost:5173, /api est relayé vers :4100
```

Tests : `cd scamwatch\backend` puis `npm test`.
Avec Docker : `cd scamwatch`, `copy .env.example .env`, puis `docker compose up --build` (http://localhost:4100).

Base de test créée sur le Postgres local pendant le développement, que vous pouvez supprimer : `scamwatch_test`.

---

## 6. À corriger dans les boutiques

Dans `backend/src/controllers/webhook.controller.js` (Captain Slabbin, et sans doute shop-react et clone, qui partagent la même logique) :
- le webhook **BlockCypher** n'est pas authentifié et crédite le montant écrit dans la requête ;
- le webhook **Alchemy** saute la vérification de signature quand l'en-tête est absent.

N'importe qui connaissant une adresse de dépôt en attente peut donc se faire créditer sans payer. Le correctif est celui de ScamWatch : le webhook déclenche seulement une lecture sur la blockchain, et Alchemy exige une signature valide.
