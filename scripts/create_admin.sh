#!/bin/bash
# Create (or reset the password of) the owner's admin account, which opens the Admin area in the app.
#
#   bash ~/dograh/scripts/create_admin.sh
#
# The password you type is hidden. Press Enter with nothing typed to get a random one, shown once.
set -euo pipefail
APP_DIR="${APP_DIR:-$HOME/dograh}"
cd "$APP_DIR"
EMAIL="${1:-admin@twjlabs.com}"
read -r -s -p "Password for $EMAIL (press Enter for a random one): " PW; echo
sudo docker exec -e ADMIN_EMAIL="$EMAIL" -e ADMIN_PASSWORD="$PW" dograh-api-1 python -m api.product.make_admin
