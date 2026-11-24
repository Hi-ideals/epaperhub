const fs = require('fs');
const path = require('path');
const multer = require('multer');
const config = require('../config');
const { ApiError } = require('../utils/http');
const { randomToken } = require('../utils/helpers');

fs.mkdirSync(config.paths.tmp, { recursive: true });

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.paths.tmp),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${randomToken(8)}${path.extname(file.originalname).toLowerCase()}`),
});

function makeFilter({ allowPdf = false, allowSvgIco = false } = {}) {
  return (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const okImage = IMAGE_MIMES.includes(file.mimetype) && IMAGE_EXT.includes(ext);
    const okPdf = allowPdf && file.mimetype === 'application/pdf' && ext === '.pdf';
    const okIco = allowSvgIco && ['.ico'].includes(ext) && /icon/.test(file.mimetype);
    if (okImage || okPdf || okIco) return cb(null, true);
    cb(ApiError.badRequest(`Unsupported file type: ${file.originalname}. Allowed: JPG, JPEG, PNG, WebP${allowPdf ? ', PDF' : ''}`));
  };
}

/**
 * Wrap a multer instance so that (1) a client over its storage limit can't upload, and
 * (2) the request goes back into the client's context after the file stream finishes.
 */
function guarded(m) {
  const wrap = (mw) => async (req, res, next) => {
    const { rebind } = require('./tenant');
    try {
      const t = req.tenant;
      if (t) {
        const used = await require('../platform/tenants').storageUsed(t);
        const limit = t.limits.storage_mb * 1024 * 1024;
        const incoming = Number(req.headers['content-length']) || 0;
        if (limit > 0 && used + incoming > limit) {
          const mb = (b) => (b / 1048576).toFixed(b < 10 * 1048576 ? 1 : 0);
          const msg = used >= limit
            ? `Storage limit reached: ${mb(used)} MB of ${t.limits.storage_mb} MB used.`
            : `This upload (${mb(incoming)} MB) is larger than your remaining storage (${mb(limit - used)} MB of ${t.limits.storage_mb} MB left).`;
          return next(new ApiError(413, `${msg} Delete old editions or ask the platform administrator to increase your storage.`));
        }
      }
    } catch (e) { return next(e); }
    mw(req, res, (err) => rebind(req, () => {
      if (!err && req.tenant) require('../config/db').master.query('UPDATE tenants SET storage_checked_at=NULL WHERE id=?', [req.tenant.id]).then(() => require('../platform/tenants').forget()).catch(() => {});
      next(err);
    }));
  };
  return { single: (...a) => wrap(m.single(...a)), array: (...a) => wrap(m.array(...a)), fields: (...a) => wrap(m.fields(...a)), any: () => wrap(m.any()), none: () => wrap(m.none()) };
}

/** Page uploads (images + optional PDF). */
const pageUpload = guarded(multer({ storage, fileFilter: makeFilter({ allowPdf: true }), limits: { fileSize: config.upload.pageMaxBytes, files: config.upload.pageMaxFiles } }));
/** Generic image uploads (logos, covers, category images...). 8 MB. */
const imageUpload = guarded(multer({ storage, fileFilter: makeFilter({ allowSvgIco: true }), limits: { fileSize: 8 * 1024 * 1024, files: 10 } }));

/** Remove temp files after a request (call in finally). */
function cleanupFiles(req) {
  const files = [].concat(req.file || [], ...(Array.isArray(req.files) ? [req.files] : Object.values(req.files || {})));
  for (const f of files.flat()) if (f?.path) fs.promises.unlink(f.path).catch(() => {});
}

/** All files of one page upload together may be at most PAGE_MAX_UPLOAD_MB (default 10 MB). */
function pageTotalLimit(req, res, next) {
  const files = [].concat(req.file || [], Array.isArray(req.files) ? req.files : []);
  const total = files.reduce((a, f) => a + (f.size || 0), 0);
  if (total <= config.upload.pageMaxBytes) return next();
  cleanupFiles(req);
  const mb = Math.round(config.upload.pageMaxBytes / 1048576);
  return res.status(400).json({ success: false, message: `Total upload size is ${(total / 1048576).toFixed(1)} MB. All files together can be at most ${mb} MB per upload.` });
}

module.exports = { pageUpload, pageTotalLimit, imageUpload, cleanupFiles };
