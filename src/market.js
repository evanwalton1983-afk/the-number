// The Odds API events to games, fair prices and edges.
//
// Fair price: the sharp book's two-way price with the vig removed (Pinnacle by default). When it
// does not have a market, the median of every book's no-vig price stands in, and edges from it
// have to clear a higher bar. A book hanging a different line (-2.5 against Pinnacle's -3) is
// priced through the fitted score distributions in dists.js, so the half point is worth what
// it is really worth.
//
// Each fair view also keeps the market under all four methods of removing the vig, so the EV
// gate can hold an edge to its worst case: the lowest fair chance of the four for that side.
import { devig, evOf, fairAmerican, kellyFraction, stakeFor, hold } from './odds.js';
import { FAIR_METHODS } from './fairprice.js';
import { centerFrom, chances, hasDists } from './dists.js';
import { SPORTS, BOOKS, isVirginiaSchool } from './sports.js';

export const MARKETS = { ml: 'Moneyline', spread: 'Spread', total: 'Total' };

const API_MARKET = { h2h: 'ml', spreads: 'spread', totals: 'total' };

// One Odds API event to { id, sport, start, home, away, books: { key: { ml, spread, total } } }.
export function parseEvent(ev, sport) {
  const game = {
    id: String(ev.id),
    sport,
    start: ev.commence_time,
    home: ev.home_team,
    away: ev.away_team,
    books: {},
  };
  for (const b of ev.bookmakers || []) {
    const book = { key: b.key, title: (BOOKS[b.key] && BOOKS[b.key].title) || b.title || b.key, updated: b.last_update || null, link: b.link || null };
    for (const m of b.markets || []) {
      const kind = API_MARKET[m.key];
      if (!kind) continue;
      const outs = m.outcomes || [];
      const pick = (name) => outs.find((o) => o.name === name);
      const numOrNull = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
      const side = (o) => {
        const price = o ? numOrNull(o.price) : null;
        return price != null && Math.abs(price) >= 100 ? { price, line: numOrNull(o.point), link: o.link || null } : null;
      };
      let entry = null;
      if (kind === 'ml') {
        const h = side(pick(game.home));
        const a = side(pick(game.away));
        if (h && a) entry = { home: h, away: a };
      } else if (kind === 'spread') {
        const h = side(pick(game.home));
        const a = side(pick(game.away));
        // Both sides of a spread mirror each other; anything else is a feed glitch.
        if (h && a && h.line != null && a.line != null && Math.abs(h.line + a.line) < 1e-9) entry = { home: h, away: a };
      } else {
        const o = side(pick('Over'));
        const u = side(pick('Under'));
        if (o && u && o.line != null && o.line === u.line) entry = { over: o, under: u };
      }
      if (entry) {
        entry.updated = m.last_update || book.updated;
        entry.link = m.link || null;
        book[kind] = entry;
      }
    }
    if (book.ml || book.spread || book.total) game.books[b.key] = book;
  }
  return game;
}

const SIDES = { ml: ['home', 'away'], spread: ['home', 'away'], total: ['over', 'under'] };
export const sidesOf = (market) => SIDES[market];

function pairPrices(entry, market) {
  const [a, b] = SIDES[market];
  return [entry[a].price, entry[b].price];
}

const median = (xs) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// A book's view of the market: the home side's no-vig chance (moneyline), or the curve its line
// and prices imply ({ mu, ref } for spreads and totals, see dists.js).
function bookView(sport, market, entry, method) {
  const prices = pairPrices(entry, market);
  const fair = devig(prices, method);
  if (!fair) return null;
  if (market === 'ml') return { p: fair[0], hold: hold(prices) };
  if (!hasDists(sport)) return null;
  const line = market === 'spread' ? entry.home.line : entry.over.line;
  const center = centerFrom(sport, market, line, fair[0]);
  return center ? { center, hold: hold(prices), line } : null;
}

// How far the rest of the market may sit from the sharp book before the market counts as
// unsettled (news hit and the sharp feed has not caught up, or the other way round).
const UNSETTLED = { ml: 0.05, spread: { football: 1.5, basketball: 2 }, total: { football: 2, basketball: 3 } };

const level = (market, v) => (market === 'ml' ? v.p : v.center.mu);

// The fair view's value under each method, read from the same books: the median home chance
// (moneyline) or the one book's curve (spread, total). The chosen method keeps its value as is.
function valuesFor(game, market, keys, method, value) {
  const out = { [method]: value };
  const rest = Object.keys(FAIR_METHODS).filter((m) => m !== method);
  if (market === 'ml') {
    for (const m of rest) out[m] = median(keys.map((k) => bookView(game.sport, market, game.books[k].ml, m)).filter(Boolean).map((v) => v.p));
    return out;
  }
  // Solving a curve is the slow part, so methods that land on the same chance share one (Shin
  // and additive always do on two outcomes).
  const entry = game.books[keys[0]][market];
  const prices = pairPrices(entry, market);
  const at = (m) => Math.round(devig(prices, m)[0] * 1e12);
  const curves = new Map([[at(method), value]]);
  for (const m of rest) {
    if (!curves.has(at(m))) {
      const v = bookView(game.sport, market, entry, m);
      curves.set(at(m), v ? v.center : null);
    }
    out[m] = curves.get(at(m));
  }
  return out;
}

// Fair view for each market of one game: { value, from, book, updated, line, unsettled, method,
// values }. value: the home side's chance (moneyline) or the curve { mu, ref } (spread, total),
// by the chosen method; values: the same under each of the four methods.
// opts: { ref: 'pinnacle', method: 'power' }
export function fairFor(game, opts = {}) {
  const ref = opts.ref || 'pinnacle';
  const method = opts.method || 'power';
  const kind = SPORTS[game.sport].kind;
  const out = {};
  for (const market of ['ml', 'spread', 'total']) {
    const views = [];
    for (const [key, b] of Object.entries(game.books)) {
      if (!b[market]) continue;
      const v = bookView(game.sport, market, b[market], method);
      // Skip glitches: a two-way market with a hold under 0% or over 12%.
      if (v && v.hold > -0.005 && v.hold < 0.12) views.push({ key, updated: b[market].updated, ...v });
    }
    if (!views.length) continue;
    const sharp = views.find((v) => v.key === ref);
    const others = views.filter((v) => v.key !== ref);
    const consensus = others.length ? median(others.map((v) => level(market, v))) : NaN;
    let fair;
    let keys;
    if (sharp) {
      keys = [ref];
      fair = { value: market === 'ml' ? sharp.p : sharp.center, from: 'sharp', book: ref, updated: sharp.updated, line: sharp.line };
      if (others.length >= 3 && Number.isFinite(consensus)) {
        const gap = Math.abs(consensus - level(market, sharp));
        const limit = market === 'ml' ? UNSETTLED.ml : UNSETTLED[market][kind] || 2;
        const newer = median(others.map((v) => Date.parse(v.updated) || 0)) > (Date.parse(sharp.updated) || 0);
        if (gap > limit && newer) fair.unsettled = true;
      }
    } else if (others.length >= 3) {
      // The middle book's whole view (its line and its curve), not medians taken apart, so the
      // stand-in never sits on a line no book hangs.
      const mid = [...others].sort((a, b) => level(market, a) - level(market, b))[Math.floor((others.length - 1) / 2)];
      const value = market === 'ml' ? consensus : mid.center;
      keys = market === 'ml' ? others.map((v) => v.key) : [mid.key];
      fair = { value, from: 'consensus', book: null, updated: null, books: others.length, line: market === 'ml' ? null : mid.line };
    } else continue;
    fair.views = views.length;
    fair.method = method;
    fair.values = valuesFor(game, market, keys, method, fair.value);
    out[market] = fair;
  }
  return out;
}

// Win, push and loss chances for one side of one market at a line.
export function sideChances(sport, market, fair, side, line) {
  if (!fair) return null;
  if (market === 'ml') {
    const p = side === 'home' ? fair.value : 1 - fair.value;
    return { win: p, push: 0, loss: 1 - p };
  }
  return chances(sport, market, fair.value, side, line);
}

// Chances for one side under the EV gate. 'worst': of the four methods, the one that gives this
// side its lowest fair chance to win at this line. Any other gate: the fair price method's.
export function gateChances(sport, market, fair, side, line, gate) {
  if (gate !== 'worst' || !fair || !fair.values) return sideChances(sport, market, fair, side, line);
  let low = null;
  for (const value of Object.values(fair.values)) {
    const ch = sideChances(sport, market, { ...fair, value }, side, line);
    if (ch && Number.isFinite(ch.win) && (!low || ch.win < low.win)) low = ch;
  }
  return low;
}

// Settings that shape the edge list, with defaults.
export const EDGE_DEFAULTS = {
  minEdge: 0.02,
  consensusExtra: 0.01,
  maxFav: -250,
  maxGap: { spread: 3, total: 4 },
  hideVA: true,
};

// Every bettable price for a game, scored. books: the keys the user can bet.
// s.gate 'worst' also scores each price at its worst case (gateEv); otherwise gateEv is ev.
export function pricesFor(game, fair, books, s = {}) {
  const out = [];
  for (const key of books) {
    const b = game.books[key];
    if (!b) continue;
    for (const market of ['ml', 'spread', 'total']) {
      const entry = b[market];
      const f = fair[market];
      if (!entry || !f) continue;
      for (const side of SIDES[market]) {
        const o = entry[side];
        const line = market === 'ml' ? null : o.line;
        const ch = sideChances(game.sport, market, f, side, line);
        if (!ch) continue;
        const ev = evOf(ch.win, ch.push, o.price);
        const gch = s.gate === 'worst' ? gateChances(game.sport, market, f, side, line, 'worst') : null;
        const gap = market === 'ml' || f.line == null ? 0 : Math.abs((market === 'spread' ? (side === 'home' ? line : -line) : line) - f.line);
        out.push({
          id: `${game.id}|${key}|${market}|${side}|${line == null ? '' : line}|${o.price}`,
          gameId: game.id,
          sport: game.sport,
          start: game.start,
          home: game.home,
          away: game.away,
          book: key,
          market,
          side,
          line,
          price: o.price,
          link: o.link || entry.link || b.link || null,
          updated: entry.updated,
          win: ch.win,
          push: ch.push,
          loss: ch.loss,
          fairPrice: fairAmerican(ch.win, ch.push),
          ev,
          gateEv: gch ? evOf(gch.win, gch.push, o.price) : ev,
          kelly: kellyFraction(ch.win, ch.push, o.price),
          from: f.from,
          method: f.method,
          unsettled: !!f.unsettled,
          gap,
          stake: s.bankroll ? stakeFor(ch.win, ch.push, o.price, s) : null,
        });
      }
    }
  }
  return out;
}

// Whether a scored price is a bet: its edge under the EV gate clears the bar (higher when the
// fair price is the books' median), the market is settled, it is not too long a favorite, and
// its line is close enough to the sharp line to trust the conversion. The edge list and the
// line shop both use this.
export function qualifies(x, s = {}) {
  const opt = { ...EDGE_DEFAULTS, ...s };
  const bar = opt.minEdge + (x.from === 'consensus' ? opt.consensusExtra : 0);
  const edge = Number.isFinite(x.gateEv) ? x.gateEv : x.ev;
  if (!(edge >= bar) || x.unsettled) return false;
  if (x.price < 0 && x.price < opt.maxFav) return false;
  if (x.market !== 'ml' && x.gap > tooFar(x, opt)) return false;
  return true;
}

// Line gap past which a converted price is not trusted.
export function tooFar(x, s = {}) {
  const opt = { ...EDGE_DEFAULTS, ...s };
  return (opt.maxGap && opt.maxGap[x.market]) || 3;
}

// The edges worth showing: qualifying prices in games not started, Virginia college games left
// out when asked. Edges on the same side of one game share their risk, so each notes the others.
export function edgesFrom(games, fairs, books, s = {}, now = Date.now()) {
  const opt = { ...EDGE_DEFAULTS, ...s };
  const out = [];
  for (const g of games) {
    if (Date.parse(g.start) <= now) continue;
    if (opt.hideVA && SPORTS[g.sport].college && (isVirginiaSchool(g.home) || isVirginiaSchool(g.away))) continue;
    const fair = fairs[g.id];
    if (!fair) continue;
    for (const x of pricesFor(g, fair, books, s)) if (qualifies(x, opt)) out.push(x);
  }
  // Same game, same direction: a team's spread and moneyline, or overs (or unders) at two books.
  const dir = (x) => `${x.gameId}|${x.market === 'total' ? x.side : x.side}`;
  const count = new Map();
  for (const x of out) count.set(dir(x), (count.get(dir(x)) || 0) + 1);
  for (const x of out) x.related = count.get(dir(x)) - 1;
  return out.sort((a, b) => b.ev - a.ev);
}

// Best price for each side of each market in one game, across the user's books.
export function bestBySide(prices) {
  const best = {};
  for (const x of prices) {
    const k = `${x.market}|${x.side}`;
    if (!best[k] || x.ev > best[k].ev) best[k] = x;
  }
  return best;
}

// Short name for a side: "Bills -3.5", "Over 44.5", "Dolphins".
export function nickname(team, sport) {
  if (SPORTS[sport] && SPORTS[sport].kind === 'fight') {
    const parts = String(team || '').trim().split(/\s+/);
    return parts.length > 1 ? parts.slice(1).join(' ') : team;
  }
  const words = String(team || '').trim().split(/\s+/);
  if (words.length <= 1) return team;
  // College teams keep the school ("Ohio State"); pro teams keep the nickname ("Bills").
  if (SPORTS[sport] && SPORTS[sport].college) return words.slice(0, -1).join(' ') || team;
  const two = ['Red Sox', 'White Sox', 'Blue Jays', 'Trail Blazers', 'Golden Knights', 'Maple Leafs'];
  const last2 = words.slice(-2).join(' ');
  return two.includes(last2) ? last2 : words[words.length - 1];
}

export function fmtLine(x) {
  if (!Number.isFinite(x)) return '';
  if (x === 0) return 'PK';
  const s = Number.isInteger(x) ? String(Math.abs(x)) : Math.abs(x).toFixed(1);
  return `${x > 0 ? '+' : '-'}${s}`;
}

export function sideLabel(x, short = true) {
  const team = (side) => (short ? nickname(x[side], x.sport) : x[side]);
  if (x.market === 'total') return `${x.side === 'over' ? 'Over' : 'Under'} ${x.line}`;
  if (x.market === 'ml') return `${team(x.side)} to win`;
  return `${team(x.side)} ${fmtLine(x.line)}`;
}
