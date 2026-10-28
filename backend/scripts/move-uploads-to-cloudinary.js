// Moves every image saved in the local uploads folder to Cloudinary and rewrites
// the links that point to it (product photos, shelf banners, bot styles).
//
//   node scripts/move-uploads-to-cloudinary.js [--dry]
//
// Needs CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in
// backend/.env (without them uploads silently stay local, so this stops). Safe to
// run again: links already on Cloudinary are left alone.
import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../src/db.js';
import { env } from '../src/config/env.js';
import { uploadToCloudinary } from '../src/middlewares/upload.js';

const dry = process.argv.includes('--dry');
if (!env.cloudinary.cloudName || !env.cloudinary.apiKey || !env.cloudinary.apiSecret) {
  console.error('Cloudinary is not configured: set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in backend/.env, then run this again.');
  process.exit(1);
}

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
const LOCAL = /(?:https?:\/\/[^\s"'\\]+)?\/uploads\/products\/([\w-]+\.(?:jpe?g|png|webp|gif))/g;

const moved = new Map(); // file name → Cloudinary url
async function cloudUrl(file) {
  if (moved.has(file)) return moved.get(file);
  let url = null;
  try {
    const buffer = await fs.readFile(path.resolve(env.uploadDir, 'products', file));
    if (!dry) url = (await uploadToCloudinary(buffer, MIME[file.split('.').pop().toLowerCase()], 'captain-slabbin/uploads')).url;
    else url = `(dry) ${file}`;
  } catch (err) { console.error(`${file}: ${err.message}`); }
  moved.set(file, url);
  return url;
}

// Rewrites every local link inside a text; null when nothing changed
async function rewrite(text) {
  if (typeof text !== 'string') return null;
  const files = [...new Set([...text.matchAll(LOCAL)].map(m => m[1]))];
  if (!files.length) return null;
  let out = text;
  for (const f of files) {
    const url = await cloudUrl(f);
    if (url) out = out.replace(new RegExp(`(?:https?:\\/\\/[^\\s"'\\\\]+)?\\/uploads\\/products\\/${f.replace('.', '\\.')}`, 'g'), url);
  }
  return out === text ? null : out;
}

let changed = 0;
for (const img of await prisma.productImage.findMany()) {
  const url = await rewrite(img.url), thumbnail = await rewrite(img.thumbnail);
  if (url || thumbnail) {
    changed++;
    if (!dry) await prisma.productImage.update({ where: { id: img.id }, data: { ...(url && { url }), ...(thumbnail && { thumbnail }) } });
  }
}
for (const cat of await prisma.category.findMany({ where: { imageUrl: { not: null } } })) {
  const imageUrl = await rewrite(cat.imageUrl);
  if (imageUrl) { changed++; if (!dry) await prisma.category.update({ where: { id: cat.id }, data: { imageUrl } }); }
}
for (const style of await prisma.botStyle.findMany()) {
  const text = await rewrite(JSON.stringify(style.look));
  if (text) { changed++; if (!dry) await prisma.botStyle.update({ where: { id: style.id }, data: { look: JSON.parse(text) } }); }
}

const ok = [...moved.values()].filter(Boolean).length;
console.log(`${dry ? 'Dry run: ' : ''}${ok} of ${moved.size} files ${dry ? 'would move' : 'moved'} to Cloudinary, ${changed} records ${dry ? 'would be' : ''} updated.`);
await prisma.$disconnect();
