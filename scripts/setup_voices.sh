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

EMAIL="${1:-}"
[ -n "$EMAIL" ] || read -r -p "Email of your main Swarvo account: " EMAIL
[ -n "$EMAIL" ] || { echo "An email is needed. Run: bash scripts/setup_voices.sh your@email.com"; exit 1; }
S="-s"; [ "${SHOW_KEYS:-}" = "1" ] && S=""   # SHOW_KEYS=1 shows what you type, in case pasting into a hidden prompt does not work
read -r $S -p "Inworld API key (press Enter to keep the current one): " INWORLD_KEY; echo
read -r $S -p "Google API key (press Enter to skip / keep the current one): " GOOGLE_KEY; echo
read -r $S -p "swarvo-tts API key (press Enter to skip / keep the current one): " SWARVO_KEY; echo
read -r -p "swarvo-tts service address, https://... (press Enter to keep the current one): " SWARVO_URL
read -r $S -p "AssemblyAI API key, used to listen for swarvo-tts voices (press Enter to skip / keep the current one): " AAI_KEY; echo
read -r $S -p "Deepgram API key, for the second listening choice (press Enter to skip / keep the current one): " DG_KEY; echo
read -r $S -p "Murf API key, for the Falcon 2.1 Indian voices (press Enter to skip / keep the current one): " MURF_KEY; echo
read -r -p "Murf region (in, global, us-east, ...; press Enter to keep the current one, default in): " MURF_REGION
echo "Got ${#MURF_KEY} characters for the Murf key."
echo "Got ${#INWORLD_KEY} characters for the Inworld key, ${#GOOGLE_KEY} for the Google key, ${#SWARVO_KEY} for the swarvo-tts key, ${#AAI_KEY} for the AssemblyAI key and ${#DG_KEY} for the Deepgram key."

sudo docker exec -e INWORLD_API_KEY="$INWORLD_KEY" -e GOOGLE_API_KEY="$GOOGLE_KEY" -e SWARVO_TTS_KEY="$SWARVO_KEY" -e ASSEMBLYAI_API_KEY="$AAI_KEY" -e DEEPGRAM_API_KEY="$DG_KEY" -e MURF_API_KEY="$MURF_KEY" -e MURF_REGION="$MURF_REGION" -e SWARVO_TTS_BASE_URL="$SWARVO_URL" dograh-api-1 python -m api.product.make_profile --email "$EMAIL"

set_env() { if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi; }
[ -z "$SWARVO_URL" ] || set_env SWARVO_TTS_BASE_URL "$SWARVO_URL"
[ -z "$MURF_KEY" ] || set_env MURF_API_KEY "$MURF_KEY"   # also lets the voice list show each Murf voice's gender
set_env PRODUCT_PROFILES "'{\"default\":\"inworld\",\"inworld\":\"inworld\",\"google\":\"google\",\"swarvo\":\"swarvo\",\"murf\":\"murf\"}'"
echo "Restarting the API so it uses the new settings (calls in progress drop for a moment)..."
sudo docker compose --profile remote up -d api
echo "Done."
