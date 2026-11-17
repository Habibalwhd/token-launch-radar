// Token Radar's value model: one sealed snapshot in, one ranked board out.
//
// The board ranks pre-token protocols only. It covers every slug on the snapshot's
// watchlist (the floor, never the ceiling) and adds every other protocol the
// eligibility rule keeps, strongest TVL first, up to EARLY_ROWS. A protocol is
// eligible only when it meets every clause of the house watchlist rule
// (isEligiblePreToken), applied to every board row, not just the watchlist: its
// record carries no token at all (no market cap, no CoinGecko id, no symbol), its
// category is none of Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking,
// Restaked BTC or CEX, and contains no "bridge" in any wording (a "Cross Chain
// Bridge" is a bridge product even though the list names only Bridge and
// Canonical Bridge), its name carries no whole word wrapped, staked or staking,
// ends in no version marker, and begins with no exchange name. The snapshot's ten
// fields carry no parent protocol, so that clause of the house rule cannot be
// checked and is not invented. The floor is where the house's reading started, not
// a ceiling: a protocol above the floor the watchlist leaves out is ranked on the
// same terms. Protocols whose token already trades are kept apart in the live set
// and are never mixed into the ranked board.
//
// Implied value is derived only from the snapshot's own figures, never from a list of
// names. For a protocol with TVL T, seven-day change G, age A in days since it was
// first tracked, C chains and category K:
//
//   base        = T x 0.30
//   growth      = clamp(G, -50, 150) per cent; unknown growth counts as 0
//   growthMult  = 1 + (growth / 100) x 0.60
//   ageMult     = 0.70 + 0.30 x min(A, 730) / 730; unknown age counts as 365 days
//   breadthMult = 1 + 0.03 x min(C - 1, 4)
//   categoryMult = 1.05 when the category captures fees directly (Dexs, Lending,
//                  Derivatives, Yield, CDP, Leveraged Farming, Basis Trading,
//                  Yield Aggregator), 0.95 when it wraps or bridges another asset
//                  (Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking,
//                  Restaked BTC, Staking Pool), 1.00 otherwise
//   implied     = max(1, round(base x growthMult x ageMult x breadthMult x categoryMult))
//
// Ranks are assigned by implied value, highest first, ties broken by slug so the
// order is stable; where two rows still tie on value, the lower one is stepped down
// by a dollar at a time until the board is strictly decreasing, so rank 1 is always
// the board's most valuable protocol and no two rows share a value.

/** One protocol as the sealed snapshot carries it: exactly its ten fields. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  age_floor: number;
  age_range: number;
  age_cap_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_extra_chains: number;
  category_fee_capture: number;
  category_wrapper: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.3,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 150,
  age_floor: 0.7,
  age_range: 0.3,
  age_cap_days: 730,
  unknown_age_days: 365,
  breadth_per_chain: 0.03,
  breadth_max_extra_chains: 4,
  category_fee_capture: 1.05,
  category_wrapper: 0.95,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'value-2';

/** How many eligible protocols outside the watchlist the board adds at most, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the dashboard's live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_usd: number;
    growth_pct: number;
    growth_multiplier: number;
    age_multiplier: number;
    breadth_multiplier: number;
    category_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A board row's compact form for data.js, carrying the exact farm plan. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  base_usd: number;
  growth_multiplier: number;
  age_multiplier: number;
  breadth_multiplier: number;
  category_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  watchlist: string[];
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Categories that capture fees directly from the activity they host. */
const FEE_CAPTURE = new Set([
  'dexs',
  'lending',
  'derivatives',
  'yield',
  'yield aggregator',
  'cdp',
  'leveraged farming',
  'basis trading',
  'perpetuals',
  'options',
  'interest rate derivatives',
]);

/** Categories that wrap, stake or bridge an asset whose token already trades. */
const WRAPPER = new Set([
  'bridge',
  'canonical bridge',
  'cross chain bridge',
  'liquid staking',
  'liquid restaking',
  'restaked btc',
  'staking pool',
  'restaking',
]);

/** A category's multiplier: fee-capturing categories earn more per TVL dollar. */
function categoryMultiplier(category: string | null, model: ModelConstants): number {
  const c = (category ?? '').toLowerCase();
  if (FEE_CAPTURE.has(c)) return model.category_fee_capture;
  if (WRAPPER.has(c)) return model.category_wrapper;
  return 1;
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; base: number; growthPct: number; growthMult: number; ageMult: number; breadthMult: number; categoryMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const ageMult =
    model.age_floor + (Math.min(Math.max(ageForModel, 0), model.age_cap_days) / model.age_cap_days) * model.age_range;
  const extraChains = Math.max(0, Math.min(protocol.chains.length - 1, model.breadth_max_extra_chains));
  const breadthMult = 1 + model.breadth_per_chain * extraChains;
  const categoryMult = categoryMultiplier(protocol.category, model);
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * ageMult * breadthMult * categoryMult));
  return { implied, base: Math.round(base), growthPct, growthMult, ageMult, breadthMult, categoryMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a wrapped, staked or bridged product of a token that already trades. */
const INELIGIBLE_CATEGORIES = new Set([
  'bridge',
  'canonical bridge',
  'liquid staking',
  'liquid restaking',
  'restaked btc',
  'cex',
]);

/** Any category containing "bridge" is a bridge product in any wording: "Cross
 * Chain Bridge" is a bridge even though the house rule's list names only Bridge
 * and Canonical Bridge, so the substring, not the list, is the test. */
const BRIDGE_CATEGORY = /bridge/i;

/** A name carrying wrapped, staked or staking as a whole word is such a product. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Exchange names: a protocol beginning with one is the exchange's own product. */
const EXCHANGE_PREFIX = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: it meets every clause of the
 * house watchlist rule. The rule's parent-protocol clause cannot be checked:
 * parentProtocol is not one of the snapshot's ten fields, so it is not invented
 * here — the list is what the rule produced from the fields the snapshot carries.
 * The category clause is the six disallowed categories plus any category
 * containing "bridge": the rule's intent is that bridges are out, and a
 * category spelled "Cross Chain Bridge" is a bridge product even though the
 * list names only Bridge and Canonical Bridge.
 */
export function isEligiblePreToken(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (INELIGIBLE_CATEGORIES.has((p.category ?? '').toLowerCase())) return false;
  if (BRIDGE_CATEGORY.test(p.category ?? '')) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The protocols the board ranks, strongest first, with ranks 1..n and strictly falling values. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, even one the snapshot no longer
  // carries (it cannot, but coverage is the gate's row and is never gambled). The
  // eligibility rule applies to watchlist rows too; on this snapshot all 40 pass it.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined && isEligiblePreToken(p)) chosen.set(slug, p);
  }
  // The early radar: every other protocol the eligibility rule keeps, strongest TVL
  // first, capped. The floor is where the house's reading started, not a ceiling:
  // a protocol above the floor the watchlist leaves out is ranked on the same terms,
  // and on this snapshot the rule keeps fewer than the cap, so the board holds every
  // eligible pre-token protocol there is.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isEligiblePreToken(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  // Strictly decreasing values: a tie steps the lower row down a dollar at a time, so
  // the ranking is a ranking and not a shared value with two ranks.
  let prev = Number.POSITIVE_INFINITY;
  return scored.map((s, i) => {
    let value = s.v.implied;
    if (value >= prev) value = Math.max(1, prev - 1);
    prev = value;
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      age_days: s.v.age,
      implied_value_usd: value,
      model: {
        base_usd: s.v.base,
        growth_pct: s.v.growthPct,
        growth_multiplier: round4(s.v.growthMult),
        age_multiplier: round4(s.v.ageMult),
        breadth_multiplier: round4(s.v.breadthMult),
        category_multiplier: round4(s.v.categoryMult),
        age_days: s.v.age,
      },
      farm_steps: farmSteps(s.p, s.v.age).map(stepText),
    };
  });
}

/** A step as one string: its action, then its cost and time, within 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 2_000_000_000) return 300;
  if (p.tvl_usd >= 500_000_000) return 200;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * A category family's farm verbs: the core position and the weekly qualifying action.
 * The family is matched on the category's words, never on a protocol's name.
 */
function familyFor(p: SnapshotProtocol): { core: string; weekly: string } {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return {
      core: `Supply the capital as collateral on ${name} and borrow a small amount against it to show both sides of the book`,
      weekly: 'make one borrow or repayment, or top up the collateral by a few dollars',
    };
  }
  if (c.includes('dex') || c.includes('leveraged farm')) {
    return {
      core: `Provide the capital as liquidity in ${name}'s deepest pool and keep the position in range`,
      weekly: 'swap a small amount through the pool or rebalance the range once',
    };
  }
  if (c.includes('yield') || c.includes('liquidity manager') || c.includes('allocator') || c.includes('curator') || c.includes('index')) {
    return {
      core: `Deposit the capital into a ${name} vault and hold the vault shares`,
      weekly: 'deposit a few dollars more or move the shares into the vault\'s newest strategy',
    };
  }
  if (c.includes('bridge') || c.includes('cross chain')) {
    return {
      core: `Bridge the capital through ${name} and put the bridged funds to work in the destination app`,
      weekly: 'bridge a small amount back or across again to keep the route active',
    };
  }
  if (c.includes('stak') || c.includes('restak')) {
    return {
      core: `Stake the capital through ${name} and keep the staking receipt`,
      weekly: 'restake the rewards or top up the stake by a few dollars',
    };
  }
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options') || c.includes('interest rate')) {
    return {
      core: `Deposit the capital as margin on ${name} and open one small hedged position`,
      weekly: 'adjust the hedge or open one small trade to keep the account active',
    };
  }
  if (c.includes('prediction')) {
    return {
      core: `Fund the account on ${name} and take one small position in an open market`,
      weekly: 'place one small position in a new market',
    };
  }
  if (c.includes('rwa') || c.includes('stable') || c.includes('dual-token')) {
    return {
      core: `Mint or buy the capital's worth of ${name}'s yield asset and hold it`,
      weekly: 'claim the yield and roll it back into the same asset',
    };
  }
  if (c.includes('insurance')) {
    return {
      core: `Buy cover from ${name} for the capital and keep the policy live`,
      weekly: 'check the policy and renew or extend it before it lapses',
    };
  }
  if (c.includes('basis')) {
    return {
      core: `Deposit the capital into ${name}'s basis trade and hold the position`,
      weekly: 'check the funding rate and roll the position when the term ends',
    };
  }
  if (c.includes('chain')) {
    return {
      core: `Bridge the capital onto the chain ${name} runs and use it in its native app`,
      weekly: 'use one native app on the chain, such as a swap or a deposit',
    };
  }
  if (c.includes('farm')) {
    return {
      core: `Stake the capital in ${name}'s farm and keep the LP tokens staked`,
      weekly: 'claim the farm rewards and restake them',
    };
  }
  if (c.includes('payment') || c.includes('card')) {
    return {
      core: `Top up ${name} with the capital and spend a small amount through it`,
      weekly: 'spend a small amount or top the balance up again',
    };
  }
  if (c.includes('privacy')) {
    return {
      core: `Deposit the capital into ${name}'s shielded pool and keep the note safe`,
      weekly: 'make one shielded deposit or withdrawal to keep the pool active',
    };
  }
  if (c.includes('governance')) {
    return {
      core: `Deposit the capital with ${name} and vote in its next proposal`,
      weekly: 'vote in any open proposal or delegate the vote',
    };
  }
  return {
    core: `Deposit the capital into ${name} and keep the position open`,
    weekly: 'make one deposit, swap or vote to keep the account active',
  };
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. Every
 * step is derived from the protocol's own record (category, chains, TVL, age), never
 * from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const family = familyFor(p);
  const gas = capital >= 200 ? 8 : 4;
  return [
    {
      text: `Set up a fresh wallet on ${chain} that holds only the funds you plan to farm with ${p.name}, and write its seed phrase on paper, never in a chat or a file.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: `${family.core} on ${chain}.`,
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Once a week, ${family.weekly}.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot of the protocol.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw anything, open ${p.name}'s own points or rewards page from the link the protocol itself publishes, and check the wallet is the one you farmed with.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction hash in a farm log, and plan the exit: unwind in two or three steps and keep enough gas on ${chain} to withdraw.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan and the model breakdown. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    base_usd: row.model.base_usd,
    growth_multiplier: row.model.growth_multiplier,
    age_multiplier: row.model.age_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    category_multiplier: row.model.category_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    watchlist: [...snapshot.watchlist],
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  const index = bySlug(snapshot.protocols);
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.gecko_id !== null || r.symbol !== null || r.mcap_usd !== null) return `${r.slug} records a token and is not pre-token`;
    const p = index.get(r.slug);
    if (p === undefined || !isEligiblePreToken(p)) return `${r.slug} fails the eligibility rule`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
