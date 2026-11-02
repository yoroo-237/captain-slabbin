# ScamWatch

Anonymous platform to report scam, fake and abusive Telegram accounts. Bilingual (EN/FR).
Standalone project of this repository, with its own Railway project.

## Step 1 (current)

- Anonymous report form: account (@username, t.me link or numeric ID), description, optional proof link.
- Automatic type detection (`backend/src/detect.js`): crypto scam, clone, spam, impersonation, phishing, other. Live preview in the form, the user can override it.
- Reports are grouped per account, with a public list and search.
- Hashed IP stored with each report, so abuse controls can be added in a later step.

## Step 2 (current)

- Repeated reports backed by evidence: an account can be reported again and again, as long as each
  report brings evidence never sent for this account (a new proof link or new screenshots).
  Without evidence, a limited number of reports per person (hashed IP) and account: 1 by default,
  set in the moderation space (0 = no limit). Links are compared after
  normalization (protocol, host case, trailing slash, utm_* ignored), screenshots by SHA-256.
- Screenshot upload: up to 3 images per report (PNG, JPEG, WebP, 3 MB each, type checked from the
  bytes). Stored in Postgres (Railway disks are not kept), visible to the moderator only.
- Moderation space at `/#admin`, protected by `ADMIN_PASSWORD` (10 wrong tries per IP, then blocked
  15 minutes): list by status, read every report and its screenshots, confirm, reject or put back
  to pending. Confirmed accounts get a badge and come first in the public list; rejected ones are
  hidden from it.

Not part of this project: automated sending of reports to Telegram.

## Run with Docker (recommended)

```
cd scamwatch
cp .env.example .env        # optional: set passwords
docker compose up --build   # Postgres + app, schema applied at start
```

Open http://localhost:4100. Data lives in the `dbdata` volume.

## Run locally without Docker

```
cd scamwatch/backend
cp .env.example .env        # set DATABASE_URL (Postgres)
npm install
npx prisma db push
npm run dev                 # API on :4100

cd ../frontend
npm install
npm run dev                 # UI on :5173, proxies /api
```

Tests: `cd backend && npm test`

## Railway

1. New Railway project (separate from the shops).
2. Add a Postgres service.
3. Add a service from this repository, Root Directory `scamwatch/` (uses `Dockerfile`).
4. Variables: `DATABASE_URL` (reference the Postgres one), `IP_SALT` (random string),
   `ADMIN_PASSWORD` (long random string, enables `/#admin`).

## Next steps

- Rate limit on report submission.
- Evidence file export for confirmed accounts.
- Telegram bot as a second entry point.
