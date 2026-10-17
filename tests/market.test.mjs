import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oddsWorld, espnWorld } from './world.mjs';
import * as M from '../src/market.js';
import * as P from '../src/promos.js';
import * as G from '../src/grade.js';
import * as O from '../src/odds.js';
import { normalizeScoreboard } from '../src/espn.js';
import { DEFAULT_BOOKS, isVirginiaSchool } from '../src/sports.js';

const NOW = Date.parse('2026-10-11T15:00:00Z');
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);

function load(now = NOW) {
  const w = oddsWorld(now);
  const games = [];
  const fairs = {};
  for (const sport of Object.keys(w)) {
    for (const e of w[sport]) {
      const g = M.parseEvent(e, sport);
      games.push(g);
      fairs[g.id] = M.fairFor(g, { ref: 'pinnacle', method: 'power' });
    }
  }
  return { games, fairs };
}
const S = { bankroll: 1000, kelly: 0.25, minPct: 0.005, maxPct: 0.05 };

test('Odds API events parse into books and markets', () => {
  const { games } = load();
  const bills = games.find((g) => g.id === 'nfl1');
  assert.equal(bills.home, 'Buffalo Bills');
  assert.equal(bills.books.fanduel.spread.home.line, -2.5);
  assert.equal(bills.books.fanduel.spread.away.line, 2.5);
  assert.equal(bills.books.fanduel.total.over.line, 48);
  assert.equal(bills.books.pinnacle.ml.away.price, 148);
  assert.match(bills.books.fanduel.spread.home.link, /fanduel\/slip/);
  // A spread whose sides do not mirror is dropped.
  const bad = M.parseEvent({ id: 'x', commence_time: new Date(NOW).toISOString(), home_team: 'A', away_team: 'B', bookmakers: [{ key: 'draftkings', markets: [{ key: 'spreads', outcomes: [{ name: 'A', price: -110, point: -3 }, { name: 'B', price: -110, point: 2.5 }] }] }] }, 'nfl');
  assert.deepEqual(bad.books, {});
});

test('fair views: sharp book, stand-in median, and a stale sharp price', () => {
  const { fairs } = load();
  assert.equal(fairs.nfl1.spread.from, 'sharp');
  assert.equal(fairs.nfl1.spread.line, -3);
  assert.ok(fairs.nfl1.ml.value > 0.6 && fairs.nfl1.ml.value < 0.62);
  assert.equal(fairs.cfb2.spread.from, 'consensus');
  assert.equal(fairs.cfb2.spread.line, 3.5);
  assert.equal(fairs.nba2.spread.unsettled, true);
  assert.ok(!fairs.nba1.spread.unsettled);
});

test('edges: through the key numbers, the stand-in bar, and the traps', () => {
  const { games, fairs } = load();
  const edges = M.edgesFrom(games, fairs, DEFAULT_BOOKS, S, NOW);
  const names = edges.map((e) => `${e.book} ${M.sideLabel(e)} ${e.price}`);
  assert.deepEqual(names, [
    'fanduel Bills -2.5 -118',
    'betmgm Ohio State -3 -105',
    'fanatics Bravo to win 150',
    'fanduel Under 45.5 -110',
    'draftkings Raiders +7.5 -110',
  ]);
  const bills = edges[0];
  // Pinnacle is -3 -112: -2.5 at -118 is worth about 5% because the hook on 3 lands one game in ten.
  assert.ok(bills.ev > 0.04 && bills.ev < 0.06, `Bills ev ${bills.ev}`);
  assert.equal(bills.push, 0);
  assert.ok(bills.fairPrice < -125);
  // Quarter Kelly, rounded down to whole dollars so it never tops the rule.
  assert.equal(bills.stake.stake, Math.floor(1000 * 0.25 * bills.kelly));
  // Ohio State comes from the books' median, so it had to clear 3%.
  assert.equal(edges[1].from, 'consensus');
  assert.ok(edges[1].ev >= 0.03);
  // Started games, Virginia college teams and the stale Lakers price never show.
  assert.ok(!edges.some((e) => ['nfl3', 'cfb1', 'nba2'].includes(e.gameId)));
  const withVA = M.edgesFrom(games, fairs, DEFAULT_BOOKS, { ...S, hideVA: false }, NOW);
  assert.ok(withVA.some((e) => e.gameId === 'cfb1' && e.side === 'away'));
  // Only the user's books.
  const noFD = M.edgesFrom(games, fairs, DEFAULT_BOOKS.filter((b) => b !== 'fanduel'), S, NOW);
  assert.ok(!noFD.some((e) => e.book === 'fanduel'));
  // A higher bar.
  assert.deepEqual(M.edgesFrom(games, fairs, DEFAULT_BOOKS, { ...S, minEdge: 0.045 }, NOW).map((e) => e.gameId), ['nfl1']);
});

test('best price per side and labels', () => {
  const { games, fairs } = load();
  const g = games.find((x) => x.id === 'nfl1');
  const best = M.bestBySide(M.pricesFor(g, fairs.nfl1, DEFAULT_BOOKS, S));
  assert.equal(best['spread|home'].book, 'fanduel');
  assert.equal(M.nickname('Ohio State Buckeyes', 'cfb'), 'Ohio State');
  assert.equal(M.nickname('Portland Trail Blazers', 'nba'), 'Trail Blazers');
  assert.equal(M.nickname('Bruno Bravo', 'ufc'), 'Bravo');
  assert.equal(M.fmtLine(-3), '-3');
  assert.equal(M.fmtLine(7.5), '+7.5');
  assert.equal(M.fmtLine(0), 'PK');
  assert.ok(isVirginiaSchool('Virginia Tech Hokies') && isVirginiaSchool('VCU Rams') && isVirginiaSchool('William & Mary Tribe') && isVirginiaSchool('Norfolk State Spartans'));
  assert.ok(!isVirginiaSchool('West Virginia Mountaineers'));
});

test('boosts, bonus bets and second chances', () => {
  // +300 bonus bet hedged at -350: both outcomes pay the same.
  const h = P.bonusHedge(100, 300, -350);
  close(h.hedge, (100 * 3) / (1 + 100 / 350), 1e-9);
  close(300 - h.hedge, h.hedge * (100 / 350), 1e-9);
  close(h.rate, h.locked / 100, 1e-12);
  // 50% profit boost on a coin flip at -110.
  const b = P.boostValue({ win: 0.5, push: 0, loss: 0.5 }, -110, 0.5, 25);
  close(b.dec, 1 + (100 / 110) * 1.5, 1e-9);
  close(b.ev, 0.5 * (b.dec - 1) - 0.5, 1e-12);
  close(b.dollars, b.ev * 25, 1e-9);
  // Second chance: a losing $50 bet comes back as a $50 bonus bet worth 70%.
  const sc = P.secondChanceValue({ win: 0.45, push: 0, loss: 0.55 }, 120, 50, 50, 0.7);
  close(sc.refund, 0.55 * 50 * 0.7, 1e-9);
  close(sc.cash, (0.45 * 1.2 - 0.55) * 50, 1e-9);
  const { games, fairs } = load();
  const opts = P.bonusOptions(games, fairs, 'fanduel', DEFAULT_BOOKS, 100, { now: NOW });
  assert.ok(opts.length > 0);
  for (const o of opts) {
    assert.notEqual(o.hedgeBook, 'fanduel');
    if (o.market === 'spread') assert.equal(o.hedgeLine, -o.line);
    if (o.market === 'total') assert.equal(o.hedgeLine, o.line);
  }
  assert.ok(opts[0].rate >= opts[opts.length - 1].rate);
  // Longshots convert best: the top option is a plus price.
  assert.ok(opts[0].price > 100);
});

test('grading finals, ESPN closing lines and closing line value', () => {
  const espn = normalizeScoreboard(espnWorld(NOW, 'final'), 'nfl');
  const { games } = load();
  const bills = games.find((g) => g.id === 'nfl1');
  const raiders = games.find((g) => g.id === 'nfl2');
  const bet = (g, market, side, line, price) => ({ sport: 'nfl', home: g.home, away: g.away, start: g.start, market, side, line, price, stake: 20 });
  const b1 = bet(bills, 'spread', 'home', -2.5, -118);
  const m1 = G.matchGame(b1, espn);
  assert.ok(m1 && !m1.flip);
  assert.equal(G.gradeBet(b1, m1), 'won');
  assert.equal(G.profitOf(b1, 'won'), Math.round(20 * (100 / 118) * 100) / 100);
  assert.equal(G.gradeBet(bet(bills, 'spread', 'away', 10, -110), m1), 'push');
  assert.equal(G.gradeBet(bet(bills, 'total', 'over', 47.5, -110), m1), 'lost');
  assert.equal(G.gradeBet(bet(bills, 'ml', 'away', null, 148), m1), 'lost');
  const r = bet(raiders, 'spread', 'home', 7.5, -110);
  assert.equal(G.gradeBet(r, G.matchGame(r, espn)), 'won');
  assert.equal(G.gradeBet(bet(raiders, 'total', 'under', 45.5, -110), G.matchGame(r, espn)), 'won');
  // ESPN closed Bills -3.5 -110: taking -2.5 at -118 beat the close.
  const c = G.closeFromEspn(b1, m1);
  assert.equal(c.source, 'espn');
  assert.equal(c.line, -3.5);
  const clv = G.clvOf(b1, c);
  assert.ok(clv > 0.05, `clv ${clv}`);
  // Taking Dolphins +148 when it closed +155 lost value.
  const ml = bet(bills, 'ml', 'away', null, 148);
  assert.ok(G.clvOf(ml, G.closeFromEspn(ml, m1)) < 0);
  // Before the game ESPN shows nothing final.
  const pre = normalizeScoreboard(espnWorld(NOW, 'pre'), 'nfl');
  assert.equal(G.gradeBet(b1, G.matchGame(b1, pre)), null);
});

test('record summary and the verdict on closing line value', () => {
  const mk = (clv, result, profit) => ({ stake: 10, clv, result, profit, evAtBet: 0.03 });
  assert.equal(G.summarize([]).verdict, 'none');
  assert.equal(G.summarize([mk(0.02, 'won', 9)]).verdict, 'early');
  const good = Array.from({ length: 60 }, (_, i) => mk(0.03 + ((i % 5) - 2) * 0.01, i % 2 ? 'won' : 'lost', i % 2 ? 9.09 : -10));
  const s = G.summarize(good);
  assert.equal(s.verdict, 'beating');
  close(s.clv.mean, 0.03, 1e-9);
  assert.equal(s.won, 30);
  close(s.roi, (30 * 9.09 - 300) / 600, 1e-9);
  const noisy = Array.from({ length: 30 }, (_, i) => mk(i % 2 ? 0.08 : -0.07, 'open'));
  const n = G.summarize(noisy);
  assert.equal(n.verdict, 'unclear');
  assert.ok(n.needed > 0);
  const bad = Array.from({ length: 40 }, (_, i) => mk(-0.03 + ((i % 3) - 1) * 0.005, 'lost', -10));
  assert.equal(G.summarize(bad).verdict, 'losing');
});

test('review fixes: one bar for the list and the shop, honest stand-ins, rounding, timing', () => {
  // A line far from the sharp line never qualifies, however big the converted edge looks.
  const base = { ev: 0.3, from: 'sharp', unsettled: false, price: -110, market: 'spread', gap: 5 };
  assert.equal(M.qualifies(base, S), false);
  assert.equal(M.qualifies({ ...base, gap: 0 }, S), true);
  assert.equal(M.qualifies({ ...base, gap: 0, price: -300 }, S), false);
  assert.equal(M.qualifies({ ...base, gap: 0, ev: 0.025, from: 'consensus' }, S), false);
  assert.equal(M.qualifies({ ...base, gap: 0, ev: 0.025, from: 'sharp' }, S), true);
  // The books' median takes one book's whole view, so its line is a line a book hangs.
  const g = M.parseEvent({ id: 'q', commence_time: new Date(NOW + 3600e3).toISOString(), home_team: 'A Home', away_team: 'B Away', bookmakers: ['draftkings', 'fanduel', 'betmgm', 'espnbet'].map((key, i) => ({ key, markets: [{ key: 'spreads', outcomes: [{ name: 'A Home', price: -110, point: i % 2 ? -3.5 : -3 }, { name: 'B Away', price: -110, point: i % 2 ? 3.5 : 3 }] }] })) }, 'nfl');
  const f = M.fairFor(g, { ref: 'pinnacle' }).spread;
  assert.equal(f.from, 'consensus');
  assert.ok([-3, -3.5].includes(f.line), `stand-in line ${f.line}`);
  // Prices or points the feed leaves empty are not zeros.
  const empty = M.parseEvent({ id: 'e', commence_time: new Date(NOW).toISOString(), home_team: 'A', away_team: 'B', bookmakers: [{ key: 'draftkings', markets: [{ key: 'h2h', outcomes: [{ name: 'A', price: null }, { name: 'B', price: 120 }] }, { key: 'spreads', outcomes: [{ name: 'A', price: -110, point: null }, { name: 'B', price: -110, point: null }] }] }] }, 'nfl');
  assert.deepEqual(empty.books, {});
  // Postponed games wait three days before they void; canceled ones void at once.
  const espn = normalizeScoreboard(espnWorld(NOW, 'pre'), 'nfl');
  const { games } = load();
  const bills = games.find((x) => x.id === 'nfl1');
  const bet = { sport: 'nfl', home: bills.home, away: bills.away, start: bills.start, market: 'spread', side: 'home', line: -2.5, price: -118, stake: 20 };
  const m = G.matchGame(bet, espn);
  m.game.statusName = 'STATUS_POSTPONED';
  assert.equal(G.gradeBet(bet, m, Date.parse(bet.start) + 86400e3), null);
  assert.equal(G.gradeBet(bet, m, Date.parse(bet.start) + 4 * 86400e3), 'void');
  m.game.statusName = 'STATUS_CANCELED';
  assert.equal(G.gradeBet(bet, m), 'void');
  // One missing ESPN price is filled with the usual margin, not -110.
  m.game.odds = { spreadHome: -3, homeSpreadOdds: -120, awaySpreadOdds: null, provider: 'ESPN BET' };
  const c = G.closeFromEspn(bet, m);
  const both = G.closeFromEspn(bet, { ...m, game: { ...m.game, odds: { ...m.game.odds, awaySpreadOdds: 100 } } });
  assert.ok(Math.abs(c.value.mu - both.value.mu) < 0.15, `filled ${c.value.mu} against ${both.value.mu}`);
  // Boosted bets pay on the exact boosted price; a lost bonus bet costs nothing.
  const boosted = { ...bet, price: 114, dec: 1 + (100 / 110) * 1.25, stake: 50 };
  assert.equal(G.profitOf(boosted, 'won'), Math.round(50 * (100 / 110) * 1.25 * 100) / 100);
  assert.equal(G.profitOf({ ...bet, bonus: true }, 'lost'), 0);
});

test('fair views carry the market under all four methods', () => {
  const { games, fairs } = load();
  for (const f of Object.values(fairs)) {
    for (const v of Object.values(f)) {
      assert.deepEqual(Object.keys(v.values).sort(), ['additive', 'multiplicative', 'power', 'shin']);
      assert.equal(v.method, 'power');
      assert.deepEqual(v.values.power, v.value);
    }
  }
  // A moneyline's value under each method is that method's no-vig chance from Pinnacle.
  const pin = games.find((g) => g.id === 'nfl1').books.pinnacle.ml;
  for (const m of ['multiplicative', 'additive', 'power', 'shin']) close(fairs.nfl1.ml.values[m], O.devig([pin.home.price, pin.away.price], m)[0], 1e-12);
  // The stand-in median carries every method too.
  assert.equal(fairs.cfb2.spread.from, 'consensus');
  assert.ok(Object.values(fairs.cfb2.spread.values).every((v) => Number.isFinite(v.mu)));
});

test('the worst-case EV gate takes the lowest fair chance of the four methods', () => {
  const { games, fairs } = load();
  for (const id of ['nfl1', 'nfl2', 'cfb2', 'ufc1']) {
    const g = games.find((x) => x.id === id);
    if (!g) continue;
    const xs = M.pricesFor(g, fairs[id], DEFAULT_BOOKS, { ...S, gate: 'worst' });
    assert.ok(xs.length > 0, id);
    for (const x of xs) {
      const f = fairs[id][x.market];
      const wins = Object.values(f.values).map((v) => M.sideChances(g.sport, x.market, { ...f, value: v }, x.side, x.line).win);
      const ch = M.gateChances(g.sport, x.market, f, x.side, x.line, 'worst');
      close(ch.win, Math.min(...wins), 1e-12);
      close(x.gateEv, O.evOf(ch.win, ch.push, x.price), 1e-12);
      if (x.market === 'ml') assert.ok(x.gateEv <= x.ev + 1e-12, `${id} ${x.side}`);
      assert.equal(x.method, 'power');
    }
    // Gated on the fair price method instead, the gate is the edge itself.
    for (const x of M.pricesFor(g, fairs[id], DEFAULT_BOOKS, { ...S, gate: 'fair' })) close(x.gateEv, x.ev, 1e-12);
  }
});

test('the EV gate decides the edge list and the bar', () => {
  // Pinnacle -400 / +300. Shin puts the dog at 22.5%, power at 21.8%: +360 is worth +3.5% by
  // Shin but only about +0.1% at the worst case, under the 2% bar.
  const g = M.parseEvent({ id: 'w', commence_time: new Date(NOW + 3600e3).toISOString(), home_team: 'A Home', away_team: 'B Away', bookmakers: [
    { key: 'pinnacle', markets: [{ key: 'h2h', outcomes: [{ name: 'A Home', price: -400 }, { name: 'B Away', price: 300 }] }] },
    { key: 'draftkings', markets: [{ key: 'h2h', outcomes: [{ name: 'A Home', price: -450 }, { name: 'B Away', price: 360 }] }] },
  ] }, 'nfl');
  const fairs = { w: M.fairFor(g, { ref: 'pinnacle', method: 'shin' }) };
  const byFair = M.edgesFrom([g], fairs, ['draftkings'], { ...S, gate: 'fair' }, NOW);
  assert.deepEqual(byFair.map((x) => `${x.side} ${x.price}`), ['away 360']);
  assert.ok(byFair[0].ev > 0.03 && byFair[0].ev < 0.04, `Shin edge ${byFair[0].ev}`);
  assert.deepEqual(M.edgesFrom([g], fairs, ['draftkings'], { ...S, gate: 'worst' }, NOW), []);
  const dog = M.pricesFor(g, fairs.w, ['draftkings'], { ...S, gate: 'worst' }).find((x) => x.side === 'away');
  assert.ok(dog.gateEv > 0 && dog.gateEv < 0.005, `worst case ${dog.gateEv}`);
  // A gated price is held to the bar on its gate edge.
  const base = { ev: 0.05, from: 'sharp', unsettled: false, price: -110, market: 'ml', gap: 0 };
  assert.equal(M.qualifies({ ...base, gateEv: 0.01 }, S), false);
  assert.equal(M.qualifies({ ...base, gateEv: 0.03 }, S), true);
});
