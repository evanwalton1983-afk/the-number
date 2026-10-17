// The app's calls to its Netlify functions. Scores and closing lines from ESPN fall back to
// ESPN directly when the site has no functions (a drag-and-drop deploy); odds need the function.
import { SPORTS } from './sports.js';
import * as X from './espn.js';

const base = '/api';

// AbortSignal.timeout is missing on older iPhones (before iOS 16); without it, no time limit.
const timeoutSignal = (ms) => {
  try {
    return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined;
  } catch {
    return undefined;
  }
};

async function call(path, passcode, opts = {}) {
  const code = String(passcode || '').trim();
  let res;
  try {
    res = await fetch(`${base}${path}`, {
      headers: code ? { 'x-number-passcode': code } : {},
      signal: timeoutSignal(opts.timeout || 20000),
    });
  } catch (e) {
    const err = new Error(e && e.name === 'TimeoutError' ? 'The site took too long to answer. Try again.' : 'Could not reach the site. Check your signal and try again.');
    err.status = 0;
    throw err;
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const said = body && body.error ? `${body.error}${body.detail ? ` (${body.detail})` : ''}` : `The site answered ${res.status}.`;
    const err = new Error(said);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export async function status() {
  try {
    const r = await call('/status', null, { timeout: 8000 });
    return { odds: r.odds === true };
  } catch {
    return { odds: false };
  }
}

export const activeSports = (passcode) => call('/sports', passcode);

export function scan(sport, books, markets, passcode) {
  const q = new URLSearchParams({ sport, books: books.join(','), markets: markets.join(',') });
  return call(`/scan?${q}`, passcode, { timeout: 25000 });
}

export function closing(sport, date, markets, passcode) {
  const q = new URLSearchParams({ sport, date, markets: markets.join(','), books: 'pinnacle' });
  return call(`/close?${q}`, passcode, { timeout: 25000 });
}

// ESPN scoreboard for a day (YYYYMMDD, Eastern), as cleaned games.
export async function scoreboard(sport, date) {
  try {
    const r = await call(`/espn?sport=${sport}&kind=scoreboard&date=${date}`, null, { timeout: 12000 });
    return r.games || [];
  } catch (e) {
    if (e.status === 400) throw e;
    const groups = X.DEFAULT_GROUPS[sport] || [null];
    const lists = await Promise.all(groups.map(async (g) => {
      const res = await fetch(X.scoreboardUrl(sport, date, g), { signal: timeoutSignal(12000) });
      if (!res.ok) throw new Error(`ESPN answered ${res.status}`);
      return X.normalizeScoreboard(await res.json(), sport);
    }));
    const byId = new Map();
    for (const g of lists.flat()) byId.set(g.id, g);
    return [...byId.values()];
  }
}

export const sportName = (k) => (SPORTS[k] ? SPORTS[k].name : k);
