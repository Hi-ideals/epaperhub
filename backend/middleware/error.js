const multer = require('multer');
const config = require('../config');
const { ApiError } = require('../utils/http');

function notFound(req, res) {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = err.status || 500;
  let message = err.message || 'Internal server error';
  let errors = err.errors;

  if (err instanceof multer.MulterError) {
    status = 400;
    //message = err.code === 'LIMIT_FILE_SIZE' ? `File too large. Maximum size is ${Math.round(config.upload.maxBytes / 1048576)} MB.` : err.message;
    const isPage = /\/pages\//.test(req.originalUrl || '');
    const mb = Math.round((isPage ? config.upload.pageMaxBytes : config.upload.maxBytes) / 1048576);
    if (err.code === 'LIMIT_FILE_SIZE') message = isPage ? `Upload too large. All files together can be at most ${mb} MB per upload.` : `File too large. Each file can be at most ${mb} MB.`;
    else if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') message = isPage ? `Too many files. You can upload at most ${config.upload.pageMaxFiles} files at a time.` : 'Too many files.';
    else message = err.message;
  } else if (err.code === 'ER_DUP_ENTRY') {
    status = 409; message = 'A record with the same unique value already exists.';
  } else if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED') {
    status = 409; message = 'This record is in use by other records and cannot be deleted.';
  } else if (err.type === 'entity.too.large') {
    status = 413; message = 'Request body too large.';
  } else if (!(err instanceof ApiError) && status === 500) {
    console.error(err);
    if (config.isProd) message = 'Internal server error';
  }
  res.status(status).json({ success: false, message, ...(errors ? { errors } : {}) });
}

module.exports = { notFound, errorHandler };
