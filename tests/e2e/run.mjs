// End-to-end test: a phone sets up The Number, scans the scripted market, logs edges from the
// list and the line shop, works the promo tools, then the clock jumps past the games and the
// record reads the closing lines and grades the bets. Screenshots go to the folder given
// (default tests/e2e/shots). Needs Playwright with Chromium.
//
//   node tests/e2e/run.mjs [shots-dir]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.resolve(process.argv[2] || path.join(here, 'shots'));
fs.mkdirSync(shots, { recursive: true });
const port = 4700 + Math.floor(Math.random() * 300);
const base = `http://localhost:${port}`;
const T0 = Date.now();

const server = spawn(process.execPath, [path.join(here, 'server.mjs'), String(port), String(T0)], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => { if (String(d).includes('ready')) resolve(); });
  server.on('exit', (c) => reject(new Error(`server exited ${c}`)));
});

const failures = [];
const check = (ok, what) => {
  if (!ok) failures.push(what);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light', acceptDownloads: true });
const page = await ctx.newPage();
await page.clock.install({ time: new Date(T0) });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/status of 40[12]/.test(m.text())) errors.push(`console: ${m.text()}`); });
const shot = async (name, opts = {}) => {
  await pause(400);
  await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: !!opts.full });
};
const texts = (sel) => page.locator(sel).allInnerTexts();
const download = async (action) => {
  const [d] = await Promise.all([page.waitForEvent('download'), page.click(action)]);
  return fs.readFileSync(await d.path(), 'utf8');
};

try {
  // A site without the Odds API key explains what to add and cannot scan.
  await fetch(`${base}/__keys?on=0`);
  await page.goto(`${base}/#edges`);
  await page.waitForSelector('.setup');
  check(await page.isVisible('text=Connect your Odds API key'), 'without a key the app explains the setup');
  const scanOff = async () => /\boff\b/.test((await page.getAttribute('.top [data-action="scan"]', 'class')) || '');
  check(await scanOff(), 'without a key the scan button is dimmed');
  await page.click('.top [data-action="scan"]');
  await page.waitForSelector('#toast:not([hidden])');
  check(/ODDS_API_KEY/.test(await page.innerText('#toast')), 'a tap on scan without a key says what to fix');
  await fetch(`${base}/__keys?on=1`);

  // A wrong passcode says so instead of doing nothing.
  await page.goto(`${base}/?k=0#settings`);
  await page.waitForSelector('[data-bind="settings.passcode"]');
  await page.fill('[data-bind="settings.passcode"]', 'wrong-pass');
  await page.click('[data-tab="edges"]');
  await page.click('.top [data-action="scan"]');
  await page.waitForFunction(() => /passcode did not match/.test((document.querySelector('#toast') || {}).textContent || ''));
  check(/passcode did not match/.test(await page.innerText('main')), 'a wrong passcode shows on the Edges page too');

  // Settings: passcode and bankroll, typed one after the other like a person would.
  await page.goto(`${base}/?k=1#settings`);
  await page.waitForSelector('[data-bind="settings.passcode"]');
  await page.fill('[data-bind="settings.passcode"]', '');
  await page.click('[data-bind="settings.passcode"]');
  await page.keyboard.type('test-pass');
  await page.click('[data-bind="settings.bankroll"]');
  await page.keyboard.type('1000');
  await page.click('[data-bind="settings.unit"]');
  check((await page.inputValue('[data-bind="settings.bankroll"]')) === '1000', 'moving between settings fields keeps what was typed');
  await shot('01-settings');
  await page.reload();
  await page.waitForSelector('[data-bind="settings.bankroll"]');
  check((await page.inputValue('[data-bind="settings.bankroll"]')) === '1000', 'bankroll is saved on the phone');
  check(!(await scanOff()), 'with the passcode the scan button is on');
  check((await page.inputValue('[data-bind="settings.fairMethod"]')) === 'shin', 'fair prices default to Shin');
  check((await page.getAttribute('[data-key="evGate"][data-v="worst"]', 'aria-pressed')) === 'true', 'the EV gate defaults to the worst case');

  // Scan and read the edges.
  await page.click('[data-tab="edges"]');
  await page.click('.top [data-action="scan"]');
  await page.waitForSelector('.row.edge');
  const picks = await texts('.row.edge .pick');
  check(JSON.stringify(picks) === JSON.stringify(['Bills -2.5', 'Ohio State -3', 'Bravo to win', 'Under 45.5', 'Raiders +7.5']), `five edges in order of edge (${picks.join(', ')})`);
  const first = (await page.locator('.row.edge').first().innerText()).replace(/\s+/g, ' ');
  check(/-118/.test(first) && /FanDuel/.test(first) && /Fair \(Shin\) -132/.test(first) && /Edge \+5\.1%/.test(first), 'Bills -2.5 -118 at FanDuel: fair -132 by Shin, edge +5.1%');
  check(/Bet \$14 ?1\.4u/.test(first), `quarter Kelly on a $1,000 bankroll is $14, 1.4 units (${first})`);
  check(!(await page.isVisible('text=Virginia Tech')), 'the Virginia Tech game stays hidden');
  check(!(await page.isVisible('text=Lakers')), 'the stale Lakers price is not an edge');
  check(/credits left/.test(await page.innerText('.top')), 'credits left show after a scan');
  await shot('02-edges', { full: true });
  await page.click('[data-action="edge-sport"][data-sport="nfl"]');
  check((await page.locator('.row.edge').count()) === 3, 'NFL filter shows the three NFL edges');
  await page.click('[data-action="edge-sport"][data-sport="all"]');

  // The fair price method sets the fair prices and their label; the EV gate shows its worst case.
  const firstRow = async () => (await page.locator('.row.edge').first().innerText()).replace(/\s+/g, ' ');
  await page.click('[data-tab="settings"]');
  await page.selectOption('[data-bind="settings.fairMethod"]', 'power');
  await page.click('[data-tab="edges"]');
  check(/Fair \(Power\) -132/.test(await firstRow()), 'switched to power, the fair prices say Power');
  await page.click('[data-tab="settings"]');
  await page.selectOption('[data-bind="settings.fairMethod"]', 'shin');
  await page.click('[data-tab="edges"]');
  check(/Fair \(Shin\) -132/.test(await firstRow()), 'and back to Shin');
  await page.click('.row.edge >> nth=0');
  await page.waitForSelector('.sheet .stats');
  check(/Worst case\s*\+5\.0%/.test(await page.innerText('.sheet .stats')), 'the log sheet shows the worst case of the four methods (+5.0%)');
  await page.click('.sheet [data-action="close"]');
  await page.click('[data-tab="settings"]');
  await page.click('[data-action="set"][data-key="evGate"][data-v="fair"]');
  await page.click('[data-tab="edges"]');
  await page.click('.row.edge >> nth=0');
  await page.waitForSelector('.sheet .stats');
  check(!/Worst case/.test(await page.innerText('.sheet .stats')), 'gated on the fair price method, no worst case is shown');
  await page.click('.sheet [data-action="close"]');
  await page.click('[data-tab="settings"]');
  await page.click('[data-action="set"][data-key="evGate"][data-v="worst"]');
  await page.click('[data-tab="edges"]');

  // Log the Bills edge at the price actually taken.
  await page.click('.row.edge >> nth=0');
  await page.waitForSelector('.sheet [data-action="save-log"]');
  const href = await page.getAttribute('.sheet a.btn.mark', 'href');
  check(/fanduel\/slip/.test(href || ''), 'the bet links to FanDuel’s bet slip');
  await page.fill('[data-bind="sheet.draft.price"]', '-120');
  check(/\+4\.\d%/.test(await page.innerText('.sheet .stats')), 'edge updates for the price actually taken');
  await shot('03-log');
  await page.click('[data-action="save-log"]');
  await page.waitForSelector('text=Follow it in Sweat');
  await page.click('[data-action="to-sweat"]');
  await page.waitForSelector('.sheet textarea.code');
  const code = await page.inputValue('.sheet textarea.code');
  const sweatHref = await page.getAttribute('.sheet a.btn.primary', 'href');
  check(code.startsWith('NUM1.') && sweatHref.startsWith('https://sweat-tracker-5a8e.netlify.app/#import=NUM1.'), 'Sweat gets the bet as a link and a code');
  const payload = JSON.parse(Buffer.from(code.slice(5).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  const leg = payload.bets[0].legs[0];
  check(leg.team === 'Buffalo Bills' && leg.opponent === 'Miami Dolphins' && leg.line === -2.5 && leg.odds === -120 && payload.bets[0].stake === 14, 'the Sweat code carries team, line, price and stake');
  await page.click('.sheet [data-action="close"]');

  // Arbs tab: the scripted Pistons total is +110 at DraftKings against -105 at FanDuel.
  await page.click('[data-tab="arbs"]');
  check(/Middles 1/.test(await page.innerText('[data-action="arb-mode"][data-mode="middles"]')), 'the Arbs tab finds the one scripted middle');
  await page.click('[data-action="arb-mode"][data-mode="arbs"]');
  await page.fill('[data-bind="arb.total"]', '200');
  await page.waitForSelector('.row.edge');
  check((await page.locator('.row.edge').count()) === 1, 'one arb at the default minimum (the thin one is under it)');
  const arb = (await page.locator('.row.edge').first().innerText()).replace(/\s+/g, ' ');
  check(/\+1\.18%/.test(arb) && /Pistons|Bulls/.test(arb), `the arb reads +1.18% ROI (${arb})`);
  check(/\$96 and \$104/.test(arb), 'a 200 total splits into whole dollar stakes of 96 and 104');
  check(/Guaranteed profit \+\$1\.60/.test(arb) && !/2\.35/.test(arb), 'the profit shown is the guaranteed minimum, 1.60, not the ideal 2.35');
  check(/DraftKings/.test(arb) && /FanDuel/.test(arb) && /\+110/.test(arb) && /-105/.test(arb) && /2 min old/.test(arb), 'both legs show book, price and age');
  await shot('04-arbs');
  await page.click('[data-tab="settings"]');
  await page.click('[data-action="set"][data-key="minMidEv"][data-v="0"]');
  await page.click('[data-tab="arbs"]');
  await page.waitForFunction(() => document.querySelectorAll('.row.edge').length >= 2).catch(() => {});
  const rows = await texts('.row.edge');
  check(rows.length === 3, `with the minimum at $0 the two thin arbs appear too (${rows.length})`);
  const flat = rows.map((r) => r.replace(/\s+/g, ' '));
  check(/Pistons|Bulls/.test(flat[0]) && !/no guaranteed profit/.test(flat[0]), 'the healthy arb stays first and unflagged');
  const hawks = flat.find((r) => /Hawks|Heat/.test(r)) || '';
  check(/\$97 and \$103/.test(hawks) && /Guaranteed profit -\$0\.18/.test(hawks) && /no guaranteed profit/.test(hawks), `a thin arb that rounds to a loss is flagged with the loss (${hawks})`);
  const bravo = flat.find((r) => /Bravo/.test(r)) || '';
  check(/\$120 and \$80/.test(bravo) && /Guaranteed profit \$0 /.test(bravo) && /no guaranteed profit/.test(bravo), `a thin arb that rounds to zero is flagged too (${bravo})`);
  await shot('05-arbs-thin', { full: true });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'the Arbs tab does not scroll sideways');
  await page.click('[data-tab="settings"]');
  await page.click('[data-action="set"][data-key="minMidEv"][data-v="1"]');

  // Line shop: open the Raiders game and log DraftKings +7.5 from the table.
  await page.click('[data-tab="games"]');
  await page.waitForSelector('.row.game');
  check(!(await page.isVisible('text=Virginia Tech')), 'the line shop hides Virginia college games too');
  await page.click('.row.game:has-text("Raiders")');
  await page.waitForSelector('table.shop');
  check(/Fair \(Shin\): Raiders \+7/.test(await page.innerText('.sheet .fairline >> nth=0')), 'the line shop shows the fair price at the sharp line, by Shin');
  await shot('04-shop');
  await page.click('.cellbtn[data-book="draftkings"][data-market="spread"][data-side="home"]');
  await page.waitForSelector('[data-bind="sheet.draft.line"]');
  check((await page.inputValue('[data-bind="sheet.draft.line"]')) === '7.5', 'logging from the table fills the line');
  await page.click('[data-action="save-log"]');
  await page.waitForSelector('text=Follow it in Sweat');
  await page.click('.sheet [data-action="close"]');

  // Check a price: Raiders +7.5 at -105 from a book The Number does not scan.
  await page.click('.row.game:has-text("Raiders")');
  await page.waitForSelector('.check');
  await page.click('.check [data-action="check-side"][data-side="home"]');
  await page.fill('[data-bind="sheet.check.line"]', '7.5');
  await page.fill('[data-bind="sheet.check.price"]', '-105');
  const chk = await page.innerText('.check .stats');
  check(/Fair \(Shin\)\s*-116/.test(chk) && /\+4\.\d%/.test(chk) && /Worst case/.test(chk), `a typed price gets a fair price, an edge and its worst case (${chk.replace(/\s+/g, ' ')})`);
  await page.click('.sheet [data-action="close"]');

  // Promos: a 50% profit boost on Bills -2.5, a bonus bet, a second chance.
  await page.click('[data-tab="promos"]');
  await page.waitForSelector('[data-bind="promo.pick.gameId"]');
  await page.selectOption('[data-bind="promo.pick.gameId"]', 'nfl1');
  await page.click('[data-action="pick-market"][data-market="spread"]');
  await page.click('[data-action="pick-side"][data-side="home"]');
  await page.selectOption('[data-bind="promo.pick.book"]', 'fanduel');
  await page.click('[data-action="boost-pct"][data-v="0.5"]');
  const boost = await page.innerText('.panel .verdict');
  check(/Worth \+\$/.test(boost) && /pays like \+127/.test(boost), `a 50% boost on -118 pays like +127 and is worth it (${boost.split('\n')[0]})`);
  await shot('05-boost');
  await page.click('[data-action="promo-mode"][data-mode="bonus"]');
  await page.fill('[data-bind="promo.bonusAmount"]', '100');
  await page.selectOption('[data-bind="promo.bonusBook"]', 'fanduel');
  await page.waitForSelector('.bonus .row');
  const topRate = await page.innerText('.bonus .row >> nth=0');
  check(/Lock \$\d+/.test(topRate) && /Cash bet/.test(topRate), 'the bonus bet tool finds a hedge that locks cash');
  await shot('06-bonus');
  const before = await page.evaluate(() => document.querySelectorAll('.row').length);
  await page.click('.bonus [data-action="log-bonus"] >> nth=0');
  await pause(300);
  await page.click('[data-action="promo-mode"][data-mode="second"]');
  await page.waitForSelector('[data-bind="promo.scStake"]');
  check(/Worth/.test(await page.innerText('.panel')), 'the second-chance tool prices the refund');
  check(before > 0, 'promos render');

  // Record before any game: no closing lines yet.
  await page.click('[data-tab="record"]');
  await page.waitForSelector('h1:text-is("Record")');
  const waiting = (await page.innerText('.verdict')).replace(/\s+/g, ' ');
  check(/No closing lines yet/.test(waiting), `record waits for closing lines (${waiting.slice(0, 80)})`);
  check((await page.locator('.row.bet').count()) === 4, 'four bets logged (Bills, Raiders, the bonus bet and its hedge)');

  // Exact closing lines on the free plan: the app falls back to the free ones and says so.
  await page.click('[data-tab="settings"]');
  await page.click('[data-action="set"][data-key="closing"][data-v="pinnacle"]');
  await fetch(`${base}/__step?s=final`);
  await fetch(`${base}/__time?ms=${8 * 3600e3}`);
  await page.clock.fastForward('08:00:00');
  await page.reload();
  await page.waitForSelector('[data-key="closing"]');
  await pause(1500);
  await page.reload();
  await page.waitForSelector('[data-key="closing"]');
  check((await page.getAttribute('[data-key="closing"][data-v="free"]', 'aria-pressed')) === 'true', 'without a paid plan the closing line setting goes back to free');

  // After the games: closing lines from ESPN and grades.
  await page.click('[data-tab="record"]');
  await page.waitForSelector('h1:text-is("Record")');
  await pause(500);
  const rec = (await page.innerText('main')).replace(/\s+/g, ' ');
  check(/a bet so far/.test(rec), 'two closing lines read: an early verdict');
  check(/Record 2-0/.test(rec), `Bills -2.5 and Raiders +7.5 graded as wins (${(rec.match(/Record [\d-]+/) || [''])[0]})`);
  check(/kept out of these numbers: 2 bets, \+\$\d+/.test(rec), 'the bonus bet and its hedge are counted apart from the record');
  check(/Won/.test(await page.locator('.row.bet:has-text("Raiders +7.5")').innerText()), 'Raiders +7.5 won (lost by 4)');
  const billsRow = (await page.locator('.row.bet:has-text("Bills -2.5")').innerText()).replace(/\s+/g, ' ');
  check(/\+\d+\.\d% vs close/.test(billsRow) && /Won \+\$11\.67/.test(billsRow), `Bills -2.5 at -120 beat the -3.5 close and won $11.67 on $14 (${billsRow})`);
  await shot('07-record', { full: true });
  await page.click('.row.bet:has-text("Bills -2.5")');
  await page.waitForSelector('.sheet [data-action="save-bet"]');
  check(/ESPN BET closing line/.test(await page.innerText('.sheet')), 'the bet shows where its closing line came from');
  check(/Fair when bet \(Shin\)/.test(await page.innerText('.sheet .stats')), 'a logged bet keeps the method of its fair price');
  await page.click('[data-action="set-result"][data-r="lost"]');
  await page.click('[data-action="save-bet"]');
  await pause(300);
  check(/Lost -\$14/.test((await page.locator('.row.bet:has-text("Bills -2.5")').innerText()).replace(/\s+/g, ' ')), 'a result can be fixed by hand');
  await page.click('.row.bet:has-text("Bills -2.5")');
  await page.click('[data-action="set-result"][data-r="won"]');
  await page.click('[data-action="save-bet"]');

  // Exports.
  const csv = await download('[data-action="export-csv"]');
  check(csv.split('\n').length === 5 && /^logged,start,sport/.test(csv), 'spreadsheet has a header and four bets');
  const war = JSON.parse(await download('[data-action="export-war"]'));
  check(war.contract === 'sweat-ledger' && war.source_app === 'the-number' && war.bets.length === 4 && war.bets.some((b) => b.closing_line_value > 0), 'War Room file has every bet with its closing line value');
  await page.click('[data-tab="settings"]');
  const backup = JSON.parse(await download('[data-action="export-json"]'));
  check(backup.app === 'the-number' && backup.bets.length === 4 && backup.settings.passcode === '', 'backup has the bets and never the passcode');

  // Night and a wide screen.
  await page.click('[data-action="set"][data-key="theme"][data-v="night"]');
  await page.click('[data-tab="edges"]');
  await shot('08-night');
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.click('[data-tab="record"]');
  await shot('09-desktop');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(!overflow, 'no sideways scrolling');
  const dashes = await page.evaluate(() => /[\u2013\u2014]/.test(document.body.innerText));
  check(!dashes, 'no long dashes on screen');
} catch (e) {
  failures.push(`crashed: ${e.message}`);
  console.log(e);
  await shot('crash');
} finally {
  await browser.close();
  server.kill();
}

for (const e of errors) console.log(e);
if (failures.length || errors.length) {
  console.log(`\n${failures.length + errors.length} problem(s)`);
  process.exit(1);
}
console.log('\nAll end-to-end checks passed');
