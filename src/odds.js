// Price math: odds formats, removing the vig, expected value with pushes, and bet sizing.
// Pure functions, shared by the browser, the functions and the tests.
import { fairProbs, isFairMethod } from './fairprice.js';

export function americanToDecimal(american) {
  const a = Number(american);
  if (!Number.isFinite(a) || (a > -100 && a < 100)) return NaN;
  return a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
}

// Rounded to a whole American price, the way books show it. -100 shows as +100.
export function decimalToAmerican(dec) {
  if (!(dec > 1) || !Number.isFinite(dec)) return NaN;
  return dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1));
}

export function impliedProb(american) {
  const d = americanToDecimal(american);
  return Number.isFinite(d) ? 1 / d : NaN;
}

export function formatAmerican(american) {
  const a = Math.round(Number(american));
  if (!Number.isFinite(a)) return '';
  if (a === 100 || a === -100) return '+100';
  return a > 0 ? `+${a}` : String(a);
}

// "+105", "-110", "105", "ev" or "even" to a number; NaN if it is not a price.
export function parseAmerican(text) {
  const s = String(text == null ? '' : text).trim().toLowerCase().replace(/−/g, '-');
  if (s === 'ev' || s === 'even' || s === 'evens') return 100;
  if (!/^[+-]?\d{3,5}(\.\d+)?$/.test(s)) return NaN;
  const a = Number(s);
  return Math.abs(a) >= 100 ? a : NaN;
}

export function normCdf(z) {
  if (z === Infinity) return 1;
  if (z === -Infinity) return 0;
  // Abramowitz and Stegun 7.1.26 erf, max error 1.5e-7.
  const x = z / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + (x >= 0 ? y : -y));
}

export const DEVIG_METHODS = {
  power: 'Power',
  multiplicative: 'Proportional',
  shin: 'Shin',
  additive: 'Additive',
};

// Fair probabilities from one market's prices (all outcomes, American odds), by one of the four
// methods in fairprice.js. Power and Shin match real results better than proportional when
// prices are lopsided. An unknown method reads as power, as it always has.
export function devig(prices, method = 'power') {
  return fairProbs(prices.map(americanToDecimal), isFairMethod(method) ? method : 'power');
}

// Book's hold (overround) on a market, as a share of the money: 0.045 is 4.5%.
export function hold(prices) {
  const s = prices.map(impliedProb).reduce((a, b) => a + b, 0);
  return Number.isFinite(s) ? 1 - 1 / s : NaN;
}

// Expected profit per dollar staked. pWin + pPush + pLoss = 1; a push returns the stake.
export function evOf(pWin, pPush, american) {
  return evDecimal(pWin, pPush, americanToDecimal(american));
}

export function evDecimal(pWin, pPush, dec) {
  if (!(dec > 1)) return NaN;
  const pLoss = Math.max(0, 1 - pWin - pPush);
  return pWin * (dec - 1) - pLoss;
}

// The decimal price at which the bet breaks even.
export function fairDecimal(pWin, pPush = 0) {
  const pLoss = Math.max(0, 1 - pWin - pPush);
  if (!(pWin > 0)) return Infinity;
  return 1 + pLoss / pWin;
}

export function fairAmerican(pWin, pPush = 0) {
  return decimalToAmerican(fairDecimal(pWin, pPush));
}

// Share of bankroll that maximizes long-run growth (Kelly), with pushes:
// f = (b p - q) / (b (p + q)), b = decimal - 1. Zero when the bet has no edge.
export function kellyFraction(pWin, pPush, american) {
  const d = americanToDecimal(american);
  if (!Number.isFinite(d)) return 0;
  const b = d - 1;
  const q = Math.max(0, 1 - pWin - pPush);
  const f = (b * pWin - q) / (b * (pWin + q));
  return f > 0 && Number.isFinite(f) ? f : 0;
}

// Stake for one bet from the bankroll settings:
//  kelly: share of full Kelly to bet (0.25 is quarter Kelly)
//  minPct / maxPct: the smallest and largest bet as a share of bankroll
// Never more than full Kelly, so the minimum is skipped for tiny edges at long odds.
export function stakeFor(pWin, pPush, american, s) {
  const full = kellyFraction(pWin, pPush, american);
  if (!(full > 0) || !(s.bankroll > 0)) return { stake: 0, pct: 0, full, capped: false, floored: false };
  let pct = full * (s.kelly || 0.25);
  let floored = false;
  let capped = false;
  if (s.minPct > 0 && pct < s.minPct) {
    if (full >= s.minPct) {
      pct = s.minPct;
      floored = true;
    }
  }
  if (s.maxPct > 0 && pct > s.maxPct) {
    pct = s.maxPct;
    capped = true;
  }
  // Whole dollars, rounded down so a stake never tops the sizing rule.
  const stake = Math.max(0, Math.floor(s.bankroll * pct + 1e-9));
  return { stake, pct, full, capped, floored };
}

export const round2 = (x) => Math.round(x * 100) / 100;
