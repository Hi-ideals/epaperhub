/**
 * Email for the whole platform. Uses the Platform Email (SMTP) settings from the super
 * admin panel; falls back to SMTP_* in .env. Emails sent for a newspaper use that
 * newspaper's name as the sender name. Without SMTP, emails are printed to the console.
 */
const nodemailer = require('nodemailer');
const config = require('../config');

let cached = null; // { key, transporter }

async function smtp() {
  const s = await require('../platform/settings').getAll().catch(() => null);
  const host = s?.smtp_host || config.smtp.host;
  if (!host) return null;
  const opts = {
    host,
    port: Number(s?.smtp_host ? s.smtp_port : config.smtp.port) || 587,
    secure: s?.smtp_host ? !!s.smtp_secure : config.smtp.secure,
    user: s?.smtp_host ? s.smtp_user : config.smtp.user,
    pass: s?.smtp_host ? s.smtp_pass : config.smtp.pass,
    fromEmail: s?.mail_from_email || (String(config.smtp.from).match(/<([^>]+)>/) || [])[1] || config.smtp.from,
    fromName: s?.mail_from_name || 'ePaper',
  };
  // The port decides SSL for the standard ports, so a wrong switch can't break sending
  if (opts.port === 465) opts.secure = true;
  else if (opts.port === 587 || opts.port === 25 || opts.port === 2525) opts.secure = false;
  const key = JSON.stringify([opts.host, opts.port, opts.secure, opts.user, opts.pass]);
  if (!cached || cached.key !== key) {
    cached = { key, transporter: nodemailer.createTransport({ host: opts.host, port: opts.port, secure: opts.secure, auth: opts.user ? { user: opts.user, pass: opts.pass } : undefined }) };
  }
  return { ...opts, transporter: cached.transporter };
}

async function senderName(fallback) {
  const t = require('../platform/context').current();
  if (!t) return fallback;
  try { return (await require('./settings').getGroup('website_settings')).site_name || t.name; } catch { return t.name; }
}

/** Send an email. */
async function sendMail({ to, subject, html, text, fromName, attachments }) {
  const s = await smtp();
  if (!s) {
    console.log(`\n[mail:console] To: ${to}\nSubject: ${subject}\n${text || String(html).replace(/<[^>]+>/g, ' ')}\n`);
    return { console: true };
  }
  const name = fromName || (await senderName(s.fromName));
  return s.transporter.sendMail({ from: `"${String(name).replace(/"/g, '')}" <${s.fromEmail}>`, to, subject, html, text, attachments });
}

/** Verify the SMTP login (super admin "Send test email"). */
async function verify() {
  const s = await smtp();
  if (!s) throw new Error('SMTP is not configured');
  await s.transporter.verify();
  return true;
}

const isConfigured = async () => !!(await smtp());

/** Turn common SMTP errors into plain instructions. */
function friendlyError(e) {
  const m = String(e?.message || e || '');
  if (/534.?5\.7\.9|Application-specific password required/i.test(m)) return 'Gmail needs an App password, not your normal password. Turn on 2-Step Verification in your Google account, create an App password at myaccount.google.com/apppasswords, and paste it into Platform Email (SMTP) → Password.';
  if (/535.?5\.7\.8|Username and Password not accepted|Invalid login|authentication failed/i.test(m)) return 'The SMTP username or password is wrong. Check them in Platform Email (SMTP). For Gmail, use an App password.';
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH/i.test(m)) return 'Cannot reach the mail server. Check the SMTP host and port (Gmail: smtp.gmail.com, port 587, SSL off) and your internet connection.';
  if (/wrong version number|ssl3_get_record|self.signed|certificate/i.test(m)) return 'SSL setting does not match the port. Use port 587 with SSL off, or port 465 with SSL on.';
  if (/550|553|sender address rejected|not owned by user/i.test(m)) return 'The mail server rejected the "From email". Use the same address as the SMTP username.';
  return m;
}

module.exports = { sendMail, verify, isConfigured, friendlyError };
