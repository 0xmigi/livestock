# Livestock — Build Spec

> **Naming.** The product is **Livestock** (planned home: `livestock.gg`).
> The things people trade are **narrative tokens**; that phrase does not
> change. The on-chain program is the `livestock` crate; the workspace
> packages keep the `@nm/*` scope.
>
> This document is the source of truth for what is built and why. Where the
> code and this document disagree, fix one of them the same day.

---

## 1. What this is

Livestock is a launchpad for **narrative tokens**: short-lived tokens about a
specific story concerning a public company, which **expire into that
company's tokenized stock**.

You are bullish Tesla → buy TSLA.
You are bullish Tesla *and specifically the Austin robotaxi launch* → buy the
`ROBOTAXI` narrative token. If the narrative works, you end up holding **more
TSLA than the same dollars would have bought outright**. If it doesn't, you
still end up holding TSLA — just less than a direct buy.

The point is that it removes the exit-timing problem from memecoins. You never
have to find a greater fool, because there is a date on which your position
becomes equity by default.

**Positioning note:** this is a *narrative market*, not a prediction market.
Nothing verifies whether robotaxis actually launched. Payoff is determined by
flows, not by truth. Say it that way; the alternative invites an obvious
challenge.

---

## 2. Prior art, and the gap

| | long.xyz | StonkFun | Livestock |
|---|---|---|---|
| Stock as quote asset | yes | yes | yes |
| Redemption into the stock | **no** | **no** | **yes** |
| Expiry | **no** | **no** | **yes** |

Both competitors pair memecoins against tokenized stocks and both are live with
real volume. In both, the stock is *only* a quote asset — holders have no claim
on it. The expiry-into-equity mechanic is unbuilt. That is the wedge.

Both, notably, implement their "bonding curve" as single-sided concentrated
liquidity in a permanent AMM pool. **We do not**, and the reason is structural:
expiry requires the protocol to halt the market and freeze the pot, and you
cannot halt a Raydium pool you do not own. Our curve is native to the program.

---

## 3. Product rules (do not violate)

1. Narrative tokens are created **permissionlessly**. Anyone, any supported
   stock, any name.
2. Many narratives per stock, all live at once. There is no "one at a time."
3. Each narrative has its **own** vault. No shared pot, no cross-narrative
   accounting.
4. `expiry_ts` is set at creation and is **immutable**.
5. Narrative supply is only ever minted by the curve. The client builds the
   mint, but the program refuses it unless mint authority has **already** been
   handed to the narrative PDA, there is **no freeze authority**, supply is
   zero, and decimals are zero. Mint authority is revoked at expiry.
6. The creator can never drain the vault, change the expiry, or mint outside
   the curve. These are program-enforced, not policy.
7. Redemption claims **never expire**. There is no deadline to claim.
8. Narrative mints have **0 decimals**. One token is one integer. Launchpad
   convention is 6; we deviate on purpose (see §8).

---

## 4. The mechanism

### Money flow

```
BUY      user's USDC ──Jupiter swap──> TSLAx ──> curve ──> narrative tokens
                                        └──────> vault (stays until expiry)

EXPIRY   curve freezes. mint authority revoked. supply + vault frozen.

REDEEM   burn narrative tokens ──> pro-rata TSLAx from the vault
```

### Why you can end up with more TSLA than you paid for

The curve rises, so early buyers pay less TSLAx per narrative token than late
buyers. At expiry, everyone redeems the **same** TSLAx per token — the vault's
average price.

Your gains are funded by later buyers. Your losses are bounded by the fact that
you still receive stock. The floor is real equity, not zero.

---

## 5. **CRITICAL: the curve is denominated in the stock, not USDC**

The user pays USDC. The *curve* is priced in TSLAx. These are different claims
and the distinction is the single most important thing in this document.

### Why — the arbitrage that a USDC-denominated curve creates

Suppose the curve is priced in USDC and the protocol swaps to TSLAx on each buy.

- Redemption value per token, in USDC, is `(vault_TSLAx / supply) × P_TSLA`.
  It **moves with the stock price**.
- The curve's marginal price is a fixed USDC number determined only by supply.
  It **does not move with the stock price**.

So the moment the stock rallies far enough, redemption value crosses above the
curve price, and anyone can mint on the curve and immediately redeem for a
risk-free profit — diluting every existing holder to do it.

How far is "far enough"? The arb opens when `P′/P > p(S)/avg(p)`. For a curve
with a meaningful base price and a shallow slope, that ratio is close to 1 — a
**5% move in the stock can open it**. This is not a tail scenario. It is fatal,
and it is perverse: the stock going up is supposed to be good for holders.

### The fix

Price the curve in **TSLAx per narrative token**. Then the marginal price and
the redemption value are in the same unit, both scale identically with the
stock, and `marginal > average` holds at every stock price by construction. The
arb closes permanently.

### How the user still pays dollars

The program never touches USDC. The **frontend composes one transaction**:

```
[ Jupiter: swap USDC → TSLAx ]  +  [ our program: buy(tokens_out, max_stock_in) ]
```

One signature, atomic, slippage handled by Jupiter's own instruction. The user
sees "pay $50, receive 1,240 ROBOTAXI." They never see a TSLAx unit unless they
want to.

This also keeps the program self-contained — no Jupiter CPI, no external program
risk, fully testable in LiteSVM.

> **Status:** wired, with SOL as the input. The buy panel quotes the swap
> live, sizes the buy from the least the swap can deliver, and puts the swap
> instructions in front of `buy` in one transaction (`app/src/lib/swap.ts`).
> On mainnet the swap is Jupiter's best route; that path is written to the
> swap API's documented shapes and has not yet been run against a funded
> wallet. On devnet, where tokenized stocks do not exist, the app's **faucet
> wallet** plays the counterparty: it holds every stand-in stock, sells it at
> the live Tokens API rate, and co-signs the buyer's transaction from the
> server after checking it is exactly "SOL in, one stock out at the quote"
> (`/api/devnet/swap`). Exercised end to end by `scripts/src/swap-buy.ts`.

---

## 6. Accounts

Three, and no more. (There is deliberately no `Position` account: redeem burns
the holder's entire balance, so a second redeem is impossible on balance alone.)

### `narrative_mint` — a Token-2022 keypair the creator brings

Not a PDA. The client generates a keypair (which is what lets a creator grind a
vanity address, as every launchpad does) and builds the mint in the same
transaction as `create_narrative`:

1. `CreateAccount` under Token-2022, funded for the account's *final* size
2. `InitializeMetadataPointer` pointing at the mint itself
3. `InitializeMint2` with 0 decimals, the creator as transient mint authority,
   **no** freeze authority
4. `InitializeTokenMetadata` with name, symbol and the metadata URI inline
5. `SetAuthority(MintTokens → narrative PDA)`

The program does not build any of this. It **verifies** it: Token-2022, zero
decimals, zero supply, no freeze authority, mint authority already equal to the
narrative PDA. That last check is the one the whole curve depends on.

This matches what live launchpad mints look like today — Token-2022, metadata
in the mint's own `TokenMetadata` extension, JSON served over plain HTTPS. Not
classic SPL, not Metaplex, not IPFS-only.

### `Narrative` — PDA `["narrative", narrative_mint]`

One fixed seed. Seeding on a variable-length name meant threading the name
bytes through every signer-seed array; that is gone.

Laid out as `[discriminator = 1, version = 2]` followed by a `#[repr(C)]`
payload with **alignment 1** — every multi-byte integer is a little-endian byte
array, because the payload starts at an odd offset. 282 bytes total.

```
creator:              Address
stock_mint:           Address      // e.g. TSLAx
narrative_mint:       Address      // the Token-2022 mint above
vault:                Address      // associated token account, see below
stock_token_program:  Address      // classic SPL or Token-2022, pinned at creation
name:                 [u8; 32]
symbol:               [u8; 10]
created_ts:           i64
expiry_ts:            i64          // immutable
virtual_stock:        u64          // the curve's virtual stock reserve, live
virtual_tokens:       u64          // the curve's virtual token reserve, live
supply:               u64          // tokens outstanding
final_supply:         u64          // frozen at expiry — the redeem denominator
final_vault:          u64          // frozen at expiry — the redeem numerator
fee_bps:              u16
sell_tax_bps:         u16
status:               u8           // 0 Live, 1 Expired, 2 Settled
name_len, symbol_len, bump, stock_decimals: u8
_reserved:            [u8; 13]
```

The **version byte is checked on both sides**. The size has never changed
(v2 moved fields, v3 swapped the linear curve's parameters for the two
reserves), so without the check an old account decodes silently into the
wrong values. Bump the version on every layout change.

### `vault` — the narrative PDA's associated token account for `stock_mint`

Not a PDA of this program. Tokenized stocks are Token-2022 mints whose
extensions determine account size; the ATA program computes that correctly, so
the client creates the vault idempotently and the program pins the address at
creation and enforces it on every later instruction.

---

## 7. Instructions

One-byte discriminators: `0 create_narrative`, `1 buy`, `2 sell`, `3 expire`,
`4 redeem`. Every instruction that touches the narrative mint passes the
**Token-2022** program; every instruction that moves stock passes the stock's
own token program, which the narrative recorded at creation.

### `create_narrative(expiry_ts, virtual_stock, fee_bps, sell_tax_bps, name_len, name, symbol)`
Accounts: creator (signer, pays rent) · narrative PDA · stock mint · narrative
mint · vault · system program · stock token program.

Permissionless. Creates the `Narrative` account only. Validates:
- `expiry_ts` is between 1 hour and 90 days out
- `virtual_stock > 0`; `virtual_tokens` starts at 1,073,000,000
- `fee_bps ≤ 1000`, `sell_tax_bps ≤ 2000`
- the stock mint is an initialized mint under the supplied token program;
  its decimals are recorded
- the narrative mint passes every check in §6
- the vault is a token account for the stock mint owned by the narrative PDA

### `buy(tokens_out: u64, max_stock_in: u64)`
- Require `status == Live` and `now < expiry_ts` (re-check the clock every tx)
- Require `supply + tokens_out <= 793_100_000`, else `SoldOut`
- `cost = tokens_out × virtual_stock / (virtual_tokens − tokens_out) + 1` — see §8
- `fee = cost × fee_bps / 10_000`, sent to the creator's stock account
- Require `cost + fee <= max_stock_in`
- `TransferChecked` `cost` buyer → vault and `fee` buyer → creator
- Mint `tokens_out` narrative tokens to the buyer, signed by the narrative PDA
- `supply += tokens_out`, `virtual_stock += cost`, `virtual_tokens −= tokens_out`

### `sell(tokens_in: u64, min_stock_out: u64)`
- Require `status == Live` and `now < expiry_ts`
- `refund = tokens_in × virtual_stock / (virtual_tokens + tokens_in)`
- `tax = refund × sell_tax_bps / 10_000`, **stays in the vault**
- Require `refund - tax >= min_stock_out`
- Burn the tokens, transfer `refund - tax` vault → seller
- `supply -= tokens_in`, `virtual_stock −= refund`, `virtual_tokens += tokens_in`

The tax is the mechanism that makes "you don't need to sell" true rather than
aspirational — see §9.

### `expire()`
- Permissionless once `now >= expiry_ts`. **Nobody can call it early, including
  the creator.** No signer at all.
- Freeze `final_supply = supply`, `final_vault = vault.amount`
- Revoke the narrative mint authority
- `status = Expired` (or `Settled` if `final_supply == 0`)

### `redeem()`
- Require `status == Expired`
- `tokens = caller's full narrative balance`, must be > 0
- `payout = final_vault × tokens / final_supply`, in `u128`
- **If this is the last claimant** (`tokens >= remaining_supply`), `payout = the
  entire remaining vault balance` — sweeps rounding dust so the final redeemer
  is not short-changed
- Burn the tokens, transfer `payout` vault → caller
- When the supply hits zero, `status = Settled`

---

## 8. Curve

**pump.fun's curve, exactly, with the stock in place of SOL.** A constant
product over two virtual reserves:

```
k = virtual_stock × virtual_tokens

buy  n:  cost   = n × virtual_stock / (virtual_tokens − n) + 1     (rounded up)
sell n:  refund = n × virtual_stock / (virtual_tokens + n)         (rounded down)
spot     = virtual_stock / virtual_tokens
```

A buy adds its cost to `virtual_stock` and takes its tokens out of
`virtual_tokens`; a sell does the reverse with the full refund, tax included
(the tax is the vault's, not the curve's). Rounding always favours the vault,
so `k` can only grow.

The token side is pump.fun's, fixed in the program and counted in whole
tokens since narrative mints have 0 decimals:

```
INITIAL_VIRTUAL_TOKEN_RESERVES = 1_073_000_000   // pump.fun: 1,073,000,000 × 10⁶
INITIAL_REAL_TOKEN_RESERVES    =   793_100_000   // all the curve will ever sell
TOKEN_TOTAL_SUPPLY             = 1_000_000_000   // what market cap is quoted against
```

The stock side is the one parameter a creator supplies, `virtual_stock`: what
**30 SOL** (pump.fun's `initial_virtual_sol_reserves`) is worth in the stock
at creation, computed client-side from the live SOL and stock prices. So every
narrative opens at pump.fun's market cap, in whatever stock it converts to,
and a buy of the entire real reserve costs about 85 SOL worth of it.

**Sold out.** Supply can never exceed 793.1M. pump.fun migrates to an AMM at
that point; a narrative has nowhere to go, so buys revert with `SoldOut`,
sells keep working and put tokens back on the curve, and the date settles it
as usual. The remaining 206.9M of nominal supply is never minted.

Compute in `u128`, narrow once at the end, checked math throughout.

**Why 0 decimals.** The reserves are pump.fun's in whole tokens; a billion of
them is granularity enough, and whole units keep every price an exact ratio
of two integers with no decimal scaling in the program. (Under the earlier
linear curve the reason was different: a 6-decimal slope floored to zero.)

**The invariant.** Redemption pays the vault's average; a buy pays the
marginal price; on a rising curve marginal ≥ average, so buy-and-redeem can
never profit. Near zero supply the curve is flat enough that the two agree to
within a base unit and the buyer merely gets their stock back, minus the fee.
The only way to come out a base unit ahead is to collect other people's
round-ups, capped at one unit per earlier trade: dust, below a transaction
fee.

## 9. Attack surface

Worked through explicitly, because expiry is the novel part. Every row in the
first table has a LiteSVM test.

### Closed by design

| Attack | Why it fails |
|---|---|
| **Buy-and-redeem snipe at expiry** | Marginal price always exceeds the average on a rising curve. Buying late is always a loss. |
| **Stock-rally arbitrage** | Closed by the stock-denominated curve (§5). Was fatal under a USDC-denominated curve. |
| **Late-stage supply squeeze** | Cornering supply near expiry means buying at the most expensive part of the curve, and the curve sells out at 793.1M tokens. Self-limiting. |
| **Creator rug** | Creator cannot drain the vault, move the expiry, or mint off-curve. All program-enforced. |
| **Off-curve minting** | `create_narrative` rejects a mint whose authority is not already the narrative PDA, and the authority is revoked at expiry. |
| **Freezing holders' tokens** | A narrative mint with a freeze authority is rejected at creation. |
| **Early expiry** | `expire()` reverts before `expiry_ts` for everyone, creator included. |
| **Double redeem** | Redeem burns the entire balance. |
| **Dust griefing the last redeemer** | Final claimant sweeps the remainder. |
| **Wrong token program routing** | The stock's program is pinned at creation and checked on every instruction. |

### Accepted, and disclosed

**Creator front-running their own launch.** The creator can buy the cheapest
tokens before promoting. This is inherent to every bonding curve and is not
fixable — pump.fun has it too. Mitigation is transparency: the narrative page
shows the creator's holdings and their share of supply.

**Expiry timed against a catalyst.** A creator setting expiry two weeks out for a
one-week-away event is the *intended* use. The inverse — setting expiry *before*
a known catalyst to trap buyers — is real but self-defeating and visible: expiry
is immutable and displayed as the hero number. Treat it as a UI problem, not a
protocol one.

**Selling beats holding, absent the tax.** Sellers exit at the marginal price;
holders redeem at the average; marginal > average. Without intervention, rational
holders all exit before expiry and the core promise collapses. The `sell_tax_bps`
into the vault is the correction — leaving early pays whoever stays. **Start at
1000 bps (10%) and treat it as the main tuning dial in the whole design.**

### Real risks that are not fully mitigable

**Thin tokenized-stock liquidity.** Every buy is a live swap into an xStocks
pair, and observed pools are genuinely shallow — one SPYx pool held under 1 SPYx
of depth. This hard-caps how large a single narrative can get before slippage
eats the buyer. Enforce a strict per-buy slippage bound and surface the price
impact in the UI. **Pressure-test this against real pool depth before launch.**

**Issuer risk.** xStocks carry a freeze authority. If Backed freezes the vault's
token account, redemption breaks and there is nothing the program can do. This is
unavoidable when holding tokenized equity and must be disclosed.

**Custody posture.** long.xyz and StonkFun deliberately never take custody — the
stock is only their quote asset. We hold real tokenized equity on users' behalf.
That is simultaneously the moat and the regulatory exposure. Have the answer
ready before an investor asks.

---

## 10. Frontend

Next.js, TypeScript, Tailwind v4. **Mobile-first**, works well on desktop. Web
app to start.

### Visual direction

A synthesis, not a clone. Each reference contributed one thing: OTC Desks the
dense table and the three feature cards, Longbow the metric tracker, GitHub
the neutral list rows, JTX and Frontier Traders the near-black ground with
off-white ink, hairline borders, inverse solid buttons and 4px corners.

- **Palette.** Dark by default: `#141414` ground (near-black, never black) ·
  `#1A1A1A` panels · `#202020` tiles · `#2A2A2A` hairlines · `#F2F1EE` ink ·
  `#CFCDCC` secondary · `#A7A79F` muted. Light: white ground, `#F9F9F8`
  panels, `#DEDDDB` borders, `#1C1C1D` ink. The `neutral` scale in
  `globals.css` is semantic (50 is the faintest panel, 900 the heading
  colour) so one class reads correctly on either ground.
- **Colour is semantic**, the way fomo.family does it. Blue (`#516AF6`) is
  for actions and links with no direction: Create, Continue, Launch, Settle,
  Convert, the time bar, the ending-soon dot, creator and mint links. Green
  (`#048F5C` solid, `#21C95E` text) is only ever buy and gain: the Buy
  button, the live dot, success notices. Red-orange (`#FF622E`) is only ever
  sell and loss: the Sell button, errors. Every figure stays in the ink
  colour; nothing is coloured just because it is a number. Neutral controls
  are hairline-bordered fills. The inverse off-white button is kept for the
  login prompt only.
- **Rounded but sharper.** 4px on everything; 2px on tiny badges. No pills.
- **Type.** Geist for words, Geist Mono only for figures, tickers, prices,
  dates and addresses. No serif, no display face.
- **The mark is a herd**: two cow faces, one behind the other, drawn in the
  ink colour. Branding never takes a semantic colour: a blue mark would say
  "action" the way a green one would say "buy".
- **The time bar is the signature element.** Every narrative carries a thin
  teal bar of how much of its life has elapsed.
- **Stocks are first-class.** The registry, logos, company names and prices
  come from the Tokens API (tokens.xyz), which lists every tokenized equity
  on Solana. Every "converts to" carries the logo. The filter is a dropdown,
  never a strip or a row of pills.
- **One container, `max-w-5xl`, on every page**, header included, header
  identical everywhere. Wide pages use two columns.

Charts are deliberately absent.

The hero's right-hand card is proof rather than pitch: the week's best
completed narrative trade, replayed from chain history by `/api/highlight`
and shown in shares — what the wallet paid in the stock, what it received
when it sold or was converted, against the same stock held outright. Only a
trade that came out ahead qualifies; until one exists the card shows the
tally instead.

### Screens

**`/` — Markets.** A hero with the pitch and the Create button on the left
and a "Livestock so far" card on the right (narratives, combined FDV, locked
in vaults), closed by a hairline. Three feature cards: just launched, top FDV,
ending soonest. One toolbar: Live / Ended, Top FDV / Newest (Top FDV is the
default), a Stock dropdown with logos, search. On desktop a dense table:
narrative (image, name, `$TICKER`, status dot) · converts to (logo, ticker,
company) · FDV over supply · vault in USD over stock · time left over the time
bar, or the per-token payout once ended. On phones, compact rows with FDV and
time left, the bar, and a vault-and-date line. Twenty rows, then "Show 20
more · N left".

**`/n/[address]` — the narrative.** Identity row: image, name, `$TICKER ·
converts to [logo] TSLAx · status`. One panel, first thing under the identity row: the
hero number (time remaining, or Settling / each token converts to / Done)
over the time bar with launch and expiry dates on the left, and the action
(Buy/Sell, Settle, Convert, or the login prompt) on the right, side by side
on desktop and stacked on phones. Nobody scrolls to trade. The Overview grid: vault,
supply, next token or status, per token now, expires, creator fee, exit tax,
creator holds; footer with creator and mint links. Action card by phase:
dollar input with presets → tokens, stock paid, average, fee, price impact;
Buy/Sell once the wallet holds tokens; Settle after the date; Convert once
settled. Position grid for holders. About card only when the metadata has a
description or links.

**`/create`.** Four steps with a progress line and back/next labels, and a
bar pinned to the bottom that carries the running summary and the one action.
Stock (cards with logo and price; skipped when only one is registered) →
Story (live preview card, name, ticker, image, description, links) → Date
(1 hour up to 2 weeks as cards with the resulting date, the collapsed
price-curve card) → Review (preview, a Terms grid, Launch). One transaction
builds the mint, the vault and the narrative.

### Metadata

Each narrative has an image and a JSON document at the mint's `uri`, produced
by `POST /api/upload` (Vercel Blob, plain HTTPS). Keys follow what launchpads
emit so wallets render them: `name`, `symbol`, `description`, `image`,
`createdOn`, and optional `website`, `twitter`, `telegram`. The app reads the
URI off the mint's `TokenMetadata` extension and caches the JSON per session.

### Copy

> Buy the narrative. When it expires, you get the stock.

---

## 11. Stack

- **Program:** Pinocchio (not Anchor). 1-byte discriminators. Zero-copy state,
  `#[repr(C)]`, **alignment 1** — every multi-byte integer stored as a
  little-endian byte array, since the payload starts at an odd offset after the
  `[discriminator, version]` header.
- **Tokens:** narrative mints are **Token-2022** with `MetadataPointer` +
  `TokenMetadata`; stocks are whichever program their mint lives under
  (xStocks are Token-2022). Stock moves with `TransferChecked`.
- **Wallets:** Privy. `chain` defaults to `solana:mainnet` when omitted —
  always pass the cluster explicitly. Sign with Privy, broadcast yourself;
  locally held keypairs (the new mint) partially sign before Privy adds the
  fee payer.
- **Client:** `@solana/kit` 8. Hand-rolled instruction encoding and account
  decoders (no IDL); `@solana-program/token-2022` builders for the mint.
  Built to real ESM + declarations — consuming it as TypeScript source does
  not resolve under Turbopack.
- **Stock tokens:** xStocks / Backed on Solana (8 decimals). What StonkFun uses.
- **Swaps:** Jupiter on mainnet, composed client-side into the buy transaction.
- **RPC:** Helius.
- **Deploy:** Vercel, with Vercel Blob for images and metadata JSON. No other
  backend — the Markets page reads narratives with `getProgramAccounts`.
- **Tests:** LiteSVM for integration (30), plain unit tests for curve math (12).

---

## 12. Configuration and deployment

**Design for mainnet.** No demo shims in the protocol or the client — the thing
being built is the real system, deployed for real.

The app is configured entirely through public environment variables:

```
NEXT_PUBLIC_CLUSTER=devnet|mainnet
NEXT_PUBLIC_RPC_URL / NEXT_PUBLIC_WS_URL
NEXT_PUBLIC_STOCKS="TSLAx:<mint>:8:250,NVDAx:<mint>:8:120"   # pins: SYMBOL:mint[:decimals[:fallbackUsd]]
NEXT_PUBLIC_PRIVY_APP_ID
TOKENS_API_KEY                                               # server-side, for /api/stocks
DEVNET_FAUCET_KEYPAIR                                        # server-side, devnet only: the swap counterparty
BLOB_READ_WRITE_TOKEN                                        # server-side, for /api/upload
```

The stock registry is the Tokens API's curated stock and ETF lists, read
through `/api/stocks` and refreshed every minute: it drives the picker on
Create (searchable, deepest markets first), the filter on Markets, and every
logo, name and price. `NEXT_PUBLIC_STOCKS` pins a symbol to a mint over that
list; the older single-stock variables still work as a one-entry pin.

Mock stock mints exist **only inside the test suite**, where LiteSVM controls
the clock and lets the whole lifecycle run in milliseconds. On devnet, where
xStocks do not exist, a pin points each of the ten seeded symbols at a
stand-in mint and the rest of the catalogue shows as mainnet-only; the program
and client are identical to mainnet and only the addresses change.

---

## 13. Out of scope for v1

- **Roll into the next narrative.** This is the flywheel from the original tweet
  and it matters, but it is v2. With per-narrative vaults it stays easy to add
  later: burn A, move your pro-rata stock from A's vault to B's vault, mint B.
- Graduation to an AMM. Expiry replaces it.
- Oracles or real-world resolution.
- Multiple stocks per narrative.
- A protocol token, points, referrals.
- Mobile apps.

---

## 14. Status

**Done**

1. Curve math + unit tests
2. `create_narrative` (verifying a client-built Token-2022 mint), `buy`
3. `expire` + freeze + authority revocation
4. `redeem` + the dust sweep, and `convert`: the same payout for any holder
   without their signature, through the mint's permanent delegate. A keeper
   (`scripts/src/keeper.ts`, run locally or as a long-lived process in
   production; `/api/keeper` does one pass for an external scheduler) expires narratives and pays every holder the moment the date
   passes, so a holder never has to claim.
5. Full LiteSVM suite — every row in §9's "closed by design" table, plus the
   whole lifecycle against a Token-2022 stock and the three mint rejections
6. `sell` + the tax
7. TypeScript client: PDAs, instructions, decoders with version check, the
   mint builder
8. Devnet deployment, a seed script, and the keeper
9. Frontend: Markets, narrative page, Create, upload route, Moment-style UI

**Remaining**

- **First mainnet buy through Jupiter** (§5): the leg is written and the
  devnet faucet version runs; the Jupiter path needs a funded wallet to prove.
- **Pressure test** of real xStocks pool depth on mainnet.
- Vercel deployment (Blob token, Helius RPC, Privy production app).
- A creator cost-basis figure on the narrative page (needs transaction
  history; holdings alone are shown today).

---

## 15. Open questions

1. **Sell tax rate.** 10% is the starting guess. It is the dial that decides
   whether people hold to expiry, and it deserves to be modelled rather than
   guessed.
2. **Is a sell side needed at all in v1?** Removing it is simpler and makes the
   "it converts by default" story absolute — but a two-week lock with no exit is
   a real objection from both users and investors.
3. **Creator fee vs protocol fee split.** Currently the spec sends the whole buy
   fee to the creator, which maximises the incentive to launch. There is no
   protocol revenue in v1.
4. **Metadata permanence.** Blob is plain HTTPS, which is what launchpads do,
   but the image and JSON live on our account. Decide whether to mirror to a
   permanent store before mainnet.
5. **Graduation ratchet.** Today the expiry is fixed at creation and the
   promise is "it resolves on a date". The alternative is "it resolves within a
   fixed time of the story stalling": each time the vault crosses an escalating
   threshold the expiry moves out by a fixed step, and a narrative that stops
   attracting new money converts on its current date. Long-lived narratives are
   earned rather than chosen. Rules that would need pinning down:
   - Measure the **vault in stock units**, never market cap. Market cap is half
     air on any rising curve and a dollar figure moves with the stock; the vault
     only grows when new money arrives.
   - **Thresholds escalate** (doubling or similar) so every extension is paid
     for by fresh inflow. A fixed bar would extend forever once crossed.
   - The extension **adds a fixed step to the current expiry** (say 30 days),
     not "30 days from now", so the page can always show the date if nothing
     else happens.
   - **Lower `MAX_DURATION_SECS`** at creation (30 days rather than 90) so a
     long life can only be earned.
   - Known bound, not prevention: a whale can buy at the top to cross a
     threshold and extend everyone's lock. Escalation makes repeating it
     expensive and the exit tax pays the holders they locked in. Add to §9.
   - Cost: three fields on `Narrative` (level, next threshold, step), one
     check at the end of `buy`, a layout version bump, client and LiteSVM cases.
   - UI: a second live number under the countdown, vault against the next
     threshold in stock. This is the honest version of pump.fun's bonding bar.
6. **Exit tax switch at graduation.** Before the first threshold the sell tax
   is 0%, so the early phase is a deposit anyone can leave at roughly cost
   (tax-free sells down the curve refund the last money in, no cost-basis
   tracking needed). Crossing the first threshold switches the tax on for
   good. This blunts the creator front-run in §9 (walk out at cost if they
   dump), gives the crowd a concrete line to push for, and lets a narrative that
   never catches on end quietly. Depends on 5, or on a single graduation
   threshold if the ratchet is not adopted.
