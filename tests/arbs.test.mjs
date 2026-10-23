import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitStake, middleOf, findArbs, findMiddles, sdOf, DEFAULT_SD } from '../src/arbs.js';
import { KEYNUM } from '../src/keynum.js';

const NOW = Date.parse('2026-10-11T15:00:00Z');
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);

const at = (minAgo) => new Date(NOW - minAgo * 60000).toISOString();
const side = (price, line) => ({ price, line });
function game(books, sport = 'nfl') {
  return { id: 'g1', sport, start: new Date(NOW + 3600e3).toISOString(), home: 'Home Team', away: 'Away Team', scannedAt: NOW, books };
}
const spreadEntry = (hl, hp, ap, min = 1) => ({ home: side(hp, hl), away: side(ap, -hl), updated: at(min) });
const totalEntry = (line, op, up, min = 1) => ({ over: side(op, line), under: side(up, line), updated: at(min) });

test('the key number table is Gridiron\'s, intact', () => {
  assert.equal(KEYNUM.games, 5257);
  assert.equal(KEYNUM.pmf.length, 30);
  for (const row of KEYNUM.pmf) assert.equal(row.reduce((a, b) => a + b, 0) > 99000, true);
});

test('stake split pays the same either way, in whole dollars', () => {
  const s = splitStake(100, 2.1, 2.05); // inverse sum 0.9640
  assert.equal(s.stakeA + s.stakeB, 100);
  assert.ok(Number.isInteger(s.stakeA) && Number.isInteger(s.stakeB));
  assert.ok(Math.abs(s.payA - s.payB) < 2.2);
  assert.ok(s.profit > 2.8 && s.profit < 3.6);
  // No whole dollar split does better.
  for (let a = 1; a < 100; a++) assert.ok(Math.min(a * 2.1, (100 - a) * 2.05) - 100 <= s.profit + 1e-9);
  assert.equal(splitStake(1, 2, 2), null);
});

test('arbs: best price per side across your books, fresh only', () => {
  const g = game({
    dk: { key: 'dk', total: totalEntry(44.5, 110, -150) },
    fd: { key: 'fd', total: totalEntry(44.5, -150, 115) },
    mgm: { key: 'mgm', total: totalEntry(44.5, -120, -125) },
  });
  const arbs = findArbs([g], ['dk', 'fd', 'mgm'], { now: NOW, staleMin: 15, total: 100 });
  assert.equal(arbs.length, 1);
  const a = arbs[0];
  assert.deepEqual(a.legs.map((l) => `${l.book}:${l.side}`), ['dk:over', 'fd:under']);
  close(a.roi, 1 / (1 / 2.1 + 1 / 2.15) - 1);
  assert.equal(a.split.stakeA + a.split.stakeB, 100);
  assert.ok(a.split.profit > 0);
  // Not an arb at the books you did not mark.
  assert.equal(findArbs([g], ['dk', 'mgm'], { now: NOW, staleMin: 15 }).length, 0);
  // A stale leg drops out.
  g.books.fd.total.updated = at(40);
  assert.equal(findArbs([g], ['dk', 'fd', 'mgm'], { now: NOW, staleMin: 15 }).length, 0);
  assert.equal(findArbs([g], ['dk', 'fd', 'mgm'], { now: NOW, staleMin: 0 }).length, 1);
});

test('NFL spread middle uses the key number table', () => {
  // Home +3.5 at one book, away -2.5 at another: the game has to end with the away team by 3.
  const m = middleOf({ sport: 'nfl', market: 'spread', a: -3.5, b: -2.5, decA: 1.909, decB: 1.909, sd: 12.7 });
  assert.equal(m.method, 'keynum');
  // About one game in ten lands on exactly 3 (README: 10.6% of games lined on 3).
  assert.ok(m.chance > 0.07 && m.chance < 0.16, String(m.chance));
  close(m.hit, 50 * 0.909 * 2);
  // Break even is near 5% for -110 both ways, so a 3 to 3.5 point middle pays.
  assert.ok(m.ev > 0, String(m.ev));
});

test('other sports use the normal curve and the sd setting', () => {
  const tight = middleOf({ sport: 'nba', market: 'spread', a: -4.5, b: -2.5, decA: 1.909, decB: 1.909, sd: 8 });
  const wide = middleOf({ sport: 'nba', market: 'spread', a: -4.5, b: -2.5, decA: 1.909, decB: 1.909, sd: 16 });
  assert.equal(tight.method, 'normal');
  assert.ok(tight.chance > wide.chance);
  // Two integers in the gap (-4, -3) near the center of a 13.7 sd curve: about 2 x 2.9%.
  const nba = middleOf({ sport: 'nba', market: 'spread', a: -4.5, b: -2.5, decA: 1.909, decB: 1.909, sd: 13.7 });
  assert.ok(nba.chance > 0.04 && nba.chance < 0.08);
  assert.equal(sdOf({ sd_nba_spread: '9' }, 'nba', 'spread'), 9);
  assert.equal(sdOf({ sd_nba_spread: 'x' }, 'nba', 'spread'), DEFAULT_SD.nba.spread);
});

test('no middle when no whole number lands in the gap', () => {
  assert.equal(middleOf({ sport: 'nba', market: 'total', a: 220, b: 221, decA: 1.9, decB: 1.9, sd: 18 }), null);
  assert.equal(middleOf({ sport: 'nba', market: 'total', a: 221, b: 220.5, decA: 1.9, decB: 1.9, sd: 18 }), null);
});

test('findMiddles: spreads and totals, EV filter and staleness', () => {
  const g = game({
    dk: { key: 'dk', spread: spreadEntry(3.5, -110, -110), total: totalEntry(47.5, -110, -110) },
    fd: { key: 'fd', spread: spreadEntry(2.5, -110, -110), total: totalEntry(45.5, -110, -110) },
  });
  const all = findMiddles([g], ['dk', 'fd'], { now: NOW, staleMin: 15, minEv: 0, settings: {} });
  const spread = all.find((x) => x.market === 'spread');
  // dk home +3.5 with fd away -2.5.
  assert.deepEqual(spread.legs.map((l) => l.book), ['dk', 'fd']);
  assert.equal(spread.legs[0].line, 3.5);
  assert.equal(spread.legs[1].line, -2.5);
  const total = all.find((x) => x.market === 'total');
  // Over 45.5 at fd with under 47.5 at dk.
  assert.deepEqual(total.legs.map((l) => `${l.book}:${l.side}`), ['fd:over', 'dk:under']);
  assert.ok(all[0].ev >= all[all.length - 1].ev);
  assert.equal(findMiddles([g], ['dk', 'fd'], { now: NOW, staleMin: 15, minEv: 1000, settings: {} }).length, 0);
  g.books.dk.spread.updated = at(30);
  g.books.dk.total.updated = at(30);
  assert.equal(findMiddles([g], ['dk', 'fd'], { now: NOW, staleMin: 15, minEv: 0, settings: {} }).length, 0);
  // Same line at both books is not a middle.
  const flat = game({ dk: { key: 'dk', spread: spreadEntry(3, -110, -110) }, fd: { key: 'fd', spread: spreadEntry(3, -105, -115) } });
  assert.equal(findMiddles([flat], ['dk', 'fd'], { now: NOW, staleMin: 0, minEv: -100, settings: {} }).filter((x) => x.market === 'spread').length, 0);
});

test('scripted arbs: shown profit is the guaranteed minimum on whole dollar stakes', async () => {
  const { oddsWorld } = await import('./world.mjs');
  const { parseEvent } = await import('../src/market.js');
  const games = oddsWorld(NOW).nba.filter((e) => /3|4/.test(e.id)).map((e) => ({ ...parseEvent(e, 'nba'), scannedAt: NOW }));
  const mine = ['draftkings', 'fanduel', 'betmgm', 'betrivers'];
  const arbs = findArbs(games, mine, { now: NOW, staleMin: 15, minEv: 0, total: 200 });
  assert.equal(arbs.length, 2);
  const [gonzaga, duke] = arbs;
  assert.equal(gonzaga.away, 'Chicago Bulls');
  assert.deepEqual(gonzaga.legs.map((l) => `${l.book}:${l.price}`), ['draftkings:110', 'fanduel:-105']);
  close(gonzaga.roi, 0.01175, 1e-5);
  assert.deepEqual([gonzaga.split.stakeA, gonzaga.split.stakeB], [96, 104]);
  // Not the ideal 200 x ROI = 2.35: the smaller payout (96 x 2.1 = 201.60) less the 200 staked.
  close(gonzaga.split.profit, 1.6, 1e-9);
  assert.equal(gonzaga.thin, false);
  // Thin: +106 against -105 is 0.24%, and 97 / 103 loses 0.18 once rounded.
  assert.equal(duke.away, 'Miami Heat');
  assert.deepEqual([duke.split.stakeA, duke.split.stakeB], [97, 103]);
  assert.ok(duke.split.profit < 0 && duke.thin);
  // The default minimum ($1 per $100) hides the thin one; $0 shows it, flagged.
  const dflt = findArbs(games, mine, { now: NOW, staleMin: 15, minEv: 1, total: 200 });
  assert.deepEqual(dflt.map((x) => x.away), ['Chicago Bulls']);
});
