/**
 * The "new edition" email for subscribers: newspaper logo, edition title and date,
 * the FRONT PAGE image, and a "Read more" button. Images are attached inside the email
 * (cid:), so they show in Gmail/Outlook even when the site isn't public yet.
 */
const fs = require('fs');
const sharp = require('sharp');
const { one } = require('../config/db');
const settings = require('./settings');
const images = require('./images');

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function longDate(d) {
  try { return new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); } catch { return String(d); }
}

/** Front page (JPEG, 600px wide) + logo (PNG) as email attachments. Built once per edition. */
async function buildAssets(edition) {
  const out = { attachments: [], pageCid: null, logoCid: null };
  const page = await one(`SELECT pi.path FROM edition_pages p JOIN page_images pi ON pi.page_id=p.id
    WHERE p.edition_id=? AND p.is_visible=1 AND pi.variant IN ('medium','large','thumb') ORDER BY p.page_number, FIELD(pi.variant,'medium','large','thumb') LIMIT 1`, [edition.id]);
  if (page && fs.existsSync(images.absUpload(page.path))) {
    const buf = await sharp(images.absUpload(page.path)).resize({ width: 600, withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
    out.pageCid = `page-${edition.id}@epaper`;
    out.attachments.push({ filename: 'front-page.jpg', content: buf, cid: out.pageCid, contentType: 'image/jpeg' });
  }
  const s = await settings.getGroup('website_settings');
  const logo = s.header_logo || s.site_logo;
  if (logo && fs.existsSync(images.absUpload(logo))) {
    try {
      const buf = await sharp(images.absUpload(logo)).resize({ height: 120, width: 520, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
      out.logoCid = `logo@epaper`;
      out.attachments.push({ filename: 'logo.png', content: buf, cid: out.logoCid, contentType: 'image/png' });
    } catch { /* unusual logo format: fall back to the name */ }
  }
  return out;
}

/** HTML for one subscriber. */
function render({ site, color, edition, link, unsub, name, assets }) {
  const c = /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#7c3aed';
  const btn = `background:${c};background-image:linear-gradient(135deg,#4f46e5,${c} 55%,#db2777);`;
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f1f0f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f0f7;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border-radius:16px;overflow:hidden;">
    <tr><td style="padding:22px 24px 14px;text-align:center;border-bottom:4px solid ${c};">
      ${assets.logoCid ? `<img src="cid:${assets.logoCid}" alt="${esc(site)}" style="max-height:60px;max-width:300px;">` : `<div style="font-size:26px;font-weight:bold;color:${c};">${esc(site)}</div>`}
    </td></tr>
    <tr><td style="padding:22px 24px 6px;">
      <div style="font-size:13px;color:#6b7280;letter-spacing:.04em;text-transform:uppercase;">New edition · ${esc(longDate(edition.edition_date))}</div>
      <div style="font-size:22px;font-weight:bold;color:#111827;margin:6px 0 4px;">${esc(edition.title)}</div>
      <div style="font-size:15px;color:#374151;">Hello ${esc(name || 'reader')}, today's edition is ready to read.</div>
    </td></tr>
    ${assets.pageCid ? `<tr><td style="padding:16px 24px 4px;">
      <a href="${esc(link)}" style="display:block;text-decoration:none;">
        <img src="cid:${assets.pageCid}" alt="Front page of ${esc(edition.title)}" width="572" style="display:block;width:100%;max-width:572px;height:auto;border:1px solid #e5e7eb;border-radius:8px;">
      </a>
    </td></tr>` : ''}
    <tr><td align="center" style="padding:20px 24px 26px;">
      <a href="${esc(link)}" style="${btn}display:inline-block;color:#ffffff;text-decoration:none;font-weight:bold;font-size:17px;padding:14px 38px;border-radius:10px;">Read more &rarr;</a>
      <div style="font-size:12px;color:#9ca3af;margin-top:12px;">Or open: <a href="${esc(link)}" style="color:#6b7280;">${esc(link)}</a></div>
    </td></tr>
    <tr><td style="padding:14px 24px;background:#f9fafb;text-align:center;font-size:12px;color:#9ca3af;">
      You receive this because you subscribed to ${esc(site)}. <a href="${esc(unsub)}" style="color:#6b7280;">Unsubscribe</a>
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

module.exports = { buildAssets, render };
