/** Platform background work: per-client jobs and plan-expiry reminder emails. */
const tenants = require('./tenants');
const platformSettings = require('./settings');
const { master } = require('../config/db');

/** Run fn once for every active client (inside that client's context). */
async function forEachActiveClient(name, fn) {
  let list;
  try { list = (await tenants.all()).filter((t) => t.is_active && t.db_name); } catch (e) { console.error(`[${name}]`, e.message); return; }
  for (const t of list) {
    try { await tenants.within(t, fn); } catch (e) { console.error(`[${name}] ${t.slug}:`, e.message); }
  }
}

/** Email the client a few days before the plan expires, and on the day it expires. */
async function sendExpiryReminders() {
  const s = await platformSettings.getAll();
  const days = String(s.reminder_days || '7,3,1').split(',').map((n) => parseInt(n, 10)).filter((n) => n >= 0);
  const { sendMail } = require('../services/mail');
  const today = new Date(`${tenants.todayISO()}T12:00:00`);
  for (const t of await tenants.all()) {
    if (t.status !== 'active' || !t.expires_at) continue;
    const left = Math.round((new Date(`${t.expires_at}T12:00:00`) - today) / 86400000);
    const tag = left < 0 ? 'expired' : days.includes(left) ? `d${left}` : null;
    if (!tag || t.last_reminder === `${t.expires_at}:${tag}`) continue;
    const site = tenants.siteUrlOf(t, s.platform_url);
    const subject = left < 0 ? `${t.name} ePaper: your plan has expired` : `${t.name} ePaper: your plan expires in ${left} day${left === 1 ? '' : 's'}`;
    const html = left < 0
      ? `<p>Hello ${t.owner_name || ''},</p><p>The ${t.plan_name || ''} plan for <b>${t.name}</b> expired on <b>${t.expires_at}</b>. Your ePaper (${site}) is now closed to readers.</p><p>Please contact us to renew${s.support_email ? `: ${s.support_email}` : ''}${s.support_phone ? `, ${s.support_phone}` : ''}.</p>`
      : `<p>Hello ${t.owner_name || ''},</p><p>The ${t.plan_name || ''} plan for <b>${t.name}</b> expires on <b>${t.expires_at}</b> (${left} day${left === 1 ? '' : 's'} left).</p><p>Please renew to keep your ePaper online${s.support_email ? `. Contact: ${s.support_email}` : ''}${s.support_phone ? `, ${s.support_phone}` : ''}.</p>`;
    try {
      await sendMail({ to: t.owner_email, subject, html, fromName: s.platform_name });
      await master.query('UPDATE tenants SET last_reminder=? WHERE id=?', [`${t.expires_at}:${tag}`, t.id]);
      tenants.forget();
      console.log(`[platform] reminder ${tag} sent to ${t.slug}`);
    } catch (e) { console.error(`[platform] reminder for ${t.slug} failed:`, e.message); }
  }
}

module.exports = { forEachActiveClient, sendExpiryReminders };
