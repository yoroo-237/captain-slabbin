import { Router } from 'express';
import QRCode from 'qrcode';

// A payment QR code as a PNG, for the Telegram bot's payment screen (shown above the text).
// Public on purpose (Telegram fetches it): it only draws the text it is given, which is a
// payment URI (bitcoin:<address>?amount=…), and stores nothing.
const router = Router();
const SAFE = /^[A-Za-z0-9:.?=&%+_-]{6,300}$/;

router.get('/', async (req, res) => {
  const data = String(req.query.d || '');
  if (!SAFE.test(data)) return res.status(400).end();
  try {
    const png = await QRCode.toBuffer(data, { type: 'png', margin: 2, width: 512, errorCorrectionLevel: 'M' });
    res.set({ 'content-type': 'image/png', 'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff' }).send(png);
  } catch { res.status(400).end(); }
});

export default router;
