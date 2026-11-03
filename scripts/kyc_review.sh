#!/bin/bash
# Review identity verification (KYC) sent by customers who want Indian phone numbers.
#
#   bash ~/dograh/scripts/kyc_review.sh                       # list the ones waiting for review
#   bash ~/dograh/scripts/kyc_review.sh docs 12               # download customer 12's documents into ~/kyc-12/
#   bash ~/dograh/scripts/kyc_review.sh approve 12            # approve customer 12 (they can then buy numbers)
#   bash ~/dograh/scripts/kyc_review.sh reject 12 "PAN photo is blurry, please upload it again"
#
# Check the documents (and, if the carrier needs it, submit them in your Plivo console) BEFORE you approve.
# Documents are personal data: delete the downloaded folder when you are done  (rm -r ~/kyc-12).
set -euo pipefail
APP_DIR="${APP_DIR:-$HOME/dograh}"
cd "$APP_DIR"
SECRET="$(grep '^PRODUCT_OPS_SECRET=' .env | cut -d= -f2-)"
[ -n "$SECRET" ] || { echo "PRODUCT_OPS_SECRET is not set in .env"; exit 1; }
API="http://localhost:8000/api/v1/product/ops/kyc"
H="X-Ops-Secret: $SECRET"

case "${1:-list}" in
  list)
    RAW="$(curl -fsS "$API" -H "$H")" || { echo "Couldn't reach the API on this server. If you just updated it, wait a minute and try again."; exit 1; }
    printf '%s' "$RAW" | python3 -c '
import json, sys
rows = json.load(sys.stdin)
if not rows:
    print("Nothing waiting for review.")
    sys.exit()
for r in rows:
    print("")
    print("Customer %s: %s" % (r["workspace_id"], r["workspace"]))
    for k in ("business", "type", "pan", "gstin", "contact", "email", "phone", "address", "submitted_at"):
        print("  %-13s %s" % (k, r[k]))
    print("  documents     " + ", ".join(r["documents"]))
'
    ;;
  docs)
    [[ "${2:-}" =~ ^[0-9]+$ ]] || { echo "Usage: $0 docs <customer number>"; exit 1; }
    mkdir -p "$HOME/kyc-$2" && chmod 700 "$HOME/kyc-$2"
    i=0
    while curl -fsS -D "$HOME/kyc-$2/.h" -o "$HOME/kyc-$2/doc-$i" "$API/$2/documents/$i" -H "$H" 2>/dev/null; do
      name=$(grep -i 'filename=' "$HOME/kyc-$2/.h" | sed 's/.*filename="\(.*\)".*/\1/' | tr -d '\r')
      mv "$HOME/kyc-$2/doc-$i" "$HOME/kyc-$2/${i}-${name:-file}"; i=$((i+1))
    done
    rm -f "$HOME/kyc-$2/.h"
    echo "Saved $i file(s) in $HOME/kyc-$2/   (delete the folder when you are done)"
    ;;
  approve)
    [[ "${2:-}" =~ ^[0-9]+$ ]] || { echo "Usage: $0 approve <customer number>"; exit 1; }
    curl -fsS -X POST "$API/$2" -H "$H" -H 'Content-Type: application/json' -d '{"status":"approved"}'; echo
    ;;
  reject)
    [[ "${2:-}" =~ ^[0-9]+$ ]] && [ -n "${3:-}" ] || { echo "Usage: $0 reject <customer number> \"what to fix\""; exit 1; }
    NOTE="$3" python3 -c 'import json,os; print(json.dumps({"status":"rejected","note":os.environ["NOTE"]}))' | curl -fsS -X POST "$API/$2" -H "$H" -H 'Content-Type: application/json' -d @-; echo
    ;;
  *) echo "Use: list | docs <n> | approve <n> | reject <n> \"reason\""; exit 1 ;;
esac
