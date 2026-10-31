#!/bin/bash
# Turn on sending email (password reset, invites, receipts, alerts). Safe to run again.
#
#   bash ~/dograh/scripts/setup_email.sh
#
# You need an SMTP account, for example from your email host, Zoho, Brevo, or Gmail with an app password.
set -euo pipefail
APP_DIR="${APP_DIR:-$HOME/dograh}"
cd "$APP_DIR"
set_env() { if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi; }
read -r -p "SMTP server (e.g. smtp.gmail.com): " HOST
read -r -p "SMTP port [587]: " PORT; PORT="${PORT:-587}"
read -r -p "SMTP username: " USER_
read -r -s -p "SMTP password: " PASS; echo
read -r -p "Send emails from (e.g. Swarvo AI <hello@swarvoai.com>): " FROM
read -r -p "Address of the new app [https://app.swarvoai.com/new]: " APP; APP="${APP:-https://app.swarvoai.com/new}"
[ -n "$HOST" ] && [ -n "$USER_" ] && [ -n "$PASS" ] || { echo "Server, username and password are needed. Nothing was changed."; exit 1; }
set_env PRODUCT_SMTP_HOST "$HOST"; set_env PRODUCT_SMTP_PORT "$PORT"; set_env PRODUCT_SMTP_USER "$USER_"
set_env PRODUCT_SMTP_PASSWORD "$PASS"; set_env PRODUCT_EMAIL_FROM "\"$FROM\""; set_env PRODUCT_APP_URL "$APP"
echo "Restarting the API (calls in progress drop for a moment)..."
sudo docker compose --profile remote up -d api
echo "Done. Try 'Forgot password?' on the sign-in page."
