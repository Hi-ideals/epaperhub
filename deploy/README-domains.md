# Automatic own domains (one-time server setup)

After this setup, the super admin only types a client's **Own domain** and saves.
The app then, by itself:

1. checks the domain's DNS points to this server (and keeps re-checking every 10 minutes until it does),
2. creates the web-server site (Apache or Nginx) that sends the domain to the Node app,
3. gets a free SSL certificate (Let's Encrypt) and turns on the http → https redirect,
4. confirms the domain really opens that newspaper, and shows **Live** on the client page.

Changing or removing a client's domain, or deleting the client, removes its site and certificate.

## Quick way: one command

```bash
cd /path/to/epaper && sudo bash deploy/setup-domains.sh
```

It does steps 1–2 below for you and prints your server IP. Then do step 3.

## 1. Install the helper (as root, once)

```bash
cd /path/to/epaper                       # your project folder on the VPS
sudo install -m 755 deploy/epaper-domain.sh /usr/local/bin/epaper-domain
sudo epaper-domain check                 # → server=apache2 certbot=yes  (or nginx)
```

No certbot yet?

```bash
# Ubuntu / Debian, Apache:
sudo apt install -y certbot python3-certbot-apache
# Ubuntu / Debian, Nginx:
sudo apt install -y certbot python3-certbot-nginx
```

## 2. Allow the app to run only this helper with sudo

Find the Linux user that runs the Node app (with PM2: `pm2 list`, column *user*; often `root`, `ubuntu` or `epaper`).
If it is `root`, skip this step.

```bash
echo 'APPUSER ALL=(root) NOPASSWD: /usr/local/bin/epaper-domain' | sudo tee /etc/sudoers.d/epaper-domain
sudo chmod 440 /etc/sudoers.d/epaper-domain
sudo visudo -c                            # must say "parsed OK"
```

(replace `APPUSER` with that user name). The app can run **nothing else** as root.

## 3. Settings

- **Super admin → Platform settings → Own domains**:
  - *Server IP*: the VPS public IP clients must point to, e.g. `216.48.177.81`.
  - *SSL email*: email for Let's Encrypt expiry notices.
  - The box shows **Ready · apache2 + certbot** when steps 1–2 are done.
- `.env` (optional): `DOMAIN_AUTOMATION=off` turns the feature off; `DOMAIN_SCRIPT=/other/path` if you installed the helper elsewhere.

## 4. For each client

1. At the client's domain registrar (GoDaddy etc.) add an **A record**: Name `epaper` (or the sub-domain), Value = your server IP, TTL 600.
2. Super admin → Clients → Edit → **Own domain** `epaper.clientdomain.com` → Save.
3. Open the client page: the **Own domain** card shows *Waiting for DNS → Setting up → Live*. Click **Check now** to retry immediately.

## Notes

- Files created: `/etc/apache2/sites-available/epaper-<domain>.conf` (+ `-le-ssl.conf` from certbot), or `/etc/nginx/sites-available/epaper-<domain>.conf`. Your other websites are never touched.
- A config error is rolled back automatically (`apache2ctl configtest` / `nginx -t` runs before every reload).
- Let's Encrypt allows 5 failed validations per domain per hour; the app retries every 10 minutes, at most 30 times, then waits for **Check now**.
- Certificates renew automatically (`certbot renew` timer, installed with certbot).
