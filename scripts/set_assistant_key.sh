#!/bin/bash
# Give the Swarvo AI assistant (the home page and the corner helper) its own OpenAI key. Safe to run again.
#
#   bash ~/dograh/scripts/set_assistant_key.sh                 # asks you to paste the key (it is not shown)
#   bash ~/dograh/scripts/set_assistant_key.sh gpt-4.1-mini    # also choose which OpenAI model it uses
#
# The key is saved in ~/dograh/.env and used by the assistant for every workspace. Other AI features keep using each workspace's own settings.
set -euo pipefail
APP_DIR="${APP_DIR:-$HOME/dograh}"
cd "$APP_DIR"
MODEL="${1:-}"
read -r -s -p "Paste your OpenAI key (starts with sk-) and press Enter: " key
echo
key="$(printf '%s' "$key" | tr -d '[:space:]')"
case "$key" in
  sk-*) ;;
  *) echo "That does not look like an OpenAI key. Nothing was changed."; exit 1 ;;
esac
grep -v -e '^PRODUCT_ASSISTANT_OPENAI_KEY=' -e '^PRODUCT_ASSISTANT_MODEL=' .env > .env.tmp || true
printf 'PRODUCT_ASSISTANT_OPENAI_KEY=%s\n' "$key" >> .env.tmp
if [ -n "$MODEL" ]; then printf 'PRODUCT_ASSISTANT_MODEL=%s\n' "$MODEL" >> .env.tmp; fi
mv .env.tmp .env
chmod 600 .env
echo "Saved. Restarting the API (calls in progress drop for a moment)..."
sudo docker compose --profile remote up -d api
sleep 6
if sudo docker compose exec -T api printenv PRODUCT_ASSISTANT_OPENAI_KEY >/dev/null 2>&1; then
  echo "Done. The API can see the key. Open the home page and ask the assistant something."
else
  echo "The key was saved, but the running API cannot see it yet."
  echo "Rebuild the API so it has the newest code, then try again:  bash ~/deploy.sh api"
fi
