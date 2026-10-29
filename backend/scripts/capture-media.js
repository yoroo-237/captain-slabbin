// A capture's images on Cloudinary, each uploaded once. <capture>/uploads.json
// remembers what every image (by its content) became, so importing the same
// capture again, or a newer one with the same pictures, uploads only what is new.
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { env } from '../src/config/env.js';
import { uploadToCloudinary } from '../src/middlewares/upload.js';

const hash = buf => crypto.createHash('sha1').update(buf).digest('hex');

export async function captureMedia(dir, folder, { dry = false } = {}) {
  const file = path.join(dir, 'uploads.json');
  let known = {};
  try { known = JSON.parse(await fs.readFile(file, 'utf8')); } catch { /* first import */ }
  const save = () => fs.writeFile(file, JSON.stringify(known, null, 1));
  const stats = { uploaded: 0, reused: 0 };
  const read = name => fs.readFile(path.join(dir, 'media', name));

  return {
    stats,
    // The url of a captured image, uploading it only if it was never uploaded
    async url(name) {
      if (!name) return null;
      let key;
      try { key = `${folder}:${hash(await read(name))}`; } catch (err) { console.error(`image ${name}:`, err.message); return null; }
      if (known[key]) { stats.reused++; return known[key]; }
      if (dry) { stats.uploaded++; return null; }
      try {
        known[key] = (await uploadToCloudinary(await read(name), 'image/jpeg', folder, env.publicUrl)).url;
        stats.uploaded++;
        await save();
        return known[key];
      } catch (err) { console.error(`image ${name}:`, err.message); return null; }
    },
    // An image already online (from an earlier import, before uploads.json existed):
    // when it is the same picture as the captured one, it is remembered instead of uploaded again
    async adopt(onlineUrl, name) {
      if (!onlineUrl || !name || Object.values(known).includes(onlineUrl)) return;
      try {
        const res = await fetch(onlineUrl);
        if (!res.ok) return;
        const online = hash(Buffer.from(await res.arrayBuffer()));
        if (online === hash(await read(name)) && !known[`${folder}:${online}`]) {
          known[`${folder}:${online}`] = onlineUrl;
          if (!dry) await save();
        }
      } catch { /* offline: it is uploaded instead */ }
    },
    // Whether a url is one of this capture's uploads (not a picture set by hand in the admin)
    isCaptured: u => Object.values(known).includes(u),
  };
}
