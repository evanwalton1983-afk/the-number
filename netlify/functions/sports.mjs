// GET /api/sports: which of The Number's sports The Odds API has in season right now, so a scan
// never spends credits on a league that is off. Free on The Odds API; kept for six hours.
import { SPORTS, SPORT_KEYS } from '../../src/sports.js';
import { reply, gate, oddsKey, cacheGet, cachePut } from '../lib/guard.mjs';

export default async (req) => {
  const blocked = gate(req, 60);
  if (blocked) return blocked;
  const hit = await cacheGet('sports');
  if (hit) return reply({ ...hit, cached: true });
  let res;
  try {
    res = await fetch(`https://api.the-odds-api.com/v4/sports?apiKey=${encodeURIComponent(oddsKey())}`, { signal: AbortSignal.timeout(10000) });
  } catch {
    return reply({ error: 'The Odds API did not answer.' }, 504);
  }
  if (!res.ok) return reply({ error: `The Odds API answered ${res.status}.` }, 502);
  const list = await res.json().catch(() => []);
  const activeKeys = new Set((Array.isArray(list) ? list : []).filter((s) => s.active).map((s) => s.key));
  const body = { active: SPORT_KEYS.filter((k) => activeKeys.has(SPORTS[k].oddsKey)), checkedAt: new Date().toISOString() };
  await cachePut('sports', body, 6 * 3600);
  return reply({ ...body, cached: false });
};

export const config = { path: '/api/sports' };
