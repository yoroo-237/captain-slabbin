# ScamWatch: API + built frontend in one service.
# Railway: Root Directory "scamwatch/", add a Postgres service and
# reference its DATABASE_URL in this service's variables.
FROM node:20-bookworm-slim

# Python + Telethon run capture/capture.py, which looks at each reported account
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates python3 python3-pip \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY capture/requirements.txt capture/
RUN pip3 install --no-cache-dir --break-system-packages -r capture/requirements.txt
COPY capture capture

COPY frontend/package.json frontend/package-lock.json* frontend/
RUN cd frontend && npm install

COPY backend/package.json backend/package-lock.json* backend/
RUN cd backend && npm install

COPY frontend frontend
RUN cd frontend && npm run build

COPY backend backend
RUN cd backend && npx prisma generate

ENV NODE_ENV=production
ENV PORT=4100
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
WORKDIR /app/backend
CMD ["sh", "-c", "npx prisma db push --skip-generate && node src/server.js"]
