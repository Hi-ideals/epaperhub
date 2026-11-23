/**
 * On-the-fly page image sizes.
 * Each page stores ONE web image ("...-large.webp", 4000px). Reading (1400px) and thumbnail (360px)
 * sizes are made from it when a browser asks for "...-large.webp?w=1400", kept in a memory cache,
 * and sent with long browser-cache headers. Nothing extra is written to disk.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const config = require('../config');

const ALLOWED = [360, 800, 1400];          // widths browsers may ask for
const MAX_BYTES = 150 * 1024 * 1024;        // memory cache budget
const cache = new Map();                    // key -> { buf, etag } (Map keeps insertion order = LRU)
const inflight = new Map();
let used = 0;

function remember(key, val) {
  if (cache.has(key)) { used -= cache.get(key).buf.length; cache.delete(key); }
  cache.set(key, val); used += val.buf.length;
  for (const k of cache.keys()) { if (used <= MAX_BYTES) break; used -= cache.get(k).buf.length; cache.delete(k); }
}

async function make(abs, w, mtime) {
  const buf = await sharp(abs, { limitInputPixels: 400e6 })
    .resize({ width: w, withoutEnlargement: true, kernel: 'lanczos3' })
    .sharpen({ sigma: w >= 1000 ? 0.6 : 0.4 })
    .webp({ quality: w >= 1000 ? 80 : 74, smartSubsample: true, effort: 4 })
    .toBuffer();
  return { buf, etag: `"${Math.round(mtime)}-${w}-${buf.length}"` };
}

/** Express middleware for /uploads: handles "-large.webp?w=N", passes everything else on. */
module.exports = function pageSizes(req, res, next) {
  const w = Number(req.query.w);
  if (!w || !/-large\.webp$/.test(req.path)) return next();
  const width = ALLOWED.find((a) => a >= w) || ALLOWED[ALLOWED.length - 1];
  const rel = decodeURIComponent(req.path).replace(/^\/+/, '');
  if (rel.includes('..')) return next();
  const abs = path.join(config.paths.uploadsRoot, rel);
  fs.stat(abs, async (err, st) => {
    if (err || !st.isFile()) return next();
    const key = `${abs}|${width}|${st.mtimeMs}`;
    try {
      let hit = cache.get(key);
      if (hit) remember(key, hit); // mark as recently used
      else {
        if (!inflight.has(key)) inflight.set(key, make(abs, width, st.mtimeMs).finally(() => inflight.delete(key)));
        hit = await inflight.get(key);
        remember(key, hit);
      }
      if (req.headers['if-none-match'] === hit.etag) return res.status(304).end();
      res.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=2592000, immutable', ETag: hit.etag, 'Content-Length': hit.buf.length });
      res.end(hit.buf);
    } catch (e) { next(); }
  });
};
/** Prepare the usual sizes in memory right after an upload, so the first reader doesn't wait. */
module.exports.warm = (abs, widths = [1400, 360]) => setImmediate(async () => {
  try {
    const st = fs.statSync(abs);
    for (const w of widths) { const key = `${abs}|${w}|${st.mtimeMs}`; if (!cache.has(key)) remember(key, await make(abs, w, st.mtimeMs)); }
  } catch { /* ignore */ }
});
module.exports.stats = () => ({ items: cache.size, bytes: used });
