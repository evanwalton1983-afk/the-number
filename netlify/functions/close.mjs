// GET /api/close?sport=nfl&date=2026-10-11T17:00:00Z&markets=spreads,totals[&books=pinnacle]
// Header x-number-passcode must match APP_PASSCODE. The sharp book's prices at kickoff from The
// Odds API's history (paid plans only; 10 credits per market). Kept for a day: it never changes.
import { SPORTS, BOOK_KEYS } from '../../src/sports.js';
import { reply, gate, oddsKey, cacheGet, cachePut, credits, trimEvents } from '../lib/guard.mjs';

export default async (req) => {
  const blocked = gate(req, 60);
  if (blocked) return blocked;
  const url = new URL(req.url);
  const sport = url.searchParams.get('sport') || '';
  const sp = SPORTS[sport];
  if (!sp) return reply({ error: 'Unknown sport' }, 400);
  const date = url.searchParams.get('date') || '';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(date) || Date.parse(date) > Date.now()) return reply({ error: 'date must be a past time like 2026-10-11T17:00:00Z' }, 400);
  const books = [...new Set((url.searchParams.get('books') || 'pinnacle').split(',').filter((b) => BOOK_KEYS.includes(b)))].sort().slice(0, 10);
  const markets = [...new Set((url.searchParams.get('markets') || '').split(',').filter((m) => sp.markets.includes(m)))].sort();
  if (!books.length || !markets.length) return reply({ error: 'Pick books and markets' }, 400);

  const key = `close/${sport}/${date}/${books.join(',')}/${markets.join(',')}`;
  const hit = await cacheGet(key);
  if (hit) return reply({ ...hit, cached: true });

  const q = new URLSearchParams({ apiKey: oddsKey(), bookmakers: books.join(','), markets: markets.join(','), oddsFormat: 'american', dateFormat: 'iso', date });
  let res;
  try {
    res = await fetch(`https://api.the-odds-api.com/v4/historical/sports/${sp.oddsKey}/odds?${q}`, { signal: AbortSignal.timeout(15000) });
  } catch {
    return reply({ error: 'The Odds API did not answer. Try again.' }, 504);
  }
  if (!res.ok) {
    let msg = '';
    try {
      const j = await res.json();
      msg = String((j && (j.message || j.error_code)) || '');
    } catch {
      // not JSON
    }
    if (/paid|plan|subscription|upgrade/i.test(msg) || res.status === 401 || res.status === 403) {
      return reply({ error: 'Exact closing lines need a paid Odds API plan.', paidOnly: true, detail: msg }, 402);
    }
    return reply({ error: `The Odds API answered ${res.status}.`, detail: msg }, res.status === 429 ? 429 : 502);
  }
  const raw = await res.json().catch(() => ({}));
  const body = { sport, date, snapshot: raw.timestamp || null, books, markets, events: trimEvents(raw.data), credits: credits(res) };
  await cachePut(key, body, 86400);
  return reply({ ...body, cached: false });
};

export const config = { path: '/api/close' };
