// Prints the variables of the bots platform, ready to paste into Railway
// (service → Variables → Raw Editor), with fresh secrets, passwords and wallet
// seeds generated on this machine. Run it once and keep the output safe: the
// seeds hold the platform's deposits.
//   node scripts/bots-env.js [bots.captainslabbin.shop]
import crypto from 'crypto';
import { generateMnemonic } from 'bip39';

const domain = (process.argv[2] || 'bots.captainslabbin.shop').replace(/^https?:\/\//, '').replace(/\/+$/, '');
const secret = () => crypto.randomBytes(32).toString('hex');
const password = () => crypto.randomBytes(12).toString('base64url');

console.log(`# Bots platform: ${domain}. Paste into Railway, then fill the empty lines.
DATABASE_URL=\${{Postgres.DATABASE_URL}}
FRONTEND_URL=https://${domain}
PUBLIC_URL=https://${domain}
JWT_SECRET=${secret()}
JWT_REFRESH_SECRET=${secret()}
TELEGRAM_WEBHOOK_SECRET=${secret()}
RAILWAY_DOCKERFILE_PATH=bots.Dockerfile
SEED_DEMO_PRODUCTS=false
ADMIN_USERNAME=admin
ADMIN_PASSWORD=${password()}
SUPERADMIN_USERNAME=superadmin
SUPERADMIN_PASSWORD=${password()}
# New wallets of the platform, never the site's (12 words each)
BTC_HD_SEED=${generateMnemonic()}
ETH_HD_SEED=${generateMnemonic()}
# Telegram account of the captures: https://my.telegram.org > API development tools
API_ID=
API_HASH=
# Same values as the site's service
BLOCKCYPHER_TOKEN=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
# A new Alchemy webhook to https://${domain}/api/webhooks/alchemy
ALCHEMY_API_KEY=
ALCHEMY_SIGNING_KEY=
ALCHEMY_AUTH_TOKEN=
ALCHEMY_WEBHOOK_ID=
# The platform's Monero address
XMR_ADDRESS=`);
