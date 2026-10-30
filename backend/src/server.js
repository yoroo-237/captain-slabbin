import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from './config/env.js';
import { errorHandler } from './middlewares/errorHandler.js';
import router from './routes/index.js';
import { startDepositCleanupJob } from './jobs/depositCleanup.js';
import { ensureDefaultStyle, ensurePresetStyles } from './services/telegram.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// CORS — accept both www and non-www variants of the frontend domain
const allowedOrigins = [env.frontendUrl, env.frontendUrl?.replace('://', '://www.')].filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Gate-Token'],
}));

// Alchemy webhooks — raw body required for HMAC verification
app.use('/api/webhooks/alchemy', express.raw({ type: 'application/json' }));

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static uploads
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// API routes
app.use('/api', router);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', env: env.nodeEnv, platform: env.platform }));

// Bots platform: the server is also the bots dashboard (frontend `npm run build:bots`)
if (env.platform === 'bots') {
  const web = path.resolve(env.botsWebDir || path.join(__dirname, '..', '..', 'frontend', 'dist-bots'));
  app.use(express.static(web, { index: false, maxAge: '1h' }));
  // The bots' own pictures (welcome, menu) live with the site's brand files
  app.use('/brand', express.static(path.join(__dirname, '..', '..', 'frontend', 'public', 'brand'), { maxAge: '7d' }));
  app.get(/^\/(?!api\/|uploads\/|brand\/).*/, (req, res) => res.sendFile(path.join(web, 'index.html'), err => {
    if (err) res.status(503).type('text').send('The bots dashboard is not built: run "npm run build:bots" in frontend.');
  }));
}

// Global error handler
app.use(errorHandler);

app.listen(env.port, () => {
  console.log(`Shop backend running on port ${env.port} [${env.nodeEnv}]`);
  startDepositCleanupJob();
  ensureDefaultStyle().then(ensurePresetStyles).catch(err => console.error('[Telegram] styles:', err.message));
});

export default app;
