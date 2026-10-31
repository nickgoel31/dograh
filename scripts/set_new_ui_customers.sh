#!/bin/bash
# Choose which existing customers can use the new UI. Safe to run again.
#
#   bash ~/dograh/scripts/set_new_ui_customers.sh            # shows customers and the current setting
#   bash ~/dograh/scripts/set_new_ui_customers.sh 12,15      # switch on organizations 12 and 15 (replaces the list)
#   bash ~/dograh/scripts/set_new_ui_customers.sh all        # everyone
#   bash ~/dograh/scripts/set_new_ui_customers.sh none       # nobody (the classic UI only, as before)
#
# Changing the list restarts the API, so phone calls in progress drop for a moment. Do it in a quiet hour.
set -euo pipefail
APP_DIR="${APP_DIR:-$HOME/dograh}"
cd "$APP_DIR"

echo "Customers (id and name):"
sudo docker exec dograh-postgres-1 psql -U postgres -c "select id, name from organizations order by id"
echo "Currently switched on: '$(grep '^PRODUCT_NEW_UI_ORGS=' .env | cut -d= -f2- || true)'  (empty = nobody, * = everyone)"

[ $# -ge 1 ] || { echo; echo "Give the ids to change it, for example:  bash $0 12,15"; exit 0; }
case "$1" in
  all) VALUE='*' ;;
  none) VALUE='' ;;
  *) VALUE="$1"; [[ "$VALUE" =~ ^[0-9,\ ]+$ ]] || { echo "Use numbers separated by commas, like 12,15"; exit 1; } ;;
esac

read -r -p "Set it to '${VALUE:-nobody}' and restart the API? Type YES: " ok
[ "$ok" = "YES" ] || { echo "Stopped. Nothing was changed."; exit 0; }

cp .env "$HOME/backups/env-before-customers-$(date +%Y%m%d-%H%M%S)" 2>/dev/null || true
if grep -q '^PRODUCT_NEW_UI_ORGS=' .env; then
  sed -i "s|^PRODUCT_NEW_UI_ORGS=.*|PRODUCT_NEW_UI_ORGS=${VALUE//|/}|" .env
else
  echo "PRODUCT_NEW_UI_ORGS=$VALUE" >> .env
fi
sudo docker compose --profile remote up -d api
echo "Done. Now switched on: '${VALUE:-nobody}'"
