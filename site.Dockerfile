# The Captain Slabbin site's API (backend), with Python for the bot captures
# (tools/tg-explorer). The storefront and admin stay on Vercel.
# Railway: Root Directory "/" and the variable RAILWAY_DOCKERFILE_PATH=site.Dockerfile.
# Mount a volume on /data: captures and Telegram sessions live there.
FROM node:20-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY tools/tg-explorer/requirements.txt tools/tg-explorer/
RUN python3 -m venv /opt/tg && /opt/tg/bin/pip install --no-cache-dir -r tools/tg-explorer/requirements.txt

COPY backend/package.json backend/package-lock.json backend/
RUN cd backend && npm ci --omit=dev
COPY backend backend
# Only the scripts: sessions, captures and .env of a PC never enter the image
COPY tools/tg-explorer/*.py tools/tg-explorer/
RUN cd backend && npx prisma generate

ENV NODE_ENV=production \
    CAPTURES=on \
    PYTHON=/opt/tg/bin/python \
    CAPTURE_TOOL_DIR=/app/tools/tg-explorer \
    CAPTURES_DIR=/data/captures \
    TG_SESSIONS_DIR=/data/sessions \
    QT_CAPTURE_DIR=/data/qt-capture

WORKDIR /app/backend
# Migrations and seed before each start (the database is reachable at runtime)
CMD ["sh", "-c", "npm run db:deploy && npm start"]
