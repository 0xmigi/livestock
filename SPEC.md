# Livestock — Build Spec

> **Naming.** The product is **Livestock** (planned home: `livestock.gg`).
> The things people trade are **narrative tokens**; that phrase does not
> change. The on-chain program keeps its crate name, `narrative_markets`, and
> the workspace packages keep the `@nm/*` scope. Only the brand moved.
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

On a linear curve that resolves to something clean:

> **You profit if you bought in the first half of everything that ever gets
> bought.**

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

> **Status:** the Jupiter leg is not wired yet. The current build pays in the
> stock directly and quotes the buy in dollars at the live stock price. See §14.

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
base_price:           u64          // stock base units for the first token
slope:                u64          // stock base units added per token sold
supply:               u64          // tokens outstanding
final_supply:         u64          // frozen at expiry — the redeem denominator
final_vault:          u64          // frozen at expiry — the redeem numerator
fee_bps:              u16
sell_tax_bps:         u16
status:               u8           // 0 Live, 1 Expired, 2 Settled
name_len, symbol_len, bump, stock_decimals: u8
_reserved:            [u8; 13]
```

The **version byte is checked on both sides**. The v1 → v2 change kept the
size and moved fields, so without the check an old account decodes silently
into the wrong values. Bump the version on every layout change.

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

### `create_narrative(expiry_ts, base_price, slope, fee_bps, sell_tax_bps, name_len, name, symbol)`
Accounts: creator (signer, pays rent) · narrative PDA · stock mint · narrative
mint · vault · system program · stock token program.

Permissionless. Creates the `Narrative` account only. Validates:
- `expiry_ts` is between 1 hour and 90 days out
- `base_price > 0`, `slope > 0`
- `fee_bps ≤ 1000`, `sell_tax_bps ≤ 2000`
- the stock mint is an initialized mint under the supplied token program;
  its decimals are recorded
- the narrative mint passes every check in §6
- the vault is a token account for the stock mint owned by the narrative PDA

### `buy(tokens_out: u64, max_stock_in: u64)`
- Require `status == Live` and `now < expiry_ts` (re-check the clock every tx)
- `cost = ∫` curve over `[supply, supply + tokens_out)` — see §8
- `fee = cost × fee_bps / 10_000`, sent to the creator's stock account
- Require `cost + fee <= max_stock_in`
- `TransferChecked` `cost` buyer → vault and `fee` buyer → creator
- Mint `tokens_out` narrative tokens to the buyer, signed by the narrative PDA
- `supply += tokens_out`

### `sell(tokens_in: u64, min_stock_out: u64)`
- Require `status == Live` and `now < expiry_ts`
- `refund = ∫` curve over `[supply - tokens_in, supply)`
- `tax = refund × sell_tax_bps / 10_000`, **stays in the vault**
- Require `refund - tax >= min_stock_out`
- Burn the tokens, transfer `refund - tax` vault → seller
- `supply -= tokens_in`

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

Linear, in stock base units per narrative token:

```
price(supply) = base_price + slope × supply
```

A buy pays the **exact integral**, so splitting a buy costs the same as making it
in one go:

```
cost(supply, n) = base_price × n + slope × (supply × n + n(n-1)/2)
```

`n(n-1)/2` is exact — one of the two factors is always even. Compute in `u128`,
narrow once at the end, and use checked math throughout.

**Why 0 decimals.** Over a 6-decimal supply the slope is a fraction far below
1 and floors to zero in integer arithmetic. Scaling it back up reintroduces a
division whose flooring can make the marginal price *equal* the average, and
"marginal strictly exceeds average" is the invariant that makes
buy-and-redeem always a loss. Decimals are cosmetic; the invariant is not.

**Defaults** are stock-price-dependent and computed client-side from the
stock's spot price, targeting a first token around $0.10 and ~$10 by 1M supply.
For a ~$250 stock with an 8-decimal stock mint:

```
base_price = 40_000    // 0.0004 TSLAx
slope      = 4         // base units per token
```

---

## 9. Attack surface

Worked through explicitly, because expiry is the novel part. Every row in the
first table has a LiteSVM test.

### Closed by design

| Attack | Why it fails |
|---|---|
| **Buy-and-redeem snipe at expiry** | Marginal price always exceeds the average on a rising curve. Buying late is always a loss. |
| **Stock-rally arbitrage** | Closed by the stock-denominated curve (§5). Was fatal under a USDC-denominated curve. |
| **Late-stage supply squeeze** | Cornering supply near expiry means buying at the most expensive part of the curve. Self-limiting. |
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

Livestock uses the same visual system as Moment, the user's other app. Copy it
rather than reinventing it:

- **Inter** everywhere (`next/font/google`), antialiased.
- **White ground** with warm neutrals — never blue-grey:
  `#FAFAF8` page tint · `#F3F3EF` chips and fills · `#E8E8E3` borders ·
  `#8A8A82` secondary text · `#5C5C56` body text and the primary button ·
  `#1A1A18` headings.
- **One accent**, amber `#D97706`, used for progress, "expiring soon" and the
  curve drawing. Status dots (green live · amber closing/awaiting · grey
  settled) are the only other colour.
- **Top bar**, `h-16 px-6`: mark + wordmark at the left, text nav beside it
  (active near-black, inactive grey), a `rounded-lg` grey account chip at the
  right with an avatar and the short address. The chip opens a full-width
  panel with an account card, the nav rows and a Log out.
- **Content column** `max-w-3xl` (narrower, `max-w-xl`, on focused screens),
  `pt-8 px-4`.
- **Section title** `text-xl font-semibold`, then a **row of filter chips**
  (`rounded-lg px-3 py-1.5 text-xs`, active = dark fill).
- **Cards** `rounded-xl border-neutral-200`; soft panels `bg-neutral-50`.
- **Buttons** `rounded-lg`: primary olive-grey fill, secondary grey fill,
  outline white with a border (Moment's bottom-pinned "Check in" style).
- **One hero number per screen**: an uppercase `tracking-widest` label over a
  `text-5xl font-bold` tabular figure with a quiet caption.
- **Empty states**: soft panel, centred outline icon, one line of copy, one
  outline button.
- Tabular figures on anything that ticks.

Do **not** produce a dark, dense, "crypto dashboard" UI.

### Screens

**`/` — Markets.** Title, tagline, a chip row: `Live · Ended | Expiring soon ·
Biggest vault | <one chip per stock>` (stock chips only when more than one is
registered). Narratives are grouped by the stock they expire into, each group
headed by the ticker and its live price. A row is: image, name, `$TICKER`,
status dot; on the right the vault size in stock and the countdown (or the
dollar value once ended). This is the only screen that needs to feel like a
market.

**`/n/[address]` — the narrative.** The core screen.
- Identity: image, name, `$TICKER · expires into TSLAx · status`
- Hero: `TIME REMAINING` over a large countdown and the conversion date.
  After the date: `TRADING CLOSED / Settling`; once settled:
  `EACH TOKEN CONVERTS TO / 0.00041 TSLAx`; when fully redeemed: `Done`.
- Two numbers: **vault** (what it converts into, with ≈ USD) and **supply**
  (with the next token's price).
- Action card: dollar input with `$10 · $50 · $100` presets → tokens received,
  stock paid, average per token, creator fee and **price impact**; Buy/Sell
  segmented control once the wallet holds tokens; the wallet's stock balance;
  an honest warning when it cannot cover the buy. After expiry a single
  **Convert** action showing exactly how much stock the wallet gets.
- Position: tokens held, and what they are worth at expiry if nothing changes.
- About: description, expiry (marked immutable), created, creator with
  holdings and share of supply, fee, exit tax, mint address, links.

**`/create`.** Stock picker (chips), image, name and ticker, description,
expiry presets (1 week / 2 weeks / 1 month) with the resulting date, links, and
a collapsible **price curve** card: a drawing of price against supply, the
dollar price of the first token, at 500k and at 1M, and what the first 100
tokens cost. Curve defaults derive from the stock's live price. One
transaction builds the mint, the vault and the narrative.

### Metadata

Each narrative has an image and a JSON document at the mint's `uri`, produced
by `POST /api/upload` (Vercel Blob, plain HTTPS). Keys follow what launchpads
emit so wallets render them: `name`, `symbol`, `description`, `image`,
`createdOn`, and optional `website`, `twitter`, `telegram`. The app reads the
URI off the mint's `TokenMetadata` extension and caches the JSON per session.

### Copy

> Buy the story. When it expires, you get the stock.

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
- **Tests:** LiteSVM for integration (25), plain unit tests for curve math (11).

---

## 12. Configuration and deployment

**Design for mainnet.** No demo shims in the protocol or the client — the thing
being built is the real system, deployed for real.

The app is configured entirely through public environment variables:

```
NEXT_PUBLIC_CLUSTER=devnet|mainnet
NEXT_PUBLIC_RPC_URL / NEXT_PUBLIC_WS_URL
NEXT_PUBLIC_STOCKS="TSLAx:<mint>:8:250,NVDAx:<mint>:8:120"   # SYMBOL:mint[:decimals[:fallbackUsd]]
NEXT_PUBLIC_PRIVY_APP_ID
BLOB_READ_WRITE_TOKEN                                        # server-side, for /api/upload
```

`NEXT_PUBLIC_STOCKS` is the stock registry: it drives the picker on Create,
the grouping and chips on Markets, and the price lookups (Jupiter price API,
by mint). The older single-stock variables still work as a one-entry registry.

Mock stock mints exist **only inside the test suite**, where LiteSVM controls
the clock and lets the whole lifecycle run in milliseconds. On devnet, where
xStocks do not exist, the registry points at a stand-in mint; the program and
client are identical to mainnet and only the addresses change.

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
4. `redeem` + the dust sweep
5. Full LiteSVM suite — every row in §9's "closed by design" table, plus the
   whole lifecycle against a Token-2022 stock and the three mint rejections
6. `sell` + the tax
7. TypeScript client: PDAs, instructions, decoders with version check, the
   mint builder
8. Devnet deployment and a seed script
9. Frontend: Markets, narrative page, Create, upload route, Moment-style UI

**Remaining**

- **Jupiter leg of the buy** (§5): USDC in, stock to the program, one
  signature. Until then buyers must hold the stock.
- **Mainnet stock registry** with real xStocks mints, and a pressure test
  against real pool depth.
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
