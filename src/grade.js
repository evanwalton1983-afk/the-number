// Logged bets: matching ESPN's games, grading finals, closing lines and closing line value.
import { americanToDecimal, decimalToAmerican, devig, evDecimal } from './odds.js';
import { centerFrom, chances, hasDists } from './dists.js';
import { findGame } from './espn.js';
import { SPORTS } from './sports.js';

// Canceled games are void at once. Postponed or suspended ones may still be played inside the
// books' window, so they stay open for three days before counting as void.
const VOID = /CANCELED|CANCELLED|FORFEIT/;
const LATER = /POSTPONED|SUSPENDED|DELAYED/;

// ESPN game for a bet, oriented so `flip` says whether ESPN lists our home team as away.
export function matchGame(bet, espnGames) {
  const hit = findGame(espnGames, bet.home, bet.away);
  if (!hit) return null;
  // A different day's meeting of the same teams is not this game.
  const t = Date.parse(hit.game.start);
  if (Number.isFinite(t) && Math.abs(t - Date.parse(bet.start)) > 30 * 3600 * 1000) return null;
  return { game: hit.game, flip: hit.aSide === 'away' };
}

function scores(game, flip) {
  const h = Number(game.home.score) || 0;
  const a = Number(game.away.score) || 0;
  return flip ? { home: a, away: h } : { home: h, away: a };
}

// 'won' | 'lost' | 'push' | 'void', or null while the game is not final.
export function gradeBet(bet, match, now = Date.now()) {
  if (!match) return null;
  const g = match.game;
  if (VOID.test(g.statusName || '')) return 'void';
  if (LATER.test(g.statusName || '')) return now - Date.parse(bet.start) > 3 * 86400e3 ? 'void' : null;
  if (g.state !== 'post' || !g.completed) return null;
  if (SPORTS[bet.sport].kind === 'fight') {
    if (g.winner === 'draw') return 'push';
    if (!g.winner) return null;
    const ourWinner = match.flip ? (g.winner === 'home' ? 'away' : 'home') : g.winner;
    return ourWinner === bet.side ? 'won' : 'lost';
  }
  const s = scores(g, match.flip);
  const margin = s.home - s.away;
  let x;
  if (bet.market === 'ml') x = bet.side === 'home' ? margin : -margin;
  else if (bet.market === 'spread') x = (bet.side === 'home' ? margin : -margin) + bet.line;
  else x = bet.side === 'over' ? s.home + s.away - bet.line : bet.line - (s.home + s.away);
  return x > 0 ? 'won' : x < 0 ? 'lost' : 'push';
}

// The exact decimal price: boosted bets keep theirs, since the American price is rounded.
export const decimalOf = (bet) => (bet.dec > 1 ? bet.dec : americanToDecimal(bet.price));

// Money won or lost on a graded bet. A bonus bet pays the winnings only and costs no cash.
export function profitOf(bet, result) {
  if (result === 'won') return Math.round(bet.stake * (decimalOf(bet) - 1) * 100) / 100;
  if (result === 'lost') return bet.bonus ? 0 : -bet.stake;
  return 0;
}

// Fair chances at the bet's line from a closing view: { market, value (center or home chance) }.
export function chancesAtClose(bet, close) {
  if (!close) return null;
  if (bet.market === 'ml') {
    const p = bet.side === 'home' ? close.value : 1 - close.value;
    return { win: p, push: 0, loss: 1 - p };
  }
  return chances(bet.sport, bet.market, close.value, bet.side, bet.line);
}

// The two prices for a two-way market when ESPN may leave one or both out: both missing reads as
// -110 each way (how its feed usually lists spreads and totals); one missing is filled so the
// pair carries the usual 4.8% margin.
function pairOf(a, b) {
  const ok = (x) => Number.isFinite(x) && Math.abs(x) >= 100;
  if (ok(a) && ok(b)) return [a, b];
  if (!ok(a) && !ok(b)) return [-110, -110];
  const known = ok(a) ? a : b;
  const other = decimalToAmerican(1 / Math.max(0.05, 1 + 1 / 21 - 1 / americanToDecimal(known)));
  return ok(a) ? [a, other] : [other, b];
}

// Closing view from ESPN's last line for the game (one book, vig removed).
export function closeFromEspn(bet, match, method = 'power') {
  if (!match || !match.game.odds) return null;
  const o = match.game.odds;
  const flip = match.flip;
  const provider = o.provider || 'ESPN';
  if (bet.market === 'ml') {
    let h = o.homeML;
    let a = o.awayML;
    if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
    if (flip) [h, a] = [a, h];
    const f = devig([h, a], method);
    return f ? { market: 'ml', value: f[0], source: 'espn', provider } : null;
  }
  if (!hasDists(bet.sport)) return null;
  if (bet.market === 'spread') {
    if (!Number.isFinite(o.spreadHome)) return null;
    let line = o.spreadHome;
    let [ph, pa] = pairOf(o.homeSpreadOdds, o.awaySpreadOdds);
    if (flip) [line, ph, pa] = [-line, pa, ph];
    const f = devig([ph, pa], method);
    return f ? { market: 'spread', value: centerFrom(bet.sport, 'spread', line, f[0]), line, source: 'espn', provider } : null;
  }
  if (!Number.isFinite(o.total)) return null;
  const f = devig(pairOf(o.overOdds, o.underOdds), method);
  return f ? { market: 'total', value: centerFrom(bet.sport, 'total', o.total, f[0]), line: o.total, source: 'espn', provider } : null;
}

// Closing line value: the bet's expected profit per dollar at the closing fair price.
export function clvOf(bet, close) {
  const ch = chancesAtClose(bet, close);
  return ch ? evDecimal(ch.win, ch.push, decimalOf(bet)) : null;
}

// Record summary for settled and closed bets.
export function summarize(bets) {
  const graded = bets.filter((b) => ['won', 'lost', 'push', 'void'].includes(b.result));
  const staked = graded.filter((b) => b.result !== 'void').reduce((a, b) => a + b.stake, 0);
  const profit = graded.reduce((a, b) => a + (b.profit || 0), 0);
  const expected = bets.filter((b) => b.result !== 'void').reduce((a, b) => a + b.stake * (b.evAtBet || 0), 0);
  const withClv = bets.filter((b) => Number.isFinite(b.clv) && b.result !== 'void');
  const n = withClv.length;
  const mean = n ? withClv.reduce((a, b) => a + b.clv, 0) / n : NaN;
  const sd = n > 1 ? Math.sqrt(withClv.reduce((a, b) => a + (b.clv - mean) ** 2, 0) / (n - 1)) : NaN;
  const se = n > 1 ? sd / Math.sqrt(n) : NaN;
  const beat = n ? withClv.filter((b) => b.clv > 0).length / n : NaN;
  const clvDollars = withClv.reduce((a, b) => a + b.stake * b.clv, 0);
  const clvStaked = withClv.reduce((a, b) => a + b.stake, 0);
  let verdict = 'none';
  let needed = null;
  if (n > 0 && n < 20) verdict = 'early';
  else if (n >= 20) {
    const lo = mean - 1.96 * se;
    const hi = mean + 1.96 * se;
    if (lo > 0) verdict = 'beating';
    else if (hi < 0) verdict = 'losing';
    else {
      verdict = 'unclear';
      if (Math.abs(mean) > 1e-6) needed = Math.max(0, Math.ceil(((1.96 * sd) / Math.abs(mean)) ** 2) - n);
    }
  }
  const won = graded.filter((b) => b.result === 'won').length;
  const lost = graded.filter((b) => b.result === 'lost').length;
  const pushed = graded.filter((b) => b.result === 'push').length;
  return {
    bets: bets.length,
    graded: graded.length,
    won,
    lost,
    pushed,
    staked,
    profit,
    roi: staked > 0 ? profit / staked : NaN,
    expected,
    clv: { n, mean, sd, se, lo: mean - 1.96 * se, hi: mean + 1.96 * se, beat, dollars: clvDollars, weighted: clvStaked > 0 ? clvDollars / clvStaked : NaN },
    verdict,
    needed,
  };
}
