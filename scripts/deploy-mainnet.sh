#!/usr/bin/env bash
# Deploy the livestock program to mainnet and publish its IDL and security.txt
# through the Program Metadata program. Safe to re-run: a second run upgrades
# the program and rewrites the metadata.
#
#   MAINNET_RPC_URL=https://mainnet.helius-rpc.com/?api-key=... scripts/deploy-mainnet.sh
#
# Build first with `solana-verify build --library-name livestock` so the
# on-chain hash matches a reproducible build of the tagged source.
set -euo pipefail
cd "$(dirname "$0")/.."

PROGRAM_ID=5X7RTCFFLgCpsRiskzm1gBEQmbzBEL39H6WpN9YzSizB
PROGRAM_KEYPAIR=programs/livestock/keypair.json
KEYPAIR=${KEYPAIR:-$HOME/.config/solana/id.json}
BIN=target/deploy/livestock.so
MIN_SOL=1.2
: "${MAINNET_RPC_URL:?set MAINNET_RPC_URL to a private mainnet RPC; the public one drops deploy writes}"

AUTHORITY=$(solana-keygen pubkey "$KEYPAIR")
[ "$(solana-keygen pubkey "$PROGRAM_KEYPAIR")" = "$PROGRAM_ID" ] || { echo "programs/livestock/keypair.json is not $PROGRAM_ID"; exit 1; }
[ -f "$BIN" ] || { echo "no $BIN; run solana-verify build --library-name livestock"; exit 1; }
strings "$BIN" | grep -q "BEGIN SECURITY.TXT" || { echo "$BIN has no embedded security.txt"; exit 1; }

BALANCE=$(solana balance "$AUTHORITY" -u "$MAINNET_RPC_URL" | awk '{print $1}')
awk "BEGIN { exit !($BALANCE >= $MIN_SOL) }" || { echo "$AUTHORITY has $BALANCE SOL on mainnet; needs at least $MIN_SOL"; exit 1; }

if solana program show "$PROGRAM_ID" -u "$MAINNET_RPC_URL" >/dev/null 2>&1; then
  CURRENT=$(solana program show "$PROGRAM_ID" -u "$MAINNET_RPC_URL" | awk '/^Authority/ {print $2}')
  if [ "$CURRENT" != "$AUTHORITY" ]; then
    # The upgrade authority is the Squads vault. The CLI can only stage the
    # bytes: write them to a buffer, hand the buffer to the vault, and the
    # upgrade itself is proposed and approved in Squads.
    echo "== upgrade authority is $CURRENT (Squads), not this wallet: staging a buffer"
    echo "== executable hash $(solana-verify get-executable-hash "$BIN")"
    LEN=$(solana program show "$PROGRAM_ID" -u "$MAINNET_RPC_URL" | awk '/^Data Length/ {print $3}')
    [ "$(stat -f %z "$BIN")" -le "$LEN" ] || echo "!! binary is larger than the program data account ($LEN bytes): the multisig must run 'solana program extend' first"
    BUFFER=$(solana program write-buffer "$BIN" -u "$MAINNET_RPC_URL" -k "$KEYPAIR" --with-compute-unit-price 2000 --max-sign-attempts 30 | awk '/^Buffer/ {print $2}')
    solana program set-buffer-authority "$BUFFER" --new-buffer-authority "$CURRENT" -u "$MAINNET_RPC_URL" -k "$KEYPAIR"
    echo "== buffer $BUFFER is owned by the vault; proposing the upgrade and approving it as this wallet"
    MAINNET_RPC_URL="$MAINNET_RPC_URL" KEYPAIR="$KEYPAIR" pnpm --filter @nm/scripts run propose-upgrade -- propose --buffer "$BUFFER" \
      --memo "livestock $(git describe --tags --always) $(solana-verify get-executable-hash "$BIN" | cut -c1-16)"
    echo "== approve in Squads to reach the threshold, then execute there or with: pnpm --filter @nm/scripts run propose-upgrade -- execute --index <n>"
    echo "== re-run this script only if the IDL or security card changed (they publish below)."
    exit 0
  fi
  echo "== $PROGRAM_ID exists on mainnet: upgrading"
  ID_ARG=(--program-id "$PROGRAM_ID")
else
  echo "== first mainnet deploy of $PROGRAM_ID by $AUTHORITY ($BALANCE SOL)"
  ID_ARG=(--program-id "$PROGRAM_KEYPAIR")
fi
echo "== executable hash $(solana-verify get-executable-hash "$BIN")"

solana program deploy "$BIN" "${ID_ARG[@]}" \
  -u "$MAINNET_RPC_URL" -k "$KEYPAIR" \
  --with-compute-unit-price 2000 --max-sign-attempts 30
solana program show "$PROGRAM_ID" -u "$MAINNET_RPC_URL"

echo "== publishing the IDL and security.txt (Program Metadata, canonical: signed by the upgrade authority)"
npx --yes @solana-program/program-metadata@latest write idl "$PROGRAM_ID" metadata/livestock.codama.json \
  --keypair "$KEYPAIR" --rpc "$MAINNET_RPC_URL"
npx --yes @solana-program/program-metadata@latest write security "$PROGRAM_ID" metadata/security.json \
  --keypair "$KEYPAIR" --rpc "$MAINNET_RPC_URL"

echo "== done."
