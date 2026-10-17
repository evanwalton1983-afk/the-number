// GET /api/scan?sport=nfl&books=pinnacle,draftkings,...&markets=h2h,spreads,totals
// Header x-number-passcode must match APP_PASSCODE. Current prices for one sport's upcoming games
// from The Odds API. Each request costs credits (markets x every 10 books), so answers are kept
// for a minute and a second phone, or a double tap, gets the same answer for free.
import { SPORTS, BOOKS, BOOK_KEYS } from '../../src/sports.js';
import { reply, gate, oddsKey, cacheGet, cachePut, credits, upstreamError, trimEvents } from '../lib/guard.mjs';

const KEEP_SECONDS = 60;
const iso = (t) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');

export default async (req) => {
  const blocked = gate(req, 80);
  if (blocked) return blocked;
  const url = new URL(req.url);
  const sport = url.searchParams.get('sport') || '';
  const sp = SPORTS[sport];
  if (!sp) return reply({ error: 'Unknown sport' }, 400);
  const books = [...new Set((url.searchParams.get('books') || '').split(',').filter((b) => BOOK_KEYS.includes(b)))].sort();
  if (!books.length || books.length > 20) return reply({ error: 'Pick 1 to 20 books' }, 400);
  const markets = [...new Set((url.searchParams.get('markets') || sp.markets.join(',')).split(',').filter((m) => sp.markets.includes(m)))].sort();
  if (!markets.length) return reply({ error: 'Unknown markets' }, 400);
  const cost = markets.length * Math.ceil(books.length / 10);

  const key = `scan/${sport}/${books.join(',')}/${markets.join(',')}`;
  const hit = await cacheGet(key);
  if (hit) return reply({ ...hit, cached: true });

  const now = Date.now();
  const ask = (plain) => {
    const q = new URLSearchParams({
      apiKey: oddsKey(),
      bookmakers: (plain ? books.filter((b) => !BOOKS[b].paid) : books).join(','),
      markets: markets.join(','),
      oddsFormat: 'american',
      dateFormat: 'iso',
      commenceTimeFrom: iso(now - 5 * 60 * 1000),
      commenceTimeTo: iso(now + sp.days * 24 * 3600 * 1000),
    });
    if (!plain) q.set('includeLinks', 'true');
    return fetch(`https://api.the-odds-api.com/v4/sports/${sp.oddsKey}/odds?${q}`, { signal: AbortSignal.timeout(15000) });
  };
  let res;
  try {
    res = await ask(false);
    // A request The Odds API turns down costs nothing; ask once more without links and the
    // paid-plan books, the two things a plan can refuse.
    if (res.status === 400 || res.status === 422) res = await ask(true);
  } catch {
    return reply({ error: 'The Odds API did not answer. Try again.' }, 504);
  }
  if (!res.ok) return upstreamError(res);
  const events = trimEvents(await res.json().catch(() => []));
  const body = { sport, books, markets, cost, events, fetchedAt: new Date(now).toISOString(), credits: credits(res) };
  await cachePut(key, body, KEEP_SECONDS);
  return reply({ ...body, cached: false });
};

export const config = { path: '/api/scan' };
