# The Number

Every price at your sportsbooks against the sharp market's fair price. The Number pulls
moneylines, spreads and totals for the NFL, college football, the NBA, men's college basketball
and UFC from The Odds API, takes the vig out of Pinnacle's prices to get each side's fair
chance, and lists the bets where one of your books pays more than that, with a stake for each.
It also shops every line, prices boosts and bonus bets, and keeps a record that says whether
the prices you take beat the closing line.

It is a phone-first web app on Netlify (installable to the Home Screen). Bets stay on your
device. Odds come from your own Odds API key through the site's functions; scores and free
closing lines come from ESPN.

## What it does

- **Edges.** Every price at your books that beats fair by your bar (2% by default) however the
  vig is removed (see the EV gate below): the bet,
  the book and price, the fair price, the edge, the stake from your bankroll, and how long it
  has been up. A link opens the bet at the book where the book provides one. Log it at the
  price you got.
- **Games.** The line shop: every game with the best price at your books for each market. Open
  a game for the fair line and every book's price with its edge, then tap a price to log it.
  **Check a price** prices anything else: an alternate line, a book The Number does not scan,
  or a pick from one of your model apps.
- **Promos.** Profit boosts (what the boost is worth and how much to bet), bonus bets (the hedge
  at another book that turns the bonus into the most cash, logged as a pair), and second-chance
  bets (the bet at fair plus the refund's cash value).
- **Record.** Closing line value on every bet, read at kickoff, with a verdict once there are
  enough bets: beating the close, behind it, or too close to call (with how many more bets would
  settle it). Results grade themselves from ESPN finals. Profit against what the closing prices
  said to expect, by sport, market and book. Boosts and bonus bets are kept out of these numbers.
- **Sweat and The War Room.** One tap sends a logged bet to Sweat to follow live (a link, or a
  code to paste into Sweat's Import tab when Sweat is on the Home Screen). The War Room file
  uses the same shape Sweat exports, with the fair price, edge and closing line value added.
- **Alerts.** With the app open, a sound and a notification when a new edge above your alert
  level appears. Scans run by hand or on a timer.

## How the numbers work

- **Fair price.** Pinnacle's two prices for a market, with its margin removed by one of four
  methods in `src/fairprice.js`: Shin by default, or power, multiplicative or additive (Settings,
  Fair price method). Every fair price on screen says which method it used. On two-way markets
  Shin and additive agree exactly. When Pinnacle has no price, the median book stands
  in and an edge has to clear the bar by one more point. When the other books have all moved
  away from Pinnacle in the last few minutes (news), the market is held back as unsettled: that
  gap is a stale price, not an edge.
- **Different lines.** A book at -2.5 when Pinnacle is at -3 is priced through final-score
  curves fitted on real closing lines and finals (`scripts/fit-dists.mjs`). Football margins
  carry key-number weights, and a favorite lined on 3 or 7 lands on it more often than the key's
  overall weight says, so the hook is worth what it really is. Totals lined on a whole number
  push less often than a smooth curve says (books settle on whole numbers where landing is
  unlikely). Lines more than 3 points (4 on totals) from the sharp line are not priced.
- **Edge** is the average return per dollar at the fair chances, with pushes returning the stake.
- **EV gate.** What counts as an edge: the Edges list, highlights, alerts and every Bet or Pass.
  At Worst case (the default) the side's lowest fair chance of the four methods decides, so a
  price has to beat fair however the vig comes off. The edge and stake shown stay at the fair
  price method; the worst case shows next to them when you open a bet.
- **Stakes** are a share of Kelly (a quarter by default), at least 0.5% and at most 5% of your
  bankroll, never more than full Kelly, rounded down to whole dollars.
- **Closing line value** is the same edge measured at kickoff. The free close is your own scan if
  one ran within 20 minutes of kickoff, otherwise ESPN's closing line (one book, vig removed). On
  a paid Odds API plan, Settings can read Pinnacle's price at kickoff from The Odds API's history.

### Checked against real games

NFL 2015 to 2025 (3,092 games with closing prices, nflverse). Each curve is centered where the
closing price says, the same way the app uses it.

| Lined on | Games | Pushed | Curve |
|---|---|---|---|
| 3 | 444 | 10.6% | 10.7% |
| 7 | 178 | 7.3% | 7.2% |
| 6 | 144 | 4.2% | 4.4% |
| 14 | 42 | 4.8% | 4.8% |
| Whole-number totals | 1,456 | 1.9% | 2.0% |

Spread of finals around the line: NFL margins 12.7, totals 13.2; college football (1,600 ESPN
lines) 16.1 and 16.6; NBA (1,321 games, 2024-25) 13.7; college basketball (450 ESPN lines) 11.1.

## Set up on Netlify

1. Deploy this folder to a Netlify site (settings come from `netlify.toml`: build `npm run
   build`, publish `public`, functions `netlify/functions`). Drag and drop skips functions, and
   The Number needs them.
2. In Site configuration, Environment variables, add:
   - `ODDS_API_KEY`: your key from the-odds-api.com.
   - `APP_PASSCODE`: any passcode; you type it once in The Number's Settings.
   Redeploy after adding them.
3. Open the site on your phone, add it to the Home Screen, enter the passcode and your bankroll.
   When a scan cannot run, the scan button says why: no passcode yet, a passcode that does not
   match, a key the site cannot see, or The Odds API's own reason for turning the request down.

### Odds API credits

A scan costs one credit per market per sport, with Pinnacle and up to 9 books counting as one:
3 credits for each football or basketball league, 1 for UFC. The Number checks which leagues are
in season first (free) and caches each answer for a minute. The free plan's 500 credits a month
covers about one or two full scans a day; the 20K plan ($30 a month when this was written) covers
scanning every 20 to 30 minutes, and adds Caesars and Fanatics prices. Sweat's live prices use
the same key.

Virginia law bars bets on games with in-state college teams, so those games are hidden by
default (Settings).

## Work on it

```
npm install
npm run build        # public/index.html (one file), the font, the service worker
npm test             # odds math, fair price methods, curves, market, promos, grading and functions (node:test)
npm run e2e          # browser run of a scripted market and night (needs Playwright with Chromium)
npm run check:dashes # no en or em dashes anywhere
node scripts/fit-dists.mjs --nfl games.csv --cfb cfb_lines.csv --nba nba_states.csv \
  --nba-totals nba_raw_states.csv --ncaab mbb_raw_states.csv   # refit the curves
```

`npm run e2e` serves `public/` and runs the real functions against a scripted market
(`tests/world.mjs`): an edge through the key number, a college market Pinnacle does not have, a
Virginia college game and a stale Pinnacle price as traps, then the clock jumps past the games
and the record reads closing lines and grades.

```
src/odds.js          prices, removing the vig, edge, Kelly, stakes
src/fairprice.js     fair chances four ways: multiplicative, additive, power, Shin (MIT notices inside)
src/dists.js         fitted final-score curves and line conversion
src/market.js        Odds API events to games, fair prices and edges
src/promos.js        boosts, bonus bets, second chances
src/grade.js         ESPN matching, grading, closing lines, closing line value, the verdict
src/handoff.js       bets to Sweat
src/espn.js          ESPN scoreboards (shared with Sweat)
src/app.js, ui.js    the app; styles.css the look (Archivo, ink on paper, one marker color)
netlify/functions    scan (odds), close (Pinnacle at kickoff, paid plans), sports, espn, status
netlify/lib          passcode, limits, caching and trimming shared by the functions
scripts/             build, curve fitting, dash check
tests/               unit tests, the scripted world, end-to-end run
```

## Limits worth knowing

- Pinnacle's prices reach The Odds API from its public site and can lag; the unsettled check
  catches the big moves, not every small one. Scan close to when you bet.
- Edges are small (a few percent a bet). Profit comes from volume and discipline, and books do
  limit accounts that beat them this way.
- Game lines only. Alternate lines and props are not scanned (each costs credits per game); use
  Check a price for those.
- Edges on the same side of one game (a team's spread and moneyline at two books) win or lose
  together; each is sized as if it were the only bet, so bet one.
- ESPN's closing line is one book's; Pinnacle's close (paid plan) is the sharper yardstick.
- Bets live in this browser. Back up before switching phones.
