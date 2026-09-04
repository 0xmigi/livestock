# Narrative Markets — Build Spec

> Supersedes the original Season Vault spec entirely. The code currently in this
> repo was built to that spec and is **obsolete**; treat this document as the
> only source of truth.

---

## 1. What this is

A launchpad for **narrative tokens**: short-lived tokens about a specific story
concerning a public company, which **expire into that company's tokenized
stock**.

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

| | long.xyz | StonkFun | This |
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
5. Narrative supply is only ever minted by the curve. Mint authority is a
   program PDA and is revoked at expiry.
6. The creator can never drain the vault, change the expiry, or mint outside the
   curve. These are program-enforced, not policy.
7. Redemption claims **never expire**. There is no deadline to claim.
8. Narrative mints have **0 decimals**. One token is one integer.

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
[ Jupiter: swap USDC → exact TSLAx ]  +  [ our program: buy(stock_in, tokens_out) ]
```

One signature, atomic, slippage handled by Jupiter's own instruction. The user
sees "pay $50, receive 1,240 ROBOTAXI." They never see a TSLAx unit unless they
want to.

This also keeps the program self-contained — no Jupiter CPI, no external program
risk, fully testable in LiteSVM.

---

## 6. Accounts

Three, and no more. (There is deliberately no `Position` account: redeem burns
the holder's entire balance, so a second redeem is impossible on balance alone.)

### `Narrative` — PDA `["narrative", stock_mint, creator, name_hash]`

```
creator:            Address
stock_mint:         Address      // e.g. TSLAx
narrative_mint:     Address      // PDA, 0 decimals
vault:              Address      // token account, holds stock_mint
name:               [u8; 32]
symbol:             [u8; 10]
created_ts:         i64
expiry_ts:          i64          // immutable
base_price:         u64          // stock base units for the first token
slope:              u64          // stock base units added per token sold
supply:             u64          // tokens outstanding
stock_in_vault:     u64          // cached; ground truth is the token account
fee_bps:            u16
sell_tax_bps:       u16
status:             u8           // 0 Live, 1 Expired, 2 Settled
name_len, symbol_len, bump, mint_bump, vault_bump: u8
// frozen at expiry:
final_supply:       u64
final_vault:        u64
```

### `narrative_mint` — PDA `["mint", narrative]`
0 decimals. Mint authority = the `Narrative` PDA, revoked at expiry.

### `vault` — PDA `["vault", narrative]`
Token account for `stock_mint`, owned by the `Narrative` PDA.

---

## 7. Instructions

### `create_narrative(name, symbol, expiry_ts, base_price, slope, fee_bps, sell_tax_bps)`
Permissionless. Creates all three accounts. Validates:
- `expiry_ts` is between 1 hour and 90 days out
- `base_price > 0`, `slope > 0`
- `fee_bps < 1000`, `sell_tax_bps < 2000`
- `stock_mint` is an initialized SPL mint

### `buy(tokens_out: u64, max_stock_in: u64)`
- Require `status == Live` and `now < expiry_ts` (re-check the clock every tx)
- `cost = ∫` curve over `[supply, supply + tokens_out)` — see §8
- `fee = cost × fee_bps / 10_000`, sent to the creator
- Require `cost + fee <= max_stock_in`
- Transfer `cost` stock from buyer → vault, `fee` → creator
- Mint `tokens_out` narrative tokens to the buyer
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
  the creator.**
- Freeze `final_supply = supply`, `final_vault = vault.amount`
- Revoke the narrative mint authority
- `status = Expired` (or `Settled` if `final_supply == 0`)

### `redeem()`
- Require `status == Expired`
- `tokens = caller's full narrative balance`, must be > 0
- `payout = final_vault × tokens / final_supply`, in `u128`
- **If this is the last claimant** (`tokens == remaining_supply`), `payout = the
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

**Defaults** are stock-price-dependent and should be computed client-side from
the stock's spot price. For a ~$250 stock with an 8-decimal stock mint, targeting
a first token around $0.10 and ~$10 by 1M supply:

```
base_price = 40_000    // 0.0004 TSLAx
slope      = 4         // base units per token
```

---

## 9. Attack surface

Worked through explicitly, because expiry is the novel part.

### Closed by design

| Attack | Why it fails |
|---|---|
| **Buy-and-redeem snipe at expiry** | Marginal price always exceeds the average on a rising curve. Buying late is always a loss. |
| **Stock-rally arbitrage** | Closed by the stock-denominated curve (§5). Was fatal under a USDC-denominated curve. |
| **Late-stage supply squeeze** | Cornering supply near expiry means buying at the most expensive part of the curve. Self-limiting. |
| **Creator rug** | Creator cannot drain the vault, move the expiry, or mint off-curve. All program-enforced. |
| **Early expiry** | `expire()` reverts before `expiry_ts` for everyone, creator included. |
| **Double redeem** | Redeem burns the entire balance. |
| **Dust griefing the last redeemer** | Final claimant sweeps the remainder. |

### Accepted, and disclosed

**Creator front-running their own launch.** The creator can buy the cheapest
tokens before promoting. This is inherent to every bonding curve and is not
fixable — pump.fun has it too. Mitigation is transparency: show creator holdings
and their cost basis on the token page.

**Expiry timed against a catalyst.** A creator setting expiry two weeks out for a
one-week-away event is the *intended* use. The inverse — setting expiry *before*
a known catalyst to trap buyers — is real but self-defeating and visible: expiry
is immutable and displayed prominently. Treat it as a UI problem, not a protocol
one.

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
impact in the UI. **Pressure-test this against real pool depth before building.**

**Issuer risk.** xStocks carry a freeze authority. If Backed freezes the vault's
token account, redemption breaks and there is nothing the program can do. This is
unavoidable when holding tokenized equity and must be disclosed.

**Custody posture.** long.xyz and StonkFun deliberately never take custody — the
stock is only their quote asset. We hold real tokenized equity on users' behalf.
That is simultaneously the moat and the regulatory exposure. Have the answer
ready before an investor asks.

---

## 10. Frontend

Next.js, TypeScript, Tailwind. **Mobile-first**, works well on desktop. Web app
to start.

### Visual direction

Follow the Moment aesthetic:

- **Off-white ground** (`#FAFAF9`-ish, faintly warm), near-black text. Not grey
  on grey, not dark mode.
- **A lot of air.** Generous whitespace is the primary design device.
- **Uppercase, letter-spaced micro-labels** above large numerals.
  `TIME REMAINING` over a big countdown.
- **One hero number per screen.** Decide what it is and let it dominate.
- **Pill buttons**, `rounded-full`, subtle grey fill for secondary, solid dark
  for primary.
- **Small coloured status dots** as the only real accent colour — green for live,
  amber for expiring, grey for settled.
- Tabular figures on anything that ticks.
- Sparse horizontal nav, text links, dark = active, grey = inactive.

Do **not** produce a dark, dense, "crypto dashboard" UI.

### Screens

**`/` — Discover.** List of live narratives, grouped by stock. Each row: name,
stock, time remaining, vault size, current price. Sort by expiring-soon and by
vault size. This is the only screen that needs to feel like a market.

**`/n/[address]` — the narrative.** The core screen and the one to get right.
- Hero: name, the stock it expires into, and a large countdown
- Two numbers: **vault** (what it converts into) and **supply**
- Buy panel: dollar input → token quote, with price impact shown
- After expiry: a single **Redeem** action showing exactly how much stock you get
- Your position: tokens held, and what they are currently worth in stock

**`/create`.** Pick stock, name, symbol, expiry (presets: 1 week / 2 weeks /
1 month), and curve defaults derived from spot price. Show a preview of the curve
and what the first buy costs.

### Copy

> Buy the story. When it expires, you get the stock.

---

## 11. Stack

- **Program:** Pinocchio (not Anchor). 1-byte discriminators. Zero-copy state,
  `#[repr(C)]`, **alignment 1** — every multi-byte integer stored as a
  little-endian byte array, since the payload starts at an odd offset after the
  `[discriminator, version]` header.
- **Wallets:** Privy. `chain` defaults to `solana:mainnet` when omitted —
  always pass `solana:devnet` explicitly. Devnet is a first-class chain in
  Privy's RPC registry, so targeting devnet removes the localnet workaround
  entirely. Sign with Privy, broadcast yourself.
- **Client:** `@solana/kit`. Hand-rolled instruction encoding and account
  decoders (no IDL). Build the client to real ESM + declarations — consuming it
  as TypeScript source does not resolve under Turbopack.
- **Stock tokens:** xStocks / Backed on Solana (8 decimals). What StonkFun uses.
- **Swaps:** Jupiter on mainnet, composed client-side into the buy transaction.
  See §12 for the devnet substitute.
- **RPC:** Helius (devnet).
- **Deploy:** Vercel. No backend — the discover page reads narratives with
  `getProgramAccounts` directly, which is fine at demo scale.
- **Tests:** LiteSVM for integration, plain unit tests for curve math.

---

## 12. Deployment

**Design for mainnet.** No demo shims in the protocol or the client — the thing
being built is the real system, deployed for real.

- **Stock tokens:** real xStocks (Backed) on Solana mainnet. 8 decimals.
- **Swaps:** real Jupiter, composed client-side into the buy transaction.
- **Frontend:** Vercel. No backend; the discover page reads narratives with
  `getProgramAccounts` via Helius.

Mock mints exist **only inside the test suite**, where LiteSVM controls the
clock and lets the whole lifecycle run in milliseconds. Nothing mock is part of
the design, ships to the client, or gets deployed.

Deploying to devnet first is a rollout decision, not a design one — the same
binary and the same client work against either cluster by changing the RPC and
the stock mint address. Privy treats devnet as a first-class chain, so no
workaround is needed there either.

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

## 14. Build order

1. Curve math + unit tests
2. `create_narrative`, `buy`
3. `expire` + freeze
4. `redeem` + the dust sweep
5. Full LiteSVM suite — every row in §9's "closed by design" table gets a test
6. `sell` + the tax — **the first thing to cut if scope runs long.** Buy →
   expire → redeem is the entire story being demonstrated; sell is a
   convenience.
7. Client + a localnet script that runs the whole lifecycle end to end
8. Deploy to devnet, mock mints, seed script (§12)
9. Frontend, `/n/[address]` first, then `/`, then `/create`
10. Vercel

Do not start the frontend until redeem works on localnet.

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
