// GET /api/status: whether this site has live odds switched on. Booleans only; no secrets.
import { oddsOn } from '../lib/guard.mjs';

export default async () => new Response(JSON.stringify({ odds: oddsOn() }), {
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

export const config = { path: '/api/status' };
