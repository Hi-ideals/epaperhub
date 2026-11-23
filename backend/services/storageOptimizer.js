/**
 * Storage optimizer — makes a newspaper's files smaller WITHOUT making pages harder to read.
 *
 *  1. Page originals:
 *     - PNG / GIF / TIFF (incl. pages rendered from PDF uploads) → LOSSLESS WebP: pixel-identical, typically 40–70% smaller.
 *     - Very heavy JPEGs → JPEG quality 95 with full colour detail (4:4:4) — visually identical text and photos;
 *       only kept when it saves at least 25%.
 *     - Anything that would not get meaningfully smaller is left untouched.
 *  2. Leftovers: temp files and page images / originals no page uses any more.
 *  Reader-facing images (large / medium / thumb) are not touched.
 *
 * Runs inside the current tenant context (database + folders of one newspaper).
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const config = require('../config');
const { query } = require('../config/db');
const { keyOf, current } = require('../platform/context');

const MIN_SAVING = 0.25;          // re-encoded JPEG must be ≥25% smaller to replace the original
const WEBP_MAX = 16383;           // WebP size limit (px)
const jobs = new Map();           // tenantKey -> { running, phase, done, total, saved_bytes, ... }

function dirSize(dir) {
  let n = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      n += e.isDirectory() ? dirSize(p) : (fs.statSync(p, { throwIfNoEntry: false })?.size || 0);
    }
  } catch { /* missing folder */ }
  return n;
}
function walk(dir, out = []) {
  try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, out); else out.push(p); } } catch { /* none */ }
  return out;
}

/** Bytes per area for the current newspaper. */
function usage() {
  return {
    page_images: dirSize(path.join(config.paths.uploads, 'editions')),
    other_uploads: dirSize(config.paths.uploads) - dirSize(path.join(config.paths.uploads, 'editions')),
    originals: dirSize(config.paths.originals),
    backups: dirSize(config.paths.backups),
  };
}

/**
 * Re-encode one original to a smaller file with no visible quality loss.
 * Returns { path, mime, size_bytes } of the new file, or null when it should stay as is.
 */
async function shrinkOriginal(abs) {
  let meta;
  try { meta = await sharp(abs, { limitInputPixels: 400e6 }).metadata(); } catch { return null; }
  const before = fs.statSync(abs).size;
  const base = abs.replace(/\.[^.]+$/, '');
  if (['png', 'gif', 'tiff'].includes(meta.format) && meta.width <= WEBP_MAX && meta.height <= WEBP_MAX) {
    const dest = `${base}.webp`;
    if (dest === abs) return null;
    await sharp(abs, { limitInputPixels: 400e6 }).webp({ lossless: true, effort: 5 }).toFile(dest);
    const after = fs.statSync(dest).size;
    if (after >= before * 0.95) { fs.unlinkSync(dest); return null; }
    return { abs: dest, mime: 'image/webp', size_bytes: after };
  }
  if (meta.format === 'jpeg' && before > 1.5 * 1024 * 1024) {
    const tmp = `${base}.opt-${Date.now()}.jpg`;
    await sharp(abs, { limitInputPixels: 400e6 }).rotate().jpeg({ quality: 95, chromaSubsampling: '4:4:4', mozjpeg: true }).toFile(tmp);
    const after = fs.statSync(tmp).size;
    if (after > before * (1 - MIN_SAVING)) { fs.unlinkSync(tmp); return null; }
    fs.renameSync(tmp, abs);   // same name, same type
    return { abs, mime: 'image/jpeg', size_bytes: after };
  }
  return null;
}

/** Compress all page originals. */
async function optimizeOriginals(job) {
  const rows = await query("SELECT pi.id, pi.path, pi.size_bytes FROM page_images pi WHERE pi.variant='original' ORDER BY pi.id");
  job.phase = 'Compressing original pages'; job.total = rows.length; job.done = 0;
  for (const r of rows) {
    job.done++;
    const abs = path.join(config.paths.originals, r.path);
    if (!fs.existsSync(abs)) continue;
    const before = fs.statSync(abs).size;
    try {
      const res = await shrinkOriginal(abs);
      if (!res) continue;
      const relNew = path.relative(config.paths.originals, res.abs).split(path.sep).join('/');
      await query('UPDATE page_images SET path=?, mime=?, size_bytes=? WHERE id=?', [relNew, res.mime, res.size_bytes, r.id]);
      if (res.abs !== abs) fs.unlinkSync(abs);
      job.saved_bytes += before - res.size_bytes; job.files_compressed++;
    } catch (e) { job.errors.push(`${path.basename(abs)}: ${e.message}`.slice(0, 200)); }
  }
}

/** Remove temp files and page files that no page uses. */
async function cleanup(job) {
  // One web image per page: older pages also kept medium/thumb (and xlarge) files — those sizes are now made on the fly
  job.phase = 'Keeping one image per page';
  const extra = await query(`SELECT pi.id, pi.path, pi.size_bytes FROM page_images pi
    WHERE pi.variant IN ('xlarge','medium','thumb') AND EXISTS (SELECT 1 FROM page_images l WHERE l.page_id=pi.page_id AND l.variant='large')`);
  for (const r of extra) {
    const abs = path.join(config.paths.uploads, r.path);
    const size = fs.statSync(abs, { throwIfNoEntry: false })?.size || 0;
    await query('DELETE FROM page_images WHERE id=?', [r.id]);
    try { fs.unlinkSync(abs); } catch { /* already gone */ }
    job.saved_bytes += size; job.files_removed++;
  }
  // Covers that pointed at a removed medium image → use the page's large image
  if (extra.length) {
    await query(`UPDATE editions e JOIN edition_pages p ON p.edition_id=e.id JOIN page_images l ON l.page_id=p.id AND l.variant='large'
      SET e.cover_image=l.path WHERE e.cover_image LIKE '%-medium.webp' AND REPLACE(e.cover_image,'-medium.webp','-large.webp')=l.path`);
    require('./cache').invalidate?.('public:');
  }
  job.phase = 'Removing unused files';
  const used = new Set((await query('SELECT variant, path FROM page_images')).map((r) => `${r.variant === 'original' ? 'o' : 'u'}:${r.path}`));
  const old = Date.now() - 6 * 60 * 60 * 1000; // never touch files from the last 6 hours (uploads in progress)
  const candidates = [
    ...walk(path.join(config.paths.uploads, 'editions')).filter((f) => /-(xlarge|large|medium|thumb)\.webp$/.test(f)).map((f) => ['u', config.paths.uploads, f]),
    ...walk(path.join(config.paths.originals, 'editions')).map((f) => ['o', config.paths.originals, f]),
  ];
  for (const [kind, root, f] of candidates) {
    const rel = path.relative(root, f).split(path.sep).join('/');
    if (used.has(`${kind}:${rel}`)) continue;
    const st = fs.statSync(f, { throwIfNoEntry: false });
    if (!st || st.mtimeMs > old) continue;
    try { fs.unlinkSync(f); job.saved_bytes += st.size; job.files_removed++; } catch { /* ignore */ }
  }
  // Shared temp folder: files older than 6 hours
  for (const f of walk(config.paths.tmp)) {
    const st = fs.statSync(f, { throwIfNoEntry: false });
    if (st && st.mtimeMs < old && !f.endsWith('.gitkeep')) { try { fs.unlinkSync(f); job.saved_bytes += st.size; job.files_removed++; } catch { /* in use */ } }
  }
  // Empty edition folders
  for (const root of [path.join(config.paths.uploads, 'editions'), path.join(config.paths.originals, 'editions')]) {
    try { for (const d of fs.readdirSync(root)) { const p = path.join(root, d); if (fs.statSync(p).isDirectory() && !fs.readdirSync(p).length) fs.rmdirSync(p); } } catch { /* none */ }
  }
}

/** Start an optimization run for the current newspaper (returns immediately). */
function start({ compress = true, clean = true } = {}) {
  const key = keyOf(current());
  const existing = jobs.get(key);
  if (existing?.running) return existing;
  const job = { running: true, phase: 'Starting', done: 0, total: 0, saved_bytes: 0, files_compressed: 0, files_removed: 0, errors: [], started_at: new Date(), finished_at: null, before: usage() };
  jobs.set(key, job);
  (async () => {
    try {
      if (compress) await optimizeOriginals(job);
      if (clean) await cleanup(job);
      job.phase = 'Finished';
    } catch (e) { job.phase = 'Stopped'; job.errors.push(e.message); }
    job.after = usage(); job.running = false; job.finished_at = new Date();
    const t = current(); if (t) require('../platform/tenants').storageUsed(t, { fresh: true }).catch(() => {});
  })();
  return job;
}

const status = () => jobs.get(keyOf(current())) || null;

module.exports = { usage, start, status, shrinkOriginal, cleanup, dirSize };
