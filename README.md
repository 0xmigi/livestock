# Livestock

**Buy the narrative. When it expires, you get the stock.**

Livestock is a launchpad for **narrative tokens**: short-lived tokens about a
specific story concerning a public company, which expire into that company's
tokenized stock.

Bullish Tesla → buy TSLA. Bullish Tesla *and specifically the Austin robotaxi
launch* → buy the `ROBOTAXI` narrative token. If the narrative works you end up
holding more TSLA than the same dollars would have bought outright. If it
doesn't, you still end up holding TSLA.

It removes the exit-timing problem from memecoins: there is a date on which your
position becomes equity by default, so you never have to find a greater fool.

**[Read the spec →](SPEC.md)**

---

## Layout

```
programs/livestock   Pinocchio program
client/                      @nm/client — @solana/kit instruction builders, decoders, mint builder
app/                         @nm/app — Next.js frontend (Privy wallets, Moment-style UI)
scripts/                     @nm/scripts — devnet seed and diagnostics
```

Solana. Narrative mints are Token-2022 with inline metadata; stocks are
xStocks (Backed); swaps route through Jupiter.

## Running it

```bash
pnpm install
cp app/.env.example app/.env.local   # fill in the Privy app ID and the Tokens API key
pnpm dev                             # builds the client, then next dev
```

A buy is paid in SOL: the transaction swaps it into the narrative's stock and
then calls the program, in one signature. On mainnet the swap is Jupiter. On
devnet it is the app's faucet wallet (`DEVNET_FAUCET_KEYPAIR` in
`app/.env.local`), which holds the ten stand-in stocks and sells them at the
live price; fund it once with `spl-token create-account`/`mint` for each
pinned mint, as the deployer wallet is their mint authority. To run a buy from
the command line, against the dev server:

```bash
BUYER_KEYPAIR=<path to a devnet keypair> SOL=0.05 pnpm --filter @nm/scripts run swap-buy
```

Program tests (46, LiteSVM + curve unit tests):

```bash
cargo build-sbf && cargo test -p livestock
```

Upgrade the devnet program (the upgrade authority is your Solana CLI wallet;
the program keypair is only needed for a first deploy and is not committed):

```bash
cargo build-sbf && solana program deploy target/deploy/livestock.so --program-id 5X7RTCFFLgCpsRiskzm1gBEQmbzBEL39H6WpN9YzSizB -u devnet
```

Do not pass `target/deploy/livestock-keypair.json` as the program id:
`cargo build-sbf` generates that file and it is a different, unrelated key.

Mainnet uses the same program id. Build reproducibly, then deploy and publish
the IDL and security.txt in one go (the script refuses to run without a private
RPC, a funded authority and a binary that carries the embedded security.txt):

```bash
solana-verify build --library-name livestock
MAINNET_RPC_URL=https://mainnet.helius-rpc.com/?api-key=... scripts/deploy-mainnet.sh
```

Upgrades go through the Squads multisig that holds the upgrade authority.
The same script stages the new binary in a buffer owned by the vault, then
proposes the upgrade and approves it as the CLI wallet; the second approval
and the execution happen in the Squads dashboard (or from the CLI once the
threshold is met):

```bash
solana-verify build --library-name livestock
MAINNET_RPC_URL=... scripts/deploy-mainnet.sh                                   # stages, proposes, approves
MAINNET_RPC_URL=... pnpm --filter @nm/scripts run propose-upgrade -- show --index <n>
MAINNET_RPC_URL=... pnpm --filter @nm/scripts run propose-upgrade -- execute --index <n>
```

The IDL (`metadata/livestock.codama.json`, Codama format, since the program is
Pinocchio and has no Anchor IDL) and the contact card (`metadata/security.json`)
are written to the Program Metadata program under the `idl` and `security`
seeds. The binary also embeds a `security.txt` pointing at `SECURITY.md`.

The stock registry comes from the Tokens API (`TOKENS_API_KEY`, read by
`/api/stocks`): every tokenized equity on Solana, with mint, logo and price.
Devnet has ten stand-in stock mints named after real xStocks (classic SPL,
8 decimals, minted by the deployer wallet). Pin them in `app/.env.local` so
those ten are pickable there; the rest of the catalogue shows as mainnet-only:

```
NEXT_PUBLIC_STOCKS=TSLAx:8gfqWFan4bfnm3QXFC67VStWpf31ZzJK5uHT6Jiip2wg:8:353,NVDAx:AysPNDmoUrcr2RbtCNn5fMfLKPmKRvvoxAXTiT61k5dh:8:230,AAPLx:FjBzTxa57GzcPakBb7TPed2HM3SaYebhNs5RHVGu6nub:8:320,SPYx:CVgVgVpBGskc6MqZGLoCtHzSRTznWtJCcB5h9LM1cphW:8:770,MSTRx:39HoeQsujcqFEdUUX1gngA1jb4w1aX2Txs2ZEuYzWXLT:8:143,GOOGLx:uVQdBmMn2QfmwttG5Hi8697DGUXFD136xcDKQCGPAVB:8:337,AMZNx:4MMLbN6Wy2TPHE3e4MEmZt4s927ERwBVywDG28qQWne4:8:258,METAx:HjDxAEZ67VbTmfXcBK2uzCAGSGQmJ7VsXanrrch5dU7N:8:617,COINx:Eg6usUHZSeytKyYWyfKACjuCwnE4Q5zZR7MVrrnTqXj4:8:185,HOODx:E28rNA15CnXpZpWSE11zZ8C8JnsDPzRBE9ofqMQa5KLE:8:122
```

On mainnet nothing is pinned. `/api/stocks` applies three automatic rules
(`app/src/lib/server/listing.ts`): a stock is pickable when Jupiter can route
a $100 buy into it under 1% price impact, its mint charges no transfer fee, and
its mint has no transfer hook enabled. The rest of the catalogue stays visible
with the reason ("No pool yet", "Thin pool", "Transfer fee") and lights up on
its own once a pool appears. `STOCK_DENY_LIST` (comma-separated mints or
symbols) is the emergency switch for a stock that should not be offered.

When a narrative's date passes, nothing happens on its own: someone has to
send `expire`, then `convert` for every holder. The keeper does that. Run it
next to the dev server and it walks devnet every twenty seconds, paying fees
from your CLI wallet (`KEYPAIR` overrides):

```bash
pnpm --filter @nm/scripts run keeper
```

In production, run the same script as a long-lived process (Railway, or any
box): set `KEEPER_KEYPAIR` to a funded keypair as a JSON byte array and
`RPC_URL`, and start it with `pnpm --filter @nm/scripts run keeper`. Vercel's
free tier only allows daily crons, so there is no cron there; `/api/keeper`
still does one pass per call for any external scheduler, guarded by
`CRON_SECRET` as a bearer token. New
narrative mints name their narrative as permanent delegate, which is what lets
the program burn on holders' behalf; narratives created before that keep the
manual Redeem button.

Seed devnet with a few narratives:

```bash
RPC_URL=... STOCK_MINT=... pnpm --filter @nm/scripts run seed
```

To exercise expiry and conversion on devnet, seed one narrative that expires
in an hour (the program's minimum) and leave the keeper running; the payout
lands in the buyer's stock account a minute or so after the countdown ends:

```bash
HOURS=1 STOCK_MINT=... pnpm --filter @nm/scripts run seed
```

Status: **building.** See §14 of the spec for what is done and what remains.
