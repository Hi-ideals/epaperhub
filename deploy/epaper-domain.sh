#!/usr/bin/env bash
# =============================================================================
#  epaper-domain — adds / removes a newspaper's own domain on this server.
#  Called by the ePaper app (super admin → client → Own domain) through sudo.
#
#    epaper-domain check
#    epaper-domain add    <domain> <node-port> [ssl-email]
#    epaper-domain remove <domain>
#
#  Works with Apache (Ubuntu/Debian apache2 or RHEL httpd) and Nginx.
#  Install:  sudo install -m 755 deploy/epaper-domain.sh /usr/local/bin/epaper-domain
#  See deploy/README-domains.md for the one sudoers line.
# =============================================================================
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

ACTION="${1:-}"; DOMAIN="${2:-}"; PORT="${3:-5000}"; EMAIL="${4:-}"
PREFIX="epaper-"                      # every file we create starts with this
MAX_BODY_MB="${EPAPER_MAX_UPLOAD_MB:-200}"

die() { echo "ERROR: $1" >&2; exit "${2:-1}"; }
log() { echo "[epaper-domain] $*"; }

# ---- strict input checks (this runs as root) --------------------------------
valid_domain() { [[ "$1" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]] && (( ${#1} <= 190 )); }
if [[ "$ACTION" == add || "$ACTION" == remove ]]; then
  DOMAIN="$(echo "$DOMAIN" | tr 'A-Z' 'a-z')"
  valid_domain "$DOMAIN" || die "invalid domain: $DOMAIN"
fi
if [[ "$ACTION" == add ]]; then
  [[ "$PORT" =~ ^[0-9]{2,5}$ ]] || die "invalid port: $PORT"
  [[ -z "$EMAIL" || "$EMAIL" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "invalid email: $EMAIL"
fi

# ---- which web server owns port 80? ------------------------------------------
detect() {
  if systemctl is-active --quiet nginx 2>/dev/null; then echo nginx; return; fi
  if systemctl is-active --quiet apache2 2>/dev/null; then echo apache2; return; fi
  if systemctl is-active --quiet httpd 2>/dev/null; then echo httpd; return; fi
  if command -v nginx >/dev/null; then echo nginx; return; fi
  if command -v apache2ctl >/dev/null; then echo apache2; return; fi
  if command -v httpd >/dev/null; then echo httpd; return; fi
  echo none
}
SERVER="$(detect)"
CERTBOT="$(command -v certbot >/dev/null && echo yes || echo no)"

case "$SERVER" in
  nginx)
    if [[ -d /etc/nginx/sites-available ]]; then CONF="/etc/nginx/sites-available/${PREFIX}${DOMAIN}.conf"; LINK="/etc/nginx/sites-enabled/${PREFIX}${DOMAIN}.conf"
    else CONF="/etc/nginx/conf.d/${PREFIX}${DOMAIN}.conf"; LINK=""; fi
    TEST="nginx -t"; RELOAD="systemctl reload nginx"; CB_PLUGIN="--nginx" ;;
  apache2)
    CONF="/etc/apache2/sites-available/${PREFIX}${DOMAIN}.conf"; LINK=""
    TEST="apache2ctl configtest"; RELOAD="systemctl reload apache2"; CB_PLUGIN="--apache" ;;
  httpd)
    CONF="/etc/httpd/conf.d/${PREFIX}${DOMAIN}.conf"; LINK=""
    TEST="apachectl configtest"; RELOAD="systemctl reload httpd"; CB_PLUGIN="--apache" ;;
  *) CONF=""; ;;
esac

# ---- actions -----------------------------------------------------------------
case "$ACTION" in
check)
  echo "server=$SERVER certbot=$CERTBOT"
  [[ "$SERVER" != none ]] || die "no Apache or Nginx found on this server" 2
  exit 0 ;;

add)
  [[ "$SERVER" != none ]] || die "no Apache or Nginx found on this server" 2
  log "web server: $SERVER, domain: $DOMAIN -> 127.0.0.1:$PORT"
  BACKUP=""
  [[ -f "$CONF" ]] && { BACKUP="$(mktemp)"; cp "$CONF" "$BACKUP"; }

  if [[ "$SERVER" == nginx ]]; then
    cat > "$CONF" <<NGINX
# Created by epaper-domain for the ePaper app. Safe to delete with: epaper-domain remove $DOMAIN
server {
    listen 80;
    server_name $DOMAIN;
    client_max_body_size ${MAX_BODY_MB}M;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
    }
}
NGINX
    [[ -n "$LINK" ]] && ln -sf "$CONF" "$LINK"
  else
    if [[ "$SERVER" == apache2 ]]; then a2enmod -q proxy proxy_http headers >/dev/null; LOGDIR='${APACHE_LOG_DIR}'; else LOGDIR='logs'; fi
    cat > "$CONF" <<APACHE
# Created by epaper-domain for the ePaper app. Safe to delete with: epaper-domain remove $DOMAIN
<VirtualHost *:80>
    ServerName $DOMAIN
    ProxyPreserveHost On
    ProxyRequests Off
    ProxyPass        / http://127.0.0.1:$PORT/ timeout=300
    ProxyPassReverse / http://127.0.0.1:$PORT/
    RequestHeader set X-Forwarded-Proto expr=%{REQUEST_SCHEME}
    LimitRequestBody $(( MAX_BODY_MB * 1024 * 1024 ))
    ErrorLog  $LOGDIR/${PREFIX}${DOMAIN}-error.log
    CustomLog $LOGDIR/${PREFIX}${DOMAIN}-access.log combined
</VirtualHost>
APACHE
    [[ "$SERVER" == apache2 ]] && a2ensite -q "${PREFIX}${DOMAIN}.conf" >/dev/null
  fi

  if ! $TEST >/tmp/epaper-domain-test.log 2>&1; then
    cat /tmp/epaper-domain-test.log >&2
    if [[ -n "$BACKUP" ]]; then cp "$BACKUP" "$CONF"; else
      [[ "$SERVER" == apache2 ]] && a2dissite -q "${PREFIX}${DOMAIN}.conf" >/dev/null 2>&1 || true
      rm -f "$CONF" ${LINK:+"$LINK"}; fi
    die "web server config test failed - nothing changed" 3
  fi
  $RELOAD
  sleep 1
  log "website created (http)"

  if [[ "$CERTBOT" == yes ]]; then
    ACCOUNT=(--register-unsafely-without-email); [[ -n "$EMAIL" ]] && ACCOUNT=(-m "$EMAIL")
    if certbot $CB_PLUGIN -d "$DOMAIN" --non-interactive --agree-tos "${ACCOUNT[@]}" --redirect --keep-until-expiring; then
      log "SSL certificate installed (https)"
    else
      die "certbot could not issue the SSL certificate (http still works)" 4
    fi
  else
    log "certbot not installed - skipped SSL"
  fi
  [[ -n "$BACKUP" ]] && rm -f "$BACKUP"
  log "done"
  exit 0 ;;

remove)
  [[ "$SERVER" != none ]] || exit 0
  if [[ "$SERVER" == apache2 ]]; then
    a2dissite -q "${PREFIX}${DOMAIN}.conf" >/dev/null 2>&1 || true
    a2dissite -q "${PREFIX}${DOMAIN}-le-ssl.conf" >/dev/null 2>&1 || true
    rm -f "/etc/apache2/sites-available/${PREFIX}${DOMAIN}.conf" "/etc/apache2/sites-available/${PREFIX}${DOMAIN}-le-ssl.conf"
  elif [[ "$SERVER" == httpd ]]; then
    rm -f "/etc/httpd/conf.d/${PREFIX}${DOMAIN}.conf" "/etc/httpd/conf.d/${PREFIX}${DOMAIN}-le-ssl.conf"
  else
    rm -f "$CONF" ${LINK:+"$LINK"}
  fi
  [[ "$CERTBOT" == yes ]] && certbot delete --cert-name "$DOMAIN" --non-interactive >/dev/null 2>&1 || true
  $TEST >/dev/null 2>&1 && $RELOAD
  log "removed $DOMAIN"
  exit 0 ;;

*)
  echo "usage: epaper-domain check | add <domain> <port> [email] | remove <domain>" >&2; exit 64 ;;
esac
