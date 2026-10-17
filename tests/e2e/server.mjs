// Local test server: serves public/ and runs the real Netlify functions, with The Odds API and
// ESPN answered from the scripted world in tests/world.mjs.
//
//   node tests/e2e/server.mjs [port]
//   GET /__step?s=pre|final   moves ESPN from before the games to after them
//   GET /__plan?paid=0|1      whether The Odds API history (exact closing lines) is available
//   GET /__keys?on=0|1        takes the Odds API key away, as on a site without one
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { oddsWorld, espnWorld } from '../world.mjs';
import { SPORTS, SPORT_KEYS } from '../../src/sports.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.resolve(here, '../../public');
const port = Number(process.argv[2] || 4510);
const WORLD_NOW = Number(process.argv[3]) || Date.now();

process.env.APP_PASSCODE = 'test-pass';
process.env.ODDS_API_KEY = 'test-odds';

// The browser's clock jumps ahead in the test; the functions follow it through Date.now.
let offset = 0;
const realNow = Date.now;
Date.now = () => realNow() + offset;

let step = 'pre';
let paid = false;
const calls = [];
let credits = 500;

const world = oddsWorld(WORLD_NOW);
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  calls.push(u.replace(/apiKey=[^&]+/, 'apiKey=***'));
  if (u.startsWith('https://api.the-odds-api.com/v4/sports?')) {
    return json(SPORT_KEYS.map((k) => ({ key: SPORTS[k].oddsKey, active: k !== 'ncaab' })));
  }
  const hist = /\/v4\/historical\/sports\/([^/]+)\/odds/.exec(u);
  if (hist) {
    if (!paid) return json({ message: 'Historical odds are only available on paid usage plans.' }, 401);
    const sport = SPORT_KEYS.find((k) => SPORTS[k].oddsKey === hist[1]);
    credits -= 10;
    return json({ timestamp: new URL(u).searchParams.get('date'), data: world[sport] || [] }, 200, { 'x-requests-remaining': String(credits), 'x-requests-used': String(500 - credits), 'x-requests-last': '10' });
  }
  const live = /\/v4\/sports\/([^/]+)\/odds/.exec(u);
  if (live) {
    const sport = SPORT_KEYS.find((k) => SPORTS[k].oddsKey === live[1]);
    const cost = new URL(u).searchParams.get('markets').split(',').length;
    credits -= cost;
    return json(world[sport] || [], 200, { 'x-requests-remaining': String(credits), 'x-requests-used': String(500 - credits), 'x-requests-last': String(cost) });
  }
  if (u.includes('site.api.espn.com')) {
    if (u.includes('/football/nfl/scoreboard')) return json(espnWorld(WORLD_NOW, step));
    return json({ events: [] });
  }
  return realFetch(url, opts);
};

const fns = {};
for (const name of ['scan', 'close', 'sports', 'espn', 'status']) fns[`/api/${name}`] = (await import(`../../netlify/functions/${name}.mjs`)).default;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname === '/__step') {
    step = url.searchParams.get('s') || 'pre';
    res.end(step);
    return;
  }
  if (url.pathname === '/__time') {
    offset = Number(url.searchParams.get('ms')) || 0;
    res.end(String(offset));
    return;
  }
  if (url.pathname === '/__plan') {
    paid = url.searchParams.get('paid') === '1';
    res.end(String(paid));
    return;
  }
  if (url.pathname === '/__keys') {
    if (url.searchParams.get('on') === '1') process.env.ODDS_API_KEY = 'test-odds';
    else delete process.env.ODDS_API_KEY;
    res.end('ok');
    return;
  }
  if (url.pathname === '/__calls') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(calls));
    return;
  }
  const fn = fns[url.pathname];
  if (fn) {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    const out = await fn(new Request(url.toString(), { method: req.method, headers }));
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
    return;
  }
  const rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const file = path.join(pub, path.normalize(rel));
  if (!file.startsWith(pub) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.listen(port, () => console.log(`ready on ${port}`));
