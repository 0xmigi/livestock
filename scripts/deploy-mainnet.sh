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

echo "== done. Next: move the upgrade authority to a multisig:"
echo "   solana program set-upgrade-authority $PROGRAM_ID --new-upgrade-authority <multisig> -u \$MAINNET_RPC_URL --skip-new-upgrade-authority-signer-check"
