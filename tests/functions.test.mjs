import { test } from 'node:test';
import assert from 'node:assert/strict';
import scan from '../netlify/functions/scan.mjs';
import close from '../netlify/functions/close.mjs';
import status from '../netlify/functions/status.mjs';
import espn from '../netlify/functions/espn.mjs';
import { oddsWorld, espnWorld } from './world.mjs';

const NAMES = ['APP_PASSCODE', 'ODDS_API_KEY'];

// Runs fn with these variables set and fetch answered by `answer(url)`.
async function withEnv(env, answer, fn) {
  const saved = Object.fromEntries(NAMES.map((k) => [k, process.env[k]]));
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return answer(String(url));
  };
  for (const k of NAMES) delete process.env[k];
  Object.assign(process.env, env);
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = realFetch;
    for (const k of NAMES) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const KEYS = { APP_PASSCODE: 'pw', ODDS_API_KEY: 'odds-key' };
const get = (path, pass = 'pw', ip = '10.1.0.1') => new Request(`http://x${path}`, { headers: { 'x-number-passcode': pass, 'x-nf-client-connection-ip': ip } });
const oddsAnswer = (body, status = 200, headers = {}) => () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'x-requests-remaining': '471', 'x-requests-used': '29', 'x-requests-last': '3', ...headers } });

test('/api/status reports live odds only with the key and a passcode', async () => {
  await withEnv({}, null, async () => assert.deepEqual(await (await status()).json(), { odds: false }));
  await withEnv({ ODDS_API_KEY: 'k' }, null, async () => assert.deepEqual(await (await status()).json(), { odds: false }));
  await withEnv(KEYS, null, async () => assert.deepEqual(await (await status()).json(), { odds: true }));
});

test('/api/scan asks The Odds API for one sport, trimmed, with credits', async () => {
  const w = oddsWorld(Date.now());
  const raw = w.nfl.map((e) => ({ ...e, extra: 'dropped', bookmakers: e.bookmakers.map((b) => ({ ...b, junk: 1 })) }));
  await withEnv(KEYS, oddsAnswer(raw), async (calls) => {
    const res = await scan(get('/api/scan?sport=nfl&books=pinnacle,draftkings,fanduel,nonsense&markets=h2h,spreads,totals'));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(calls.length, 1);
    const u = new URL(calls[0]);
    assert.equal(u.pathname, '/v4/sports/americanfootball_nfl/odds');
    assert.equal(u.searchParams.get('bookmakers'), 'draftkings,fanduel,pinnacle');
    assert.equal(u.searchParams.get('markets'), 'h2h,spreads,totals');
    assert.equal(u.searchParams.get('includeLinks'), 'true');
    assert.match(u.searchParams.get('commenceTimeFrom'), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.equal(body.cost, 3);
    assert.deepEqual(body.credits, { remaining: 471, used: 29, last: 3 });
    assert.equal(body.events.length, 3);
    assert.equal(body.events[0].extra, undefined);
    assert.equal(body.events[0].bookmakers[0].junk, undefined);
    assert.ok(body.events[0].bookmakers[0].markets[0].outcomes[0].link);
  });
});

test('/api/scan guards the credits', async () => {
  await withEnv({ ODDS_API_KEY: 'k' }, oddsAnswer([]), async (calls) => {
    assert.equal((await scan(get('/api/scan?sport=nfl&books=draftkings'))).status, 503);
    assert.equal(calls.length, 0);
  });
  await withEnv(KEYS, oddsAnswer([]), async (calls) => {
    assert.equal((await scan(get('/api/scan?sport=nfl&books=draftkings', 'nope', '10.2.0.1'))).status, 401);
    assert.equal((await scan(get('/api/scan?sport=golf&books=draftkings', 'pw', '10.2.0.2'))).status, 400);
    assert.equal((await scan(get('/api/scan?sport=nfl&books=nonsense', 'pw', '10.2.0.3'))).status, 400);
    // UFC has only moneylines; asking for spreads alone is refused.
    assert.equal((await scan(get('/api/scan?sport=ufc&books=draftkings&markets=spreads', 'pw', '10.2.0.4'))).status, 400);
    assert.equal(calls.length, 0);
    // Eleven books count as two regions.
    const res = await scan(get('/api/scan?sport=nfl&books=pinnacle,draftkings,fanduel,betmgm,williamhill_us,fanatics,espnbet,betrivers,hardrockbet,ballybet,betonlineag&markets=spreads', 'pw', '10.2.0.5'));
    assert.equal((await res.json()).cost, 2);
  });
  // Wrong passcodes lock the address out.
  await withEnv(KEYS, oddsAnswer([]), async () => {
    for (let i = 0; i < 8; i++) await scan(get('/api/scan?sport=nfl&books=draftkings', 'guess', '10.3.0.1'));
    assert.equal((await scan(get('/api/scan?sport=nfl&books=draftkings', 'pw', '10.3.0.1'))).status, 429);
  });
});

test('/api/scan explains Odds API errors', async () => {
  await withEnv(KEYS, oddsAnswer({ message: 'API key is not valid' }, 401), async () => {
    const res = await scan(get('/api/scan?sport=nba&books=draftkings', 'pw', '10.4.0.1'));
    assert.equal(res.status, 502);
    assert.match((await res.json()).error, /key/);
  });
  await withEnv(KEYS, oddsAnswer({ message: 'Usage quota has been reached' }, 429), async () => {
    const res = await scan(get('/api/scan?sport=nba&books=draftkings', 'pw', '10.4.0.2'));
    assert.equal(res.status, 429);
    assert.match((await res.json()).error, /credits/);
  });
});

test('/api/scan forgives stray spaces and retries a refused request without the extras', async () => {
  // A key and passcode pasted with a trailing space or line break still work.
  await withEnv({ APP_PASSCODE: 'pw \n', ODDS_API_KEY: ' odds-key\n' }, oddsAnswer([]), async (calls) => {
    const res = await scan(get('/api/scan?sport=nfl&books=draftkings', ' pw ', '10.5.0.1'));
    assert.equal(res.status, 200);
    assert.equal(new URL(calls[0]).searchParams.get('apiKey'), 'odds-key');
  });
  // The Odds API refuses links or paid-plan books: one more ask without them.
  const w = oddsWorld(Date.now());
  const answer = (url) => (new URL(url).searchParams.has('includeLinks') ? oddsAnswer({ message: 'Invalid parameter' }, 422)() : oddsAnswer(w.nfl)());
  await withEnv(KEYS, answer, async (calls) => {
    const res = await scan(get('/api/scan?sport=nfl&books=pinnacle,draftkings,williamhill_us,fanatics&markets=spreads', 'pw', '10.5.0.2'));
    assert.equal(res.status, 200);
    assert.equal(calls.length, 2);
    assert.equal(new URL(calls[1]).searchParams.get('bookmakers'), 'draftkings,pinnacle');
    assert.equal((await res.json()).events.length, 3);
  });
  // Still refused: the reason comes back with The Odds API's own words.
  await withEnv(KEYS, oddsAnswer({ message: 'Invalid sport' }, 422), async (calls) => {
    const res = await scan(get('/api/scan?sport=nfl&books=draftkings&markets=spreads', 'pw', '10.5.0.3'));
    assert.equal(res.status, 400);
    assert.equal(calls.length, 2);
    assert.equal((await res.json()).detail, 'Invalid sport');
  });
});

test('/api/close reads the sharp price at kickoff, and says when the plan has no history', async () => {
  const w = oddsWorld(Date.now() - 3 * 3600e3);
  await withEnv(KEYS, oddsAnswer({ timestamp: '2026-10-04T16:55:00Z', data: w.nfl.slice(0, 1) }), async (calls) => {
    const res = await close(get('/api/close?sport=nfl&date=2026-10-04T17:00:00Z&markets=spreads,totals', 'pw', '10.5.0.1'));
    assert.equal(res.status, 200);
    const body = await res.json();
    const u = new URL(calls[0]);
    assert.equal(u.pathname, '/v4/historical/sports/americanfootball_nfl/odds');
    assert.equal(u.searchParams.get('bookmakers'), 'pinnacle');
    assert.equal(u.searchParams.get('date'), '2026-10-04T17:00:00Z');
    assert.equal(body.snapshot, '2026-10-04T16:55:00Z');
    assert.equal(body.events.length, 1);
  });
  await withEnv(KEYS, oddsAnswer({ message: 'Historical data is only available on paid usage plans' }, 401), async () => {
    const res = await close(get('/api/close?sport=nfl&date=2026-10-04T17:00:00Z&markets=spreads', 'pw', '10.5.0.2'));
    assert.equal(res.status, 402);
    assert.equal((await res.json()).paidOnly, true);
  });
  await withEnv(KEYS, oddsAnswer({}), async () => {
    const future = new Date(Date.now() + 3600e3).toISOString().replace(/\.\d{3}Z$/, 'Z');
    assert.equal((await close(get(`/api/close?sport=nfl&date=${future}&markets=spreads`, 'pw', '10.5.0.3'))).status, 400);
  });
});

test('/api/espn cleans the scoreboard and caches finals longer', async () => {
  const now = Date.now();
  await withEnv({}, () => new Response(JSON.stringify(espnWorld(now, 'final')), { headers: { 'content-type': 'application/json' } }), async () => {
    const res = await espn(new Request('http://x/api/espn?sport=nfl&kind=scoreboard&date=20261011'));
    const body = await res.json();
    assert.equal(body.games.length, 2);
    assert.equal(body.games[0].state, 'post');
    assert.match(res.headers.get('netlify-cdn-cache-control'), /s-maxage=600/);
  });
});
