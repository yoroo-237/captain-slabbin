# The bots platform: the backend in bots mode, which also serves the bots
# dashboard and runs the bot captures (tools/tg-explorer, Python + Telethon).
# Railway: Root Directory "/" and the variable RAILWAY_DOCKERFILE_PATH=bots.Dockerfile.
# Mount a volume on /data: captures and the Telegram session live there.
FROM node:20-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python of the captures, in its own environment
COPY tools/tg-explorer/requirements.txt tools/tg-explorer/
RUN python3 -m venv /opt/tg && /opt/tg/bin/pip install --no-cache-dir -r tools/tg-explorer/requirements.txt

COPY backend/package.json backend/package-lock.json backend/
RUN cd backend && npm ci --omit=dev
COPY frontend/package.json frontend/package-lock.json frontend/
RUN cd frontend && npm ci

COPY backend backend
COPY frontend frontend
# Only the scripts: sessions, captures and .env of a PC never enter the image
COPY tools/tg-explorer/*.py tools/tg-explorer/

RUN cd backend && npx prisma generate \
 && cd ../frontend && npm run build:bots && rm -rf node_modules

ENV NODE_ENV=production \
    PLATFORM=bots \
    PYTHON=/opt/tg/bin/python \
    CAPTURE_TOOL_DIR=/app/tools/tg-explorer \
    CAPTURES_DIR=/data/captures \
    TG_SESSIONS_DIR=/data/sessions

WORKDIR /app/backend
# Migrations and seed before each start (the database is reachable at runtime)
CMD ["sh", "-c", "npm run db:deploy && npm start"]
