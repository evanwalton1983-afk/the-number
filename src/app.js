// The Number: prices from every book against the sharp book's fair price, the edges worth
// betting with a stake for each, a line shop with a price checker, boost and bonus bet math,
// and a record that says whether the prices you take beat the close.
import * as db from './store.js';
import * as feed from './feed.js';
import { SPORTS, SPORT_KEYS, BOOKS, BOOK_KEYS, DEFAULT_BOOKS, bookTitle, isVirginiaSchool } from './sports.js';
import { americanToDecimal, decimalToAmerican, parseAmerican, evOf, evDecimal, fairAmerican, stakeFor } from './odds.js';
import { FAIR_METHODS, isFairMethod } from './fairprice.js';
import { parseEvent, fairFor, pricesFor, edgesFrom, qualifies, tooFar, sideChances, gateChances, sideLabel, nickname, fmtLine, sidesOf } from './market.js';
import { boostValue, bonusOptions, secondChanceValue } from './promos.js';
import { matchGame, gradeBet, profitOf, closeFromEspn, clvOf, chancesAtClose, summarize } from './grade.js';
import { espnDate } from './espn.js';
import { esc, money, signedPct, pct, price, units, kickoff, since, until, dayLabel, icon, recordChart } from './ui.js';
import { sweatCode } from './handoff.js';
import { findArbs, findMiddles, sdKey, sdOf, DEFAULT_SD } from './arbs.js';

const APP_VERSION = '1.2.0';
const MARKET_NAMES = { spread: 'Spread', total: 'Total', ml: 'Moneyline' };
const SETTLED = new Set(['won', 'lost', 'push', 'void']);
const DEFAULTS = {
  bankroll: 0,
  unit: 10,
  kelly: 0.25,
  minPct: 0.005,
  maxPct: 0.05,
  minEdge: 0.02,
  maxFav: -250,
  books: DEFAULT_BOOKS,
  ref: 'pinnacle',
  fairMethod: 'shin',
  evGate: 'worst',
  sports: { nfl: true, cfb: true, nba: true, ncaab: true, ufc: true },
  hideVA: true,
  auto: 0,
  alerts: true,
  alertEdge: 0.03,
  sound: true,
  closing: 'free',
  passcode: '',
  sweatUrl: 'https://sweat-tracker-5a8e.netlify.app',
  theme: 'auto',
  staleMin: 15,
  minMidEv: 1,
};

const state = {
  tab: 'edges',
  settings: { ...DEFAULTS },
  caps: { odds: false, checked: false },
  scans: {},
  active: null,
  games: [],
  fairs: {},
  edges: [],
  snaps: {},
  seen: {},
  credits: null,
  scanning: false,
  scanError: '',
  bets: [],
  edgeFilter: { sport: 'all', sort: 'edge' },
  shop: { sport: '', q: '' },
  promo: { mode: 'boost', pick: {}, boost: 0.5, boostCustom: '', boostStake: 25, bonusAmount: 25, bonusBook: '', bonusMin: '', scStake: 25, scCap: 25, scRate: '' },
  record: { by: 'sport', show: 'all' },
  arb: { mode: 'middles', total: 100 },
  sheet: null,
  saving: false,
};

const $ = (sel, root = document) => root.querySelector(sel);
const num = (v) => (v === '' || v == null ? NaN : Number(v));
const now = () => Date.now();
const gameById = (id) => state.games.find((g) => g.id === id) || null;
const sizing = () => ({ bankroll: num(state.settings.bankroll) || 0, kelly: state.settings.kelly, minPct: state.settings.minPct, maxPct: state.settings.maxPct });
const edgeOpts = () => ({ ...sizing(), minEdge: state.settings.minEdge, maxFav: state.settings.maxFav === 'any' ? -100000 : state.settings.maxFav, hideVA: state.settings.hideVA, gate: state.settings.evGate });
// The EV gate's chances for a side, and whether it is the worst case of the four methods.
const gateOf = (sport, market, fair, side, line) => gateChances(sport, market, fair, side, line, state.settings.evGate);
const worstGate = () => state.settings.evGate === 'worst';
// "Fair (Shin)": every fair price says which method removed the vig.
const methodTag = (method) => (isFairMethod(method) ? ` (${FAIR_METHODS[method]})` : '');
const fairLabel = (method) => `Fair${methodTag(method)}`;
// Edge class under the gate: plain when it passes, muted when only the fair price method sees an edge.
const edgeClass = (ev, gev) => (gev > 0 ? 'ev' : ev > 0 ? 'muted' : 'neg');
const ready = () => state.caps.odds && !!state.settings.passcode;
const scanBooks = () => [...new Set([state.settings.ref, ...state.settings.books])].filter((b) => BOOK_KEYS.includes(b));
const matchupOf = (x) => (SPORTS[x.sport].kind === 'fight' ? `${nickname(x.away, x.sport)} vs ${nickname(x.home, x.sport)}` : `${nickname(x.away, x.sport)} at ${nickname(x.home, x.sport)}`);
const hiddenVA = (g) => state.settings.hideVA && SPORTS[g.sport].college && (isVirginiaSchool(g.home) || isVirginiaSchool(g.away));
const edgeKey = (x) => `${x.gameId}|${x.book}|${x.market}|${x.side}|${x.line == null ? '' : x.line}`;

// ------------------------------------------------------------ boot

async function boot() {
  const saved = await db.getKV('settings', {});
  state.settings = { ...DEFAULTS, ...saved, sports: { ...DEFAULTS.sports, ...(saved.sports || {}) } };
  if (!Array.isArray(state.settings.books)) state.settings.books = [...DEFAULT_BOOKS];
  // 1.1.0: the fair price method takes over from "Removing the vig". A method picked there
  // carries over; power, the old default, gives way to the new default.
  if (saved.fairMethod == null && saved.method !== 'power' && isFairMethod(saved.method)) state.settings.fairMethod = saved.method;
  if (!isFairMethod(state.settings.fairMethod)) state.settings.fairMethod = DEFAULTS.fairMethod;
  if (!['worst', 'fair'].includes(state.settings.evGate)) state.settings.evGate = DEFAULTS.evGate;
  state.bets = (await db.allBets()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  state.scans = (await db.getKV('scans', {})) || {};
  state.snaps = (await db.getKV('snaps', {})) || {};
  state.seen = (await db.getKV('seen', {})) || {};
  state.credits = await db.getKV('credits', null);
  state.active = await db.getKV('active', null);
  applyTheme();
  rebuild({ quiet: true });
  window.addEventListener('hashchange', route);
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      rebuild({ quiet: true });
      render();
      followUp();
    }
  });
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  route();
  state.caps = { ...(await feed.status()), checked: true };
  render();
  schedule();
  followUp();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
}

function applyTheme() {
  const t = state.settings.theme;
  const dark = t === 'night' || (t === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'night' : 'day';
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#121920' : '#eceee8';
}

const TABS = [['edges', 'Edges', 'edges'], ['games', 'Games', 'games'], ['promos', 'Promos', 'promos'], ['arbs', 'Arbs', 'arbs'], ['record', 'Record', 'record'], ['settings', 'Settings', 'settings']];

function route() {
  const h = location.hash.replace(/^#/, '').split('?')[0];
  state.tab = TABS.some(([k]) => k === h) ? h : 'edges';
  if (state.sheet) state.sheet = null;
  render();
  const m = $('#main');
  if (m) m.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function go(tab) {
  if (location.hash === `#${tab}`) route();
  else location.hash = tab;
}

// ------------------------------------------------------------ rendering

function render() {
  renderTop();
  renderTabs();
  renderMain();
  renderLayer();
}

function creditsText() {
  const c = state.credits;
  if (!c || c.remaining == null) return '';
  return `${Number(c.remaining).toLocaleString('en-US')} credits left`;
}

function lastScanAt() {
  return Math.max(0, ...Object.values(state.scans).map((s) => s.at || 0));
}

function renderTop() {
  const at = lastScanAt();
  const status = state.scanning ? 'Scanning the books...' : at ? `Scanned ${since(at)}` : 'Not scanned yet';
  $('#top').innerHTML = `<div class="brand"><span class="mark-word">The Number</span></div>
    <div class="scanbox"><div class="scanmeta"><span>${esc(status)}</span>${creditsText() ? `<span class="cr">${esc(creditsText())}</span>` : ''}</div>
    <button class="icon-btn scan${ready() ? '' : ' off'}" data-action="scan" ${state.scanning ? 'disabled' : ''} aria-label="Scan the books now">${icon('scan')}</button></div>`;
}

function renderTabs() {
  $('#tabs').innerHTML = TABS.map(([k, label, ic]) => `<button class="tab" data-action="tab" data-tab="${k}" ${state.tab === k ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span></button>`).join('');
}

function renderMain() {
  const v = { edges: viewEdges, games: viewGames, promos: viewPromos, arbs: viewArbs, record: viewRecord, settings: viewSettings }[state.tab] || viewEdges;
  $('#main').innerHTML = v();
}

// Shown where the app cannot price anything yet.
function setupCard() {
  if (!state.caps.checked) return '<p class="sub">Checking the site...</p>';
  if (!state.caps.odds) {
    return `<div class="card setup"><h2>Connect your Odds API key</h2>
      <p>The Number reads prices from The Odds API through your Netlify site. In Netlify, add <b>ODDS_API_KEY</b> (your key from the-odds-api.com) and <b>APP_PASSCODE</b> (any passcode you choose) under Environment variables, then redeploy.</p>
      <p class="note">Until then the Promos math and your record still work with prices you type in.</p></div>`;
  }
  if (!state.settings.passcode) {
    return `<div class="card setup"><h2>Enter your passcode</h2><p>Type the APP_PASSCODE you set in Netlify once. It stays on this phone.</p>
      <button class="btn primary" data-action="tab" data-tab="settings">Open Settings</button></div>`;
  }
  return '';
}

function bankrollCard() {
  if (num(state.settings.bankroll) > 0) return '';
  return `<div class="card nudge"><p>Set your bankroll and The Number sizes every bet for you.</p><button class="btn" data-action="tab" data-tab="settings">Set bankroll</button></div>`;
}

// ------------------------------------------------------------ edges

function sportChips(counts, current, action) {
  const keys = SPORT_KEYS.filter((k) => state.settings.sports[k] && state.games.some((g) => g.sport === k));
  const all = action === 'edge-sport' ? [`<button class="chip" data-action="${action}" data-sport="all" aria-pressed="${current === 'all'}">All<span class="n">${counts.all || 0}</span></button>`] : [];
  return `<div class="chips" role="group" aria-label="Sport">${all.join('')}${keys.map((k) => `<button class="chip" data-action="${action}" data-sport="${k}" aria-pressed="${current === k}">${esc(SPORTS[k].short)}${counts[k] != null ? `<span class="n">${counts[k]}</span>` : ''}</button>`).join('')}</div>`;
}

function edgeRowHTML(x) {
  const seen = state.seen[edgeKey(x)];
  const st = x.stake && x.stake.stake > 0 ? `${money(x.stake.stake)}<span class="u">${esc(units(x.stake.stake, state.settings.unit))}</span>` : null;
  const ref = x.from === 'consensus' ? '<span class="tag">Fair from the books’ median</span>' : '';
  return `<li class="row edge" data-action="open-edge" data-id="${esc(x.id)}" tabindex="0" role="button" aria-label="${esc(`${sideLabel(x)} ${price(x.price)} at ${bookTitle(x.book)}, edge ${signedPct(x.ev)}${worstGate() ? `, worst case ${signedPct(x.gateEv)}` : ''}`)}">
    <div class="r1"><span class="pick">${esc(sideLabel(x))}</span><span class="px"><span class="hl">${esc(price(x.price))}</span></span></div>
    <div class="r2"><span>${esc(matchupOf(x))}, ${esc(kickoff(x.start))}</span><span class="bk">${esc(bookTitle(x.book))}</span></div>
    <dl class="r3"><div><dt>${esc(fairLabel(x.method))}</dt><dd class="fair">${esc(price(x.fairPrice))}</dd></div><div><dt>Edge</dt><dd class="ev">${esc(signedPct(x.ev))}</dd></div>${st ? `<div><dt>Bet</dt><dd>${st}</dd></div>` : ''}<div><dt>Seen</dt><dd>${seen && now() - seen > 60000 ? esc(since(seen).replace(' ago', '')) : 'New'}</dd></div></dl>
    ${ref}</li>`;
}

function viewEdges() {
  const setup = setupCard();
  if (setup && !state.games.length) return `<section class="view">${setup}</section>`;
  const f = state.edgeFilter;
  const counts = { all: state.edges.length };
  for (const e of state.edges) counts[e.sport] = (counts[e.sport] || 0) + 1;
  let list = state.edges.filter((e) => f.sport === 'all' || e.sport === f.sport);
  if (f.sort === 'bet') list = [...list].sort((a, b) => (b.stake ? b.stake.stake * b.ev : 0) - (a.stake ? a.stake.stake * a.ev : 0));
  else if (f.sort === 'start') list = [...list].sort((a, b) => (a.start < b.start ? -1 : 1));
  const sorts = [['edge', 'Edge'], ['bet', 'Value'], ['start', 'Start']];
  const head = `<div class="viewhead"><h1>${list.length ? `${list.length} ${list.length === 1 ? 'price' : 'prices'} above fair` : 'Edges'}</h1>
    <div class="seg small" role="group" aria-label="Sort">${sorts.map(([k, l]) => `<button data-action="edge-sort" data-sort="${k}" aria-pressed="${f.sort === k}">${l}</button>`).join('')}</div></div>`;
  let body;
  if (!lastScanAt()) {
    body = `<div class="empty"><p>Scan the books to see which prices beat the fair line right now.</p>${state.scanError ? `<p class="warn">${esc(state.scanError)}</p>` : ''}<button class="btn primary" data-action="scan">Scan now</button></div>`;
  } else if (!list.length) {
    body = `<div class="empty"><p>Nothing is priced above fair at your books right now. Lines move most in the last hours before games; scan again later.</p>
      <p class="note">Bar: ${esc(signedPct(state.settings.minEdge, 0))} edge, ${esc(String(state.settings.books.length))} books. ${state.scanError ? esc(state.scanError) : ''}</p></div>`;
  } else body = `<ul class="sheetlist">${list.map(edgeRowHTML).join('')}</ul>`;
  const age = now() - lastScanAt();
  const stale = lastScanAt() && list.length && age > 30 * 60 * 1000 ? `<p class="warn">${esc(`These prices are from ${since(lastScanAt())}. Lines move; scan again before you bet.`)}</p>` : '';
  const err = (state.scanError && list.length ? `<p class="warn">${esc(state.scanError)}</p>` : '') + stale;
  return `<section class="view">${setup}${bankrollCard()}${head}${sportChips(counts, f.sport, 'edge-sport')}${err}${body}
    <p class="foot">Fair prices come from ${state.settings.ref === 'pinnacle' ? 'Pinnacle' : 'the median of the books'} with the vig removed by the ${esc(FAIR_METHODS[state.settings.fairMethod])} method. Edge is what each dollar returns on average at the fair price.${worstGate() ? ' A price shows here when its edge clears your bar under all four ways of removing the vig (the worst case).' : ''}</p></section>`;
}

// ------------------------------------------------------------ arbs and middles

// "3 min", "2 h": how old a price is.
function ageText(ms) {
  const m = Math.floor(ms / 60000);
  return m < 1 ? 'under 1 min' : m < 60 ? `${m} min` : `${Math.round(m / 60)} h`;
}

function legText(x, leg) {
  const team = (side) => nickname(x[side], x.sport);
  const what = x.market === 'total' ? `${leg.side === 'over' ? 'Over' : 'Under'} ${leg.line}` : x.market === 'ml' ? `${team(leg.side)} to win` : `${team(leg.side)} ${fmtLine(leg.line)}`;
  return `<span>${esc(what)} <b>${esc(price(leg.price))}</b></span><span class="bk">${esc(bookTitle(leg.book))}, ${esc(ageText(leg.age))} old</span>`;
}

function arbRowHTML(x) {
  const sp = x.split;
  const stakes = sp ? `${money(sp.stakeA)} and ${money(sp.stakeB)}` : 'Enter 2 dollars or more';
  return `<li class="row edge">
    <div class="r1"><span class="pick">${esc(MARKET_NAMES[x.market])}: ${esc(matchupOf(x))}</span><span class="px"><span class="hl">${esc(signedPct(x.roi, 2))}</span></span></div>
    <div class="r2"><span>${esc(kickoff(x.start))}</span><span class="bk">Oldest price ${esc(ageText(x.age))}</span></div>
    <div class="r2">${legText(x, x.legs[0])}</div><div class="r2">${legText(x, x.legs[1])}</div>
    <dl class="r3"><div><dt>Stakes</dt><dd>${esc(stakes)}</dd></div>${sp ? `<div><dt>Payout</dt><dd>${esc(money(Math.min(sp.payA, sp.payB)))}</dd></div><div><dt>Guaranteed profit</dt><dd class="${x.thin ? 'neg' : 'ev'}">${esc(money(sp.profit, { sign: true }))}</dd></div>` : ''}</dl>
    ${x.thin ? '<p class="warn">Whole dollar stakes leave no guaranteed profit at this total. Enter a larger total or skip it.</p>' : ''}</li>`;
}

function middleRowHTML(x) {
  const how = x.method === 'keynum' ? 'NFL key numbers' : `Normal curve, SD ${sdOf(state.settings, x.sport, x.market)}`;
  return `<li class="row edge">
    <div class="r1"><span class="pick">${esc(MARKET_NAMES[x.market])} middle: ${esc(matchupOf(x))}</span><span class="px"><span class="hl">${esc(money(x.ev, { sign: true }))}</span></span></div>
    <div class="r2"><span>${esc(kickoff(x.start))}, gap of ${esc(String(+x.gap.toFixed(1)))}</span><span class="bk">Oldest price ${esc(ageText(x.age))}</span></div>
    <div class="r2">${legText(x, x.legs[0])}</div><div class="r2">${legText(x, x.legs[1])}</div>
    <dl class="r3"><div><dt>In the gap</dt><dd>${esc(pct(x.chance, 1))}</dd></div><div><dt>EV per $100</dt><dd class="ev">${esc(money(x.ev, { sign: true }))}</dd></div><div><dt>If it hits</dt><dd>${esc(money(x.hit, { sign: true }))}</dd></div><div><dt>If it misses</dt><dd>${esc(money(x.miss, { sign: true }))}</dd></div></dl>
    <span class="tag">${esc(how)}</span></li>`;
}

function viewArbs() {
  const setup = setupCard();
  if (setup && !state.games.length) return `<section class="view">${setup}</section>`;
  const s = state.settings;
  const opts = { now: now(), staleMin: Number(s.staleMin) || 0, minEv: Number(s.minMidEv) || 0, hideVA: s.hideVA, settings: s, total: num(state.arb.total) };
  const arbs = findArbs(state.games, s.books, opts);
  const mids = findMiddles(state.games, s.books, opts);
  const mode = state.arb.mode;
  const list = mode === 'arbs' ? arbs : mids;
  const head = `<div class="viewhead"><h1>Arbs and middles</h1>
    <div class="seg small" role="group" aria-label="Show">${[['middles', 'Middles', mids.length], ['arbs', 'Arbs', arbs.length]].map(([k, l, n]) => `<button data-action="arb-mode" data-mode="${k}" aria-pressed="${mode === k}">${l} ${n}</button>`).join('')}</div></div>`;
  const total = mode === 'arbs' ? numField('Total to stake, dollars', 'arb.total', state.arb.total, '100', 'numeric') : '';
  let body;
  if (!lastScanAt()) body = '<div class="empty"><p>Scan the books to look for arbs and middles.</p><button class="btn primary" data-action="scan">Scan now</button></div>';
  else if (!list.length) {
    const stale = Number(s.staleMin) ? `Prices older than ${s.staleMin} min are hidden` : 'The stale setting is off';
    body = `<div class="empty"><p>${mode === 'arbs' ? 'No arbs across your books right now.' : 'No middles above your minimum right now.'}</p>
      <p class="note">${esc(`Your ${s.books.length} books only. ${stale}, and EV under ${money(Number(s.minMidEv) || 0)} per $100 is hidden. Change either in Settings.`)}</p></div>`;
  } else body = `<ul class="sheetlist">${list.map(mode === 'arbs' ? arbRowHTML : middleRowHTML).join('')}</ul>`;
  const foot = mode === 'arbs'
    ? 'An arb is the best price on each side of one line, with the inverse decimal odds adding to under 1. Stakes are whole dollars chosen so both payouts come out as close to equal as dollars allow, and the profit shown is the smaller payout minus your total (the guaranteed minimum, a little under the ROI figure). Book rules can void a price: check both before you bet.'
    : 'A middle wins both bets when the result lands in the gap between the two lines, and loses a little otherwise. EV is for $100 staked, $50 on each side. NFL spreads use the key number table from Gridiron; everything else uses a normal curve with the standard deviation in Settings. Price age counts from the book’s own update time.';
  return `<section class="view">${setup}${head}${total}${body}<p class="foot">${esc(foot)}</p></section>`;
}

// ------------------------------------------------------------ games and the line shop

function marketCell(g, market) {
  const fair = state.fairs[g.id] && state.fairs[g.id][market];
  if (!fair) return '<span class="muted">No line</span>';
  const prices = pricesFor(g, { [market]: fair }, state.settings.books, edgeOpts()).filter((x) => x.market === market);
  if (!prices.length) return '<span class="muted">Not at your books</span>';
  const usable = prices.filter((x) => x.market === 'ml' || x.gap <= tooFar(x, edgeOpts()));
  const best = (usable.length ? usable : prices).reduce((a, b) => (b.gateEv > a.gateEv ? b : a));
  const short = market === 'total' ? `${best.side === 'over' ? 'O' : 'U'} ${best.line}` : market === 'ml' ? nickname(best[best.side], g.sport) : `${nickname(best[best.side], g.sport)} ${fmtLine(best.line)}`;
  const good = qualifies(best, edgeOpts());
  return `<span class="mc"><span>${esc(short)}</span> <span class="${good ? 'hl' : ''}">${esc(price(best.price))}</span></span>`;
}

function viewGames() {
  const setup = setupCard();
  const sports = SPORT_KEYS.filter((k) => state.settings.sports[k] && state.games.some((g) => g.sport === k));
  if (!sports.length) return `<section class="view">${setup}<div class="viewhead"><h1>Games</h1></div><div class="empty"><p>${lastScanAt() ? 'No upcoming games in your sports from the last scan.' : 'Scan the books to shop every line.'}</p>${state.scanError ? `<p class="warn">${esc(state.scanError)}</p>` : ''}<button class="btn primary" data-action="scan">Scan now</button></div></section>`;
  if (!sports.includes(state.shop.sport)) state.shop.sport = sports[0];
  const counts = {};
  for (const g of state.games) if (Date.parse(g.start) > now() && !hiddenVA(g)) counts[g.sport] = (counts[g.sport] || 0) + 1;
  const q = state.shop.q.trim().toLowerCase();
  const games = state.games.filter((g) => g.sport === state.shop.sport && Date.parse(g.start) > now() && !hiddenVA(g) && (!q || `${g.home} ${g.away}`.toLowerCase().includes(q)));
  let lastDay = '';
  const rows = games.map((g) => {
    const day = dayLabel(g.start);
    const dh = day !== lastDay ? `<li class="dayhead">${esc(day)}</li>` : '';
    lastDay = day;
    const markets = SPORTS[g.sport].kind === 'fight' ? ['ml'] : ['spread', 'total', 'ml'];
    return `${dh}<li class="row game" data-action="open-game" data-id="${esc(g.id)}" tabindex="0" role="button">
      <div class="g1"><span class="teams">${esc(matchupOf(g))}</span><span class="time">${esc(kickoff(g.start).replace(/^(Today|Tomorrow) /, ''))}</span></div>
      <dl class="g2">${markets.map((m) => `<div><dt>${MARKET_NAMES[m]}</dt><dd>${marketCell(g, m)}</dd></div>`).join('')}</dl></li>`;
  }).join('');
  const search = `<label class="search"><span class="sr">Find a team</span><input class="input" type="search" placeholder="Find a team or fighter" value="${esc(state.shop.q)}" data-bind="shop.q" autocomplete="off"></label>`;
  return `<section class="view">${setup}<div class="viewhead"><h1>Games</h1></div>${sportChips(counts, state.shop.sport, 'shop-sport')}${search}
    ${games.length ? `<ul class="sheetlist">${rows}</ul>` : '<p class="sub">No games match.</p>'}
    <p class="foot">The best price at your books for each market. Highlighted prices beat fair by your bar${worstGate() ? ' under all four ways of removing the vig' : ''}.</p></section>`;
}

// Fair prices at the sharp line for both sides of a market.
function fairText(g, market, fair) {
  if (!fair) return '';
  const [a, b] = sidesOf(market);
  const lineFor = (side) => (market === 'ml' ? null : market === 'spread' ? (side === 'home' ? fair.line : -fair.line) : fair.line);
  const parts = [a, b].map((side) => {
    const line = lineFor(side);
    const ch = sideChances(g.sport, market, fair, side, line);
    if (!ch) return '';
    const label = market === 'total' ? `${side === 'over' ? 'Over' : 'Under'} ${line}` : market === 'ml' ? nickname(g[side], g.sport) : `${nickname(g[side], g.sport)} ${fmtLine(line)}`;
    return `${label} <b>${esc(price(fairAmerican(ch.win, ch.push)))}</b>`;
  });
  const src = fair.from === 'sharp' ? `${bookTitle(fair.book)}, vig removed` : `median of ${fair.books} books, vig removed`;
  const stale = fair.unsettled ? '<p class="warn">The other books moved away from the sharp price in the last few minutes (news?). Edges here are held back until the market settles.</p>' : '';
  return `<p class="fairline">${esc(fairLabel(fair.method))}: ${parts.join(', ')} <span class="muted">(${esc(src)})</span></p>${stale}`;
}

function shopTable(g, market) {
  const fair = state.fairs[g.id] && state.fairs[g.id][market];
  const [a, b] = sidesOf(market);
  const books = [...new Set([...(fair && fair.book ? [fair.book] : []), ...state.settings.books])].filter((k) => g.books[k] && g.books[k][market]);
  if (!books.length) return '<p class="sub">No prices for this market.</p>';
  const all = fair ? pricesFor(g, { [market]: fair }, books, edgeOpts()) : [];
  const far = (x) => x.market !== 'ml' && x.gap > tooFar(x, edgeOpts());
  const bestEv = {};
  for (const x of all) if (x.book !== (fair && fair.book) && !far(x) && (!bestEv[x.side] || x.gateEv > bestEv[x.side].gateEv)) bestEv[x.side] = x;
  const cell = (k, side) => {
    const o = g.books[k][market][side];
    const x = all.find((p) => p.book === k && p.side === side);
    const isRef = fair && k === fair.book;
    const line = market === 'ml' ? '' : market === 'total' ? `${side === 'over' ? 'O' : 'U'} ${o.line}` : fmtLine(o.line);
    const best = !isRef && bestEv[side] && bestEv[side].book === k && x && qualifies(x, edgeOpts());
    const ev = isRef || !x ? '' : far(x) ? '<span class="cev neg">Line too far to price</span>' : `<span class="cev ${x.gateEv > 0 ? 'pos' : 'neg'}">${esc(signedPct(x.ev))}</span>`;
    const label = `${bookTitle(k)} ${market === 'total' ? (side === 'over' ? 'over' : 'under') : nickname(g[side], g.sport)} ${line} ${price(o.price)}${x && !isRef ? `, edge ${signedPct(x.ev)}${worstGate() ? `, worst case ${signedPct(x.gateEv)}` : ''}` : ''}`;
    return isRef
      ? `<td class="ref"><span class="cl">${esc(line)}</span> <span class="cp">${esc(price(o.price))}</span></td>`
      : `<td><button class="cellbtn" data-action="log-price" data-game="${esc(g.id)}" data-book="${esc(k)}" data-market="${market}" data-side="${side}" aria-label="${esc(`Log ${label}`)}"><span class="cl">${esc(line)}</span> <span class="cp ${best ? 'hl' : ''}">${esc(price(o.price))}</span>${ev}</button></td>`;
  };
  const head = market === 'total' ? ['Over', 'Under'] : [nickname(g[a], g.sport), nickname(g[b], g.sport)];
  return `<table class="shop"><thead><tr><th scope="col">Book</th><th scope="col">${esc(head[0])}</th><th scope="col">${esc(head[1])}</th></tr></thead><tbody>
    ${books.map((k) => `<tr class="${fair && k === fair.book ? 'refrow' : ''}"><th scope="row">${esc(bookTitle(k))}${fair && k === fair.book ? '<span class="tag">fair source</span>' : ''}</th>${cell(k, a)}${cell(k, b)}</tr>`).join('')}
  </tbody></table>`;
}

function checkPanel(g, s) {
  const market = s.check.market;
  const fair = state.fairs[g.id] && state.fairs[g.id][market];
  const markets = Object.keys(state.fairs[g.id] || {});
  const [a, b] = sidesOf(market);
  const side = s.check.side || a;
  const line = market === 'ml' ? null : num(s.check.line);
  const pr = parseAmerican(s.check.price);
  let out = '<p class="sub">Enter a line and a price to see what it is worth.</p>';
  if (fair && Number.isFinite(pr) && (market === 'ml' || Number.isFinite(line))) {
    const ch = sideChances(g.sport, market, fair, side, line);
    const gch = ch && gateOf(g.sport, market, fair, side, line);
    if (ch && gch) {
      const ev = evOf(ch.win, ch.push, pr);
      const gev = evOf(gch.win, gch.push, pr);
      const st = stakeFor(ch.win, ch.push, pr, sizing());
      out = `<dl class="stats tight"><div><dt>${esc(fairLabel(fair.method))}</dt><dd class="fair">${esc(price(fairAmerican(ch.win, ch.push)))}</dd></div><div><dt>Edge</dt><dd class="${edgeClass(ev, gev)}">${esc(signedPct(ev))}</dd></div>${worstGate() ? `<div><dt>Worst case</dt><dd class="${gev > 0 ? '' : 'neg'}">${esc(signedPct(gev))}</dd></div>` : ''}
        <div><dt>Wins</dt><dd>${esc(pct(ch.win, 1))}</dd></div>${ch.push > 0.0005 ? `<div><dt>Pushes</dt><dd>${esc(pct(ch.push, 1))}</dd></div>` : ''}<div><dt>Bet</dt><dd>${gev > 0 && st.stake > 0 ? esc(money(st.stake)) : gev > 0 && !(num(state.settings.bankroll) > 0) ? 'Set bankroll' : 'Pass'}</dd></div></dl>
        <button class="btn" data-action="log-check">Log this bet</button>`;
    }
  }
  const sideBtns = [a, b].map((sd) => `<button data-action="check-side" data-side="${sd}" aria-pressed="${side === sd}">${esc(market === 'total' ? (sd === 'over' ? 'Over' : 'Under') : nickname(g[sd], g.sport))}</button>`).join('');
  return `<div class="check"><h3>Check a price</h3><p class="note">For an alternate line, a book The Number does not scan, or a price from one of your model apps.</p>
    <div class="seg" role="group" aria-label="Market">${markets.map((m) => `<button data-action="check-market" data-market="${m}" aria-pressed="${market === m}">${MARKET_NAMES[m]}</button>`).join('')}</div>
    <div class="seg" role="group" aria-label="Side">${sideBtns}</div>
    <div class="fields">${market === 'ml' ? '' : numField(market === 'total' ? 'Total' : 'Line', 'sheet.check.line', s.check.line, market === 'total' ? '47.5' : '-3', 'decimal', market === 'spread')}
    ${numField('Price', 'sheet.check.price', s.check.price, '-110', 'numeric', true)}</div>${out}</div>`;
}

// A number field with a plus or minus switch: phone number pads often have no minus key.
function numField(label, bind, value, placeholder, mode = 'decimal', flip = false) {
  return `<label class="field">${esc(label)}<span class="numrow"><input class="input" inputmode="${mode}" data-bind="${bind}" value="${esc(value == null ? '' : value)}" placeholder="${esc(placeholder)}" autocomplete="off">${flip ? `<button type="button" class="btn small flip" data-action="flip" data-target="${bind}" aria-label="Switch plus or minus for ${esc(label)}">+/-</button>` : ''}</span></label>`;
}

function sheetGame(s) {
  const g = gameById(s.gameId);
  if (!g) return '<p>This game is no longer on the board.</p>';
  const markets = ['spread', 'total', 'ml'].filter((m) => Object.values(g.books).some((b) => b[m]));
  const blocks = markets.map((m) => `<section class="mkt"><h3>${MARKET_NAMES[m]}</h3>${fairText(g, m, state.fairs[g.id] && state.fairs[g.id][m])}${shopTable(g, m)}</section>`).join('');
  return `<div class="sheet-head"><h2 id="sheet-title">${esc(matchupOf(g))}</h2><button class="icon-btn" data-action="close" aria-label="Close">${icon('close')}</button></div>
    <p class="sub">${esc(`${SPORTS[g.sport].name}, ${kickoff(g.start)}, ${until(Date.parse(g.start))}`)}</p>${blocks}${checkPanel(g, s)}`;
}

function openGame(id) {
  const g = gameById(id);
  if (!g) return;
  const markets = Object.keys(state.fairs[g.id] || {});
  const market = markets.includes('spread') ? 'spread' : markets[0] || 'ml';
  state.sheet = { type: 'game', gameId: id, check: { market, side: sidesOf(market)[0], line: '', price: '' } };
  renderLayer();
}

// ------------------------------------------------------------ logging bets

function sheetLog(s) {
  const d = s.draft;
  const pr = parseAmerican(d.price);
  const line = d.market === 'ml' ? null : num(d.line);
  const g = gameById(d.gameId);
  const fair = g && state.fairs[g.id] ? state.fairs[g.id][d.market] : null;
  const ch = fair && Number.isFinite(pr) && (d.market === 'ml' || Number.isFinite(line)) ? sideChances(d.sport, d.market, fair, d.side, line) : null;
  const gch = ch ? gateOf(d.sport, d.market, fair, d.side, line) : null;
  const dec = Number.isFinite(pr) ? 1 + (americanToDecimal(pr) - 1) * (1 + (d.boost > 0 ? d.boost : 0)) : NaN;
  const effective = decimalToAmerican(dec);
  const ev = ch && dec > 1 ? (d.bonus ? NaN : evDecimal(ch.win, ch.push, dec)) : NaN;
  const gev = gch && Number.isFinite(ev) ? evDecimal(gch.win, gch.push, dec) : NaN;
  const st = ch && dec > 1 && !d.bonus ? stakeFor(ch.win, ch.push, effective, sizing()) : null;
  const label = sideLabel({ ...d, line });
  const books = [...state.settings.books, 'other'];
  return `<div class="sheet-head"><h2 id="sheet-title">Log ${esc(label)}</h2><button class="icon-btn" data-action="close" aria-label="Close">${icon('close')}</button></div>
    <p class="sub">${esc(`${matchupOf(d)}, ${kickoff(d.start)}`)}</p>
    ${ch ? `<dl class="stats tight"><div><dt>${esc(fairLabel(fair.method))}</dt><dd class="fair">${esc(price(fairAmerican(ch.win, ch.push)))}</dd></div>${Number.isFinite(ev) ? `<div><dt>Edge</dt><dd class="${edgeClass(ev, gev)}">${esc(signedPct(ev))}</dd></div>${worstGate() ? `<div><dt>Worst case</dt><dd class="${gev > 0 ? '' : 'neg'}">${esc(signedPct(gev))}</dd></div>` : ''}` : ''}${st ? `<div><dt>Suggested</dt><dd>${gev > 0 && st.stake > 0 ? esc(money(st.stake)) : num(state.settings.bankroll) > 0 ? 'Pass' : 'Set bankroll'}</dd></div>` : ''}</dl>` : ''}
    ${d.link && /^https:\/\//.test(d.link) ? `<a class="btn mark" href="${esc(d.link)}" target="_blank" rel="noopener noreferrer">Open the bet at ${esc(bookTitle(d.book))} ${icon('out')}</a>` : ''}
    <p class="note">Log it once it is placed, at the price you got.</p>
    <div class="fields">
      <label class="field">Book<select class="input" data-bind="sheet.draft.book">${books.map((k) => `<option value="${k}" ${d.book === k ? 'selected' : ''}>${esc(k === 'other' ? 'Another book' : bookTitle(k))}</option>`).join('')}</select></label>
      ${d.market === 'ml' ? '' : numField(d.market === 'total' ? 'Total' : 'Line', 'sheet.draft.line', d.line, '', 'decimal', d.market === 'spread')}
      ${numField(d.boost > 0 ? 'Price before the boost' : 'Price', 'sheet.draft.price', d.price, '-110', 'numeric', true)}
      ${numField(d.bonus ? 'Bonus bet amount' : 'Stake', 'sheet.draft.stake', d.stake, '25', 'decimal')}
    </div>
    ${d.boost > 0 ? `<p class="note">${esc(`Profit boost ${Math.round(d.boost * 100)}%: logged at ${price(effective)}.`)}</p>` : ''}
    ${d.bonus ? '<p class="note">Bonus bet: a win pays the profit only, a loss costs no cash.</p>' : ''}
    ${s.error ? `<p class="neg">${esc(s.error)}</p>` : ''}
    <div class="row"><button class="btn primary" data-action="save-log" ${state.saving ? 'disabled' : ''}>Save bet</button><button class="btn" data-action="close">Cancel</button></div>`;
}

function draftFrom(x, extra = {}) {
  const st = x.stake && x.stake.stake > 0 && !(x.gateEv <= 0) ? x.stake.stake : '';
  return { gameId: x.gameId, sport: x.sport, start: x.start, home: x.home, away: x.away, market: x.market, side: x.side, line: x.line == null ? '' : String(x.line), price: x.price > 0 ? `+${x.price}` : String(x.price), book: x.book, link: x.link || null, stake: st === '' ? '' : String(st), source: 'edge', boost: 0, bonus: false, ...extra };
}

function openLog(draft) {
  state.sheet = { type: 'log', draft, error: '' };
  renderLayer();
}

async function saveLog() {
  const s = state.sheet;
  const d = s.draft;
  if (state.saving) return;
  const pr = parseAmerican(d.price);
  const stake = num(d.stake);
  const line = d.market === 'ml' ? null : num(d.line);
  if (!Number.isFinite(pr)) s.error = 'Enter the price you got, like -110 or +105.';
  else if (!(stake > 0)) s.error = 'Enter the stake.';
  else if (d.market !== 'ml' && !Number.isFinite(line)) s.error = 'Enter the line.';
  else s.error = '';
  if (s.error) return renderLayer();
  const g = gameById(d.gameId);
  const fair = g && state.fairs[g.id] ? state.fairs[g.id][d.market] : null;
  const dec = 1 + (americanToDecimal(pr) - 1) * (1 + (d.boost > 0 ? d.boost : 0));
  const effective = d.boost > 0 ? decimalToAmerican(dec) : pr;
  const ch = fair ? sideChances(d.sport, d.market, fair, d.side, line) : null;
  const bet = {
    id: db.newId('n'),
    createdAt: new Date().toISOString(),
    gameId: d.gameId,
    sport: d.sport,
    start: d.start,
    home: d.home,
    away: d.away,
    market: d.market,
    side: d.side,
    line,
    price: effective,
    dec: d.boost > 0 ? dec : undefined,
    basePrice: d.boost > 0 ? pr : undefined,
    boost: d.boost > 0 ? d.boost : undefined,
    bonus: d.bonus || undefined,
    book: d.book,
    stake,
    fair: ch ? { win: ch.win, push: ch.push, price: fairAmerican(ch.win, ch.push), from: fair.from, method: fair.method } : null,
    evAtBet: ch && !d.bonus ? evDecimal(ch.win, ch.push, dec) : null,
    source: d.source || 'manual',
    result: 'open',
    profit: 0,
  };
  state.saving = true;
  try {
    await db.putBet(bet);
  } finally {
    state.saving = false;
  }
  state.bets.unshift(bet);
  state.sheet = { type: 'saved', betId: bet.id };
  renderLayer();
  renderMain();
}

function sheetSaved(s) {
  const b = state.bets.find((x) => x.id === s.betId);
  if (!b) return '';
  return `<div class="sheet-head"><h2 id="sheet-title">Saved</h2><button class="icon-btn" data-action="close" aria-label="Close">${icon('close')}</button></div>
    <p>${esc(`${sideLabel(b)} ${price(b.price)} at ${bookTitle(b.book)}, ${money(b.stake)}.`)} The Number reads the closing line at kickoff and grades it after the final.</p>
    <div class="row"><button class="btn primary" data-action="to-sweat" data-id="${esc(b.id)}">Follow it in Sweat</button><button class="btn" data-action="close">Done</button></div>`;
}

// ------------------------------------------------------------ promos

function upcomingGames() {
  return state.games.filter((g) => Date.parse(g.start) > now() && !hiddenVA(g) && state.fairs[g.id] && Object.keys(state.fairs[g.id]).length);
}

// The bet picker shared by the boost and second-chance tools.
function pickerHTML() {
  const p = state.promo.pick;
  const games = upcomingGames();
  if (!games.length) return `<p class="sub">${lastScanAt() ? 'No upcoming games in the last scan.' : 'Scan the books first, or type the fair price below.'}</p>`;
  const g = gameById(p.gameId) || games[0];
  if (p.gameId !== g.id) Object.assign(p, { gameId: g.id, market: '', side: '', book: '' });
  const markets = Object.keys(state.fairs[g.id]);
  if (!markets.includes(p.market)) p.market = markets.includes('spread') ? 'spread' : markets[0];
  const [a, b] = sidesOf(p.market);
  if (![a, b].includes(p.side)) p.side = a;
  const books = state.settings.books.filter((k) => g.books[k] && g.books[k][p.market]);
  if (!books.includes(p.book) && p.book !== 'other') p.book = books[0] || 'other';
  const bySport = SPORT_KEYS.map((sp) => [sp, games.filter((x) => x.sport === sp)]).filter(([, l]) => l.length);
  const opt = (k) => {
    const o = g.books[k][p.market][p.side];
    const line = p.market === 'ml' ? '' : p.market === 'spread' ? `${fmtLine(o.line)} ` : `${o.line} `;
    return `${bookTitle(k)}: ${line}${price(o.price)}`;
  };
  return `<label class="field">Game<select class="input" data-bind="promo.pick.gameId">${bySport.map(([sp, l]) => `<optgroup label="${esc(SPORTS[sp].name)}">${l.map((x) => `<option value="${esc(x.id)}" ${x.id === g.id ? 'selected' : ''}>${esc(`${matchupOf(x)}, ${kickoff(x.start)}`)}</option>`).join('')}</optgroup>`).join('')}</select></label>
    <div class="seg" role="group" aria-label="Market">${markets.map((m) => `<button data-action="pick-market" data-market="${m}" aria-pressed="${p.market === m}">${MARKET_NAMES[m]}</button>`).join('')}</div>
    <div class="seg" role="group" aria-label="Side">${[a, b].map((sd) => `<button data-action="pick-side" data-side="${sd}" aria-pressed="${p.side === sd}">${esc(p.market === 'total' ? (sd === 'over' ? 'Over' : 'Under') : nickname(g[sd], g.sport))}</button>`).join('')}</div>
    <label class="field">Book and price<select class="input" data-bind="promo.pick.book">${books.map((k) => `<option value="${k}" ${p.book === k ? 'selected' : ''}>${esc(opt(k))}</option>`).join('')}<option value="other" ${p.book === 'other' ? 'selected' : ''}>Type a line and price</option></select></label>
    ${p.book === 'other' ? `<div class="fields">${p.market === 'ml' ? '' : numField(p.market === 'total' ? 'Total' : 'Line', 'promo.pick.line', p.line, '', 'decimal', p.market === 'spread')}${numField('Price', 'promo.pick.price', p.price, '-110', 'numeric', true)}</div>` : ''}`;
}

// The picked bet: { game, market, side, line, price, book, ch }.
function picked() {
  const p = state.promo.pick;
  const g = gameById(p.gameId);
  if (!g || !p.market) return null;
  let line;
  let pr;
  if (p.book === 'other') {
    line = p.market === 'ml' ? null : num(p.line);
    pr = parseAmerican(p.price);
  } else {
    const o = g.books[p.book] && g.books[p.book][p.market] && g.books[p.book][p.market][p.side];
    if (!o) return null;
    line = o.line;
    pr = o.price;
  }
  if (!Number.isFinite(pr) || (p.market !== 'ml' && !Number.isFinite(line))) return { g, market: p.market, side: p.side, book: p.book, line, price: pr, ch: null, gch: null };
  const fair = state.fairs[g.id][p.market];
  const ch = sideChances(g.sport, p.market, fair, p.side, line);
  const gch = ch ? gateOf(g.sport, p.market, fair, p.side, line) : null;
  return { g, market: p.market, side: p.side, book: p.book, line, price: pr, ch, gch, method: fair && fair.method };
}

function boostPanel() {
  const pr = state.promo;
  const boost = pr.boost === 'custom' ? num(pr.boostCustom) / 100 : pr.boost;
  const x = picked();
  let out = '';
  if (x && x.ch && x.gch && boost > 0) {
    const max = num(pr.boostStake) > 0 ? num(pr.boostStake) : 0;
    const v1 = boostValue(x.ch, x.price, boost, 1);
    const g1 = boostValue(x.gch, x.price, boost, 1);
    const good = g1.ev > 0;
    const sized = stakeFor(x.ch.win, x.ch.push, v1.american, sizing());
    const hasBank = num(state.settings.bankroll) > 0;
    const stake = good ? (hasBank ? Math.min(max || Infinity, sized.stake) : max) : 0;
    state.promo.boostBet = stake;
    const v = boostValue(x.ch, x.price, boost, stake || max);
    const sizeNote = !good ? '' : !hasBank ? 'Set your bankroll and The Number sizes this bet.' : sized.stake >= max ? `Bet the most the boost allows (${money(max)}): sizing says ${money(sized.stake)}.` : `Bet ${money(stake)}: sizing on your bankroll says so, under the ${money(max)} the boost allows.`;
    out = `<div class="verdict ${good ? 'yes' : 'no'}"><p class="big">${good ? `Worth <span class="hl">${esc(money(v.dollars, { sign: true }))}</span>${stake ? ` on ${esc(money(stake))}` : ''}` : v1.ev > 0 ? `Not worth it: ${esc(signedPct(g1.ev))} a dollar at the worst case` : `Not worth it: ${esc(signedPct(v1.ev))} a dollar`}</p>
      <p>${esc(`${price(x.price)} boosted ${Math.round(boost * 100)}% pays like ${price(v1.american)}. ${fairLabel(x.method)} is ${price(fairAmerican(x.ch.win, x.ch.push))}, so each dollar returns ${signedPct(v1.ev)} on average.${worstGate() ? ` At the worst case of the four methods: ${signedPct(g1.ev)}.` : ''}`)}</p>
      ${sizeNote ? `<p class="note">${esc(sizeNote)}</p>` : ''}</div>
      ${good && stake > 0 ? '<button class="btn" data-action="log-boost">Log the boosted bet</button>' : ''}`;
  } else if (x && !x.ch) out = '<p class="sub">Enter a line and price.</p>';
  const chips = [0.2, 0.25, 0.3, 0.5, 1].map((b) => `<button class="chip" data-action="boost-pct" data-v="${b}" aria-pressed="${pr.boost === b}">${Math.round(b * 100)}%</button>`).join('');
  return `<p class="lead">Profit boosts multiply your winnings. Pick the bet and the boost to see what it is worth against the fair price.</p>
    ${pickerHTML()}
    <span class="flabel field">Boost</span><div class="chips" role="group" aria-label="Boost">${chips}<button class="chip" data-action="boost-pct" data-v="custom" aria-pressed="${pr.boost === 'custom'}">Other</button></div>
    <div class="fields">${pr.boost === 'custom' ? numField('Boost %', 'promo.boostCustom', pr.boostCustom, '40', 'decimal') : ''}${numField('Most you can bet', 'promo.boostStake', pr.boostStake, '25', 'decimal')}</div>${out}`;
}

function bonusPanel() {
  const pr = state.promo;
  const books = state.settings.books;
  if (!books.includes(pr.bonusBook)) pr.bonusBook = books[0] || '';
  const amount = num(pr.bonusAmount);
  const minOdds = parseAmerican(pr.bonusMin);
  let out = '';
  if (amount > 0 && pr.bonusBook) {
    const opts = bonusOptions(state.games.filter((g) => !hiddenVA(g)), state.fairs, pr.bonusBook, books, amount, { minOdds: Number.isFinite(minOdds) ? minOdds : null, now: now() });
    if (!opts.length) out = `<p class="sub">${lastScanAt() ? `No market at ${esc(bookTitle(pr.bonusBook))} has the exact other side at another of your books right now.` : 'Scan the books first.'}</p>`;
    else {
      const top = opts.slice(0, 6);
      const keep = opts.filter((o) => o.keepValue != null).sort((a, b) => b.keepValue - a.keepValue)[0];
      out = `<ol class="sheetlist bonus">${top.map((o, i) => `<li class="row">
        <div class="r1"><span class="pick">Lock ${esc(money(o.locked))}</span><span class="px">${i === 0 ? `<span class="hl">${esc(pct(o.rate))}</span>` : esc(pct(o.rate))}</span></div>
        <p>${esc(`Bonus bet ${money(amount)} on ${sideLabel(o)} ${price(o.price)} at ${bookTitle(pr.bonusBook)}.`)}</p>
        <p>${esc(`Cash bet ${money(o.hedge)} on ${sideLabel({ ...o, side: o.hedgeSide, line: o.hedgeLine })} ${price(o.hedgePrice)} at ${bookTitle(o.hedgeBook)}.`)}</p>
        <p class="note">${esc(`${matchupOf(o)}, ${kickoff(o.start)}.${o.pushes ? ' A push returns both bets.' : ''}`)}</p>
        <button class="btn small" data-action="log-bonus" data-i="${i}">Log both bets</button></li>`).join('')}</ol>
        ${keep ? `<p class="note">${esc(`Not hedging: the bonus bet's best average value is ${money(keep.keepValue)} on ${sideLabel(keep)} ${price(keep.price)}, with more swing.`)}</p>` : ''}`;
      state.promo.lastBonus = top;
    }
  }
  return `<p class="lead">A bonus bet pays only the winnings. Put it on a long price and bet the other side with cash at another book, and both outcomes pay the same.</p>
    <div class="fields">${numField('Bonus bet amount', 'promo.bonusAmount', pr.bonusAmount, '25', 'decimal')}
    <label class="field">Bonus is at<select class="input" data-bind="promo.bonusBook">${books.map((k) => `<option value="${k}" ${pr.bonusBook === k ? 'selected' : ''}>${esc(bookTitle(k))}</option>`).join('')}</select></label>
    ${numField('Lowest price allowed (optional)', 'promo.bonusMin', pr.bonusMin, '-200', 'numeric', true)}</div>${out}`;
}

function secondChancePanel() {
  const pr = state.promo;
  const x = picked();
  const stake = num(pr.scStake);
  const cap = num(pr.scCap) > 0 ? num(pr.scCap) : stake;
  const rate = num(pr.scRate) > 0 ? num(pr.scRate) / 100 : 0.7;
  let out = '';
  if (x && x.ch && x.gch && stake > 0) {
    const v = secondChanceValue(x.ch, x.price, stake, cap, rate);
    const gv = secondChanceValue(x.gch, x.price, stake, cap, rate);
    const good = gv.dollars > 0;
    out = `<div class="verdict ${good ? 'yes' : 'no'}"><p class="big">${good ? `Worth <span class="hl">${esc(money(v.dollars, { sign: true }))}</span>` : v.dollars > 0 ? `Not worth it at the worst case: ${esc(money(gv.dollars, { sign: true }))}` : `Worth ${esc(money(v.dollars, { sign: true }))}`}</p>
      <p>${esc(`The bet itself: ${money(v.cash, { sign: true })} at fair${methodTag(x.method)}. The refund if it loses (${pct(x.ch.loss)} of the time) as a bonus bet you turn into cash at ${pct(rate)}: ${money(v.refund, { sign: true })}.${worstGate() ? ` At the worst case of the four methods, all of it is worth ${money(gv.dollars, { sign: true })}.` : ''}`)}</p>
      <p class="note">Longer prices lose more often, so they get more out of a refund.</p></div>`;
  }
  return `<p class="lead">A second-chance bet refunds a loss as a bonus bet. Its value is the bet at fair plus the refund you can turn into cash.</p>
    ${pickerHTML()}<div class="fields">${numField('Stake', 'promo.scStake', pr.scStake, '25', 'decimal')}${numField('Most it refunds', 'promo.scCap', pr.scCap, '25', 'decimal')}${numField('Bonus kept as cash %', 'promo.scRate', pr.scRate, '70', 'decimal')}</div>${out}`;
}

function viewPromos() {
  const m = state.promo.mode;
  const modes = [['boost', 'Profit boost'], ['bonus', 'Bonus bet'], ['second', 'Second chance']];
  const body = m === 'bonus' ? bonusPanel() : m === 'second' ? secondChancePanel() : boostPanel();
  return `<section class="view"><div class="viewhead"><h1>Promos</h1></div>
    <div class="seg" role="group" aria-label="Promo">${modes.map(([k, l]) => `<button data-action="promo-mode" data-mode="${k}" aria-pressed="${m === k}">${l}</button>`).join('')}</div>
    <div class="panel">${body}</div></section>`;
}

// ------------------------------------------------------------ record

const isSettled = (b) => SETTLED.has(b.result);

function verdictHTML(s) {
  const n = s.clv.n;
  if (s.verdict === 'none') return `<div class="verdict"><p class="big">No closing lines yet</p><p>Log the bets you place. At kickoff The Number reads where the line closed; beating it is the surest sign of an edge, long before wins and losses settle down.</p></div>`;
  const range = `${signedPct(s.clv.lo)} to ${signedPct(s.clv.hi)}`;
  if (s.verdict === 'early') return `<div class="verdict"><p class="big">${esc(signedPct(s.clv.mean))} a bet so far</p><p>${esc(`${n} ${n === 1 ? 'bet has' : 'bets have'} a closing line. Give it 20 before reading much into it.`)}</p></div>`;
  if (s.verdict === 'beating') return `<div class="verdict yes"><p class="big">Beating the close by <span class="hl">${esc(signedPct(s.clv.mean))}</span> a bet</p><p>${esc(`Most likely between ${range} over ${n} bets. That is a real edge.`)}</p></div>`;
  if (s.verdict === 'losing') return `<div class="verdict no"><p class="big">Behind the close by ${esc(signedPct(s.clv.mean))} a bet</p><p>${esc(`Most likely between ${range} over ${n} bets. The prices you take are worse than where they close.`)}</p></div>`;
  return `<div class="verdict"><p class="big">${esc(signedPct(s.clv.mean))} a bet against the close</p><p>${esc(`Too close to call over ${n} bets (${range}).${s.needed ? ` About ${s.needed} more at this rate would settle it.` : ''}`)}</p></div>`;
}

function breakdown(bets, by) {
  const key = (b) => (by === 'sport' ? SPORTS[b.sport].name : by === 'market' ? MARKET_NAMES[b.market] : bookTitle(b.book));
  const groups = new Map();
  for (const b of bets) {
    if (b.result === 'void') continue;
    const k = key(b);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(b);
  }
  const rows = [...groups.entries()].map(([k, list]) => {
    const s = summarize(list);
    return `<tr><th scope="row">${esc(k)}</th><td>${list.length}</td><td class="${s.clv.mean > 0 ? 'pos' : s.clv.mean < 0 ? 'neg' : ''}">${Number.isFinite(s.clv.mean) ? esc(signedPct(s.clv.mean)) : ''}</td><td class="${s.profit > 0 ? 'pos' : s.profit < 0 ? 'neg' : ''}">${esc(money(s.profit, { sign: true }))}</td></tr>`;
  }).join('');
  return rows ? `<table class="shop small"><thead><tr><th scope="col">${by === 'sport' ? 'Sport' : by === 'market' ? 'Market' : 'Book'}</th><th scope="col">Bets</th><th scope="col">Vs close</th><th scope="col">Profit</th></tr></thead><tbody>${rows}</tbody></table>` : '';
}

function betRowHTML(b) {
  const started = Date.parse(b.start) <= now();
  const clv = b.bonus ? '<span class="muted">Bonus bet</span>' : Number.isFinite(b.clv) ? `<span class="${b.clv > 0 ? 'pos' : 'neg'}">${esc(signedPct(b.clv))} vs close</span>` : started ? '<span class="muted">Closing line pending</span>' : `<span class="muted">Closes ${esc(until(Date.parse(b.start)))}</span>`;
  const amount = b.result === 'void' || b.result === 'push' || (b.bonus && b.result === 'lost') ? '' : esc(money(b.profit, { sign: true }));
  const res = isSettled(b) ? `<span class="res ${b.result}">${esc(b.result === 'won' ? 'Won' : b.result === 'lost' ? 'Lost' : b.result === 'push' ? 'Push' : 'Void')} ${amount}</span>` : '<span class="res open">Open</span>';
  return `<li class="row bet" data-action="open-bet" data-id="${esc(b.id)}" tabindex="0" role="button">
    <div class="r1"><span class="pick">${esc(sideLabel(b))}</span><span class="px">${esc(price(b.price))}</span></div>
    <div class="r2"><span>${esc(`${matchupOf(b)}, ${kickoff(b.start)}`)}</span><span class="bk">${esc(`${bookTitle(b.book)}, ${money(b.stake)}${b.bonus ? ' bonus' : ''}`)}</span></div>
    <div class="r2">${clv}${res}</div></li>`;
}

const isPromo = (b) => b.bonus || b.source === 'bonus' || b.source === 'boost';

function viewRecord() {
  const bets = state.bets;
  const core = bets.filter((b) => !isPromo(b));
  const promos = bets.filter(isPromo);
  const s = summarize(core);
  const r = state.record;
  const settled = core.filter(isSettled).sort((a, b) => (a.start < b.start ? -1 : 1));
  let acc = 0;
  let exp = 0;
  const chartRows = [{ actual: 0, expected: 0 }];
  for (const b of settled) {
    if (b.result === 'void') continue;
    acc += b.profit || 0;
    exp += b.stake * (Number.isFinite(b.clv) ? b.clv : b.evAtBet || 0);
    chartRows.push({ actual: acc, expected: exp });
  }
  const promoProfit = promos.reduce((a, b) => a + (isSettled(b) ? b.profit || 0 : 0), 0);
  const promoOpen = promos.filter((b) => !isSettled(b)).length;
  const stats = s.bets ? `<dl class="stats">
    <div><dt>Bets</dt><dd>${s.bets}</dd></div>
    <div><dt>Record</dt><dd>${s.won}-${s.lost}${s.pushed ? `-${s.pushed}` : ''}</dd></div>
    <div><dt>Profit</dt><dd class="${s.profit > 0 ? 'pos' : s.profit < 0 ? 'neg' : ''}">${esc(money(s.profit, { sign: true }))}</dd></div>
    <div><dt>Return</dt><dd>${Number.isFinite(s.roi) ? esc(signedPct(s.roi)) : ''}</dd></div>
    <div><dt>Beat the close</dt><dd>${Number.isFinite(s.clv.beat) ? esc(pct(s.clv.beat)) : ''}</dd></div>
    <div><dt>Worth at close</dt><dd>${s.clv.n ? esc(money(s.clv.dollars, { sign: true })) : ''}</dd></div>
  </dl>` : '';
  const promoLine = promos.length ? `<p class="note">${esc(`Boosts and bonus bets are kept out of these numbers: ${promos.length} bet${promos.length === 1 ? '' : 's'}, ${money(promoProfit, { sign: true })} so far${promoOpen ? `, ${promoOpen} open` : ''}.`)}</p>` : '';
  const chart = chartRows.length > 2 ? `<figure class="fig">${recordChart(chartRows)}<figcaption><span class="k act"></span>Profit <span class="k exp"></span>What the closing prices said to expect</figcaption></figure>` : '';
  const bys = [['sport', 'Sport'], ['market', 'Market'], ['book', 'Book']];
  const table = core.length ? `<div class="seg small" role="group" aria-label="Break down by">${bys.map(([k, l]) => `<button data-action="rec-by" data-by="${k}" aria-pressed="${r.by === k}">${l}</button>`).join('')}</div>${breakdown(core, r.by)}` : '';
  const shows = [['all', 'All'], ['open', 'Open'], ['settled', 'Settled']];
  const list = bets.filter((b) => r.show === 'all' || (r.show === 'open' ? !isSettled(b) : isSettled(b)));
  const listHTML = bets.length ? `<div class="viewhead sub"><h2>Bets</h2><div class="seg small" role="group" aria-label="Show">${shows.map(([k, l]) => `<button data-action="rec-show" data-show="${k}" aria-pressed="${r.show === k}">${l}</button>`).join('')}</div></div>
    ${list.length ? `<ul class="sheetlist">${list.map(betRowHTML).join('')}</ul>` : '<p class="sub">None here.</p>'}` : '';
  const data = `<div class="row wrap"><button class="btn small" data-action="export-csv" ${bets.length ? '' : 'disabled'}>Spreadsheet (CSV)</button><button class="btn small" data-action="export-war" ${bets.length ? '' : 'disabled'}>War Room file</button></div>`;
  return `<section class="view"><div class="viewhead"><h1>Record</h1></div>${verdictHTML(s)}${stats}${promoLine}${chart}${table}${listHTML}${bets.length ? data : ''}</section>`;
}

function sheetBet(s) {
  const b = state.bets.find((x) => x.id === s.id);
  if (!b) return '';
  const e = s.edit;
  const close = b.close
    ? `<p>${esc(`Closed ${b.close.line != null && b.market !== 'ml' ? `${b.market === 'spread' ? fmtLine(b.side === 'home' ? b.close.line : -b.close.line) : b.close.line} ` : ''}with your side fair${methodTag(b.close.method)} at ${price(b.close.fairAtBet)} at your line (${b.close.source === 'pinnacle' ? 'Pinnacle at kickoff' : b.close.source === 'scan' ? `your last scan, ${b.close.mins} min before kickoff` : `${b.close.provider || 'ESPN'} closing line`}).`)}</p>`
    : '<p class="sub">No closing line yet.</p>';
  const results = [['won', 'Won'], ['lost', 'Lost'], ['push', 'Push'], ['void', 'Void'], ['open', 'Open']];
  return `<div class="sheet-head"><h2 id="sheet-title">${esc(`${sideLabel(b)} ${price(b.price)}`)}</h2><button class="icon-btn" data-action="close" aria-label="Close">${icon('close')}</button></div>
    <p class="sub">${esc(`${matchupOf(b)}, ${kickoff(b.start)}. ${bookTitle(b.book)}, ${money(b.stake)}${b.bonus ? ' bonus bet' : ''}${b.boost ? `, ${Math.round(b.boost * 100)}% boost` : ''}.`)}</p>
    <dl class="stats tight"><div><dt>Fair when bet${esc(methodTag(b.fair && b.fair.method))}</dt><dd class="fair">${b.fair ? esc(price(b.fair.price)) : ''}</dd></div><div><dt>Edge when bet</dt><dd>${Number.isFinite(b.evAtBet) ? esc(signedPct(b.evAtBet)) : ''}</dd></div><div><dt>Vs close</dt><dd class="${b.clv > 0 ? 'pos' : b.clv < 0 ? 'neg' : ''}">${Number.isFinite(b.clv) ? esc(signedPct(b.clv)) : ''}</dd></div><div><dt>Result</dt><dd>${esc(isSettled(b) ? `${b.result}${b.result === 'won' || b.result === 'lost' ? ` ${money(b.profit, { sign: true })}` : ''}` : 'open')}</dd></div></dl>
    ${close}${b.note ? `<p class="note">${esc(b.note)}</p>` : ''}
    <h3>Fix it</h3>
    <div class="fields">${numField('Price', 'sheet.edit.price', e.price, '-110', 'numeric', true)}${numField('Stake', 'sheet.edit.stake', e.stake, '25', 'decimal')}${b.market === 'ml' ? '' : numField('Line', 'sheet.edit.line', e.line, '', 'decimal', b.market === 'spread')}</div>
    <div class="seg" role="group" aria-label="Result">${results.map(([k, l]) => `<button data-action="set-result" data-r="${k}" aria-pressed="${e.result === k}">${l}</button>`).join('')}</div>
    ${s.error ? `<p class="neg">${esc(s.error)}</p>` : ''}
    <div class="row wrap"><button class="btn primary" data-action="save-bet">Save changes</button><button class="btn" data-action="to-sweat" data-id="${esc(b.id)}">Follow in Sweat</button><button class="btn danger" data-action="ask-delete">Delete</button></div>`;
}

function openBet(id) {
  const b = state.bets.find((x) => x.id === id);
  if (!b) return;
  state.sheet = { type: 'bet', id, edit: { price: b.basePrice != null ? price(b.basePrice) : price(b.price), stake: String(b.stake), line: b.line == null ? '' : String(b.line), result: b.result }, error: '' };
  renderLayer();
}

async function saveBetEdit() {
  const s = state.sheet;
  const b = state.bets.find((x) => x.id === s.id);
  if (!b) return;
  const pr = parseAmerican(s.edit.price);
  const stake = num(s.edit.stake);
  const line = b.market === 'ml' ? null : num(s.edit.line);
  if (!Number.isFinite(pr) || !(stake > 0) || (b.market !== 'ml' && !Number.isFinite(line))) {
    s.error = 'Check the price, stake and line.';
    return renderLayer();
  }
  const dec = 1 + (americanToDecimal(pr) - 1) * (1 + (b.boost || 0));
  b.price = b.boost ? decimalToAmerican(dec) : pr;
  if (b.boost) {
    b.basePrice = pr;
    b.dec = dec;
  }
  b.stake = stake;
  if (line !== b.line) {
    // A new line needs the fair chances at that line: from the board while the game is up.
    const g = gameById(b.gameId);
    const fair = g && state.fairs[g.id] ? state.fairs[g.id][b.market] : null;
    const ch = fair ? sideChances(b.sport, b.market, fair, b.side, line) : null;
    b.fair = ch ? { win: ch.win, push: ch.push, price: fairAmerican(ch.win, ch.push), from: fair.from, method: fair.method } : null;
  }
  b.line = line;
  b.evAtBet = b.fair && !b.bonus ? evDecimal(b.fair.win, b.fair.push, dec) : null;
  if (b.close) {
    b.close.fairAtBet = closeFairAt(b, b.close);
    b.clv = clvOf(b, asClose(b.close));
  }
  const manual = s.edit.result;
  if (manual !== b.result || manual !== 'open') {
    b.result = manual;
    b.manual = manual !== 'open';
    b.profit = betProfit(b, manual);
    b.gradedAt = manual === 'open' ? null : new Date().toISOString();
  }
  await db.putBet(b);
  state.sheet = null;
  toast('Saved.');
  render();
}

// ------------------------------------------------------------ settings

function seg(label, key, options, current) {
  return `<div class="field"><span class="flabel">${esc(label)}</span><div class="seg" role="group" aria-label="${esc(label)}">${options.map(([v, l]) => `<button data-action="set" data-key="${key}" data-v="${esc(String(v))}" aria-pressed="${String(current) === String(v)}">${esc(l)}</button>`).join('')}</div></div>`;
}

function scanCost() {
  const books = scanBooks();
  const per = Math.ceil(books.length / 10);
  const sports = SPORT_KEYS.filter((k) => state.settings.sports[k] && (!state.active || !state.active.list || state.active.list.includes(k)));
  return sports.reduce((a, k) => a + SPORTS[k].markets.length * per, 0);
}

function viewSettings() {
  const s = state.settings;
  const sw = (key, label, note = '') => `<label class="switch"><span>${esc(label)}${note ? `<span class="note">${esc(note)}</span>` : ''}</span><input type="checkbox" data-bind="settings.${key}" ${s[key] ? 'checked' : ''}></label>`;
  const bookList = BOOK_KEYS.filter((k) => k !== 'pinnacle' && BOOKS[k].va).map((k) => `<label class="switch"><span>${esc(bookTitle(k))}${BOOKS[k].paid ? '<span class="note">Needs a paid Odds API plan</span>' : ''}</span><input type="checkbox" data-action="book" data-book="${k}" ${s.books.includes(k) ? 'checked' : ''}></label>`).join('');
  const cost = scanCost();
  const perDay = s.auto ? Math.round(cost * (60 / s.auto) * 14) : 0;
  return `<section class="view settings"><div class="viewhead"><h1>Settings</h1></div>
    <div class="card"><h2>Bankroll</h2>
      <div class="fields">${numField('Bankroll', 'settings.bankroll', s.bankroll || '', '1000', 'decimal')}${numField('One unit', 'settings.unit', s.unit, '10', 'decimal')}</div>
      ${seg('Share of Kelly to bet', 'kelly', [[0.125, 'Eighth'], [0.25, 'Quarter'], [0.5, 'Half']], s.kelly)}
      <div class="fields">${numField('Smallest bet, % of bankroll', 'settings.minPctText', s.minPctText != null ? s.minPctText : String(s.minPct * 100), '0.5', 'decimal')}${numField('Largest bet, % of bankroll', 'settings.maxPctText', s.maxPctText != null ? s.maxPctText : String(s.maxPct * 100), '5', 'decimal')}</div>
      <p class="note">Kelly sizes each bet by its edge and price. A quarter of it keeps the swings small while you find out how good your edges really are.</p></div>
    <div class="card"><h2>What counts as an edge</h2>
      ${seg('Smallest edge to show', 'minEdge', [[0.01, '1%'], [0.02, '2%'], [0.03, '3%'], [0.04, '4%'], [0.05, '5%']], s.minEdge)}
      ${seg('Longest favorite', 'maxFav', [[-200, '-200'], [-250, '-250'], [-300, '-300'], [-500, '-500'], ['any', 'Any']], s.maxFav)}
      ${sw('hideVA', 'Hide Virginia college teams', 'Virginia law bars bets on games with in-state college teams.')}
      <p class="note">When the sharp book has no price, the books' median stands in and an edge has to clear the bar by one more point.</p></div>
    <div class="card"><h2>Your books</h2>${bookList}
      <p class="note">${esc(`Each scan costs about ${cost} credit${cost === 1 ? '' : 's'} for your sports in season (Pinnacle plus up to 9 books count as one).${state.credits && state.credits.remaining != null ? ` ${creditsText()}.` : ''}`)}</p></div>
    <div class="card"><h2>Sports</h2>${SPORT_KEYS.map((k) => `<label class="switch"><span>${esc(SPORTS[k].name)}</span><input type="checkbox" data-action="sport-on" data-sport="${k}" ${s.sports[k] ? 'checked' : ''}></label>`).join('')}</div>
    <div class="card"><h2>Fair price</h2>
      ${seg('Fair price from', 'ref', [['pinnacle', 'Pinnacle'], ['median', 'Books’ median']], s.ref)}
      <label class="field">Fair price method<select class="input" data-bind="settings.fairMethod">${Object.entries(FAIR_METHODS).map(([k, l]) => `<option value="${k}" ${s.fairMethod === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <p class="note">The fair prices you see. Power and Shin take more of the book's margin from the longshot than multiplicative does, which matches real results better. On two-way markets Shin comes out the same as additive, which takes an equal amount off each side.</p>
      ${seg('EV gate', 'evGate', [['worst', 'Worst case'], ['fair', 'Fair price method']], s.evGate)}
      <p class="note">What counts as an edge: the Edges list, highlights, alerts, and every Bet or Pass. Worst case takes the lowest fair chance of the four methods for the side you bet, so an edge has to hold up however the vig comes off.</p></div>
    <div class="card"><h2>Scanning and alerts</h2>
      ${seg('Scan on its own while open', 'auto', [[0, 'Off'], [15, 'Every 15 min'], [30, '30 min'], [60, 'Hourly']], s.auto)}
      ${s.auto ? `<p class="note">${esc(`About ${perDay} credits a day if left open 14 hours. The free plan has 500 a month.`)}</p>` : ''}
      ${sw('alerts', 'Alert me to new edges')}
      ${seg('Alert at', 'alertEdge', [[0.02, '2%'], [0.03, '3%'], [0.04, '4%'], [0.05, '5%']], s.alertEdge)}
      ${sw('sound', 'Sound')}
      ${typeof Notification !== 'undefined' && Notification.permission !== 'granted' ? '<button class="btn small" data-action="notif">Allow notifications</button>' : ''}</div>
    <div class="card"><h2>Arbs and middles</h2>
      ${seg('Hide prices older than', 'staleMin', [[5, '5 min'], [10, '10 min'], [15, '15 min'], [30, '30 min'], [60, '1 h'], [0, 'Never']], s.staleMin)}
      ${seg('Smallest EV per $100 to show', 'minMidEv', [[0, '$0'], [1, '$1'], [2, '$2'], [3, '$3'], [5, '$5']], s.minMidEv)}
      <p class="note">Applies to the Arbs tab only. Edges and the line shop are not hidden by it.</p>
      <div class="fields">${['nfl', 'cfb', 'nba', 'ncaab'].flatMap((sp) => ['spread', 'total'].map((m) => numField(`${SPORTS[sp].short} ${m} SD`, `settings.${sdKey(sp, m)}`, s[sdKey(sp, m)] != null ? s[sdKey(sp, m)] : '', String(DEFAULT_SD[sp][m]), 'decimal'))).join('')}</div>
      <p class="note">Standard deviation of the final margin or total, in points, for the normal curve behind a middle's chance. Blank uses the default shown. NFL spreads use the key number table instead.</p></div>
    <div class="card"><h2>Closing lines</h2>
      ${seg('Read the close from', 'closing', [['free', 'Free'], ['pinnacle', 'Pinnacle (paid plan)']], s.closing)}
      <p class="note">${s.closing === 'pinnacle' ? 'Exact Pinnacle prices at kickoff from The Odds API history: about 10 credits per kickoff time per market. Paid plans only.' : 'Free: your own scan if one ran in the last 20 minutes before kickoff, otherwise the closing line ESPN shows.'}</p></div>
    <div class="card"><h2>Connections</h2>
      <label class="field">Passcode<input class="input" type="password" data-bind="settings.passcode" value="${esc(s.passcode)}" autocomplete="off" placeholder="The APP_PASSCODE you set in Netlify"></label>
      <label class="field">Sweat address<input class="input" type="url" data-bind="settings.sweatUrl" value="${esc(s.sweatUrl)}" autocomplete="off"></label></div>
    <div class="card"><h2>Look</h2>${seg('Theme', 'theme', [['day', 'Day'], ['night', 'Night'], ['auto', 'Match phone']], s.theme)}</div>
    <div class="card"><h2>Your data</h2><p class="note">Bets and settings live on this phone. Back up before switching phones.</p>
      <div class="row wrap"><button class="btn small" data-action="export-json">Back up</button><label class="btn small">Restore<input type="file" accept="application/json,.json" class="sr" data-action="import-json"></label><button class="btn small" data-action="export-csv">Spreadsheet (CSV)</button><button class="btn small" data-action="export-war">War Room file</button></div></div>
    <div class="card"><h2>How the numbers work</h2>
      <p>The sharp book's two prices, with its margin taken out, give each side's fair chance. Another book's price is worth betting when it pays more than that. Lines that differ (a -2.5 against a -3) are priced through score curves fitted on real closing lines and finals, so the hook on 3 and 7 is worth what it really is.</p>
      <p>There are four common ways to take the margin out: multiplicative, additive, power and Shin. Fair prices use the one you pick. With the EV gate at worst case, a price counts as an edge only when it beats fair under all four.</p>
      <p>Edge is the average return per dollar at the fair price. Closing line value is the same thing measured at kickoff: beating it over a few hundred bets is the clearest sign your edges are real.</p>
      <p class="note">${esc(`The Number ${APP_VERSION}. Odds from The Odds API, scores and free closing lines from ESPN.`)}</p></div>
  </section>`;
}

async function saveSettings() {
  await db.setKV('settings', state.settings);
}

// ------------------------------------------------------------ scanning

async function activeList() {
  const enabled = SPORT_KEYS.filter((k) => state.settings.sports[k]);
  const fresh = state.active && now() - state.active.at < 3600e3;
  if (!fresh) {
    try {
      const r = await feed.activeSports(state.settings.passcode);
      state.active = { list: r.active, at: now() };
      await db.setKV('active', state.active);
    } catch (e) {
      // A wrong passcode stops here; anything else, try every enabled sport.
      if (e.status === 401 || e.status === 429 || e.status === 503) throw e;
    }
  }
  return state.active && Array.isArray(state.active.list) ? enabled.filter((k) => state.active.list.includes(k)) : enabled;
}

async function scanAll(manual = false) {
  if (state.scanning) return;
  if (!ready()) {
    if (manual) {
      if (!state.caps.odds) {
        state.caps = { ...(await feed.status()), checked: true };
        if (state.caps.odds) return scanAll(manual);
      }
      toast(state.caps.odds ? 'Enter your passcode in Settings first.' : 'The site cannot reach your Odds API key. Check ODDS_API_KEY in Netlify and redeploy.');
      if (state.caps.odds) go('settings');
    }
    return;
  }
  state.scanning = true;
  state.scanError = '';
  renderTop();
  if (manual) toast('Scanning the books...');
  try {
    const sports = await activeList();
    if (!sports.length) {
      state.scanError = 'None of your sports are in season right now. Turn more on in Settings.';
      if (manual) toast(state.scanError);
      return;
    }
    const books = scanBooks();
    const results = await Promise.allSettled(sports.map((sp) => feed.scan(sp, books, SPORTS[sp].markets, state.settings.passcode)));
    const errors = [];
    results.forEach((r, i) => {
      const sp = sports[i];
      if (r.status === 'fulfilled') {
        const v = r.value;
        state.scans[sp] = { events: v.events, at: Date.parse(v.fetchedAt) || now(), cost: v.cost };
        if (v.credits && v.credits.remaining != null && !v.cached) state.credits = { ...v.credits, at: now() };
      } else errors.push(r.reason);
    });
    for (const k of Object.keys(state.scans)) if (!sports.includes(k)) delete state.scans[k];
    if (errors.length) {
      const e = errors[0];
      state.scanError = e.status === 401 ? 'The passcode did not match. Check it in Settings.' : e.message;
    }
    rebuild({ alerts: true });
    await Promise.all([db.setKV('scans', state.scans), db.setKV('credits', state.credits), persistSnaps()]);
    if (manual && !errors.length) toast(state.edges.length ? `${state.edges.length} ${state.edges.length === 1 ? 'price beats' : 'prices beat'} fair.` : 'Scanned. Nothing above fair right now.');
    if (manual && errors.length) toast(state.scanError);
  } catch (e) {
    state.scanError = e && e.status === 401 ? 'The passcode did not match. Check it in Settings.' : `Scan failed: ${(e && e.message) || e}`;
    if (manual) toast(state.scanError);
  } finally {
    state.scanning = false;
    render();
  }
}

// Games, fair prices and edges from the saved scans; also records each game's fair view over time.
function rebuild(opts = {}) {
  const games = [];
  const fairs = {};
  const ref = state.settings.ref === 'median' ? '__none__' : state.settings.ref;
  for (const [sport, s] of Object.entries(state.scans)) {
    if (!SPORTS[sport] || !state.settings.sports[sport]) continue;
    for (const e of s.events || []) {
      const g = parseEvent(e, sport);
      g.scannedAt = s.at;
      games.push(g);
      fairs[g.id] = fairFor(g, { ref, method: state.settings.fairMethod });
    }
  }
  games.sort((a, b) => (a.start < b.start ? -1 : 1));
  state.games = games;
  state.fairs = fairs;
  for (const g of games) snapshot(g, fairs[g.id]);
  const before = new Set(state.edges.map(edgeKey));
  state.edges = edgesFrom(games, fairs, state.settings.books, edgeOpts(), now());
  const t = now();
  const live = new Set(state.edges.map(edgeKey));
  for (const k of live) if (!state.seen[k]) state.seen[k] = t;
  for (const k of Object.keys(state.seen)) if (!live.has(k)) delete state.seen[k];
  db.setKV('seen', state.seen);
  if (opts.alerts && state.settings.alerts) {
    const fresh = state.edges.filter((x) => !before.has(edgeKey(x)) && x.gateEv >= state.settings.alertEdge);
    if (fresh.length && before.size + fresh.length > 0) {
      const x = fresh[0];
      notify(`${sideLabel(x)} ${price(x.price)} at ${bookTitle(x.book)}`, `${signedPct(x.ev)} edge${fresh.length > 1 ? `, and ${fresh.length - 1} more` : ''}`);
    }
  }
}

// A game's fair view at scan time, kept until a day after kickoff for the closing line.
function snapshot(g, fair) {
  if (!fair || !g.scannedAt) return;
  const start = Date.parse(g.start);
  if (g.scannedAt > start) return;
  const list = state.snaps[g.id] || [];
  if (list.length && list[list.length - 1].t >= g.scannedAt) return;
  const v = {};
  for (const m of ['ml', 'spread', 'total']) if (fair[m] && fair[m].from === 'sharp' && !fair[m].unsettled) v[m] = fair[m].value;
  if (!Object.keys(v).length) return;
  list.push({ t: g.scannedAt, method: Object.values(fair).map((f) => f.method).find(Boolean), ...v });
  state.snaps[g.id] = list.slice(-12);
  state.snapsDirty = true;
}

function persistSnaps() {
  const cutoff = now() - 4 * 86400e3;
  const ids = new Set(state.games.map((g) => g.id));
  for (const b of state.bets) if (!b.close) ids.add(b.gameId);
  for (const [id, list] of Object.entries(state.snaps)) {
    if (!ids.has(id) || !list.length || list[list.length - 1].t < cutoff) delete state.snaps[id];
  }
  state.snapsDirty = false;
  return db.setKV('snaps', state.snaps);
}

let timer = null;
function schedule() {
  clearTimeout(timer);
  const mins = Number(state.settings.auto) || 0;
  timer = setTimeout(async () => {
    try {
      if (mins && !document.hidden && ready()) {
        const reserve = state.credits && state.credits.remaining != null && state.credits.remaining < scanCost() + 20;
        if (!reserve) await scanAll(false);
      }
      await followUp();
    } finally {
      schedule();
    }
  }, (mins || 10) * 60 * 1000);
}

// ------------------------------------------------------------ closing lines and grading

const boards = new Map();
function board(sport, date) {
  const k = `${sport}|${date}`;
  const hit = boards.get(k);
  if (hit && now() - hit.at < 5 * 60 * 1000) return hit.p;
  const p = feed.scoreboard(sport, date).catch(() => []);
  boards.set(k, { p, at: now() });
  return p;
}

const betProfit = (b, result) => profitOf(b, result);

// Fair price at the bet's line from a closing view.
const asClose = (close) => ({ value: close.view });
function closeFairAt(b, close) {
  const ch = chancesAtClose(b, asClose(close));
  return ch ? fairAmerican(ch.win, ch.push) : null;
}

async function pinnacleCloses(open) {
  const groups = new Map();
  for (const b of open) {
    const k = `${b.sport}|${b.start}`;
    if (!groups.has(k)) groups.set(k, { sport: b.sport, start: b.start, markets: new Set(), bets: [] });
    const gr = groups.get(k);
    gr.markets.add({ ml: 'h2h', spread: 'spreads', total: 'totals' }[b.market]);
    gr.bets.push(b);
  }
  for (const gr of groups.values()) {
    try {
      const date = new Date(Date.parse(gr.start)).toISOString().replace(/\.\d{3}Z$/, 'Z');
      const r = await feed.closing(gr.sport, date, [...gr.markets], state.settings.passcode);
      for (const b of gr.bets) {
        const ev = r.events.find((e) => e.id === b.gameId);
        if (!ev) continue;
        const g = parseEvent(ev, b.sport);
        const f = fairFor(g, { ref: 'pinnacle', method: state.settings.fairMethod })[b.market];
        if (f && f.from === 'sharp') setClose(b, { source: 'pinnacle', view: f.value, line: f.line, method: f.method });
      }
    } catch (e) {
      if (e.status === 402) {
        state.settings.closing = 'free';
        await saveSettings();
        toast('Exact closing lines need a paid Odds API plan. Using the free closing lines.');
        return;
      }
    }
  }
}

function setClose(b, close) {
  const v = close.view;
  const line = close.line != null ? close.line : b.market === 'spread' && v && Number.isFinite(v.ref) ? -v.ref : b.market === 'total' && v ? v.ref : null;
  b.close = { ...close, line, at: new Date().toISOString() };
  b.close.fairAtBet = closeFairAt(b, b.close);
  b.clv = b.bonus ? null : clvOf(b, asClose(b.close));
  b.dirty = true;
}

// After kickoff: read the closing line. After the final: grade. Runs on open and every few minutes.
let following = false;
async function followUp() {
  if (following) return;
  following = true;
  try {
    const t = now();
    const needClose = state.bets.filter((b) => !b.close && Date.parse(b.start) <= t && b.result !== 'void');
    if (needClose.length && state.settings.closing === 'pinnacle' && ready()) await pinnacleCloses(needClose);
    const needEspn = [];
    for (const b of needClose) {
      if (b.close) continue;
      const list = state.snaps[b.gameId] || [];
      const start = Date.parse(b.start);
      const last = [...list].reverse().find((x) => x.t <= start && x[b.market] != null);
      const mins = last ? Math.round((start - last.t) / 60000) : Infinity;
      if (last && mins <= 20) setClose(b, { source: 'scan', view: last[b.market], mins, method: last.method });
      else needEspn.push({ b, last, mins });
    }
    const toGrade = state.bets.filter((b) => !SETTLED.has(b.result) && Date.parse(b.start) <= t);
    const lookups = new Map();
    for (const b of [...needEspn.map((x) => x.b), ...toGrade]) {
      const date = espnDate(new Date(b.start));
      lookups.set(`${b.sport}|${date}`, { sport: b.sport, date });
    }
    const boardsBy = new Map();
    await Promise.all([...lookups.values()].map(async (l) => boardsBy.set(`${l.sport}|${l.date}`, await board(l.sport, l.date))));
    const gamesFor = (b) => boardsBy.get(`${b.sport}|${espnDate(new Date(b.start))}`) || [];
    for (const { b, last, mins } of needEspn) {
      const m = matchGame(b, gamesFor(b));
      const c = m ? closeFromEspn(b, m, state.settings.fairMethod) : null;
      if (c && m.game.state !== 'pre') setClose(b, { source: 'espn', view: c.value, line: c.line, provider: c.provider, method: state.settings.fairMethod });
      else if (last && mins <= 180 && t - Date.parse(b.start) > 3 * 3600e3) setClose(b, { source: 'scan', view: last[b.market], mins, method: last.method });
    }
    for (const b of toGrade) {
      if (b.manual) continue;
      const m = matchGame(b, gamesFor(b));
      const r = gradeBet(b, m, t);
      if (r) {
        b.result = r;
        b.profit = betProfit(b, r);
        b.gradedAt = new Date().toISOString();
        b.dirty = true;
        if (r !== 'void') notify(`${r === 'won' ? 'Won' : r === 'lost' ? 'Lost' : 'Push'}: ${sideLabel(b)}`, `${money(b.profit, { sign: true })}${Number.isFinite(b.clv) ? `, ${signedPct(b.clv)} vs close` : ''}`, true);
      } else if (!m && t - Date.parse(b.start) > 2 * 86400e3 && !b.note) {
        b.note = 'ESPN has no result for this game. Set the result by hand.';
        b.dirty = true;
      }
    }
    const dirty = state.bets.filter((b) => b.dirty);
    for (const b of dirty) delete b.dirty;
    if (dirty.length) await db.putBets(dirty);
    if (state.snapsDirty) await persistSnaps();
    if (dirty.length && !state.sheet) renderMain();
  } finally {
    following = false;
  }
}

// ------------------------------------------------------------ Sweat and exports

async function toSweat(id) {
  const b = state.bets.find((x) => x.id === id);
  if (!b) return;
  const code = sweatCode(b);
  let copied = false;
  try {
    await navigator.clipboard.writeText(code);
    copied = true;
  } catch {
    copied = false;
  }
  const base = String(state.settings.sweatUrl || '').replace(/\/+$/, '');
  state.sheet = { type: 'sweat', url: /^https:\/\//.test(base) ? `${base}/#import=${code}` : '', copied, code };
  renderLayer();
}

function sheetSweat(s) {
  return `<div class="sheet-head"><h2 id="sheet-title">Follow it in Sweat</h2><button class="icon-btn" data-action="close" aria-label="Close">${icon('close')}</button></div>
    ${s.url ? `<a class="btn primary" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">Open Sweat with this bet ${icon('out')}</a>` : '<p class="neg">Add Sweat’s address in Settings.</p>'}
    <p class="note">${s.copied ? 'The bet is also copied. If Sweat is on your Home Screen, open it, tap Add, then Import, and paste.' : 'If Sweat is on your Home Screen, copy this, open Sweat, tap Add, then Import, and paste it there.'}</p>
    <label class="field">Bet code<textarea class="input code" readonly rows="3">${esc(s.code)}</textarea></label>`;
}

function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}

const stamp = () => new Date().toISOString().slice(0, 10);
const csvCell = (v) => {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function exportCsv() {
  const head = ['logged', 'start', 'sport', 'game', 'bet', 'market', 'book', 'price', 'stake', 'bonus', 'fair_when_bet', 'edge_when_bet', 'close_source', 'fair_at_close', 'clv', 'result', 'profit'];
  const rows = state.bets.map((b) => [b.createdAt, b.start, SPORTS[b.sport].name, `${b.away} at ${b.home}`, sideLabel(b, false), MARKET_NAMES[b.market], bookTitle(b.book), price(b.price), b.stake, b.bonus ? 'yes' : 'no',
    b.fair ? price(b.fair.price) : '', Number.isFinite(b.evAtBet) ? (b.evAtBet * 100).toFixed(2) : '', b.close ? b.close.source : '', b.close ? price(b.close.fairAtBet) : '', Number.isFinite(b.clv) ? (b.clv * 100).toFixed(2) : '', b.result, b.profit || 0]);
  download(`the-number-bets-${stamp()}.csv`, [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n'), 'text/csv');
}

// Bets in The War Room's vocabulary (sport, event, market, selection, price), the same file
// shape Sweat exports, with the fair price and closing line value added.
function exportWarRoom() {
  const bets = state.bets.map((b) => ({
    bet_id: b.id,
    placed_at: b.createdAt,
    settled_at: b.gradedAt || null,
    sportsbook: bookTitle(b.book),
    stake: Number(b.stake),
    american_odds: Math.round(b.price),
    bonus_bet: !!b.bonus,
    result: isSettled(b) ? b.result : 'open',
    profit: Number(b.profit) || 0,
    fair_american_odds: b.fair ? b.fair.price : null,
    edge_at_bet: Number.isFinite(b.evAtBet) ? Math.round(b.evAtBet * 10000) / 10000 : null,
    closing_line_value: Number.isFinite(b.clv) ? Math.round(b.clv * 10000) / 10000 : null,
    legs: [{
      sport: b.sport,
      league: SPORTS[b.sport].name,
      event: {
        source_event_id: String(b.gameId),
        start_time: new Date(b.start).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        timezone: 'America/New_York',
        participants: [{ side: 'home', name: b.home }, { side: 'away', name: b.away }],
      },
      market: { type: b.market === 'ml' ? 'moneyline' : b.market, period: SPORTS[b.sport].kind === 'fight' ? 'full_event' : 'full_game', participant_scope: null },
      selection: { side: SPORTS[b.sport].kind === 'fight' ? (b.side === 'home' ? 'fighter_a' : 'fighter_b') : b.side, label: sideLabel(b, false) },
      price: { line: b.line != null ? b.line : null, american_odds: Math.round(b.price) },
      player: null,
      stat: null,
    }],
  }));
  download(`the-number-war-room-${stamp()}.json`, JSON.stringify({ contract: 'sweat-ledger', contract_version: '1.0', source_app: 'the-number', generated_at: new Date().toISOString(), bets }, null, 2), 'application/json');
}

function exportJson() {
  const data = { app: 'the-number', version: APP_VERSION, exportedAt: new Date().toISOString(), settings: { ...state.settings, passcode: '' }, bets: state.bets };
  download(`the-number-backup-${stamp()}.json`, JSON.stringify(data, null, 2), 'application/json');
}

// A restored backup is untrusted: keep only well-formed bets.
const str = (v, n = 80) => (typeof v === 'string' ? v.slice(0, n) : '');
const fin = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
function cleanBet(b) {
  if (!b || typeof b.id !== 'string' || !SPORTS[b.sport] || !MARKET_NAMES[b.market] || !sidesOf(b.market).includes(b.side)) return null;
  const pr = fin(b.price);
  const stake = fin(b.stake);
  if (!Number.isFinite(americanToDecimal(pr)) || !(stake > 0) || !Number.isFinite(Date.parse(b.start))) return null;
  if (b.market !== 'ml' && fin(b.line) == null) return null;
  const result = ['open', 'won', 'lost', 'push', 'void'].includes(b.result) ? b.result : 'open';
  const fairObj = b.fair && Number.isFinite(fin(b.fair.win)) ? { win: fin(b.fair.win), push: fin(b.fair.push) || 0, price: fin(b.fair.price), from: str(b.fair.from, 12), method: isFairMethod(b.fair.method) ? b.fair.method : undefined } : null;
  const view = (v) => (typeof v === 'number' && v > 0 && v < 1 ? v : v && Number.isFinite(fin(v.mu)) && Number.isFinite(fin(v.ref)) ? { mu: fin(v.mu), ref: fin(v.ref) } : null);
  const close = b.close && view(b.close.view) ? { source: ['pinnacle', 'scan', 'espn'].includes(b.close.source) ? b.close.source : 'espn', view: view(b.close.view), line: fin(b.close.line), provider: str(b.close.provider, 40), mins: fin(b.close.mins), fairAtBet: fin(b.close.fairAtBet), at: str(b.close.at, 30), method: isFairMethod(b.close.method) ? b.close.method : undefined } : null;
  return {
    id: b.id.slice(0, 80), createdAt: str(b.createdAt, 30) || new Date().toISOString(), gameId: str(b.gameId, 64), sport: b.sport, start: new Date(Date.parse(b.start)).toISOString(),
    home: str(b.home), away: str(b.away), market: b.market, side: b.side, line: b.market === 'ml' ? null : fin(b.line), price: pr, basePrice: fin(b.basePrice) ?? undefined, boost: fin(b.boost) ?? undefined,
    bonus: b.bonus === true || undefined, book: BOOK_KEYS.includes(b.book) || b.book === 'other' ? b.book : 'other', stake, fair: fairObj, evAtBet: fin(b.evAtBet), source: str(b.source, 12) || 'manual',
    close, clv: close ? fin(b.clv) : null, result, manual: b.manual === true, profit: result === 'open' ? 0 : fin(b.profit) || 0, gradedAt: str(b.gradedAt, 30) || null, note: str(b.note, 200) || undefined,
  };
}

async function importJson(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!data || data.app !== 'the-number' || !Array.isArray(data.bets)) throw new Error('not a backup from The Number');
    const ids = new Set(state.bets.map((b) => b.id));
    const fresh = data.bets.map(cleanBet).filter((b) => b && !ids.has(b.id));
    await db.putBets(fresh);
    state.bets = [...fresh, ...state.bets].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    toast(`Restored ${fresh.length} bet${fresh.length === 1 ? '' : 's'}.`);
    render();
  } catch (e) {
    toast(`That file did not work: ${e.message}`);
  }
}

// ------------------------------------------------------------ alerts

let audio = null;
function beep(good) {
  if (!state.settings.sound) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    (good === false ? [440, 330] : [587, 880]).forEach((f, i) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      const t = audio.currentTime + i * 0.12;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + 0.2);
    });
  } catch {
    // no audio
  }
}

async function notify(title, body, quiet = false) {
  if (!quiet) beep(true);
  toast(title);
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || !document.hidden) return;
  try {
    const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
    if (reg) await reg.showNotification(title, { body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: `number-${title}` });
    else new Notification(title, { body, icon: '/icons/icon-192.png' });
  } catch {
    // best effort
  }
}

let toastTimer = null;
function toast(text) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 3200);
}

// ------------------------------------------------------------ sheets

let lastSheet = null;
let opener = null;

function sheetConfirm(s) {
  return `<div class="sheet-head"><h2 id="sheet-title">${esc(s.title)}</h2><button class="icon-btn" data-action="close" aria-label="Close">${icon('close')}</button></div>
    <p>${esc(s.text)}</p><div class="row"><button class="btn danger" data-action="confirm-yes">${esc(s.yes)}</button><button class="btn" data-action="close">Keep it</button></div>`;
}

function renderLayer() {
  const layer = $('#layer');
  const s = state.sheet;
  if (!s) {
    const wasOpen = !!lastSheet;
    layer.innerHTML = '';
    lastSheet = null;
    document.body.classList.remove('sheet-open');
    if (wasOpen) {
      const back = opener && opener.isConnected ? opener : $('#main');
      if (back) back.focus({ preventScroll: true });
    }
    opener = null;
    return;
  }
  const fresh = s !== lastSheet;
  if (fresh && !lastSheet) {
    const a = document.activeElement;
    opener = a && a !== document.body && !layer.contains(a) ? a : null;
  }
  const html = { game: sheetGame, log: sheetLog, saved: sheetSaved, bet: sheetBet, sweat: sheetSweat, confirm: sheetConfirm }[s.type];
  const active = document.activeElement;
  const bind = !fresh && active && layer.contains(active) && active.dataset ? active.dataset.bind : null;
  const action = !fresh && active && layer.contains(active) && active.dataset ? active.dataset.action : null;
  const caret = bind && 'selectionStart' in active ? active.selectionStart : null;
  const scroll = !fresh && layer.querySelector('.sheet') ? layer.querySelector('.sheet').scrollTop : 0;
  layer.innerHTML = `<div class="scrim" data-action="close"></div><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title"><div class="grip" aria-hidden="true"></div>${html ? html(s) : ''}</div>`;
  document.body.classList.add('sheet-open');
  const sheet = layer.querySelector('.sheet');
  if (scroll) sheet.scrollTop = scroll;
  if (bind) {
    const again = layer.querySelector(`[data-bind="${bind}"]`);
    if (again) {
      again.focus({ preventScroll: true });
      try {
        if (caret != null && again.setSelectionRange) again.setSelectionRange(caret, caret);
      } catch {
        // some inputs have no caret
      }
    }
  } else if (action && !fresh) {
    const again = layer.querySelector(`[data-action="${action}"]`);
    if (again) again.focus({ preventScroll: true });
  } else if (fresh) {
    const first = layer.querySelector('.sheet .sheet-head h2');
    if (first) {
      first.setAttribute('tabindex', '-1');
      first.focus({ preventScroll: true });
    }
  }
  lastSheet = s;
}

function closeSheet() {
  state.sheet = null;
  renderLayer();
}

// ------------------------------------------------------------ events

function setPath(obj, path, value) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (o[parts[i]] == null) o[parts[i]] = {};
    o = o[parts[i]];
  }
  o[parts[parts.length - 1]] = value;
}

const LIVE_BINDS = new Set(['shop.q']);

function onInput(e) {
  const el = e.target;
  const bind = el.dataset && el.dataset.bind;
  if (!bind) return;
  const v = el.type === 'checkbox' ? el.checked : el.value;
  const [root, ...rest] = bind.split('.');
  if (root === 'settings') {
    const key = rest.join('.');
    if (key === 'bankroll' || key === 'unit') state.settings[key] = num(v) > 0 ? num(v) : key === 'unit' ? 10 : 0;
    else if (key === 'minPctText' || key === 'maxPctText') {
      state.settings[key] = v;
      const p = num(v) / 100;
      if (p > 0 && p <= 0.25) state.settings[key === 'minPctText' ? 'minPct' : 'maxPct'] = p;
    } else state.settings[key] = v;
    saveSettings();
    if (el.type === 'checkbox' || el.tagName === 'SELECT') {
      rebuild();
      renderMain();
    } else if (key === 'bankroll') rebuild();
    else if (key === 'passcode') renderTop();
    return;
  }
  if (root === 'sheet' && state.sheet) {
    setPath(state.sheet, rest.join('.'), v);
    return renderLayer();
  }
  if (root === 'promo') {
    setPath(state.promo, rest.join('.'), v);
    if (el.tagName === 'SELECT') return renderMain();
    return rerenderKeepFocus();
  }
  if (root === 'arb') {
    setPath(state.arb, rest.join('.'), v);
    return rerenderKeepFocus();
  }
  if (root === 'shop') {
    setPath(state.shop, rest.join('.'), v);
    if (LIVE_BINDS.has(bind)) return rerenderKeepFocus();
  }
}

// Re-render the main view without losing the field being typed in.
function rerenderKeepFocus() {
  const a = document.activeElement;
  const bind = a && a.dataset ? a.dataset.bind : null;
  const caret = bind && 'selectionStart' in a ? a.selectionStart : null;
  renderMain();
  if (bind) {
    const again = $(`#main [data-bind="${bind}"]`);
    if (again) {
      again.focus({ preventScroll: true });
      try {
        if (caret != null && again.setSelectionRange) again.setSelectionRange(caret, caret);
      } catch {
        // no caret
      }
    }
  }
}

function onChange(e) {
  const el = e.target;
  const a = el.dataset && el.dataset.action;
  if (a === 'import-json' && el.files && el.files[0]) {
    importJson(el.files[0]);
    el.value = '';
  } else if (a === 'book') {
    const set = new Set(state.settings.books);
    if (el.checked) set.add(el.dataset.book);
    else set.delete(el.dataset.book);
    state.settings.books = BOOK_KEYS.filter((k) => set.has(k));
    saveSettings();
    rebuild();
    renderMain();
  } else if (a === 'sport-on') {
    state.settings.sports = { ...state.settings.sports, [el.dataset.sport]: el.checked };
    saveSettings();
    rebuild();
    renderMain();
  } else if (el.dataset && el.dataset.bind && el.tagName === 'SELECT' && el.dataset.bind.startsWith('sheet.')) {
    setPath(state.sheet, el.dataset.bind.split('.').slice(1).join('.'), el.value);
    renderLayer();
  }
}

function onKey(e) {
  if (e.key === 'Escape' && state.sheet) closeSheet();
  if ((e.key === 'Enter' || e.key === ' ') && e.target.getAttribute && e.target.getAttribute('role') === 'button' && e.target.dataset.action) {
    e.preventDefault();
    e.target.click();
  }
  if (e.key === 'Tab' && state.sheet) {
    const f = [...document.querySelectorAll('#layer .sheet button, #layer .sheet input, #layer .sheet select, #layer .sheet textarea, #layer .sheet a[href]')].filter((x) => !x.disabled);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) {
      e.preventDefault();
      f[f.length - 1].focus();
    } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
      e.preventDefault();
      f[0].focus();
    }
  }
}

function flipSign(target) {
  const [root, ...rest] = target.split('.');
  const obj = root === 'sheet' ? state.sheet : root === 'promo' ? state.promo : null;
  if (!obj) return;
  const path = rest;
  let o = obj;
  for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
  const k = path[path.length - 1];
  const v = String(o[k] == null ? '' : o[k]).trim();
  o[k] = v.startsWith('-') ? `+${v.slice(1)}` : v.startsWith('+') ? `-${v.slice(1)}` : v ? `-${v}` : '-';
  if (root === 'sheet') renderLayer();
  else renderMain();
}

async function onClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return;
  const a = el.dataset.action;
  switch (a) {
    case 'tab':
      if (state.sheet) closeSheet();
      return go(el.dataset.tab);
    case 'scan':
      return scanAll(true);
    case 'close':
      return closeSheet();
    case 'edge-sport':
      state.edgeFilter.sport = el.dataset.sport;
      return renderMain();
    case 'arb-mode':
      state.arb.mode = el.dataset.mode === 'arbs' ? 'arbs' : 'middles';
      return renderMain();
    case 'edge-sort':
      state.edgeFilter.sort = el.dataset.sort;
      return renderMain();
    case 'open-edge': {
      const x = state.edges.find((y) => y.id === el.dataset.id);
      if (x) openLog(draftFrom(x));
      return;
    }
    case 'shop-sport':
      state.shop.sport = el.dataset.sport;
      return renderMain();
    case 'open-game':
      return openGame(el.dataset.id);
    case 'log-price': {
      const g = gameById(el.dataset.game);
      if (!g) return;
      const fair = state.fairs[g.id] || {};
      const x = pricesFor(g, fair, [el.dataset.book], edgeOpts()).find((p) => p.market === el.dataset.market && p.side === el.dataset.side);
      if (x) openLog(draftFrom(x, { source: 'shop' }));
      return;
    }
    case 'check-market':
      state.sheet.check.market = el.dataset.market;
      state.sheet.check.side = sidesOf(el.dataset.market)[0];
      state.sheet.check.line = '';
      return renderLayer();
    case 'check-side':
      state.sheet.check.side = el.dataset.side;
      return renderLayer();
    case 'log-check': {
      const s = state.sheet;
      const g = gameById(s.gameId);
      const c = s.check;
      return openLog({ gameId: g.id, sport: g.sport, start: g.start, home: g.home, away: g.away, market: c.market, side: c.side, line: c.market === 'ml' ? '' : c.line, price: c.price, book: 'other', link: null, stake: '', source: 'check', boost: 0, bonus: false });
    }
    case 'flip':
      return flipSign(el.dataset.target);
    case 'save-log':
      return saveLog();
    case 'promo-mode':
      state.promo.mode = el.dataset.mode;
      return renderMain();
    case 'pick-market':
      state.promo.pick.market = el.dataset.market;
      state.promo.pick.side = '';
      return renderMain();
    case 'pick-side':
      state.promo.pick.side = el.dataset.side;
      return renderMain();
    case 'boost-pct':
      state.promo.boost = el.dataset.v === 'custom' ? 'custom' : Number(el.dataset.v);
      return renderMain();
    case 'log-boost': {
      const x = picked();
      if (!x) return;
      const boost = state.promo.boost === 'custom' ? num(state.promo.boostCustom) / 100 : state.promo.boost;
      return openLog({ gameId: x.g.id, sport: x.g.sport, start: x.g.start, home: x.g.home, away: x.g.away, market: x.market, side: x.side, line: x.line == null ? '' : String(x.line), price: price(x.price), book: x.book, link: null, stake: String(state.promo.boostBet || num(state.promo.boostStake) || ''), source: 'boost', boost, bonus: false });
    }
    case 'log-bonus':
      return logBonus(Number(el.dataset.i));
    case 'rec-by':
      state.record.by = el.dataset.by;
      return renderMain();
    case 'rec-show':
      state.record.show = el.dataset.show;
      return renderMain();
    case 'open-bet':
      return openBet(el.dataset.id);
    case 'set-result':
      state.sheet.edit.result = el.dataset.r;
      return renderLayer();
    case 'save-bet':
      return saveBetEdit();
    case 'ask-delete':
      state.sheet = { type: 'confirm', title: 'Delete this bet?', text: 'It leaves your record for good.', yes: 'Delete', then: { kind: 'delete', id: state.sheet.id } };
      return renderLayer();
    case 'confirm-yes': {
      const t = state.sheet.then;
      if (t && t.kind === 'delete') {
        await db.deleteBet(t.id);
        state.bets = state.bets.filter((b) => b.id !== t.id);
        toast('Deleted.');
      }
      state.sheet = null;
      return render();
    }
    case 'to-sweat':
      return toSweat(el.dataset.id);
    case 'set': {
      const key = el.dataset.key;
      const raw = el.dataset.v;
      state.settings[key] = raw === 'any' ? 'any' : Number.isFinite(Number(raw)) && raw !== '' ? Number(raw) : raw;
      await saveSettings();
      if (key === 'theme') applyTheme();
      if (key === 'auto') schedule();
      rebuild();
      if (key === 'closing' && raw === 'pinnacle') followUp();
      return renderMain();
    }
    case 'notif':
      try {
        await Notification.requestPermission();
      } catch {
        // ignore
      }
      return renderMain();
    case 'export-csv':
      return exportCsv();
    case 'export-war':
      return exportWarRoom();
    case 'export-json':
      return exportJson();
    default:
  }
}

async function logBonus(i) {
  const o = (state.promo.lastBonus || [])[i];
  if (!o || state.saving) return;
  const amount = num(state.promo.bonusAmount);
  const base = { gameId: o.gameId, sport: o.sport, start: o.start, home: o.home, away: o.away, market: o.market, createdAt: new Date().toISOString(), result: 'open', profit: 0, source: 'bonus' };
  const g = gameById(o.gameId);
  const fair = g && state.fairs[g.id] ? state.fairs[g.id][o.market] : null;
  const mk = (side, line, pr, book, stake, bonus) => {
    const ch = fair ? sideChances(o.sport, o.market, fair, side, line) : null;
    return { ...base, id: db.newId('n'), side, line: o.market === 'ml' ? null : line, price: pr, book, stake: Math.round(stake * 100) / 100, bonus: bonus || undefined, fair: ch ? { win: ch.win, push: ch.push, price: fairAmerican(ch.win, ch.push), from: fair.from, method: fair.method } : null, evAtBet: ch && !bonus ? evOf(ch.win, ch.push, pr) : null };
  };
  const bets = [mk(o.side, o.line, o.price, state.promo.bonusBook, amount, true), mk(o.hedgeSide, o.hedgeLine, o.hedgePrice, o.hedgeBook, o.hedge, false)];
  state.saving = true;
  try {
    await db.putBets(bets);
  } finally {
    state.saving = false;
  }
  state.bets.unshift(...bets.reverse());
  toast(`Logged both bets. ${money(o.locked)} locked either way.`);
  renderMain();
}

boot();
