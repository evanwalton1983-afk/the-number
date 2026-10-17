// GET /api/espn?sport=nfl&kind=scoreboard&date=YYYYMMDD[&groups=80,81]
// Fetches ESPN's public scoreboard (free, no key), cleans it to a small game shape and lets
// Netlify's CDN cache it, so grading bets and reading closing lines costs no Odds API credits.
import { SPORTS } from '../../src/sports.js';
import * as X from '../../src/espn.js';

const UA = 'Mozilla/5.0 (compatible; TheNumber/1.0)';

function reply(body, status = 200, cacheSec = 0) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' };
  if (cacheSec > 0) {
    // Phones always ask again; Netlify's edge answers repeat questions for a few seconds.
    headers['cache-control'] = 'public, max-age=0, must-revalidate';
    headers['netlify-cdn-cache-control'] = `public, s-maxage=${cacheSec}, stale-while-revalidate=${cacheSec * 2}`;
    headers['netlify-vary'] = 'query';
  } else {
    headers['cache-control'] = 'no-store';
  }
  return new Response(JSON.stringify(body), { status, headers });
}

async function fetchJson(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: ctl.signal });
    if (!res.ok) throw new Error(`ESPN answered ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export default async (req) => {
  const url = new URL(req.url);
  const sport = url.searchParams.get('sport') || '';
  const kind = url.searchParams.get('kind') || 'scoreboard';
  if (!SPORTS[sport]) return reply({ error: 'Unknown sport' }, 400);
  const fetchedAt = new Date().toISOString();
  try {
    if (kind === 'scoreboard') {
      const date = url.searchParams.get('date') || '';
      if (date && !/^\d{8}$/.test(date)) return reply({ error: 'Date must be YYYYMMDD' }, 400);
      const raw = url.searchParams.get('groups');
      const groups = raw ? raw.split(',').filter((g) => /^\d{1,3}$/.test(g)).slice(0, 3) : X.DEFAULT_GROUPS[sport] || [null];
      const lists = await Promise.all(groups.map((g) => fetchJson(X.scoreboardUrl(sport, date, g)).then((r) => X.normalizeScoreboard(r, sport))));
      const byId = new Map();
      for (const g of lists.flat()) byId.set(g.id, g);
      const games = [...byId.values()];
      const live = games.some((g) => g.state === 'in');
      const done = games.length > 0 && games.every((g) => g.state === 'post');
      return reply({ sport, date, games, fetchedAt }, 200, live ? 8 : done ? 600 : 60);
    }
    return reply({ error: 'Unknown kind' }, 400);
  } catch (e) {
    return reply({ error: 'ESPN did not answer', detail: String((e && e.message) || e) }, 502);
  }
};

export const config = { path: '/api/espn' };
