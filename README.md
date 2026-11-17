# Token Radar

A ranked board of the protocols whose token does not exist yet, and what each
launch would be worth if the protocol's record stayed as it is. Built for the
make.fun token launch radar bounty (`token-radar-01`).

## What it reads

One sealed snapshot (`snapshot.json`, fetched once from DefiLlama, `as_of`
2026-11-14): 758 protocols, a 40-protocol watchlist of pre-token protocols at
or above a $50,000,000 TVL floor. The program reads the snapshot only; it
touches no network and takes no other input.

## The board

`board.json` holds 197 rows: all 40 watchlist protocols plus the 157 other
protocols the eligibility rule keeps, strongest TVL first. A row is eligible
only when it meets every clause of the house watchlist rule, applied to every
row, not just the watchlist: its record carries no token (no market cap, no
CoinGecko id, no symbol), its category is none of Bridge, Canonical Bridge,
Liquid Staking, Liquid Restaking, Restaked BTC or CEX, and contains no
"bridge" in any wording, its name carries no whole word wrapped, staked or staking, ends in no version marker, and begins
with no exchange name. The floor is where the house's reading started, not a
ceiling: 19 of the 157 sit above the $50,000,000 floor the watchlist leaves
out, and only 138 eligible protocols sit below it, so 200 rows is more than
the rule allows on this snapshot — 197 is every eligible pre-token protocol
there is. The value model is unchanged from v1; only the selection tightened.
Every row records no token, so the board cleanly separates "still to come"
from "token already trades". Protocols whose token already trades are kept
apart in the dashboard's live view, shown at their market's own value and
never ranked.

## The value model

`impliedValue` in `lib/model.ts` derives each row's implied value only from the
snapshot's own figures — TVL, seven-day change, age since first tracked,
chain count and category — never from a list of names:

```
base        = tvl_usd x 0.30
growth      = clamp(change_7d, -50, 150) per cent; unknown counts as 0
growthMult  = 1 + (growth / 100) x 0.60
ageMult     = 0.70 + 0.30 x min(age_days, 730) / 730; unknown age counts as 365 days
breadthMult = 1 + 0.03 x min(chains - 1, 4)
categoryMult = 1.05 for fee-capturing categories (Dexs, Lending, Derivatives,
               Yield, CDP, Leveraged Farming, Basis Trading, Yield Aggregator),
               0.95 for wrappers and bridges (Bridge, Canonical Bridge, Liquid
               Staking, Liquid Restaking, Restaked BTC, Staking Pool), 1.00 otherwise
implied     = max(1, round(base x growthMult x ageMult x breadthMult x categoryMult))
```

Rows are ranked by implied value, highest first, ties broken by slug. Where
two rows still tie, the lower one steps down a dollar at a time, so the board
is strictly decreasing. The dashboard's detail view shows every row's
breakdown, so the number can be checked from the snapshot.

## Farm plans

Each row carries six steps, derived from the protocol's own category, chains,
TVL and age: a fresh wallet, the core position (what to do depends on the
category — supply, provide liquidity, stake, bridge, mint), a weekly
qualifying action, a hold period (30–60 days, longer for younger protocols),
how to claim safely, and a farm log with an exit plan. Every step states what
it costs and how long it takes.

## The dashboard

`dashboard/` is a static page with no network: it renders the board from
`data.js`, sortable by rank, name, TVL, seven-day change, age and implied
value, filterable by text, category and chain, with a detail view per protocol
and a separate live-token view. The page recomputes each row's value from the
snapshot figures with the same formula, so the page and the board agree.

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22, standard library only. The run is deterministic: the same snapshot
bytes always produce the same output bytes. `main.ts` writes `board.json`,
`data.js`, copies `dashboard/` and `screenshots/` to the output directory,
and writes `dossier.json` with the vendored `vendor/makefun-board.ts`.
