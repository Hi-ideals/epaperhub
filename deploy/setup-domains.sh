#!/usr/bin/env bash
# =============================================================================
#  One-time setup for automatic own domains (run on the VPS, from the project folder):
#
#      sudo bash deploy/setup-domains.sh
#
#  It: finds your web server, installs certbot if missing, installs the
#  epaper-domain helper, allows the app's user to run ONLY that helper with sudo,
#  then checks everything. Safe to run again.
# =============================================================================
set -euo pipefail
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}!${NC} $*"; }
fail() { echo -e "${RED}✗ $*${NC}"; exit 1; }

[[ $EUID -eq 0 ]] || fail "Run with sudo:  sudo bash deploy/setup-domains.sh"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$HERE/epaper-domain.sh" ]] || fail "deploy/epaper-domain.sh not found next to this script"

echo "== ePaper: automatic own domains setup =="

# 1. Web server -----------------------------------------------------------------
if systemctl is-active --quiet nginx 2>/dev/null; then WS=nginx; PLUGIN=python3-certbot-nginx
elif systemctl is-active --quiet apache2 2>/dev/null; then WS=apache2; PLUGIN=python3-certbot-apache
elif systemctl is-active --quiet httpd 2>/dev/null; then WS=httpd; PLUGIN=python3-certbot-apache
else fail "No running Apache or Nginx found. Start your web server first."; fi
ok "Web server: $WS"

# 2. certbot ----------------------------------------------------------------------
if ! command -v certbot >/dev/null || ! certbot plugins 2>/dev/null | grep -q "${WS/httpd/apache}"; then
  warn "Installing certbot + $WS plugin…"
  if command -v apt-get >/dev/null; then apt-get update -qq && apt-get install -y -qq certbot "$PLUGIN" >/dev/null
  elif command -v dnf >/dev/null; then dnf install -y -q certbot "$PLUGIN" >/dev/null
  elif command -v yum >/dev/null; then yum install -y -q certbot "$PLUGIN" >/dev/null
  else warn "Could not install certbot automatically - install it, then run this again"; fi
fi
command -v certbot >/dev/null && ok "certbot installed" || warn "certbot missing: domains will work without SSL"
[[ "$WS" == apache2 ]] && a2enmod -q proxy proxy_http headers ssl rewrite >/dev/null && ok "Apache modules: proxy, proxy_http, headers, ssl, rewrite"

# 3. Helper -----------------------------------------------------------------------
install -m 755 "$HERE/epaper-domain.sh" /usr/local/bin/epaper-domain
ok "Helper installed: /usr/local/bin/epaper-domain"

# 4. Which user runs the Node app? -------------------------------------------------
APPUSER="${APPUSER:-}"
if [[ -z "$APPUSER" ]]; then
  PID="$(pgrep -f 'node .*server\.js' | head -1 || true)"
  [[ -z "$PID" ]] && PID="$(pgrep -f 'PM2' | head -1 || true)"
  [[ -n "$PID" ]] && APPUSER="$(ps -o user= -p "$PID" | tr -d ' ')"
fi
if [[ -z "$APPUSER" ]]; then
  warn "Could not find the running app. Run again with:  sudo APPUSER=<user> bash deploy/setup-domains.sh"
elif [[ "$APPUSER" == root ]]; then
  ok "App runs as root - no sudo rule needed"
else
  echo "$APPUSER ALL=(root) NOPASSWD: /usr/local/bin/epaper-domain" > /etc/sudoers.d/epaper-domain
  chmod 440 /etc/sudoers.d/epaper-domain
  visudo -cf /etc/sudoers.d/epaper-domain >/dev/null || { rm -f /etc/sudoers.d/epaper-domain; fail "sudoers check failed - nothing changed"; }
  ok "User '$APPUSER' may run only the helper with sudo"
  sudo -u "$APPUSER" sudo -n /usr/local/bin/epaper-domain check >/dev/null && ok "Tested as '$APPUSER': OK" || warn "Test as '$APPUSER' failed"
fi

# 5. Firewall ---------------------------------------------------------------------
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ok "Firewall: ports 80 and 443 open"
fi

# 6. Summary ----------------------------------------------------------------------
IP="$(curl -4 -s --max-time 5 https://api.ipify.org || hostname -I | awk '{print $1}')"
echo
/usr/local/bin/epaper-domain check
echo
ok "Done. Now in Super admin → Platform settings → Own domains:"
echo "     Server IP:  ${IP:-<your server IP>}"
echo "     SSL email:  your email"
echo "   Save, open a client with an own domain and click 'Check now'."
