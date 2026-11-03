#!/bin/bash
# Put the NEW app at https://app.swarvoai.com/ and the CLASSIC app at https://old.swarvoai.com/. Safe to run again.
#
#   bash ~/dograh/scripts/setup_old_ui_host.sh                 # app.swarvoai.com + old.swarvoai.com
#   bash ~/dograh/scripts/setup_old_ui_host.sh app.x.com old.x.com
#   bash ~/dograh/scripts/setup_old_ui_host.sh --undo          # back to: classic at /, new at /new/
#
# Before you run it: in Spaceship, add a DNS record  Type A, Host "old", Value = this server's IP.
# What it does: checks DNS, backs up .env and the certificate, gets ONE Let's Encrypt certificate that covers both
# addresses (the website is offline for about a minute while it does), updates .env, rebuilds the new app for "/",
# re-renders nginx, and restarts the API so emails link to the right place (calls in progress drop for a moment).
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/dograh}"
DEPLOY="${DEPLOY_SH:-$HOME/deploy.sh}"
BACKUPS="$HOME/backups"
STAMP="$(date +%Y%m%d-%H%M%S)"
cd "$APP_DIR"
[ -f .env ] || { echo "Can't find $APP_DIR/.env"; exit 1; }
[ -f "$DEPLOY" ] || { echo "Can't find $DEPLOY (your usual deploy script)."; exit 1; }

set_env() { if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi; }
drop_env() { sed -i "/^$1=/d" .env; }
mkdir -p "$BACKUPS" && chmod 700 "$BACKUPS"

reload_nginx() {
  sudo docker compose --profile remote up -d dograh-init nginx
  sudo docker exec nginx_https nginx -t
  sudo docker exec nginx_https nginx -s reload
}

if [ "${1:-}" = "--undo" ]; then
  APP_HOST="$(grep '^PUBLIC_HOST=' .env | cut -d= -f2-)"
  read -r -p "Go back to classic at https://$APP_HOST/ and new at /new/ ? Type YES: " ok
  [ "$ok" = "YES" ] || { echo "Stopped. Nothing was changed."; exit 0; }
  cp .env "$BACKUPS/env-before-undo-old-host-$STAMP"
  drop_env OLD_UI_HOST
  set_env VOCALIS_BASE /new/
  set_env VOCALIS_CLASSIC_URL "https://$APP_HOST"
  set_env PRODUCT_APP_URL "https://$APP_HOST/new"
  bash "$DEPLOY" vocalis
  reload_nginx
  sudo docker compose --profile remote up -d api
  echo "Done. Classic is back at https://$APP_HOST/ and the new app at https://$APP_HOST/new/"
  exit 0
fi

APP_HOST="${1:-$(grep '^PUBLIC_HOST=' .env | cut -d= -f2-)}"
OLD_HOST="${2:-old.${APP_HOST#app.}}"
[ -n "$APP_HOST" ] && [ -n "$OLD_HOST" ] || { echo "Give the two addresses, e.g.  bash $0 app.swarvoai.com old.swarvoai.com"; exit 1; }

echo "New app will be at:     https://$APP_HOST/"
echo "Classic app will be at: https://$OLD_HOST/"
SERVER_IP="$(curl -s https://ifconfig.me || true)"
FOUND_IP="$(getent hosts "$OLD_HOST" | awk '{print $1}' | head -1 || true)"
echo "This server's address: ${SERVER_IP:-unknown}.  $OLD_HOST points to: ${FOUND_IP:-nothing yet}"
if [ -z "$FOUND_IP" ] || { [ -n "$SERVER_IP" ] && [ "$FOUND_IP" != "$SERVER_IP" ]; }; then
  echo
  echo "$OLD_HOST doesn't point at this server yet. In Spaceship add:  Type A,  Host old,  Value ${SERVER_IP:-the server address}"
  echo "Wait a few minutes, then run this again. Nothing was changed."
  exit 1
fi
read -r -p "Email for Let's Encrypt notices: " EMAIL
[ -n "$EMAIL" ] || { echo "An email is required."; exit 1; }
echo
echo "The website will be offline for about a minute and calls in progress will drop."
read -r -p "Type YES to continue: " ok
[ "$ok" = "YES" ] || { echo "Stopped. Nothing was changed."; exit 0; }

echo; echo "== 1/5 Backups (in $BACKUPS)"
cp .env "$BACKUPS/env-before-old-host-$STAMP" && chmod 600 "$BACKUPS/env-before-old-host-$STAMP"
sudo cp -r certs "$BACKUPS/certs-before-old-host-$STAMP" 2>/dev/null || true

echo; echo "== 2/5 One certificate for both addresses"
command -v certbot >/dev/null || sudo apt-get install -y -qq certbot
sudo docker compose --profile remote stop nginx
trap 'sudo docker compose --profile remote start nginx >/dev/null 2>&1 || true' ERR
sudo certbot certonly --standalone --non-interactive --agree-tos --email "$EMAIL" --cert-name "$APP_HOST" --expand -d "$APP_HOST" -d "$OLD_HOST"
sudo cp "/etc/letsencrypt/live/$APP_HOST/fullchain.pem" certs/local.crt
sudo cp "/etc/letsencrypt/live/$APP_HOST/privkey.pem" certs/local.key
sudo chmod 644 certs/local.crt certs/local.key
trap - ERR

echo; echo "== 3/5 Settings in .env"
set_env OLD_UI_HOST "$OLD_HOST"
set_env VOCALIS_BASE /
set_env VOCALIS_CLASSIC_URL "https://$OLD_HOST"
set_env PRODUCT_APP_URL "https://$APP_HOST"
grep -q '^PRODUCT_ALLOWED_ORIGINS=' .env && set_env PRODUCT_ALLOWED_ORIGINS "https://$APP_HOST"

echo; echo "== 4/5 Rebuilding the new app for the front door, then nginx"
bash "$DEPLOY" vocalis
reload_nginx

echo; echo "== 5/5 Restarting the API so emails link to the new address"
sudo docker compose --profile remote up -d api

echo; echo "Checking both addresses..."
for h in "$APP_HOST" "$OLD_HOST"; do
  printf '  %-28s ' "https://$h/"; curl -s -o /dev/null -w "HTTP %{http_code}\n" "https://$h/" || echo "no answer"
done
echo
echo "Done. New app: https://$APP_HOST/    Classic app: https://$OLD_HOST/"
echo "If anything looks wrong:  bash $0 --undo"
