# Livestock

**Buy the story. When it expires, you get the stock.**

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
programs/narrative_markets   Pinocchio program (the crate keeps its original name)
client/                      @nm/client — @solana/kit instruction builders, decoders, mint builder
app/                         @nm/app — Next.js frontend (Privy wallets, Moment-style UI)
scripts/                     @nm/scripts — devnet seed and diagnostics
```

Solana. Narrative mints are Token-2022 with inline metadata; stocks are
xStocks (Backed); swaps route through Jupiter.

## Running it

```bash
pnpm install
cp app/.env.example app/.env.local   # fill in Privy app ID and the stock registry
pnpm dev                             # builds the client, then next dev
```

Program tests (36, LiteSVM + curve unit tests):

```bash
cargo build-sbf && cargo test -p narrative_markets
```

Upgrade the devnet program (the upgrade authority is your Solana CLI wallet;
the program keypair is only needed for a first deploy and is not committed):

```bash
cargo build-sbf && solana program deploy target/deploy/narrative_markets.so --program-id 7WbnkZ57UvAPzy3rNqErZW57xnhUdnqwXnDm34dGV2SX -u devnet
```

Do not pass `target/deploy/narrative_markets-keypair.json` as the program id:
`cargo build-sbf` generates that file and it is a different, unrelated key.

Seed devnet with a few narratives:

```bash
RPC_URL=... STOCK_MINT=... pnpm --filter @nm/scripts run seed
```

Status: **building.** See §14 of the spec for what is done and what remains.
