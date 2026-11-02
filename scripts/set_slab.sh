#!/bin/bash
# Set the cheapest price per minute a customer has reached (their "locked" slab). It only ever goes down after this.
# Use it once to give someone the slab they already earned, or to correct a mistake.
#
#   bash ~/dograh/scripts/set_slab.sh              # lists customers and their locked price
#   bash ~/dograh/scripts/set_slab.sh 12 5.00      # customer (workspace) 12 now pays 5.00 per minute
#   bash ~/dograh/scripts/set_slab.sh 12 clear     # remove the lock (price follows the balance again)
set -euo pipefail
PSQL="sudo docker exec dograh-postgres-1 psql -U postgres"
echo "Customers (workspace id, name, locked price):"
$PSQL -c "select w.id, w.name, s.locked_rate from product_workspaces w left join product_billing_settings s on s.workspace_id = w.id order by w.id"
[ $# -ge 2 ] || { echo "To change one:  bash $0 <workspace id> <price, like 5.00 | clear>"; exit 0; }
[[ "$1" =~ ^[0-9]+$ ]] || { echo "The workspace id must be a number."; exit 1; }
if [ "$2" = "clear" ]; then VAL="null"; else [[ "$2" =~ ^[0-9]+(\.[0-9]+)?$ ]] || { echo "Price must look like 5.00"; exit 1; }; VAL="$2"; fi
$PSQL -c "update product_billing_settings set locked_rate = $VAL where workspace_id = $1"
echo "Done. The new price applies from the next minute."
