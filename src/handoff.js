// Handing a logged bet to Sweat: the bet in the slip shape Sweat already reads (team, opponent,
// line from the picked side), as a short code Sweat opens from a link or a paste.
import { bookTitle } from './sports.js';

function b64url(text) {
  const bytes = new TextEncoder().encode(text);
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function sweatPayload(b) {
  const team = b.market === 'total' ? b.home : b[b.side];
  const opponent = b.market === 'total' ? b.away : b[b.side === 'home' ? 'away' : 'home'];
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(b.start));
  const leg = { sport: b.sport, market: b.market === 'ml' ? 'moneyline' : b.market, segment: 'game', team, opponent, odds: Math.round(b.price), date };
  if (b.market === 'total') leg.side = b.side;
  if (b.market !== 'ml') leg.line = b.line;
  return { from: 'the-number', v: 1, bets: [{ book: b.book === 'other' ? '' : bookTitle(b.book), stake: b.stake, odds: Math.round(b.price), bonus: !!b.bonus, legs: [leg] }] };
}

export function sweatCode(b) {
  return `NUM1.${b64url(JSON.stringify(sweatPayload(b)))}`;
}
