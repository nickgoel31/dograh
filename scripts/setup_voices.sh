#!/bin/bash
# Set up (or update) the voice engines new customers use. Safe to run again, for example to add the Google key later.
#
#   bash ~/dograh/scripts/setup_voices.sh
#
# It asks for the email of a Swarvo account (its AI-model settings are reused), then for the Inworld key and,
# optionally, the Google key. Typing is hidden and the keys are saved only inside the database.
set -euo pipefail
APP_DIR="${APP_DIR:-$HOME/dograh}"
cd "$APP_DIR"

read -r -p "Email of your main Swarvo account: " EMAIL
S="-s"; [ "${SHOW_KEYS:-}" = "1" ] && S=""   # SHOW_KEYS=1 shows what you type, in case pasting into a hidden prompt does not work
read -r $S -p "Inworld API key (press Enter to keep the current one): " INWORLD_KEY; echo
read -r $S -p "Google API key (press Enter to skip / keep the current one): " GOOGLE_KEY; echo
echo "Got ${#INWORLD_KEY} characters for the Inworld key and ${#GOOGLE_KEY} for the Google key."

sudo docker exec -e INWORLD_API_KEY="$INWORLD_KEY" -e GOOGLE_API_KEY="$GOOGLE_KEY" dograh-api-1 python -m api.product.make_profile --email "$EMAIL"

set_env() { if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi; }
set_env PRODUCT_PROFILES "'{\"default\":\"inworld\",\"inworld\":\"inworld\",\"google\":\"google\"}'"
echo "Restarting the API so it uses the new settings (calls in progress drop for a moment)..."
sudo docker compose --profile remote up -d api
echo "Done."
