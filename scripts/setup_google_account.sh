#!/bin/bash
# Turn on Google Calendar and Google Sheets for your customers. Safe to run again.
#
#   bash ~/dograh/scripts/setup_google_account.sh
#
# You paste the key file Google gave you (the whole thing, from the first { to the last }), then press Enter.
set -euo pipefail
APP_DIR="${APP_DIR:-$HOME/dograh}"
cd "$APP_DIR"
echo "Paste the whole key file now (it starts with { and ends with }), then press Enter:"
json=""
while IFS= read -r line; do
  json+="$line"$'\n'
  [ "$line" = "}" ] && break
done
one=$(printf '%s' "$json" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("client_email") and d.get("private_key"); print(json.dumps(d, separators=(",",":")))') || { echo "That doesn't look like a Google key file. Nothing was changed."; exit 1; }
email=$(printf '%s' "$one" | python3 -c 'import json,sys; print(json.load(sys.stdin)["client_email"])')
grep -v '^PRODUCT_GOOGLE_SA_JSON=' .env > .env.tmp || true
printf "PRODUCT_GOOGLE_SA_JSON='%s'\n" "$one" >> .env.tmp
mv .env.tmp .env
echo "Saved. Customers will be asked to share their calendar or sheet with: $email"
echo "Restarting the API (calls in progress drop for a moment)..."
sudo docker compose --profile remote up -d api
echo "Done."
