// The sports The Number prices, with The Odds API and ESPN keys. Shared by the browser, the
// Netlify functions and the tests.

export const SPORTS = {
  nfl: {
    key: 'nfl', name: 'NFL', short: 'NFL', oddsKey: 'americanfootball_nfl', espn: 'football/nfl',
    kind: 'football', periods: 4, markets: ['h2h', 'spreads', 'totals'], days: 8, college: false,
  },
  cfb: {
    key: 'cfb', name: 'College football', short: 'CFB', oddsKey: 'americanfootball_ncaaf', espn: 'football/college-football',
    kind: 'football', periods: 4, markets: ['h2h', 'spreads', 'totals'], days: 4, college: true,
  },
  nba: {
    key: 'nba', name: 'NBA', short: 'NBA', oddsKey: 'basketball_nba', espn: 'basketball/nba',
    kind: 'basketball', periods: 4, markets: ['h2h', 'spreads', 'totals'], days: 2, college: false,
  },
  ncaab: {
    key: 'ncaab', name: 'College basketball', short: 'NCAAB', oddsKey: 'basketball_ncaab', espn: 'basketball/mens-college-basketball',
    kind: 'basketball', periods: 2, markets: ['h2h', 'spreads', 'totals'], days: 2, college: true,
  },
  ufc: {
    key: 'ufc', name: 'UFC', short: 'UFC', oddsKey: 'mma_mixed_martial_arts', espn: 'mma/ufc',
    kind: 'fight', periods: 3, markets: ['h2h'], days: 8, college: false,
  },
};

export const SPORT_KEYS = Object.keys(SPORTS);

export const byOddsKey = (k) => SPORT_KEYS.find((s) => SPORTS[s].oddsKey === k) || null;

// Sportsbooks on The Odds API. `va`: takes bets in Virginia. `sharp`: a market maker whose price
// is the best estimate of fair. `paid`: The Odds API only returns it on a paid plan.
export const BOOKS = {
  pinnacle: { title: 'Pinnacle', sharp: true },
  draftkings: { title: 'DraftKings', va: true },
  fanduel: { title: 'FanDuel', va: true },
  betmgm: { title: 'BetMGM', va: true },
  williamhill_us: { title: 'Caesars', va: true, paid: true },
  fanatics: { title: 'Fanatics', va: true, paid: true },
  espnbet: { title: 'theScore Bet', va: true },
  betrivers: { title: 'BetRivers', va: true },
  hardrockbet: { title: 'Hard Rock Bet', va: true },
  ballybet: { title: 'Bally Bet', va: true },
  betparx: { title: 'betPARX' },
  betonlineag: { title: 'BetOnline' },
  lowvig: { title: 'LowVig' },
  bovada: { title: 'Bovada' },
  novig: { title: 'Novig' },
  prophetx: { title: 'ProphetX' },
};

export const BOOK_KEYS = Object.keys(BOOKS);
export const DEFAULT_BOOKS = ['draftkings', 'fanduel', 'betmgm', 'williamhill_us', 'fanatics', 'espnbet', 'betrivers', 'hardrockbet'];
export const bookTitle = (k) => (BOOKS[k] ? BOOKS[k].title : k);

// Virginia law bars bets on any game with a Virginia college team (a 2026 bill to change that died
// in committee), so these games are hidden by default. Matched on the start of the team name.
const VA_SCHOOLS = [
  'virginia cavaliers', 'virginia tech', 'old dominion', 'james madison', 'liberty', 'william mary',
  'richmond', 'vcu', 'virginia commonwealth', 'george mason', 'radford', 'norfolk st', 'norfolk state', 'hampton',
  'longwood', 'vmi', 'virginia military',
];

export function normName(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function isVirginiaSchool(team) {
  const n = normName(team);
  return n === 'virginia' || VA_SCHOOLS.some((v) => n === v || n.startsWith(`${v} `));
}
