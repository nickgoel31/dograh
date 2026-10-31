#!/bin/bash
# Let customers buy real phone numbers from your Plivo account. Safe to run again.
#
#   bash ~/dograh/scripts/setup_numbers.sh
#
# Asks for your Plivo Auth ID and Auth Token (typing is hidden), saves them in .env and restarts the API.
set -euo pipefail
APP_DIR="${APP_DIR:-$HOME/dograh}"
cd "$APP_DIR"
read -r -p "Plivo Auth ID: " PLIVO_ID
read -r -s -p "Plivo Auth Token: " PLIVO_TOKEN; echo
[ -n "$PLIVO_ID" ] && [ -n "$PLIVO_TOKEN" ] || { echo "Both are needed. Nothing was changed."; exit 1; }
cp .env "$HOME/backups/env-before-numbers-$(date +%Y%m%d-%H%M%S)" 2>/dev/null || true
set_env() { if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi; }
set_env PRODUCT_PLIVO_AUTH_ID "$PLIVO_ID"
set_env PRODUCT_PLIVO_AUTH_TOKEN "$PLIVO_TOKEN"
set_env PRODUCT_NUMBER_PROVIDER plivo
echo "Restarting the API (calls in progress drop for a moment)..."
sudo docker compose --profile remote up -d api
echo "Done. Customers can now search and buy numbers on the Phone Numbers page."
