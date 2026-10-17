// Fits the margin and total curves in src/dists.js on closing lines, closing prices and final
// scores, and prints how often each line pushed in the data against the fitted curve.
//
//   node scripts/fit-dists.mjs --nfl games.csv --cfb cfb_lines.csv \
//     --nba nba_states.csv --nba-totals nba_raw_states.csv --ncaab mbb_raw_states.csv
//
// games.csv: nflverse/nfldata games, 2015 on (spread_line is the home team's expected margin,
// result is home minus away, with closing spread and total prices). The other files have one row
// per game moment with spread_home (the home line), total_line and final scores, sampled from
// sportsdataverse's ESPN game files; only the lines and finals are used, priced at a coin flip.
//
// Each game's curve is centered where the closing price says (the app does the same with the
// sharp book's price), so a fit and a live price use the curve the same way.
import fs from 'node:fs';
import { marginPMF, totalPMF, split, solveMargin, solveTotal } from '../src/dists.js';
import { devig } from '../src/odds.js';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];

function csv(file) {
  const [head, ...lines] = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  const cols = head.split(',');
  return lines.map((l) => {
    const v = l.split(',');
    return Object.fromEntries(cols.map((c, i) => [c, v[i]]));
  });
}
const num = (x) => (x === undefined || x === '' || x === 'NA' ? NaN : Number(x));
const uniq = (rows) => [...new Map(rows.map((r) => [r.game_id, r])).values()];
const noVig = (a, b) => {
  const f = Number.isFinite(a) && Number.isFinite(b) ? devig([a, b], 'power') : null;
  return f ? Math.round(f[0] * 1000) / 1000 : 0.5;
};

// Margins: { m: home margin, h: home line, p: home no-vig chance }. Totals: { t, line, p }.
function nflData(file, from = 2015) {
  const rows = csv(file).filter((r) => num(r.season) >= from && Number.isFinite(num(r.result)) && Number.isFinite(num(r.spread_line)));
  return {
    margins: rows.map((r) => ({ m: num(r.result), h: -num(r.spread_line), p: noVig(num(r.home_spread_odds), num(r.away_spread_odds)) })),
    totals: rows.filter((r) => Number.isFinite(num(r.total_line))).map((r) => ({ t: num(r.total), line: num(r.total_line), p: noVig(num(r.over_odds), num(r.under_odds)) })),
  };
}
function lineData(rows, scoreH, scoreA) {
  const ok = rows.filter((r) => Number.isFinite(num(r.spread_home)) && Number.isFinite(num(r[scoreH])));
  return {
    margins: ok.map((r) => ({ m: num(r[scoreH]) - num(r[scoreA]), h: num(r.spread_home), p: 0.5 })),
    totals: ok.filter((r) => Number.isFinite(num(r.total_line))).map((r) => ({ t: num(r[scoreH]) + num(r[scoreA]), line: num(r.total_line), p: 0.5 })),
  };
}

// Curves for every game under one set of parameters, shared by games with the same line and price.
function marginCurves(data, par) {
  const solved = new Map();
  return data.map((g) => {
    const k = `${g.h}|${g.p}`;
    if (!solved.has(k)) {
      const mu = solveMargin(par, g.h, g.p);
      solved.set(k, marginPMF(par, mu, -g.h));
    }
    return solved.get(k);
  });
}
function totalCurves(data, par) {
  const solved = new Map();
  return data.map((g) => {
    const k = `${g.line}|${g.p}`;
    if (!solved.has(k)) solved.set(k, totalPMF(par, solveTotal(par, g.line, g.p), g.line));
    return solved.get(k);
  });
}
const at = (d, x) => Math.max(1e-12, d.p[x - d.lo] || 0);
const LL = (data, curves, key) => data.reduce((a, g, i) => a + Math.log(at(curves[i], g[key])), 0);

// Weights by absolute margin so the curves' counts of each margin match the data (iterative
// proportional fitting; `a` pseudo-games pull thin margins back toward 1). Centers are re-solved
// between rounds so every game's curve still matches its closing price.
function fitWeights(data, base, a, K = 45, rounds = 5, iters = 12) {
  const w = new Array(K).fill(1);
  for (let r = 0; r < rounds; r++) {
    const centers = new Map();
    const keyOf = (g) => `${g.h}|${g.p}`;
    for (const g of data) if (!centers.has(keyOf(g))) centers.set(keyOf(g), solveMargin({ ...base, w }, g.h, g.p));
    for (let it = 0; it < iters; it++) {
      const curves = new Map();
      const obs = new Array(K).fill(0);
      const exp = new Array(K).fill(0);
      for (const g of data) {
        const k = keyOf(g);
        if (!curves.has(k)) curves.set(k, marginPMF({ ...base, w }, centers.get(k), -g.h));
        const d = curves.get(k);
        for (let i = 0; i < d.p.length; i++) {
          const x = Math.abs(d.lo + i);
          if (x < K) exp[x] += d.p[i];
        }
        if (Math.abs(g.m) < K) obs[Math.abs(g.m)] += 1;
      }
      for (let x = 0; x < K; x++) if (exp[x] > 0) w[x] *= (obs[x] + a) / (exp[x] + a);
    }
  }
  return w.map((x) => Math.round(x * 1000) / 1000);
}

function fitMargin(name, data, { sds, a, proxGrid, noTie }) {
  const tryPar = (sd, prox) => {
    const base = { sd, tau: 1, noTie, prox };
    const par = { ...base, w: a == null ? null : fitWeights(data, base, a) };
    return { par, L: LL(data, marginCurves(data, par), 'm') };
  };
  let best = null;
  for (const sd of sds) {
    const r = tryPar(sd, null);
    if (!best || r.L > best.L) best = r;
  }
  for (const prox of proxGrid || []) {
    const r = tryPar(best.par.sd, prox);
    if (r.L > best.L) best = r;
  }
  console.log(`${name} margins: ${data.length} games, fitted sd ${best.par.sd}, boosts ${JSON.stringify(best.par.prox)}, log-lik ${best.L.toFixed(1)}`);
  return best.par;
}

function fitTotal(name, data, { cs, pushes }) {
  let best = null;
  for (const c of cs) {
    const par = { c };
    const L = LL(data, totalCurves(data, par), 't');
    if (!best || L > best.L) best = { L, par };
  }
  for (const intPush of pushes || []) {
    const par = { c: best.par.c, intPush };
    const L = LL(data, totalCurves(data, par), 't');
    if (L > best.L) best = { L, par };
  }
  console.log(`${name} totals: ${data.length} games, fitted c ${best.par.c}${best.par.intPush ? `, whole-number push factor ${best.par.intPush}` : ''}, log-lik ${best.L.toFixed(1)}`);
  return best.par;
}

function pushReport(label, data, par, lines, kind) {
  const out = [];
  for (const L of lines) {
    const sub = kind === 'margin' ? data.filter((g) => Math.abs(g.h) === L) : data.filter((g) => g.line === L);
    if (sub.length < 25) continue;
    const curves = kind === 'margin' ? marginCurves(sub, par) : totalCurves(sub, par);
    const obs = sub.filter((g) => (kind === 'margin' ? g.m === -g.h : g.t === g.line)).length / sub.length;
    const model = sub.reduce((a, g, i) => a + split(curves[i], kind === 'margin' ? -g.h : g.line).eq, 0) / sub.length;
    out.push(`${L}: ${sub.length} games, pushed ${(obs * 100).toFixed(1)}%, curve ${(model * 100).toFixed(1)}%`);
  }
  console.log(`  ${label} pushes on the line\n    ${out.join('\n    ')}`);
}

const grid = (a, b, step) => Array.from({ length: Math.round((b - a) / step) + 1 }, (_, i) => Math.round((a + i * step) * 1000) / 1000);
const out = {};

if (args.nfl) {
  const d = nflData(args.nfl, Number(args.from || 2015));
  const proxGrid = [];
  for (const g3 of [0, 0.1, 0.2, 0.3]) for (const g7 of [0, 0.15, 0.3, 0.45]) if (g3 || g7) proxGrid.push({ 3: g3, 7: g7 });
  out.nfl = {
    margin: fitMargin('NFL', d.margins, { sds: grid(12.2, 13.2, 0.1), a: 2, proxGrid }),
    total: fitTotal('NFL', d.totals, { cs: grid(1.85, 2.15, 0.01), pushes: grid(0.4, 0.95, 0.05) }),
  };
  pushReport('NFL margin', d.margins, out.nfl.margin, [1, 2, 3, 4, 6, 7, 10, 14], 'margin');
  pushReport('NFL total', d.totals, out.nfl.total, [40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 51], 'total');
}
if (args.cfb) {
  const d = lineData(csv(args.cfb), 'home_score', 'away_score');
  out.cfb = { margin: fitMargin('CFB', d.margins, { sds: grid(15.2, 17.0, 0.1), a: 8 }), total: fitTotal('CFB', d.totals, { cs: grid(2.0, 2.45, 0.01) }) };
  pushReport('CFB margin', d.margins, out.cfb.margin, [3, 7, 10, 14], 'margin');
}
if (args.nba) {
  const m = lineData(uniq(csv(args.nba)), 'final_home', 'final_away');
  const t = args['nba-totals'] ? lineData(uniq(csv(args['nba-totals'])), 'final_home', 'final_away') : m;
  out.nba = { margin: fitMargin('NBA', m.margins, { sds: grid(12.6, 14.6, 0.1), a: null, noTie: true }), total: fitTotal('NBA', t.totals, { cs: grid(1.05, 1.4, 0.01) }) };
}
if (args.ncaab) {
  const d = lineData(uniq(csv(args.ncaab)), 'final_home', 'final_away');
  out.ncaab = { margin: fitMargin('NCAAB', d.margins, { sds: grid(10.0, 12.2, 0.1), a: null, noTie: true }), total: fitTotal('NCAAB', d.totals, { cs: grid(1.2, 1.6, 0.01) }) };
}

console.log(`\nexport const DISTS = ${JSON.stringify(out)};`);
