# Season

Buy the story. When the season ends, redeem the stock or roll into the next one.

Season Vault is a Solana prototype of a **seasonal convertible for a tokenized stock**. People buy a short-lived narrative token about one company. Fees and curve proceeds buy the underlying stock token into a vault. After a hard expiry, holders either **redeem** pro-rata stock or **roll** their claim into the next season.

This is not pump.fun. MVP is **one stock, one live season, hard expiry, convert or roll**.

- Program: `season_vault`
- UI product name: **Season**
- Demo ticker: `TSLAx` (mock mint, not mainnet xStocks)
- Demo seasons: `Robotaxi` → `FSD`

## Product rules

1. One vault per stock mint.
2. One **live** season per vault at a time.
3. Hard `end_ts`. After that, trading stops.
4. After close, the only actions are `redeem` or `roll`.
5. Narrative tokens mint only from the season curve. Mint authority is the vault PDA.
6. Vault holds real SPL stock tokens (mock TSLAx on localnet).
7. No auction. Season 1 is created by admin.
8. Buys only. No sells in MVP.

## The demo swap (not a DEX)

On each buy, after the 1% fee, the program:

1. Credits remaining SOL to the season curve SOL PDA.
2. Mints narrative tokens along a linear bonding curve: `price = 0.01 SOL + 0.0000001 SOL * supply` (base `10_000_000` lamports, slope `100`).
3. Transfers `sol_after_fee * stock_per_sol / 1e9` mock TSLAx from a **program-owned market-maker ATA** into the vault ATA.

Admin funds that MM ATA (setup script mints 100,000 TSLAx into it). This is an AMM-less inventory hack so the vault fills without Jupiter. Do not pretend it is a real DEX.

Sells are disabled on purpose. Stock bought this season stays as residue — that is the product.

## Layout

```
programs/season_vault/   Anchor program
tests/season_vault.ts    Spec tests
scripts/setup.ts         Localnet bootstrap
scripts/demo.ts          A buys, B buys, A redeems, B rolls
app/                     Next.js (/, /season, /admin)
idl/season_vault.json    Hand-maintained IDL (see note below)
keys/season_vault-keypair.json
```

## Prerequisites

- Solana CLI 2.1.x (`solana-test-validator`, `cargo-build-sbf`)
- Anchor CLI 0.31.x
- Node 22+, Rust 1.83+

`Cargo.lock` pins several crates (blake3, serde, indexmap, …) so the Solana 2.1 `cargo-build-sbf` toolchain does not pull edition-2024 crates.

## Localnet

```bash
solana-test-validator --reset
# other terminal
mkdir -p target/deploy
cp keys/season_vault-keypair.json target/deploy/
npm install
# program .so is built with: PATH includes solana + anchor
anchor build --skip-lint   # IDL step may fail; .so still lands in target/deploy
npm test                   # anchor test --skip-build
npm run setup
npm run demo
cd app && npm install && npm run dev
```

Point Phantom at `http://127.0.0.1:8899` (localnet). `setup.ts` writes `config.json` and `app/.env.local`.

Default demo: season **Robotaxi**, 10 minutes, 1% fee, 0-decimal narrative tokens so the linear curve is readable.

## Instructions

| ix | who | what |
|---|---|---|
| `init_vault` | admin | Vault + stock ATA + MM ATA |
| `create_season` | admin | Live season + narrative mint. Fails if one is already live. Same ix for season N+1. |
| `buy` | anyone | SOL in → narrative tokens + MM stock into vault. Re-checks clock. |
| `close_season` | anyone after `end_ts`, admin anytime | Snapshot `redeemable_stock` / `redeemable_supply`, clear `live_season`, revoke mint authority |
| `redeem` | holder | Burn tokens, receive pro-rata stock from the snapshot. Last holder gets dust. |
| `roll` | holder | Burn season-N tokens, mint the same amount of season-(N+1). Stock stays in the vault. |

Roll is 1:1 and slightly generous. If next season already has organic buyers, this dilutes them. Fine for a prototype; production should use time-weighted or locked LP, not a last-hour snapshot.

## Redeem math

On close, snapshot:

```
redeemable_stock = vault_ata.amount - pending_claims
redeemable_supply = narrative mint supply
```

`pending_claims` is stock still owed to earlier closed seasons. Roll subtracts the user's pro-rata from that counter (stock stays in the ATA) so the next close does not double-count. Vault ATA balance only decreases on redeem.

## Tests

- Cannot create a second live season
- Buy fails after `end_ts`
- Anyone can `close_season` after expiry
- Redeem pays pro-rata against snapshot
- Double redeem fails
- Roll mints next-season tokens and burns old
- Redeem + roll cannot both succeed for the same tokens
- Vault stock only decreases on redeem, not on roll

## IDL note

`anchor idl build` currently fails on this toolchain because `toml` 0.8 + `toml_edit` disagree with host `serde`. The on-chain `.so` still compiles. The checked-in `idl/season_vault.json` is the source of truth for tests and the app. If you change accounts or instructions, update that file (discriminators are `sha256("global:<ix>")[0..8]` / `sha256("account:<Name>")[0..8]`).

## Out of scope

Permissionless launches, name auctions, Jupiter/Raydium, real xStock mints, Token-2022 hooks, leverage, multiple narratives per stock, mobile, protocol token, points.
