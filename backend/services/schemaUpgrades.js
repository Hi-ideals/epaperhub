/**
 * Small, safe schema upgrades applied automatically on start-up
 * (so an existing database never needs a manual migration for these).
 */
const { query, one } = require('../config/db');

async function columnExists(table, column) {
  const r = await one('SELECT COUNT(*) n FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?', [table, column]);
  return r.n > 0;
}

async function run() {
  // Visitor counter tables
  await require('./visitors').ensureTables();
  // Size of the file(s) the admin uploaded for each page (for the per-edition upload limit)
  if (!(await columnExists('edition_pages', 'upload_bytes'))) {
    await query('ALTER TABLE edition_pages ADD COLUMN upload_bytes BIGINT UNSIGNED NULL AFTER original_name');
    console.log('[upgrade] edition_pages.upload_bytes added');
  }
  // Extra-large page image for deep zoom
  const v = await one("SELECT COLUMN_TYPE t FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='page_images' AND column_name='variant'");
  if (v && !String(v.t).includes('xlarge')) {
    await query("ALTER TABLE page_images MODIFY variant ENUM('original','xlarge','large','medium','thumb') NOT NULL");
    console.log('[upgrade] page_images.variant: xlarge added');
  }
  // Comments on a mapped article (page area) inside the article popup
  if (!(await columnExists('comments', 'area_id'))) {
    await query('ALTER TABLE comments ADD COLUMN area_id INT UNSIGNED NULL AFTER page_id, ADD INDEX idx_cm_area (area_id, status)');
    console.log('[upgrade] comments.area_id added');
  }
}

module.exports = { run };
