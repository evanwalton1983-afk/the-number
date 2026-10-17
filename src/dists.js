// Final score distributions, used to price a line the market does not show from one it does:
// "Pinnacle has the Bills -3 at -112, so what is -2.5 at -125 worth?" Football margins land on
// 3 and 7 far more than a smooth curve says, so each sport's margin and total curves carry
// weights fitted on real closing lines and finals (scripts/fit-dists.mjs).
import { normCdf } from './odds.js';

// From scripts/fit-dists.mjs on 2015 to 2025 NFL closing lines and prices (nflverse), 1,600
// college football games, 2024-25 NBA and 2025 college basketball ESPN lines. Margin weights past
// 24 points are pulled halfway back to 1 (few games land there).
export const DISTS = {
  nfl: {
    margin: { sd: 12.3, tau: 1, prox: { 3: 0.3, 7: 0.3 }, w: [0.114, 0.787, 0.815, 2.473, 0.858, 0.829, 1.338, 1.655, 0.888, 0.356, 1.068, 0.501, 0.482, 0.549, 1.484, 0.502, 0.782, 1.288, 0.905, 0.497, 1.005, 1.203, 0.642, 0.896, 1.505, 0.99, 0.979, 0.921, 1.45, 0.892, 0.9, 1.604, 1.052, 0.874, 1.392, 1.769, 0.581, 1.573, 1.927, 0.792, 1.757, 0.946, 1.055, 1.196, 0.939] },
    total: { c: 1.97, intPush: 0.65 },
  },
  cfb: {
    margin: { sd: 15.6, tau: 1, prox: null, w: [0.004, 0.896, 0.69, 2.466, 0.876, 0.688, 0.894, 2.012, 0.834, 0.225, 1.129, 0.577, 0.35, 0.548, 1.282, 0.5, 0.413, 1.023, 0.994, 0.39, 0.477, 1.54, 0.467, 0.651, 1.252, 0.844, 0.705, 0.932, 1.359, 1.038, 0.756, 1.337, 0.99, 0.833, 1.134, 1.26, 0.646, 0.969, 1.172, 0.898, 0.656, 1.216, 1.502, 0.845, 0.661] },
    total: { c: 2.28 },
  },
  nba: {
    margin: { sd: 13.6, tau: 1, noTie: true, prox: null, w: null },
    total: { c: 1.21 },
  },
  ncaab: {
    margin: { sd: 10.9, tau: 1, noTie: true, prox: null, w: null },
    total: { c: 1.38 },
  },
};

// Probability of each final home margin (an integer).
// mu: center of the curve. ref: the market's line as a home margin (Bills -3 at home is +3);
// a favorite lined near a key number lands on it more often than the key's overall weight says,
// so that boost follows the line, not the center. Without ref the center stands in.
// par: { sd, w: weights by absolute margin, prox: { key: boost }, tau, noTie }
export function marginPMF(par, mu, ref = mu) {
  const sd = par.sd;
  const lo = Math.floor(mu - 6.5 * sd);
  const hi = Math.ceil(mu + 6.5 * sd);
  const n = hi - lo + 1;
  const p = new Array(n);
  const sign = ref >= 0 ? 1 : -1;
  const amu = Math.abs(ref);
  const tau2 = 2 * (par.tau || 1) ** 2;
  let prev = normCdf((lo - 0.5 - mu) / sd);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const m = lo + i;
    const next = normCdf((m + 0.5 - mu) / sd);
    let v = next - prev;
    prev = next;
    const k = Math.abs(m);
    if (par.w && k < par.w.length) v *= par.w[k];
    // A favorite lined near a key number lands on it more often than the key alone explains.
    if (par.prox && m * sign > 0 && par.prox[k]) v *= Math.exp(par.prox[k] * Math.exp(-((amu - k) ** 2) / tau2));
    if (par.noTie && m === 0) v = 0;
    p[i] = v;
    s += v;
  }
  for (let i = 0; i < n; i++) p[i] /= s;
  return { lo, p };
}

// Probability of each final total. The spread of totals grows with the size of the total.
// par: { c, intPush } with sd = c * sqrt(center). A total lined on a whole number lands on it
// less often than the curve says (books settle on whole numbers where landing is unlikely), so
// when ref is a whole number its share is scaled by intPush.
export function totalPMF(par, center, ref = null) {
  const sd = par.c * Math.sqrt(Math.max(4, center));
  const lo = Math.max(0, Math.floor(center - 6.5 * sd));
  const hi = Math.ceil(center + 6.5 * sd);
  const n = hi - lo + 1;
  const p = new Array(n);
  const damp = par.intPush && Number.isInteger(ref) ? ref : null;
  let prev = normCdf((lo - 0.5 - center) / sd);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const t = lo + i;
    const next = normCdf((t + 0.5 - center) / sd);
    let v = next - prev;
    prev = next;
    if (t === damp) v *= par.intPush;
    p[i] = v;
    s += v;
  }
  for (let i = 0; i < n; i++) p[i] /= s;
  return { lo, p };
}

// P(X > x), P(X = x), P(X < x) for a real threshold x.
export function split(d, x) {
  let gt = 0;
  let eq = 0;
  let lt = 0;
  for (let i = 0; i < d.p.length; i++) {
    const k = d.lo + i;
    if (k > x + 1e-9) gt += d.p[i];
    else if (k >= x - 1e-9) eq += d.p[i];
    else lt += d.p[i];
  }
  return { gt, eq, lt };
}

function bisect(f, lo, hi, iters = 40) {
  let a = lo;
  let b = hi;
  for (let i = 0; i < iters; i++) {
    const m = (a + b) / 2;
    if (f(m) < 0) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

// Chance the home side covers homeLine, leaving out pushes (how a two-way price reads).
function homeCoverShare(d, homeLine) {
  const r = split(d, -homeLine);
  return r.gt / (r.gt + r.lt);
}

function overShare(d, line) {
  const r = split(d, line);
  return r.gt / (r.gt + r.lt);
}

// The margin center that makes the home side cover homeLine with chance pHome (pushes left out).
export function solveMargin(par, homeLine, pHome) {
  const p = Math.min(0.995, Math.max(0.005, pHome));
  return bisect((mu) => homeCoverShare(marginPMF(par, mu, -homeLine), homeLine) - p, -homeLine - 45, -homeLine + 45);
}

export function solveTotal(par, line, pOver) {
  const p = Math.min(0.995, Math.max(0.005, pOver));
  return bisect((c) => overShare(totalPMF(par, c, line), line) - p, Math.max(1, line - 60), line + 60);
}

// Win, push and loss chances for one side at one line.
// market 'spread': side 'home' or 'away', line from that side ("-3.5" for a 3.5 point favorite).
// market 'total': side 'over' or 'under'.
export function outcome(d, market, side, line) {
  if (market === 'spread') {
    if (side === 'home') {
      const r = split(d, -line);
      return { win: r.gt, push: r.eq, loss: r.lt };
    }
    const r = split(d, line);
    return { win: r.lt, push: r.eq, loss: r.gt };
  }
  const r = split(d, line);
  return side === 'over' ? { win: r.gt, push: r.eq, loss: r.lt } : { win: r.lt, push: r.eq, loss: r.gt };
}

export function hasDists(sport) {
  return !!DISTS[sport];
}

// The market's view behind a two-way price: { mu, ref }, the curve's center and the line it
// came from (as a home margin for spreads, the total for totals).
// market 'spread': line is the home line, p the home side's no-vig chance.
// market 'total': line is the total, p the over's no-vig chance.
export function centerFrom(sport, market, line, p) {
  const D = DISTS[sport];
  if (!D || !Number.isFinite(line) || !(p > 0 && p < 1)) return null;
  return market === 'spread' ? { mu: solveMargin(D.margin, line, p), ref: -line } : { mu: solveTotal(D.total, line, p), ref: line };
}

const pmfCache = new Map();
function pmfFor(sport, market, c) {
  const key = `${sport}|${market}|${c.mu.toFixed(4)}|${c.ref}`;
  let d = pmfCache.get(key);
  if (!d) {
    const D = DISTS[sport];
    d = market === 'spread' ? marginPMF(D.margin, c.mu, c.ref) : totalPMF(D.total, c.mu, c.ref);
    if (pmfCache.size > 4000) pmfCache.clear();
    pmfCache.set(key, d);
  }
  return d;
}

// Win, push and loss chances for a side and line, given the market's view { mu, ref }.
export function chances(sport, market, c, side, line) {
  if (!DISTS[sport] || !c || !Number.isFinite(c.mu) || !Number.isFinite(line)) return null;
  return outcome(pmfFor(sport, market, c), market, side, line);
}
