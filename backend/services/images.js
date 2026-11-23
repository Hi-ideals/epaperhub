const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const config = require('../config');
const settings = require('./settings');
const { randomToken } = require('../utils/helpers');
const { ApiError } = require('../utils/http');

sharp.cache(false);
// Per-client folders (resolved for the current request's newspaper)
const up = () => config.paths.uploads;
const orig = () => config.paths.originals;

// Page images readers see. "large" is loaded when the reader zooms in; sized for sharp text at 3x zoom.
// ONE web image per page is stored (sharp at full zoom). Reading and thumbnail sizes are made
// from it on request (server.js /uploads ...-large.webp?w=) and cached in memory, never on disk.
const VARIANTS = {
  large: { width: 4000, quality: 78, sharpen: 0.5 },
};
const SIZES = { medium: 1400, thumb: 360 }; // widths served on the fly

const rel = (abs) => path.relative(up(), abs).split(path.sep).join('/');
const absUpload = (r) => path.join(up(), r);
const absOriginal = (r) => path.join(orig(), r);
const mkdir = (d) => fs.mkdirSync(d, { recursive: true });
const safeUnlink = (p) => p && fs.promises.unlink(p).catch(() => {});

/** Validate an image by actually decoding its header. */
async function assertImage(file) {
  try {
    const meta = await sharp(file).metadata();
    if (!meta.width || !meta.height) throw new Error();
    if (!['jpeg', 'png', 'webp', 'gif'].includes(meta.format)) throw new Error();
    return meta;
  } catch {
    throw ApiError.badRequest('The uploaded file is not a valid image.');
  }
}

/** Store a generic image (logo, cover, category...) under uploads/<folder>. Returns relative path. */
async function storeImage(tmpPath, folder, { maxWidth = 1600, keepFormat = false, originalName = '' } = {}) {
  const dir = path.join(up(), folder);
  mkdir(dir);
  const ext = path.extname(originalName || tmpPath).toLowerCase();
  if (ext === '.ico') {
    const dest = path.join(dir, `${Date.now()}-${randomToken(5)}.ico`);
    await fs.promises.copyFile(tmpPath, dest);
    return rel(dest);
  }
  const meta = await assertImage(tmpPath);
  if (keepFormat && meta.format === 'png') {
    const dest = path.join(dir, `${Date.now()}-${randomToken(5)}.png`);
    await sharp(tmpPath).rotate().resize({ width: maxWidth, withoutEnlargement: true }).png().toFile(dest);
    return rel(dest);
  }
  const dest = path.join(dir, `${Date.now()}-${randomToken(5)}.webp`);
  await sharp(tmpPath).rotate().resize({ width: maxWidth, withoutEnlargement: true }).webp({ quality: 85 }).toFile(dest);
  return rel(dest);
}

function escapeXml(s) { return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c])); }

const GRAVITY = { center: 'centre', 'top-left': 'northwest', 'top-right': 'northeast', 'bottom-left': 'southwest', 'bottom-right': 'southeast', top: 'north', bottom: 'south' };

/** Build sharp composite layers for the watermark at a given output size. */
async function watermarkLayers(width, height, wm) {
  if (!wm || !wm.enabled) return [];
  const layers = [];
  const opacity = Math.min(1, Math.max(0.02, Number(wm.opacity) || 0.15));
  const targetW = Math.max(40, Math.round(width * (Math.min(100, Math.max(5, Number(wm.size) || 30)) / 100)));
  const tile = wm.position === 'tile';
  const gravity = GRAVITY[wm.position] || 'centre';

  if ((wm.type === 'text' || wm.type === 'both') && wm.text) {
    const text = escapeXml(wm.text);
    const fontSize = Math.max(10, Math.round(targetW / Math.max(4, wm.text.length * 0.56)));
    const rot = Number(wm.rotation) || 0;
    const boxW = Math.round(targetW * 1.15);
    const boxH = Math.round(tile ? boxW * 0.7 : Math.max(fontSize * 2, Math.abs(Math.sin((rot * Math.PI) / 180)) * targetW + fontSize * 2));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${boxW}" height="${boxH}">
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif"
        font-weight="700" font-size="${fontSize}" fill="${escapeXml(wm.color || '#000')}" fill-opacity="${opacity}"
        transform="rotate(${rot} ${boxW / 2} ${boxH / 2})">${text}</text></svg>`;
    let buf = await sharp(Buffer.from(svg)).png().toBuffer();
    const m = await sharp(buf).metadata();
    if (m.width > width || m.height > height) buf = await sharp(buf).resize({ width: Math.min(m.width, width), height: Math.min(m.height, height), fit: 'inside' }).png().toBuffer();
    layers.push({ input: buf, gravity: tile ? undefined : (wm.type === 'both' ? 'centre' : gravity), tile });
  }
  if ((wm.type === 'logo' || wm.type === 'both') && wm.logo) {
    const logoPath = absUpload(wm.logo);
    if (fs.existsSync(logoPath)) {
      const lw = Math.min(width, wm.type === 'both' ? Math.round(targetW * 0.5) : targetW);
      let buf = await sharp(logoPath).resize({ width: lw, height: height, fit: 'inside' }).ensureAlpha().png().toBuffer();
      buf = await sharp(buf).composite([{ input: Buffer.from([255, 255, 255, Math.round(opacity * 255)]), raw: { width: 1, height: 1, channels: 4 }, tile: true, blend: 'dest-in' }]).png().toBuffer();
      layers.push({ input: buf, gravity: tile ? undefined : gravity, tile });
    }
  }
  return layers;
}

/** Create web variants (large/medium/thumb) from an original image. Never modifies the original. */
async function buildVariants(originalAbs, editionId, wmOverride, opts = {}) {
  const wm = wmOverride || (await settings.getGroup('watermark_settings'));
  const dir = path.join(up(), 'editions', String(editionId));
  mkdir(dir);
  const token = `${Date.now()}-${randomToken(5)}`;
  const out = {};
  const srcWidth = (await sharp(originalAbs, { limitInputPixels: 400e6 }).metadata()).width || 0;
  for (const [name, v0] of Object.entries(VARIANTS)) {
    // PDF pages: readers zoom into the PDF itself (vector), so the picture only needs reading size
    const v = opts.fromPdf && name === 'large' ? { ...v0, width: 2000, quality: 80, sharpen: 0.5 } : v0;
    if (v.onlyIfWiderThan && srcWidth <= v.onlyIfWiderThan) continue; // no extra detail to show
    let pipe = sharp(originalAbs, { limitInputPixels: 400e6 }).rotate().resize({ width: v.width, withoutEnlargement: true, kernel: 'lanczos3' });
    if (v.sharpen) pipe = pipe.sharpen({ sigma: v.sharpen }); // keeps small newspaper text crisp after downscaling
    const resized = await pipe.toBuffer({ resolveWithObject: true });
    let img = sharp(resized.data);
    const applyWm = name !== 'thumb' && wm.enabled;
    if (applyWm) img = img.composite(await watermarkLayers(resized.info.width, resized.info.height, wm));
    const dest = path.join(dir, `${token}-${name}.webp`);
    const info = await img.webp({ quality: v.quality, smartSubsample: true, effort: 5 }).toFile(dest);
    out[name] = { path: rel(dest), mime: 'image/webp', width: info.width, height: info.height, size_bytes: info.size, is_watermarked: applyWm ? 1 : 0 };
  }
  return out;
}

/** Split a PDF into one small PDF per page (vector: far smaller than a picture of the page). */
async function splitPdf(pdfPath) {
  const { PDFDocument } = require('pdf-lib');
  const src = await PDFDocument.load(await fs.promises.readFile(pdfPath), { ignoreEncryption: true });
  const out = [];
  for (let i = 0; i < src.getPageCount(); i++) {
    const d = await PDFDocument.create();
    const [pg] = await d.copyPages(src, [i]);
    d.addPage(pg);
    out.push(Buffer.from(await d.save({ useObjectStreams: true })));
  }
  return out;
}

/** Keep a single-page PDF as the page original. `renderedPng` gives the page size. */
async function saveOriginalPdf(pdfBuf, editionId, renderedPng) {
  const meta = await sharp(renderedPng).metadata();
  const dir = path.join(orig(), 'editions', String(editionId));
  mkdir(dir);
  const dest = path.join(dir, `${Date.now()}-${randomToken(6)}.pdf`);
  await fs.promises.writeFile(dest, pdfBuf);
  return { path: path.relative(orig(), dest).split(path.sep).join('/'), mime: 'application/pdf', width: meta.width, height: meta.height, size_bytes: pdfBuf.length, is_watermarked: 0 };
}

/** Image file to build web variants from: the original itself, or a fresh render of a PDF original. */
async function renderSource(originalAbs) {
  if (!/\.pdf$/i.test(originalAbs)) return { file: originalAbs, fromPdf: false, cleanup: () => {} };
  const [png] = await pdfToImages(originalAbs);
  return { file: png, fromPdf: true, cleanup: () => safeUnlink(png) };
}

/** Save an uploaded page original into private storage. */
async function saveOriginal(tmpPath, editionId, originalName) {
  const meta = await assertImage(tmpPath);
  const dir = path.join(orig(), 'editions', String(editionId));
  mkdir(dir);
  const ext = { jpeg: '.jpg', png: '.png', webp: '.webp', gif: '.gif' }[meta.format] || path.extname(originalName);
  const dest = path.join(dir, `${Date.now()}-${randomToken(6)}${ext}`);
  await fs.promises.copyFile(tmpPath, dest);
  // Store it smaller with no visible loss (PNG/PDF pages → lossless WebP; very heavy JPEG → q95 4:4:4)
  let finalPath = dest; let mime = `image/${meta.format === 'jpeg' ? 'jpeg' : meta.format}`;
  try {
    const small = await require('./storageOptimizer').shrinkOriginal(dest);
    if (small) { if (small.abs !== dest) await fs.promises.unlink(dest); finalPath = small.abs; mime = small.mime; }
  } catch { /* keep the file as uploaded */ }
  const stat = await fs.promises.stat(finalPath);
  return {
    path: path.relative(orig(), finalPath).split(path.sep).join('/'),
    mime, width: meta.width, height: meta.height, size_bytes: stat.size, is_watermarked: 0,
  };
}

/** Rasterise every page of a PDF to PNG files (returns temp paths). */
/** PDF pages are drawn about this wide (px): sharp text even when readers zoom in. */
const PDF_TARGET_WIDTH = 4000;
async function pdfToImages(pdfPath) {
  const { createCanvas } = require('@napi-rs/canvas');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(await fs.promises.readFile(pdfPath));
  let doc;
  const task = pdfjs.getDocument({ data, disableFontFace: true, useSystemFonts: false, isEvalSupported: false, verbosity: 0 });
  try {
    doc = await task.promise;
  } catch {
    throw ApiError.badRequest('The uploaded PDF could not be read.');
  }
  const outputs = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    let scale = Math.min(8, Math.max(2, PDF_TARGET_WIDTH / base.width));
    if (base.width * base.height * scale * scale > 90e6) scale = Math.sqrt(90e6 / (base.width * base.height)); // memory guard
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const out = path.join(config.paths.tmp, `pdf-${Date.now()}-${randomToken(4)}-${i}.png`);
    await fs.promises.writeFile(out, await canvas.encode('png'));
    outputs.push(out);
    page.cleanup();
  }
  if (typeof doc.destroy === 'function') await doc.destroy(); else await task.destroy();
  return outputs;
}

/**
 * Crop a region (fractions 0..1) out of a page's large variant and add a branded
 * header: logo on the left, date and "Page no:N | website" on the right.
 * brand = { logo (uploads-relative), siteName, dateText, pageNo, domain, color }
 */
async function cropClip(pageLargeRel, box, brand = {}) {
  const src = absUpload(pageLargeRel);
  const meta = await sharp(src).metadata();
  const left = Math.max(0, Math.round(box.x * meta.width));
  const top = Math.max(0, Math.round(box.y * meta.height));
  const cw = Math.max(20, Math.min(meta.width - left, Math.round(box.w * meta.width)));
  const ch = Math.max(20, Math.min(meta.height - top, Math.round(box.h * meta.height)));
  const crop = await sharp(src).extract({ left, top, width: cw, height: ch }).toBuffer();

  // Header: logo across ~80% of the width; a thin row below it with the date (left) and page + website (right)
  const W = Math.max(cw, 720);
  const pad = Math.round(W * 0.02);
  const fsz = Math.round(Math.min(15, Math.max(11, W * 0.0105)));
  let logoBuf = null; let lw = Math.round(W * 0.8); let lh = Math.round(W * 0.09);
  if (brand.logo && fs.existsSync(absUpload(brand.logo))) {
    try {
      // trim empty/white border around the logo so the logo itself fills the space
      const trimmed = await sharp(absUpload(brand.logo)).trim({ threshold: 12 }).png().toBuffer().catch(() => fs.readFileSync(absUpload(brand.logo)));
      logoBuf = await sharp(trimmed).resize({ width: lw, height: Math.round(W * 0.26), fit: 'inside' }).png().toBuffer();
      const lm = await sharp(logoBuf).metadata(); lw = lm.width; lh = lm.height;
    } catch { logoBuf = null; }
  }
  const H = Math.round(pad + lh + pad * 0.6 + fsz + pad * 0.8);
  const rowY = Math.round(pad + lh + pad * 0.6 + fsz / 2);
  const layers = logoBuf ? [{ input: logoBuf, left: Math.round((W - lw) / 2), top: pad }] : [];
  const name = brand.siteName || 'ePaper';
  const nameSize = Math.round(Math.min(lh * 0.9, (W * 0.8) / Math.max(4, name.length * 0.62)));
  const pageText = `Page no:${brand.pageNo || ''} | ${brand.domain || ''}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="100%" height="100%" fill="#ffffff"/>
    ${logoBuf ? '' : `<text x="${W / 2}" y="${pad + lh / 2}" text-anchor="middle" dominant-baseline="middle" font-family="Georgia, serif" font-weight="900" font-size="${nameSize}" fill="${escapeXml(brand.color || '#c8102e')}">${escapeXml(name)}</text>`}
    <text x="${pad}" y="${rowY}" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" font-size="${fsz}" fill="#6b7280">${escapeXml(brand.dateText || '')}</text>
    <text x="${W - pad}" y="${rowY}" text-anchor="end" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" font-size="${fsz}" fill="#6b7280">${escapeXml(pageText)}</text>
    <rect y="${H - 2}" width="100%" height="2" fill="#d1d5db"/>
  </svg>`;
  const dir = path.join(up(), 'clips');
  mkdir(dir);
  const dest = path.join(dir, `${Date.now()}-${randomToken(6)}.jpg`);
  const info = await sharp({ create: { width: W, height: H + ch, channels: 3, background: '#ffffff' } })
    .composite([{ input: Buffer.from(svg), left: 0, top: 0 }, ...layers, { input: crop, left: Math.round((W - cw) / 2), top: H }])
    .jpeg({ quality: 90 }).toFile(dest);
  return { path: rel(dest), width: info.width, height: info.height };
}

/** Preview the watermark on a sample (an existing page or a blank sheet). */
async function watermarkPreview(wm, sampleRel) {
  let base;
  if (sampleRel && fs.existsSync(absUpload(sampleRel))) base = await sharp(absUpload(sampleRel)).resize({ width: 900 }).toBuffer();
  else {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1300"><rect width="100%" height="100%" fill="#fbfaf6"/>
      ${Array.from({ length: 30 }, (_, i) => `<rect x="60" y="${120 + i * 38}" width="${i % 5 === 0 ? 500 : 780}" height="${i % 5 === 0 ? 24 : 10}" fill="#d5d2c8"/>`).join('')}
      <rect x="60" y="40" width="780" height="50" fill="#222"/></svg>`;
    base = await sharp(Buffer.from(svg)).png().toBuffer();
  }
  const m = await sharp(base).metadata();
  return sharp(base).composite(await watermarkLayers(m.width, m.height, { ...wm, enabled: true })).jpeg({ quality: 82 }).toBuffer();
}

/** Render a PWA icon at a given square size from the configured icon/logo. */
async function squareIcon(srcRel, size) {
  const src = absUpload(srcRel);
  return sharp(src).resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } }).png().toBuffer();
}

module.exports = { SIZES, VARIANTS, storeImage, saveOriginal, saveOriginalPdf, splitPdf, renderSource, buildVariants, pdfToImages, cropClip, watermarkPreview, watermarkLayers, squareIcon, absUpload, absOriginal, safeUnlink, assertImage };
