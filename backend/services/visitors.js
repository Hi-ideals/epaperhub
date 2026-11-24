/**
 * Website visitor counter.
 *  - A visitor is counted once per day (same IP + browser = same visitor).
 *  - "Online now" = visitors seen in the last 5 minutes (kept in memory).
 *  - Bots and crawlers are not counted.
 */
const { query, one } = require('../config/db');
const { sha256 } = require('../utils/helpers');
const ctx = require('../platform/context');

const BOTS = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegram|preview|curl|wget|python|headless|lighthouse/i;
const ONLINE_MS = 5 * 60 * 1000;
const online = new Map(); // tenant -> Map(hash -> lastSeen)

async function ensureTables() {
  await query(`CREATE TABLE IF NOT EXISTS site_visits (
    visit_date DATE NOT NULL PRIMARY KEY,
    visitors INT UNSIGNED NOT NULL DEFAULT 0,
    views INT UNSIGNED NOT NULL DEFAULT 0
  ) ENGINE=InnoDB`);
  await query(`CREATE TABLE IF NOT EXISTS site_visitor_days (
    visit_date DATE NOT NULL,
    vhash CHAR(24) NOT NULL,
    PRIMARY KEY (visit_date, vhash)
  ) ENGINE=InnoDB`);
}

const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10); // India date

function onlineMap() {
  const key = ctx.current()?.slug || '_';
  if (!online.has(key)) online.set(key, new Map());
  return online.get(key);
}

function onlineCount() {
  const m = onlineMap(); const now = Date.now(); let n = 0;
  for (const [h, t] of m) { if (now - t > ONLINE_MS) m.delete(h); else n++; }
  return n;
}

/** Record a visit (or a heartbeat when ping=true) and return the counter numbers. */
async function hit({ ip, ua, ping = false, start = 0 }) {
  const isBot = !ua || BOTS.test(ua);
  if (!isBot) {
    const d = today();
    const h = sha256(`${d}|${ip}|${ua}`).slice(0, 24);
    onlineMap().set(h, Date.now());
    if (!ping) {
      const r = await query('INSERT IGNORE INTO site_visitor_days (visit_date, vhash) VALUES (?,?)', [d, h]);
      const isNew = r.affectedRows === 1 ? 1 : 0;
      await query('INSERT INTO site_visits (visit_date, visitors, views) VALUES (?,?,1) ON DUPLICATE KEY UPDATE visitors=visitors+?, views=views+1', [d, isNew, isNew]);
      if (Math.random() < 0.02) await query('DELETE FROM site_visitor_days WHERE visit_date < ?', [d]); // keep the table tiny
    }
  }
  return stats(start);
}

async function stats(start = 0) {
  const d = today();
  const r = await one('SELECT COALESCE(SUM(visitors),0) total, COALESCE(SUM(views),0) views, COALESCE(SUM(CASE WHEN visit_date=? THEN visitors END),0) today FROM site_visits', [d]);
  return { total: Number(r.total) + (Number(start) || 0), today: Number(r.today), views: Number(r.views), online: Math.max(1, onlineCount()) };
}

module.exports = { ensureTables, hit, stats };
