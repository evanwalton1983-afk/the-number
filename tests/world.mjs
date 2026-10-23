// A scripted market for the tests: The Odds API responses for each sport, and ESPN scoreboards
// before and after the games, all built around a given `now`.
//
// The story: FanDuel hangs Bills -2.5 while Pinnacle is at -3 (an edge through the key number),
// DraftKings has Raiders +7.5 against Pinnacle's +7, FanDuel's under 45.5 sits a point above
// Pinnacle's 44.5, Fanatics is long on Bravo, and BetRivers is a point and a half off a college
// market Pinnacle does not have. Two traps: a Virginia Tech game with a big edge (Virginia law
// bars betting it) and a Lakers line where Pinnacle's price is stale after news.
import fs from 'node:fs';

const clone = (x) => JSON.parse(JSON.stringify(x));
const fx = (n) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));

export function oddsWorld(now = Date.now()) {
  const at = (h) => new Date(now + h * 3600e3).toISOString();
  const ago = (m) => new Date(now - m * 60e3).toISOString();
  const ml = (home, hp, away, ap) => ['h2h', [{ name: home, price: hp }, { name: away, price: ap }]];
  const sp = (home, hl, hp, away, ap) => ['spreads', [{ name: home, price: hp, point: hl }, { name: away, price: ap, point: -hl }]];
  const tot = (line, op, up) => ['totals', [{ name: 'Over', price: op, point: line }, { name: 'Under', price: up, point: line }]];
  const book = (key, title, markets, age = 4) => ({
    key,
    title,
    last_update: ago(age),
    link: `https://sportsbook.example/${key}/event`,
    markets: markets.map(([k, outcomes, mAge]) => ({
      key: k,
      last_update: ago(mAge == null ? age : mAge),
      outcomes: outcomes.map((o) => ({ ...o, link: `https://sportsbook.example/${key}/slip?pick=${encodeURIComponent(`${o.name}${o.point == null ? '' : o.point}`)}` })),
    })),
  });
  const ev = (id, sport, home, away, startH, books) => ({ id, sport_key: sport, sport_title: sport, commence_time: at(startH), home_team: home, away_team: away, bookmakers: books });

  const BUF = 'Buffalo Bills';
  const MIA = 'Miami Dolphins';
  const LV = 'Las Vegas Raiders';
  const KC = 'Kansas City Chiefs';
  const nfl = [
    ev('nfl1', 'americanfootball_nfl', BUF, MIA, 3, [
      book('pinnacle', 'Pinnacle', [ml(BUF, -165, MIA, 148), sp(BUF, -3, -112, MIA, 102), tot(47.5, -108, -102)], 6),
      book('draftkings', 'DraftKings', [ml(BUF, -170, MIA, 145), sp(BUF, -3, -115, MIA, -105), tot(47.5, -110, -110)]),
      book('fanduel', 'FanDuel', [ml(BUF, -160, MIA, 136), sp(BUF, -2.5, -118, MIA, -102), tot(48, -110, -110)]),
      book('betmgm', 'BetMGM', [ml(BUF, -175, MIA, 150), sp(BUF, -3, -110, MIA, -110), tot(47.5, -105, -115)]),
      book('espnbet', 'theScore Bet', [ml(BUF, -165, MIA, 140), sp(BUF, -3.5, 100, MIA, -120), tot(47.5, -110, -110)]),
      book('betrivers', 'BetRivers', [ml(BUF, -170, MIA, 142), sp(BUF, -3, -118, MIA, -102), tot(47.5, -112, -108)]),
      book('hardrockbet', 'Hard Rock Bet', [ml(BUF, -165, MIA, 140), sp(BUF, -3, -110, MIA, -110), tot(47, -110, -110)]),
    ]),
    ev('nfl2', 'americanfootball_nfl', LV, KC, 6, [
      book('pinnacle', 'Pinnacle', [ml(LV, 260, KC, -310), sp(LV, 7, -105, KC, -105), tot(44.5, 100, -110)], 8),
      book('draftkings', 'DraftKings', [ml(LV, 250, KC, -300), sp(LV, 7.5, -110, KC, -110), tot(44.5, -105, -115)]),
      book('fanduel', 'FanDuel', [ml(LV, 255, KC, -320), sp(LV, 7, -110, KC, -110), tot(45.5, -110, -110)]),
      book('betmgm', 'BetMGM', [ml(LV, 250, KC, -310), sp(LV, 7, -105, KC, -115), tot(44.5, -110, -110)]),
      book('espnbet', 'theScore Bet', [ml(LV, 245, KC, -305), sp(LV, 7, -110, KC, -110), tot(44.5, -108, -112)]),
      book('betrivers', 'BetRivers', [ml(LV, 250, KC, -315), sp(LV, 7, -108, KC, -112), tot(44.5, -110, -110)]),
    ]),
    // Already under way: never an edge.
    ev('nfl3', 'americanfootball_nfl', 'Philadelphia Eagles', 'Dallas Cowboys', -1, [
      book('pinnacle', 'Pinnacle', [sp('Philadelphia Eagles', -3, -110, 'Dallas Cowboys', -110)]),
      book('draftkings', 'DraftKings', [sp('Philadelphia Eagles', 3, -110, 'Dallas Cowboys', -110)]),
    ]),
  ];

  const cfb = [
    // Virginia Tech: Virginia bars bets on in-state college teams, so this stays hidden.
    ev('cfb1', 'americanfootball_ncaaf', 'Clemson Tigers', 'Virginia Tech Hokies', 30, [
      book('pinnacle', 'Pinnacle', [sp('Clemson Tigers', -10.5, -110, 'Virginia Tech Hokies', -110)]),
      book('draftkings', 'DraftKings', [sp('Clemson Tigers', -13.5, -110, 'Virginia Tech Hokies', -110)]),
      book('fanduel', 'FanDuel', [sp('Clemson Tigers', -10.5, -110, 'Virginia Tech Hokies', -110)]),
      book('betmgm', 'BetMGM', [sp('Clemson Tigers', -10.5, -110, 'Virginia Tech Hokies', -110)]),
    ]),
    // No Pinnacle: the median of the books stands in.
    ev('cfb2', 'americanfootball_ncaaf', 'Michigan Wolverines', 'Ohio State Buckeyes', 28, [
      book('draftkings', 'DraftKings', [sp('Michigan Wolverines', 3.5, -110, 'Ohio State Buckeyes', -110)]),
      book('fanduel', 'FanDuel', [sp('Michigan Wolverines', 3.5, -105, 'Ohio State Buckeyes', -115)]),
      book('betmgm', 'BetMGM', [sp('Michigan Wolverines', 3, -115, 'Ohio State Buckeyes', -105)]),
      book('espnbet', 'theScore Bet', [sp('Michigan Wolverines', 3.5, -110, 'Ohio State Buckeyes', -110)]),
      book('betrivers', 'BetRivers', [sp('Michigan Wolverines', 5, -110, 'Ohio State Buckeyes', -110)]),
    ]),
  ];

  const nba = [
    ev('nba1', 'basketball_nba', 'New York Knicks', 'Boston Celtics', 4, [
      book('pinnacle', 'Pinnacle', [ml('New York Knicks', -135, 'Boston Celtics', 122), sp('New York Knicks', -2.5, -105, 'Boston Celtics', -105), tot(223.5, -108, -102)]),
      book('draftkings', 'DraftKings', [ml('New York Knicks', -140, 'Boston Celtics', 118), sp('New York Knicks', -2.5, -110, 'Boston Celtics', -110), tot(223.5, -110, -110)]),
      book('fanatics', 'Fanatics', [ml('New York Knicks', -138, 'Boston Celtics', 116), sp('New York Knicks', -3.5, -110, 'Boston Celtics', -110), tot(223.5, -110, -110)]),
      book('fanduel', 'FanDuel', [ml('New York Knicks', -136, 'Boston Celtics', 114), sp('New York Knicks', -2.5, -112, 'Boston Celtics', -108), tot(224.5, -110, -110)]),
    ]),
    // News broke: every book moved to Lakers -2.5 in the last few minutes; the Pinnacle feed
    // still shows -6.5 from 40 minutes ago. Not an edge, a stale price.
    ev('nba2', 'basketball_nba', 'Los Angeles Lakers', 'Golden State Warriors', 5, [
      book('pinnacle', 'Pinnacle', [sp('Los Angeles Lakers', -6.5, -110, 'Golden State Warriors', -110)], 40),
      book('draftkings', 'DraftKings', [sp('Los Angeles Lakers', -2.5, -110, 'Golden State Warriors', -110)], 2),
      book('fanduel', 'FanDuel', [sp('Los Angeles Lakers', -2.5, -112, 'Golden State Warriors', -108)], 2),
      book('betmgm', 'BetMGM', [sp('Los Angeles Lakers', -2.5, -110, 'Golden State Warriors', -110)], 3),
      book('espnbet', 'theScore Bet', [sp('Los Angeles Lakers', -3, -110, 'Golden State Warriors', -110)], 2),
    ]),
    // Two arbs, fresh prices, same line at two books (no Pinnacle, so no fair price and no edge).
    // Pistons: over +110 against under -105, 1.18% ROI. Hawks: +106 against -105, 0.24% ROI, thin
    // enough that whole dollar stakes at 200 leave a small loss.
    ev('nba3', 'basketball_nba', 'Detroit Pistons', 'Chicago Bulls', 9, [
      book('draftkings', 'DraftKings', [tot(228.5, 110, -130)], 2),
      book('fanduel', 'FanDuel', [tot(228.5, -130, -105)], 2),
    ]),
    ev('nba4', 'basketball_nba', 'Atlanta Hawks', 'Miami Heat', 10, [
      book('betmgm', 'BetMGM', [tot(231.5, 106, -130)], 2),
      book('betrivers', 'BetRivers', [tot(231.5, -130, -105)], 2),
    ]),
  ];

  const ufc = [
    ev('ufc1', 'mma_mixed_martial_arts', 'Alan Alpha', 'Bruno Bravo', 8, [
      book('pinnacle', 'Pinnacle', [ml('Alan Alpha', -150, 'Bruno Bravo', 130)]),
      book('draftkings', 'DraftKings', [ml('Alan Alpha', -155, 'Bruno Bravo', 130)]),
      book('fanatics', 'Fanatics', [ml('Alan Alpha', -175, 'Bruno Bravo', 150)]),
      book('fanduel', 'FanDuel', [ml('Alan Alpha', -148, 'Bruno Bravo', 124)]),
    ]),
  ];

  return { nfl, cfb, nba, ncaab: [], ufc };
}

// ESPN scoreboards. step 'pre': nothing started. step 'final': Bills 27-17 (closing line moved
// to Bills -3.5), Chiefs 24-20 at the Raiders (closing KC -7), total 44.
export function espnWorld(now, step) {
  const raw = clone(fx('nfl-scoreboard-live.json'));
  const at = (h) => new Date(now + h * 3600e3).toISOString();
  const [bills, kc] = raw.events;
  const final = step === 'final';
  const status = (done) => (done
    ? { clock: 0, displayClock: '0:00', period: 4, type: { id: '3', name: 'STATUS_FINAL', state: 'post', completed: true, description: 'Final', detail: 'Final', shortDetail: 'Final' } }
    : { clock: 900, displayClock: '15:00', period: 0, type: { id: '1', name: 'STATUS_SCHEDULED', state: 'pre', completed: false, description: 'Scheduled', detail: 'Scheduled', shortDetail: 'Scheduled' } });
  const set = (e, startH, done, hs, as, odds) => {
    e.date = at(startH);
    const c = e.competitions[0];
    c.date = at(startH);
    c.status = status(done);
    delete c.situation;
    const home = c.competitors.find((x) => x.homeAway === 'home');
    const away = c.competitors.find((x) => x.homeAway === 'away');
    home.score = String(done ? hs : 0);
    away.score = String(done ? as : 0);
    home.winner = done && hs > as;
    away.winner = done && as > hs;
    c.odds = [odds];
  };
  set(bills, 3, final, 27, 17, { provider: { name: 'ESPN BET' }, details: final ? 'BUF -3.5' : 'BUF -3', spread: final ? -3.5 : -3, overUnder: 47.5, homeTeamOdds: { favorite: true, moneyLine: final ? -185 : -165, spreadOdds: -110 }, awayTeamOdds: { favorite: false, moneyLine: final ? 155 : 140, spreadOdds: -110 }, overOdds: -110, underOdds: -110 });
  set(kc, 6, final, 20, 24, { provider: { name: 'ESPN BET' }, details: 'KC -7', spread: 7, overUnder: 44.5, homeTeamOdds: { favorite: false, moneyLine: 260 }, awayTeamOdds: { favorite: true, moneyLine: -320 } });
  raw.events = [bills, kc];
  return raw;
}
