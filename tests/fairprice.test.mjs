import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../src/fairprice.js';
import * as O from '../src/odds.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const METHODS = ['multiplicative', 'additive', 'power', 'shin'];

// An independent solve of Shin's model: the z that makes its chances add to 1, by bisection.
function shinByBisection(odds) {
  const pi = odds.map((o) => 1 / o);
  const S = sum(pi);
  const at = (z) => pi.map((p) => (Math.sqrt(z * z + 4 * (1 - z) * (p * p) / S) - z) / (2 * (1 - z)));
  let lo = 0;
  let hi = 0.5;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (sum(at(mid)) > 1) lo = mid;
    else hi = mid;
  }
  const z = (lo + hi) / 2;
  return { z, p: at(z) };
}

test('the four methods', () => {
  assert.deepEqual(Object.keys(F.FAIR_METHODS).sort(), [...METHODS].sort());
});

test('Shin on 2.6, 2.4, 4.3 matches the shin README', () => {
  const p = F.fairProbs([2.6, 2.4, 4.3], 'shin');
  close(p[0], 0.3730, 5e-5);
  close(p[1], 0.4048, 5e-5);
  close(p[2], 0.2222, 5e-5);
  // The package's own output, to more places.
  close(p[0], 0.37299406033208965, 1e-9);
  close(p[1], 0.4047794109200184, 1e-9);
  close(p[2], 0.2222265287474275, 1e-9);
});

test('every method sums to 1', () => {
  const markets = [
    [1.909, 1.909], // -110 both ways
    [1.5, 2.7], // -200 / +170
    [1.25, 4.0], // -400 / +300
    [1.04, 12], // a long favorite
    [2.6, 2.4, 4.3], // the shin README
    [2.7, 2.3, 4.4], // the penaltyblog example
    [1.05, 15, 41, 101], // a longshot that additive would push below zero
    [3.5, 4.2, 6, 8, 11, 17, 26], // a race
  ];
  for (const odds of markets) {
    for (const m of METHODS) {
      const p = F.fairProbs(odds, m);
      assert.ok(Array.isArray(p) && p.length === odds.length, `${m} on ${odds}`);
      close(sum(p), 1, 1e-12);
      assert.ok(p.every((x) => x > 0 && x < 1), `${m} on ${odds}: ${p}`);
    }
  }
});

test('Shin on two outcomes is the closed form, with no iterations', () => {
  for (const odds of [[1.5, 2.7], [1.25, 4.0], [1.909, 1.909], [1.04, 12]]) {
    const s = F.shinSolve(odds);
    assert.equal(s.iterations, 0);
    close(s.z, shinByBisection(odds).z, 1e-9);
    // On two outcomes Shin comes out the same as taking an equal amount off each side.
    const shin = F.fairProbs(odds, 'shin');
    const add = F.fairProbs(odds, 'additive');
    close(shin[0], add[0], 1e-12);
    close(shin[1], add[1], 1e-12);
  }
});

test('Shin on three or more outcomes iterates to a fixed point', () => {
  const s = F.shinSolve([2.6, 2.4, 4.3]);
  assert.ok(s.iterations > 0 && s.iterations < 1000, `iterations ${s.iterations}`);
  assert.ok(s.z > 0 && s.z < 0.1, `z ${s.z}`);
  const race = F.shinSolve([3.5, 4.2, 6, 8, 11, 17, 26]);
  assert.ok(race.iterations > 0 && race.iterations < 1000);
});

test('Shin still lands exactly when the iteration crawls (a 0.2% margin)', () => {
  // Three outcomes and a thin margin: 1000 fixed-point steps are not enough on their own.
  const odds = [2, 2.5, 9.8039];
  const want = shinByBisection(odds);
  close(F.shinSolve(odds).z, want.z, 1e-12);
  const p = F.fairProbs(odds, 'shin');
  p.forEach((x, i) => close(x, want.p[i], 1e-12));
});

test('power solves one exponent k so the probabilities sum to 1', () => {
  const odds = [2.7, 2.3, 4.4];
  const p = F.fairProbs(odds, 'power');
  const pi = odds.map((o) => 1 / o);
  const k = Math.log(p[0]) / Math.log(pi[0]);
  assert.ok(k > 1, `k ${k}`);
  for (let i = 1; i < odds.length; i++) close(Math.log(p[i]) / Math.log(pi[i]), k, 1e-9);
});

test('multiplicative scales each chance; additive takes the same amount off each', () => {
  const odds = [2.7, 2.3, 4.4];
  const pi = odds.map((o) => 1 / o);
  const mult = F.fairProbs(odds, 'multiplicative');
  const add = F.fairProbs(odds, 'additive');
  for (let i = 0; i < odds.length; i++) {
    close(mult[i], pi[i] / sum(pi), 1e-12);
    close(pi[i] - add[i], (sum(pi) - 1) / odds.length, 1e-12);
  }
  // When an equal cut would take a longshot below zero, additive falls back to multiplicative.
  const deep = [1.05, 15, 41, 101];
  assert.deepEqual(F.fairProbs(deep, 'additive'), F.fairProbs(deep, 'multiplicative'));
});

test('a market with no margin comes back as it is', () => {
  for (const m of METHODS) {
    const p = F.fairProbs([1.5, 3], m);
    close(p[0], 2 / 3, 1e-12);
    close(p[1], 1 / 3, 1e-12);
  }
});

test('bad odds or an unknown method give null', () => {
  assert.equal(F.fairProbs([2.1], 'shin'), null);
  assert.equal(F.fairProbs([1, 3], 'shin'), null);
  assert.equal(F.fairProbs([NaN, 2], 'power'), null);
  assert.equal(F.fairProbs([], 'additive'), null);
  assert.equal(F.fairProbs([1.9, 1.9], 'magic'), null);
  // Names every object inherits are not methods (a restored backup could carry anything).
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.equal(F.fairProbs([1.9, 1.9], name), null, name);
    assert.equal(F.isFairMethod(name), false, name);
  }
  assert.ok(METHODS.every(F.isFairMethod));
  // devig reads an unknown name as power, as it always has.
  assert.deepEqual(O.devig([-200, 170], 'constructor'), O.devig([-200, 170], 'power'));
});

test('devig on American prices reads the same module', () => {
  for (const m of METHODS) {
    const a = O.devig([-200, 170], m);
    const b = F.fairProbs([1.5, 2.7], m);
    close(a[0], b[0], 1e-12);
    close(a[1], b[1], 1e-12);
  }
});
