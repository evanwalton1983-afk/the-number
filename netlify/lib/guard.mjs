// Shared by the functions that spend Odds API credits: JSON replies, the passcode check and
// per-address limits, so guessing the passcode is slow and nobody can drain the credits.
import { createHash, timingSafeEqual } from 'node:crypto';

export function reply(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers },
  });
}

// The switch for the features that need the owner's Odds API key.
export function oddsOn(env = process.env) {
  return !!String(env.APP_PASSCODE || '').trim() && !!String(env.ODDS_API_KEY || '').trim();
}

// The key without the stray space or line break a paste into Netlify can leave.
export const oddsKey = () => String(process.env.ODDS_API_KEY || '').trim();

const misses = new Map();
const calls = new Map();
function recent(map, ip, windowMs) {
  const now = Date.now();
  const list = (map.get(ip) || []).filter((t) => now - t < windowMs);
  map.set(ip, list);
  return list;
}

function sameSecret(a, b) {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

// Returns a Response to send back when the request may not go on, or null when it may.
// max: requests allowed per address in 10 minutes.
export function gate(req, max) {
  if (!oddsOn()) return reply({ error: 'Live odds are not set up. Add ODDS_API_KEY and APP_PASSCODE in Netlify.' }, 503);
  const ip = req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || 'x';
  if (recent(misses, ip, 15 * 60 * 1000).length >= 8) return reply({ error: 'Too many wrong passcodes. Try again in 15 minutes.' }, 429);
  if (!sameSecret((req.headers.get('x-number-passcode') || '').trim(), String(process.env.APP_PASSCODE).trim())) {
    recent(misses, ip, 15 * 60 * 1000).push(Date.now());
    return reply({ error: 'Wrong passcode' }, 401);
  }
  const list = recent(calls, ip, 10 * 60 * 1000);
  list.push(Date.now());
  if (list.length > max) return reply({ error: 'Too many requests in 10 minutes. Try again shortly.' }, 429);
  return null;
}

// Netlify's per-region cache, when the function runs on Netlify (absent in plain Node tests).
export async function cacheGet(key) {
  try {
    if (typeof caches === 'undefined') return null;
    const c = await caches.open('the-number');
    const hit = await c.match(new Request(`https://cache.the-number.local/${key}`));
    return hit ? await hit.json() : null;
  } catch {
    return null;
  }
}

export async function cachePut(key, body, seconds) {
  try {
    if (typeof caches === 'undefined') return;
    const c = await caches.open('the-number');
    await c.put(new Request(`https://cache.the-number.local/${key}`), new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${seconds}` },
    }));
  } catch {
    // A cache miss next time is fine.
  }
}

// Remaining and used credits from The Odds API's response headers.
export function credits(res) {
  const n = (k) => {
    const v = Number(res.headers.get(k));
    return Number.isFinite(v) ? v : null;
  };
  return { remaining: n('x-requests-remaining'), used: n('x-requests-used'), last: n('x-requests-last') };
}

// Plain-language error for an Odds API answer that is not 200.
export async function upstreamError(res) {
  let msg = '';
  try {
    const j = await res.json();
    msg = (j && (j.message || j.error_code)) || '';
  } catch {
    // not JSON
  }
  if (res.status === 401) return reply({ error: 'The Odds API turned down the key. Check ODDS_API_KEY in Netlify.', detail: msg }, 502);
  if (res.status === 429) return reply({ error: 'The Odds API says the monthly credits are used up or requests came too fast.', detail: msg }, 429);
  if (res.status === 422 || res.status === 400) return reply({ error: 'The Odds API did not accept the request.', detail: msg }, 400);
  return reply({ error: `The Odds API answered ${res.status}.`, detail: msg }, 502);
}

// Only the fields the app uses, so a phone downloads a fraction of the feed.
export function trimEvents(events) {
  return (Array.isArray(events) ? events : []).map((e) => ({
    id: e.id,
    commence_time: e.commence_time,
    home_team: e.home_team,
    away_team: e.away_team,
    bookmakers: (e.bookmakers || []).map((b) => ({
      key: b.key,
      title: b.title,
      last_update: b.last_update,
      link: b.link || undefined,
      markets: (b.markets || []).map((m) => ({
        key: m.key,
        last_update: m.last_update,
        link: m.link || undefined,
        outcomes: (m.outcomes || []).map((o) => ({ name: o.name, price: o.price, point: o.point, link: o.link || undefined })),
      })),
    })),
  }));
}
