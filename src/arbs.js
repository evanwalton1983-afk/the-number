// Arbs and middles across the books you bet at, from prices already scanned (no extra calls).
//
// Arb: the best price on each side of one line, with the inverse decimal odds adding up to less
// than 1. ROI = 1 / sum - 1, and a stake splits in proportion to each inverse (the method of
// MIT licensed DeliciousPipe1326/arbitrage-scanner; its page shows no copyright line), here with
// whole dollar stakes chosen so the two payouts come out as close to equal as rounding allows.
//
// Middle: a spread or total hung at different lines at two books (+3.5 at one, -2.5 at the
// other). Both bets win when the result lands in the gap. NFL spreads use Gridiron's key number
// table (keynum.js); everything else uses a normal curve with a standard deviation per sport
// that Settings lets you edit.
import { americanToDecimal, normCdf } from './odds.js';
import { KEYNUM } from './keynum.js';
import { SPORTS, isVirginiaSchool } from './sports.js';

// Standard deviation of the final margin and total, from the checks in the README.
export const DEFAULT_SD = {
  nfl: { spread: 12.7, total: 13.2 },
  cfb: { spread: 16.1, total: 16.6 },
  nba: { spread: 13.7, total: 18 },
  ncaab: { spread: 11.1, total: 16 },
  ufc: { spread: 1, total: 1 },
};

export const sdKey = (sport, market) => `sd_${sport}_${market}`;

// The standard deviation to use: the setting when it is a positive number, else the default.
export function sdOf(settings, sport, market) {
  const v = Number(settings && settings[sdKey(sport, market)]);
  if (v > 0 && Number.isFinite(v)) return v;
  return (DEFAULT_SD[sport] && DEFAULT_SD[sport][market]) || 12;
}

const SIDES = { ml: ['home', 'away'], spread: ['home', 'away'], total: ['over', 'under'] };
const MS_MIN = 60000;

// How old a price is: since its book last updated it, else since the scan that brought it.
export function priceAge(entry, game, now) {
  const t = Date.parse(entry.updated);
  const at = Number.isFinite(t) ? t : game.scannedAt;
  return Number.isFinite(at) ? Math.max(0, now - at) : 0;
}

// staleMin 0 means never hide.
const isStale = (age, staleMin) => staleMin > 0 && age > staleMin * MS_MIN;

// ------------------------------------------------------------ arbs

// Whole dollar stakes for a total, leaving the same payout whichever side wins as nearly as
// whole dollars allow. Of the splits, the one with the best guaranteed payout wins; ties go to
// the closer payouts.
export function splitStake(total, decA, decB) {
  const T = Math.floor(total);
  if (!(T >= 2) || !(decA > 1) || !(decB > 1)) return null;
  let best = null;
  for (let a = 1; a < T; a++) {
    const b = T - a;
    const payA = a * decA;
    const payB = b * decB;
    const floor = Math.min(payA, payB);
    const gap = Math.abs(payA - payB);
    if (!best || floor > best.floor + 1e-9 || (Math.abs(floor - best.floor) <= 1e-9 && gap < best.gap)) best = { a, b, payA, payB, floor, gap };
  }
  return { stakeA: best.a, stakeB: best.b, payA: best.payA, payB: best.payB, profit: best.floor - T };
}

function legOf(game, book, market, side, entry, now) {
  const o = entry[side];
  return { book, side, line: market === 'ml' ? null : o.line, price: o.price, dec: americanToDecimal(o.price), age: priceAge(entry, game, now), link: o.link || entry.link || null };
}

// Every arb in the games, best ROI first. books: the keys the user bets at.
// opts: { now, staleMin, minEv (dollars per $100), total, hideVA }
export function findArbs(games, books, opts = {}) {
  const now = opts.now || Date.now();
  const total = opts.total > 0 ? opts.total : 100;
  const out = [];
  for (const g of games) {
    if (Date.parse(g.start) <= now) continue;
    if (opts.hideVA && SPORTS[g.sport].college && (isVirginiaSchool(g.home) || isVirginiaSchool(g.away))) continue;
    for (const market of ['ml', 'spread', 'total']) {
      const [sa, sb] = SIDES[market];
      // Best fresh price per side, per line (a spread's key is the home line; a total's the total).
      const lines = new Map();
      for (const k of books) {
        const entry = g.books[k] && g.books[k][market];
        if (!entry) continue;
        const key = market === 'ml' ? '' : market === 'spread' ? String(entry.home.line) : String(entry.over.line);
        const slot = lines.get(key) || {};
        for (const side of [sa, sb]) {
          const leg = legOf(g, k, market, side, entry, now);
          if (!(leg.dec > 1) || isStale(leg.age, opts.staleMin)) continue;
          if (!slot[side] || leg.dec > slot[side].dec) slot[side] = leg;
        }
        lines.set(key, slot);
      }
      for (const slot of lines.values()) {
        const a = slot[sa];
        const b = slot[sb];
        if (!a || !b || a.book === b.book) continue;
        const inv = 1 / a.dec + 1 / b.dec;
        if (!(inv < 1)) continue;
        const roi = 1 / inv - 1;
        const split = splitStake(total, a.dec, b.dec);
        out.push({ kind: 'arb', gameId: g.id, sport: g.sport, start: g.start, home: g.home, away: g.away, market, legs: [a, b], roi, ev: roi * 100, split, thin: !split || !(split.profit > 1e-9), age: Math.max(a.age, b.age) });
      }
    }
  }
  // An arb that whole dollars leave without a guaranteed profit (thin) goes below the rest.
  return out.filter((x) => x.ev >= (opts.minEv || 0)).sort((x, y) => (x.thin - y.thin) || (y.roi - x.roi));
}

// ------------------------------------------------------------ middles

// Chance of each integer result (a home margin or a game total), as { lo, p }.
function normalPMF(mu, sd) {
  const lo = Math.floor(mu - 6.5 * sd);
  const hi = Math.ceil(mu + 6.5 * sd);
  const p = [];
  let prev = normCdf((lo - 0.5 - mu) / sd);
  let sum = 0;
  for (let m = lo; m <= hi; m++) {
    const next = normCdf((m + 0.5 - mu) / sd);
    p.push(next - prev);
    prev = next;
    sum += p[p.length - 1];
  }
  return { lo, p: p.map((v) => v / sum) };
}

// An NFL home margin from the key number table for a game lined at about mu (home margin), or
// null past the 14.5 the table covers.
function nflMarginPMF(mu) {
  const S = Math.abs(mu);
  if (S > 14.5) return null;
  const row = KEYNUM.pmf[Math.round(S * 2)];
  if (!row) return null;
  const sign = mu >= 0 ? 1 : -1;
  const lo = Math.min(sign * KEYNUM.margin_min, sign * KEYNUM.margin_max);
  const hi = Math.max(sign * KEYNUM.margin_min, sign * KEYNUM.margin_max);
  const p = new Array(hi - lo + 1).fill(0);
  row.forEach((v, i) => {
    const home = sign * (KEYNUM.margin_min + i);
    p[home - lo] += v / KEYNUM.scale;
  });
  const sum = p.reduce((s, v) => s + v, 0);
  return { lo, p: p.map((v) => v / sum) };
}

// Profit on a $1 stake for a leg that wins when the result is past its edge (past: result minus
// the edge, positive for a win, zero for a push).
const payoff = (past, dec) => (past > 1e-9 ? dec - 1 : past < -1e-9 ? -1 : 0);

// The middle of two bets. A wins when the result is above `a`, B when it is below `b`.
// stake: dollars on each side. Returns null when no whole number result sits in the gap.
export function middleOf({ sport, market, a, b, decA, decB, sd, stake = 50 }) {
  if (!(b > a) || !(decA > 1) || !(decB > 1)) return null;
  const mu = (a + b) / 2;
  let d = null;
  let method = 'normal';
  if (sport === 'nfl' && market === 'spread') {
    d = nflMarginPMF(mu);
    if (d) method = 'keynum';
  }
  if (!d) d = normalPMF(mu, sd);
  let inGap = 0;
  let ev = 0;
  d.p.forEach((p, i) => {
    const r = d.lo + i;
    if (r > a + 1e-9 && r < b - 1e-9) inGap += p;
    ev += p * (stake * payoff(r - a, decA) + stake * payoff(b - r, decB));
  });
  if (!(inGap > 0) || !d.p.some((_, i) => d.lo + i > a + 1e-9 && d.lo + i < b - 1e-9)) return null;
  const hit = stake * (decA - 1) + stake * (decB - 1);
  const miss = Math.min(stake * (decA - 1) - stake, stake * (decB - 1) - stake);
  return { chance: inGap, ev, hit, miss, method, gap: b - a, stake };
}

// Every middle in the games, highest EV per $100 staked first ($50 on each side), at most
// two per game and market. opts: { now, staleMin, minEv, settings, hideVA }
export function findMiddles(games, books, opts = {}) {
  const now = opts.now || Date.now();
  const out = [];
  for (const g of games) {
    if (Date.parse(g.start) <= now) continue;
    if (opts.hideVA && SPORTS[g.sport].college && (isVirginiaSchool(g.home) || isVirginiaSchool(g.away))) continue;
    if (!SPORTS[g.sport].markets.includes('spreads')) continue;
    for (const market of ['spread', 'total']) {
      const [sa, sb] = SIDES[market];
      const sd = sdOf(opts.settings, g.sport, market);
      const found = [];
      for (const kx of books) {
        for (const ky of books) {
          if (kx === ky) continue;
          const ex = g.books[kx] && g.books[kx][market];
          const ey = g.books[ky] && g.books[ky][market];
          if (!ex || !ey) continue;
          const A = legOf(g, kx, market, sa, ex, now);
          const B = legOf(g, ky, market, sb, ey, now);
          if (isStale(A.age, opts.staleMin) || isStale(B.age, opts.staleMin)) continue;
          // A wins above a, B below b: spread home +3.5 wins above -3.5; away -2.5 wins below -2.5.
          const a = market === 'spread' ? -A.line : A.line;
          const b = B.line;
          const m = middleOf({ sport: g.sport, market, a, b, decA: A.dec, decB: B.dec, sd });
          if (!m) continue;
          found.push({ kind: 'middle', gameId: g.id, sport: g.sport, start: g.start, home: g.home, away: g.away, market, legs: [A, B], ...m, age: Math.max(A.age, B.age) });
        }
      }
      found.sort((x, y) => y.ev - x.ev);
      out.push(...found.slice(0, 2));
    }
  }
  return out.filter((x) => x.ev >= (opts.minEv || 0)).sort((x, y) => y.ev - x.ev);
}
