#!/bin/bash
# Add Google sign-in and/or Razorpay payments. Safe to run again; press Enter to skip anything you don't have yet.
#
#   bash ~/dograh/scripts/setup_logins_payments.sh
set -euo pipefail
APP_DIR="${APP_DIR:-$HOME/dograh}"
cd "$APP_DIR"
set_env() { if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi; }
read -r -p "Google OAuth Client ID (Enter to skip): " GID
read -r -p "Razorpay Key ID (Enter to skip): " RID
read -r -s -p "Razorpay Key Secret (Enter to skip): " RSEC; echo
read -r -s -p "Razorpay Webhook Secret (Enter to skip): " RWH; echo
[ -n "$GID" ] && set_env GOOGLE_CLIENT_ID "$GID"
[ -n "$RID" ] && [ -n "$RSEC" ] && { set_env RAZORPAY_KEY_ID "$RID"; set_env RAZORPAY_KEY_SECRET "$RSEC"; }
[ -n "$RWH" ] && set_env RAZORPAY_WEBHOOK_SECRET "$RWH"
if [ -n "$RID" ] && [ -n "$RSEC" ]; then
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 20 -u "$RID:$RSEC" -H "Content-Type: application/json" -d '{"amount":10000,"currency":"INR","receipt":"keycheck"}' https://api.razorpay.com/v1/orders || true)
  if [ "$code" = "200" ]; then echo "Razorpay keys check: OK"; else echo "Razorpay keys check FAILED (code $code). Key ID ${#RID} characters, secret ${#RSEC} characters. Copy them again from the Razorpay dashboard and re-run this script."; fi
fi
echo "Restarting the API (calls in progress drop for a moment)..."
sudo docker compose --profile remote up -d api
echo "Done."
