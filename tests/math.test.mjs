import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as O from '../src/odds.js';
import * as D from '../src/dists.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);

test('price formats', () => {
  close(O.americanToDecimal(-110), 1.909091, 1e-6);
  close(O.americanToDecimal(150), 2.5);
  close(O.americanToDecimal(100), 2);
  close(O.americanToDecimal(-100), 2);
  assert.ok(Number.isNaN(O.americanToDecimal(50)));
  assert.equal(O.decimalToAmerican(1 + 100 / 110), -110);
  assert.equal(O.decimalToAmerican(2.5), 150);
  assert.equal(O.decimalToAmerican(2), 100);
  assert.equal(O.formatAmerican(-100), '+100');
  assert.equal(O.formatAmerican(105), '+105');
  assert.equal(O.parseAmerican('+105'), 105);
  assert.equal(O.parseAmerican('−110'), -110);
  assert.equal(O.parseAmerican('even'), 100);
  assert.ok(Number.isNaN(O.parseAmerican('99')));
  assert.ok(Number.isNaN(O.parseAmerican('abc')));
});

test('removing the vig', () => {
  for (const m of Object.keys(O.DEVIG_METHODS)) {
    const f = O.devig([-110, -110], m);
    close(f[0], 0.5, 1e-9);
  }
  // -200 / +170: the favorite's implied 66.7%, the dog's 37.0%, 3.7% over 100.
  const prop = O.devig([-200, 170], 'multiplicative');
  close(prop[0], (2 / 3) / (2 / 3 + 1 / 2.7), 1e-9);
  const add = O.devig([-200, 170], 'additive');
  close(add[0] + add[1], 1, 1e-12);
  close(add[0], 2 / 3 - ((2 / 3 + 1 / 2.7) - 1) / 2, 1e-9);
  // Power and Shin put more of the vig on the longshot, so the favorite's fair chance is higher.
  const pow = O.devig([-200, 170], 'power');
  const shin = O.devig([-200, 170], 'shin');
  close(pow[0] + pow[1], 1, 1e-9);
  close(shin[0] + shin[1], 1, 1e-9);
  assert.ok(pow[0] > prop[0] && shin[0] > prop[0]);
  assert.ok(pow[0] < 2 / 3 && shin[0] < 2 / 3);
  // Power method: p_i = pi_i^k with the same k for both sides.
  const k = Math.log(pow[0]) / Math.log(2 / 3);
  close(Math.log(pow[1]) / Math.log(1 / 2.7), k, 1e-6);
  close(O.hold([-110, -110]), 1 - 1 / (2 / 1.909091), 1e-6);
});

test('expected value, fair prices and Kelly with pushes', () => {
  close(O.evOf(0.5, 0, 100), 0);
  close(O.evOf(0.55, 0, -110), 0.55 * (100 / 110) - 0.45, 1e-12);
  // A push returns the stake.
  close(O.evOf(0.45, 0.1, 100), 0);
  assert.equal(O.fairAmerican(0.5), 100);
  assert.equal(O.fairAmerican(0.6), -150);
  assert.equal(O.fairAmerican(0.45, 0.1), 100);
  close(O.kellyFraction(0.55, 0, 100), 0.1, 1e-12);
  // (b p - q) / (b (p + q)) with b = 1, p = 0.5, q = 0.4.
  close(O.kellyFraction(0.5, 0.1, 100), 0.1 / 0.9, 1e-12);
  assert.equal(O.kellyFraction(0.4, 0, 100), 0);
  const s = { bankroll: 1000, kelly: 0.25, minPct: 0.005, maxPct: 0.05 };
  assert.deepEqual(O.stakeFor(0.55, 0, 100, s).stake, 25);
  // Tiny edge at long odds: quarter Kelly is under the 0.5% minimum and so is full Kelly, so no floor.
  const tiny = O.stakeFor(0.202, 0, 400, s);
  assert.ok(tiny.full < 0.005 && tiny.stake < 5 && !tiny.floored);
  // Small edge at even money: quarter Kelly under the minimum, full Kelly over it, so the minimum.
  const small = O.stakeFor(0.508, 0, 100, s);
  assert.equal(small.stake, 5);
  assert.ok(small.floored);
  // Huge edge: capped at 5%.
  const big = O.stakeFor(0.9, 0, 100, s);
  assert.equal(big.stake, 50);
  assert.ok(big.capped);
});

test('distributions are proper and centered', () => {
  for (const sport of ['nfl', 'cfb', 'nba', 'ncaab']) {
    const par = D.DISTS[sport];
    for (const mu of [-10.3, -3, 0, 2.5, 7, 14]) {
      const d = D.marginPMF(par.margin, mu);
      close(d.p.reduce((a, b) => a + b, 0), 1, 1e-9);
      assert.ok(d.p.every((x) => x >= 0));
    }
    const t = D.totalPMF(par.total, 45);
    close(t.p.reduce((a, b) => a + b, 0), 1, 1e-9);
  }
  // Basketball has no ties.
  const nba = D.marginPMF(D.DISTS.nba.margin, 0);
  assert.equal(nba.p[0 - nba.lo], 0);
});

test('NFL key numbers: the hook on 3 and 7 is worth what the data says', () => {
  // Bills -3 at a fair 50% (pushes left out).
  const mu = D.centerFrom('nfl', 'spread', -3, 0.5);
  const at3 = D.chances('nfl', 'spread', mu, 'home', -3);
  close(at3.win / (at3.win + at3.loss), 0.5, 1e-6);
  // Lined on 3, the favorite wins by exactly 3 about one game in ten (10.6% in 2015 to 2025 data).
  assert.ok(at3.push > 0.085 && at3.push < 0.115, `push on 3: ${at3.push}`);
  const at25 = D.chances('nfl', 'spread', mu, 'home', -2.5);
  const at35 = D.chances('nfl', 'spread', mu, 'home', -3.5);
  close(at25.win, at3.win + at3.push, 1e-9);
  close(at35.win, at3.win, 1e-9);
  assert.equal(at25.push, 0);
  // -2.5 is worth about 55% when -3 is a coin flip: fair about -122.
  assert.ok(at25.win > 0.535 && at25.win < 0.565, `-2.5: ${at25.win}`);
  // 7 lands less than 3 but far more than 6 or 8.
  const mu7 = D.centerFrom('nfl', 'spread', -7, 0.5);
  const at7 = D.chances('nfl', 'spread', mu7, 'home', -7);
  assert.ok(at7.push > 0.055 && at7.push < 0.085, `push on 7: ${at7.push}`);
  const mu5 = D.centerFrom('nfl', 'spread', -5, 0.5);
  assert.ok(D.chances('nfl', 'spread', mu5, 'home', -5).push < at7.push);
  // Same answer from the other side.
  const away = D.chances('nfl', 'spread', mu, 'away', 3);
  close(away.win, at3.loss, 1e-9);
  close(away.push, at3.push, 1e-9);
});

test('centers solve back to the price they came from', () => {
  for (const [sport, market, line, p] of [['nfl', 'spread', -6.5, 0.53], ['cfb', 'spread', 14, 0.47], ['nba', 'spread', -4.5, 0.5], ['ncaab', 'spread', 9.5, 0.55], ['nfl', 'total', 44.5, 0.52], ['nba', 'total', 228, 0.49]]) {
    const c = D.centerFrom(sport, market, line, p);
    const side = market === 'spread' ? 'home' : 'over';
    const ch = D.chances(sport, market, c, side, line);
    close(ch.win / (ch.win + ch.loss), p, 1e-5);
  }
  // Moving a basketball line one point moves the cover chance about one density step (~3%).
  const c = D.centerFrom('nba', 'spread', -5.5, 0.5);
  const d = D.chances('nba', 'spread', c, 'home', -4.5).win - 0.5;
  assert.ok(d > 0.022 && d < 0.035, `NBA point: ${d}`);
});

test('whole-number NFL totals push less than the curve, as in the data', () => {
  const c = D.centerFrom('nfl', 'total', 44, 0.5);
  const at44 = D.chances('nfl', 'total', c, 'over', 44);
  assert.ok(at44.push > 0.012 && at44.push < 0.026, `push on 44: ${at44.push}`);
  close(at44.win + at44.push + at44.loss, 1, 1e-9);
  // Next to a half-point total, the whole number keeps its full share.
  const c2 = D.centerFrom('nfl', 'total', 44.5, 0.5);
  const over44 = D.chances('nfl', 'total', c2, 'over', 44);
  const over45 = D.chances('nfl', 'total', c2, 'over', 45);
  assert.ok(over44.win > 0.5 && over45.win < 0.5);
});
