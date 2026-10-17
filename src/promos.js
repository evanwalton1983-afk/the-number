// Boosts, bonus bets and second-chance bets, priced against the fair chances.
import { americanToDecimal, decimalToAmerican, evOf } from './odds.js';
import { sideChances, sidesOf } from './market.js';

// Profit boost: the winnings are multiplied by (1 + boost). 0.5 is a 50% boost.
export function boostedDecimal(american, boost) {
  const d = americanToDecimal(american);
  return Number.isFinite(d) ? 1 + (d - 1) * (1 + boost) : NaN;
}

// Value of a boosted bet. ch: { win, push, loss }.
export function boostValue(ch, american, boost, stake) {
  const dec = boostedDecimal(american, boost);
  const ev = ch.win * (dec - 1) - ch.loss;
  return { dec, american: decimalToAmerican(dec), ev, dollars: ev * stake };
}

// Bonus bet: a winning bonus bet pays only the winnings. Hedge the other side with cash so
// both outcomes pay the same: hedge = S (dA - 1) / dB, locked = S (dA - 1)(dB - 1) / dB.
export function bonusHedge(amount, bonusAmerican, hedgeAmerican) {
  const dA = americanToDecimal(bonusAmerican);
  const dB = americanToDecimal(hedgeAmerican);
  if (!(dA > 1 && dB > 1 && amount > 0)) return null;
  const hedge = (amount * (dA - 1)) / dB;
  const locked = hedge * (dB - 1);
  return { hedge, locked, rate: locked / amount };
}

// Every way to turn a bonus bet at one book into cash right now, best first: bonus on one side
// at the bonus book, cash on the exact other side at another of your books.
// opts: { minOdds (American, the bonus's minimum price, e.g. -200), now }
export function bonusOptions(games, fairs, bonusBook, hedgeBooks, amount, opts = {}) {
  const now = opts.now || Date.now();
  const out = [];
  for (const g of games) {
    if (Date.parse(g.start) <= now) continue;
    const b = g.books[bonusBook];
    if (!b) continue;
    for (const market of ['ml', 'spread', 'total']) {
      const entry = b[market];
      if (!entry) continue;
      const [s1, s2] = sidesOf(market);
      for (const [side, other] of [[s1, s2], [s2, s1]]) {
        const mine = entry[side];
        if (opts.minOdds && americanToDecimal(mine.price) < americanToDecimal(opts.minOdds)) continue;
        // The hedge must be the exact other side: same total, mirrored spread.
        let best = null;
        for (const hk of hedgeBooks) {
          if (hk === bonusBook || !g.books[hk] || !g.books[hk][market]) continue;
          const theirs = g.books[hk][market][other];
          if (market === 'spread' && theirs.line !== -mine.line) continue;
          if (market === 'total' && theirs.line !== mine.line) continue;
          if (!best || americanToDecimal(theirs.price) > americanToDecimal(best.price)) best = { ...theirs, book: hk };
        }
        if (!best) continue;
        const h = bonusHedge(amount, mine.price, best.price);
        if (!h) continue;
        const ch = fairs[g.id] ? sideChances(g.sport, market, fairs[g.id][market], side, mine.line) : null;
        out.push({
          gameId: g.id,
          sport: g.sport,
          start: g.start,
          home: g.home,
          away: g.away,
          market,
          side,
          line: mine.line,
          price: mine.price,
          link: mine.link || entry.link || null,
          hedgeSide: other,
          hedgeLine: best.line,
          hedgeBook: best.book,
          hedgePrice: best.price,
          hedgeLink: best.link || null,
          hedge: h.hedge,
          locked: h.locked,
          rate: h.rate,
          // Not hedging: the bonus bet's average value at fair chances.
          keepValue: ch ? ch.win * amount * (americanToDecimal(mine.price) - 1) : null,
          pushes: market !== 'ml' && Number.isInteger(mine.line),
        });
      }
    }
  }
  return out.sort((a, b) => b.rate - a.rate);
}

// Second-chance (no sweat) bet: if it loses, the book returns the stake, up to `cap`, as a
// bonus bet you can turn into cash at `rate` (about 0.7 with a good hedge).
export function secondChanceValue(ch, american, stake, cap, rate) {
  const cash = evOf(ch.win, ch.push, american) * stake;
  const refund = ch.loss * Math.min(stake, cap) * rate;
  return { dollars: cash + refund, cash, refund };
}
