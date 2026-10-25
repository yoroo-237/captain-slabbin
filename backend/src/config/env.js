import 'dotenv/config';

const required = ['DATABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET'];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing environment variable: ${key}`);
  }
}

export const env = {
  nodeEnv:          process.env.NODE_ENV || 'development',
  port:             parseInt(process.env.PORT || '4000', 10),
  databaseUrl:      process.env.DATABASE_URL,
  frontendUrl:      process.env.FRONTEND_URL || 'http://localhost:5173',
  jwtSecret:        process.env.JWT_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
  uploadDir:        process.env.UPLOAD_DIR || './uploads',
  maxFileSize:      parseInt(process.env.MAX_FILE_SIZE || '5242880', 10),
  cdnBaseUrl:       process.env.CDN_BASE_URL || '',
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey:    process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
  },
  publicUrl:        process.env.PUBLIC_URL || '',
  blockcypherToken: process.env.BLOCKCYPHER_TOKEN || '',
  alchemy: {
    apiKey:     process.env.ALCHEMY_API_KEY || '',
    signingKey: process.env.ALCHEMY_SIGNING_KEY || '',
    authToken:  process.env.ALCHEMY_AUTH_TOKEN || '',
    webhookId:  process.env.ALCHEMY_WEBHOOK_ID || '',
  },
  ethHdSeed:   process.env.ETH_HD_SEED || '',
  btcHdSeed:   process.env.BTC_HD_SEED || process.env.ETH_HD_SEED || '',
  xmrAddress:  process.env.XMR_ADDRESS || '',
  // Access password of the storefront gate; Admin → Settings can override it
  sitePassword: process.env.SITE_PASSWORD || 'CSC',
  telegram: {
    botToken:      process.env.TELEGRAM_BOT_TOKEN || '',
    chatId:        process.env.TELEGRAM_CHAT_ID || '',
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || '',
  },
};
