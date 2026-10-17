// Fair (no-vig) chances from one market's prices, four ways. Decimal odds in; chances that add
// to 1 out, or null without at least two prices above 1. Pure functions, shared by the app
// (through devig in odds.js) and the tests.
//
//  multiplicative: scale every implied chance down by the same factor.
//  additive: take the same amount off each.
//  power: raise each to the one power k that makes them add to 1 (more of the margin on longshots).
//  shin: Shin's model of a book guarding against insiders. A closed form on two outcomes, a
//    fixed-point iteration on three or more.

export const FAIR_METHODS = {
  shin: 'Shin',
  power: 'Power',
  multiplicative: 'Multiplicative',
  additive: 'Additive',
};

// Only the four names count; "constructor" and the like, which every object has, do not.
export const isFairMethod = (method) => Object.prototype.hasOwnProperty.call(FAIR_METHODS, method);

const total = (xs) => xs.reduce((a, b) => a + b, 0);
const scaled = (xs) => {
  const t = total(xs);
  return xs.map((x) => x / t);
};

// The implied chance of each outcome, 1 / decimal odds, or null.
function implied(odds) {
  if (!Array.isArray(odds) || odds.length < 2) return null;
  const pi = odds.map((o) => 1 / Number(o));
  return pi.every((p) => p > 0 && p < 1) ? pi : null;
}

function bisect(f, lo, hi, iters = 80) {
  let a = lo;
  let b = hi;
  let fa = f(a);
  for (let i = 0; i < iters; i++) {
    const m = (a + b) / 2;
    const fm = f(m);
    if ((fm > 0) === (fa > 0)) {
      a = m;
      fa = fm;
    } else b = m;
  }
  return (a + b) / 2;
}

/*! Multiplicative, additive and power follow the implied module of penaltyblog,
 * https://github.com/martineastwood/penaltyblog (MIT):
 *
 * Copyright 2021 Martin Eastwood
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files
 * (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished
 * to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
 * OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS
 * BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

export function multiplicative(odds) {
  const pi = implied(odds);
  return pi && scaled(pi);
}

// When the equal cut would take a longshot to zero or below, multiplicative stands in.
export function additive(odds) {
  const pi = implied(odds);
  if (!pi) return null;
  const cut = (total(pi) - 1) / pi.length;
  const out = pi.map((p) => p - cut);
  return out.every((p) => p > 0) ? out : scaled(pi);
}

export function power(odds) {
  const pi = implied(odds);
  if (!pi) return null;
  const k = bisect((x) => pi.reduce((a, p) => a + Math.pow(p, x), 0) - 1, 0.05, 20);
  return scaled(pi.map((p) => Math.pow(p, k)));
}

/*! Shin's method follows shin, https://github.com/mberk/shin (MIT): the closed form for two
 * outcomes and the fixed-point iteration, with its defaults, for three or more.
 *
 * The MIT License
 *
 * Copyright (c) 2020, Maurice Berk
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

// One outcome's fair chance under Shin's model, given its implied chance p, their total s and z.
const shinChance = (p, s, z) => (Math.sqrt(z * z + (4 * (1 - z) * p * p) / s) - z) / (2 * (1 - z));

// z: the share of the money the book prices as coming from insiders. No margin means no z.
function solveZ(pi, maxIterations = 1000, threshold = 1e-12) {
  const n = pi.length;
  const s = total(pi);
  if (s <= 1) return { z: 0, iterations: 0 };
  if (n === 2) {
    const d = pi[0] - pi[1];
    return { z: ((s - 1) * (d * d - s)) / (s * (d * d - 1)), iterations: 0 };
  }
  let z = 0;
  let delta = Infinity;
  let iterations = 0;
  while (delta > threshold && iterations < maxIterations) {
    const z0 = z;
    z = (pi.reduce((a, p) => a + Math.sqrt(z0 * z0 + (4 * (1 - z0) * p * p) / s), 0) - 2) / (n - 2);
    delta = Math.abs(z - z0);
    iterations++;
  }
  // A thin margin makes the fixed point crawl; finish the same equation by bisection. (Written
  // so a step that went wrong, NaN, also lands here.)
  if (!(delta <= threshold)) z = bisect((x) => total(pi.map((p) => shinChance(p, s, x))) - 1, 0, 0.999);
  return { z, iterations };
}

// { z, iterations } for a market's decimal odds; iterations is 0 where the closed form applies.
export function shinSolve(odds) {
  const pi = implied(odds);
  return pi && solveZ(pi);
}

export function shin(odds) {
  const pi = implied(odds);
  if (!pi) return null;
  const s = total(pi);
  const { z } = solveZ(pi);
  return scaled(pi.map((p) => shinChance(p, s, z)));
}

const BY_METHOD = { shin, power, multiplicative, additive };

// Fair chances by one of FAIR_METHODS; null for an unknown method.
export function fairProbs(odds, method = 'shin') {
  return isFairMethod(method) ? BY_METHOD[method](odds) : null;
}
