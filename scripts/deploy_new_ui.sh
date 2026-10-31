#!/bin/bash
# One-time setup + deploy of the new app (Swarvo AI) under /new/ on the VM. Safe to run again.
#
#   bash ~/dograh/scripts/deploy_new_ui.sh                 # uses app.swarvoai.com
#   bash ~/dograh/scripts/deploy_new_ui.sh my.domain.com   # another address
#
# It: backs up the database, the current API image and .env; adds the new settings to .env (only the ones
# that are missing); runs your ~/deploy.sh for the API and the new app; makes nginx pick up /new/; and adds
# the every-minute background job. Nobody is switched on for the new UI by it.
set -euo pipefail

HOST="${1:-app.swarvoai.com}"
APP_DIR="${APP_DIR:-$HOME/dograh}"
DEPLOY="${DEPLOY_SH:-$HOME/deploy.sh}"
BACKUPS="$HOME/backups"
STAMP="$(date +%Y%m%d-%H%M%S)"

cd "$APP_DIR"
[ -f "$DEPLOY" ] || { echo "Can't find $DEPLOY (your usual deploy script)."; exit 1; }
[ -f .env ] || { echo "Can't find $APP_DIR/.env"; exit 1; }

echo
echo "This will restart the API. Phone calls in progress will drop for a moment."
echo "Best done in a quiet hour. Address used: https://$HOST"
read -r -p "Type YES to continue: " ok
[ "$ok" = "YES" ] || { echo "Stopped. Nothing was changed."; exit 0; }

echo; echo "== 1/6 Backups (in $BACKUPS)"
mkdir -p "$BACKUPS" && chmod 700 "$BACKUPS"
sudo docker exec dograh-postgres-1 pg_dump -U postgres postgres > "$BACKUPS/db-before-new-ui-$STAMP.sql"
cp .env "$BACKUPS/env-before-new-ui-$STAMP" && chmod 600 "$BACKUPS/env-before-new-ui-$STAMP"
sudo docker tag dograh-local/dograh-api:local dograh-local/dograh-api:before-new-ui
ls -lh "$BACKUPS/db-before-new-ui-$STAMP.sql"

echo; echo "== 2/6 Settings in .env (only added if missing)"
add_env() { if grep -q "^$1=" .env; then echo "  keeping existing $1"; else echo "$1=$2" >> .env; echo "  added $1"; fi; }
add_env PRODUCT_NEW_UI_ORGS ""
add_env PRODUCT_ALLOWED_ORIGINS "https://$HOST"
add_env PRODUCT_OPS_SECRET "$(openssl rand -hex 24)"
add_env VOCALIS_CLASSIC_URL "https://$HOST"
add_env PRODUCT_NAME '"Swarvo AI"'

echo; echo "== 3/6 Updating the API (pulls the latest code, rebuilds, restarts)"
bash "$DEPLOY" api

echo; echo "== 3b Voice engines (Inworld and Google keys)"
bash "$APP_DIR/scripts/setup_voices.sh"

echo; echo "== 4/6 Building and starting the new app"
bash "$DEPLOY" vocalis

echo; echo "== 5/6 Telling nginx about /new/"
sudo docker compose --profile remote up -d dograh-init nginx
sudo docker exec nginx_https nginx -t
sudo docker exec nginx_https nginx -s reload

echo; echo "== 6/6 Every-minute background job (sends webhooks, applies data retention)"
SECRET="$(grep '^PRODUCT_OPS_SECRET=' .env | cut -d= -f2-)"
( crontab -l 2>/dev/null | grep -v 'product/ops/tick' || true
  echo "* * * * * curl -fsS -X POST http://localhost:8000/api/v1/product/ops/tick -H 'X-Ops-Secret: $SECRET' >/dev/null 2>&1"
) | crontab -
echo "  added to crontab"

echo; echo "== Checks"
sleep 10
echo -n "API health:        "; curl -fsS http://localhost:8000/api/v1/health || echo "NOT OK"
echo; echo -n "New app (/new/):   "; curl -ksS -o /dev/null -w "%{http_code}\n" -H "Host: $HOST" https://localhost/new/ || echo "NOT OK"
echo -n "Old app (/):       "; curl -ksS -o /dev/null -w "%{http_code}\n" -H "Host: $HOST" https://localhost/ || echo "NOT OK"
echo; sudo docker compose --profile remote ps
echo
echo "Done. Open https://$HOST/new/ in a browser (200 means it works). Nobody is switched on yet."
echo "To switch a customer on:   bash $APP_DIR/scripts/set_new_ui_customers.sh"
echo "To undo everything:        bash $APP_DIR/scripts/set_new_ui_customers.sh none"
