# ScamWatch

Platform to report scam, fake and abusive Telegram accounts. Bilingual (EN/FR).
Standalone project of this repository, with its own Railway project, served on its own subdomain
(e.g. `scamwatch.captainslabbin.shop`).

## Features

- Report form: the account (@username, t.me link or numeric ID), an "Attach a proof" checkbox and
  a progress bar (account check, proof capture, type, payment and sending).
- Capture (`capture/capture.py`, Telethon, a Telegram account dedicated to ScamWatch): name, bio
  and photo; a bot's answer to `/start`; a public channel or group's latest messages. Regular users
  are never messaged. Captures run one at a time; `backend/src/detect.js` gives the type from what
  was captured.
  - With proof: `POST /api/captures`, the form follows `GET /api/captures/:id`, shows the capture,
    then sends `POST /api/reports` with its `captureId`. Paid only once the proof is in. The same
    content counts once per account (`proofHash` = `cap:` + content hash); no per-user limit.
  - Without proof: sent and paid at once, a background capture (reused for 24 h) fills the type.
    Batches and spreading (0 to 1440 minutes, steps of 15) are only for reports without proof.
  - The Telegram account is connected from Admin → Settings (API ID, API hash, phone, code, 2FA
    password; `capture/connect.py`). No environment variable: the session is stored in Postgres,
    encrypted with a key derived from `JWT_SECRET`. Until it is connected, the checkbox is off and
    reports keep the type "other".
- Reports without proof: a limited number per user and account (1 by default, 0 = no limit). The API
  still accepts a proof link and screenshots from other clients (deduplicated, stored in Postgres).
- The super admin has no cost and no limit.
- Look: the design, logo and favicon of the portfolio (paper, charcoal, orange; Space Grotesk,
  Instrument Serif, JetBrains Mono).
- Public list and search, free and without account. Confirmed accounts get a badge and come first;
  rejected and whitelisted ones are hidden.

## Accounts and tokens

- Reporting needs an account (username + password, scrypt hash, session token signed with `JWT_SECRET`).
- Wallet: same system as the shops. A top-up gives a deposit address (BTC, LTC, DOGE, ETH: HD
  derived; XMR: one address, credited by hand). What the address received is credited as a crypto
  holding; the balance is that crypto at the live price (CoinGecko, Kraken fallback).
- Tokens available = USD balance / token price. A report costs N tokens, debited in crypto at the
  price of the moment, in the same database transaction as the report: a refused report costs nothing.
- Every deposit belongs 100 % to the super admin (no commission split): one sweep per currency
  sends each deposit address to the reserve address.
- Webhooks (BlockCypher, signed Alchemy) only trigger a check: the amount credited is always read
  on-chain. Open deposits are also checked every 5 minutes, and closed when they expire.
- HD addresses use account `7'` (`m/44'/coin'/7'/0/<deposit id>`), so a seed shared with a shop
  never yields the same address. A dedicated seed is still recommended.

## Super admin (`/#admin`)

The account named by `SUPERADMIN_USERNAME` is created once, at the first start, with
`SUPERADMIN_PASSWORD` (the password never lives in the code). It is then kept as it is: its
password is changed from the site (My account). Lost password: `RESET_SUPERADMIN_PASSWORD=true`
for one deploy puts the variable's password back.

- Moderation: reports and screenshots per account, confirm, reject, back to pending, add to whitelist.
- Wallet: funds received, reserve addresses, sweep per currency, deposits (manual credit for XMR).
- Whitelist: accounts and bots that cannot be reported.
- Settings: token price (USD), tokens per report, reports per user and account,
  deposit address validity.

Not part of this project: automated sending of reports to Telegram.

## Run with Docker

```
cd scamwatch
cp .env.example .env        # set SUPERADMIN_PASSWORD, JWT_SECRET, wallet keys
docker compose up --build   # Postgres + app, schema applied at start
```

Open http://localhost:4100.

## Run locally without Docker

```
cd scamwatch/backend
cp .env.example .env        # DATABASE_URL, JWT_SECRET, SUPERADMIN_*, wallet keys
npm install
npx prisma db push
npm run dev                 # API on :4100

cd ../frontend
npm install
npm run dev                 # UI on :5173, proxies /api
```

Tests: `cd backend && npm test`

## Railway

1. New Railway project (separate from the shops), add a Postgres service.
2. Add a service from this repository, Root Directory `scamwatch`, builder Dockerfile.
3. Variables:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `IP_SALT` | random string, never changed afterwards |
| `JWT_SECRET` | random string, 32+ characters |
| `SUPERADMIN_USERNAME` / `SUPERADMIN_PASSWORD` | super admin sign-in |
| `BTC_HD_SEED` | 12/24-word seed for BTC, LTC, DOGE (dedicated one recommended) |
| `ETH_HD_SEED` | seed for ETH |
| `BLOCKCYPHER_TOKEN` | active blockcypher.com token (BTC/LTC/DOGE checks and sweeps) |
| `ALCHEMY_API_KEY` | ETH checks and sweeps |
| `ALCHEMY_WEBHOOK_ID`, `ALCHEMY_AUTH_TOKEN`, `ALCHEMY_SIGNING_KEY` | optional: ETH webhook to `https://scamwatch.captainslabbin.shop/api/webhooks/alchemy` |
| `PUBLIC_URL` | `https://scamwatch.captainslabbin.shop`, for BlockCypher webhooks (optional, polling works without) |

4. Settings → Networking → Custom Domain: `scamwatch.captainslabbin.shop`, CNAME at the registrar.
5. Sign in at `https://scamwatch.captainslabbin.shop/#admin`, set the reserve addresses and the token price.

## Next steps

- Rate limit on report submission.
- Evidence file export for confirmed accounts.
- Telegram bot as a second entry point.
