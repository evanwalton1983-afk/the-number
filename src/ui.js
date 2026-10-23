// Small rendering helpers: escaping, number and time formats, icons, and the record chart.
import { formatAmerican } from './odds.js';

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });

// $1,234 for whole amounts, $12.50 otherwise; sign: true adds + to gains.
export function money(x, opts = {}) {
  const v = Number(x);
  if (!Number.isFinite(v)) return '';
  const whole = Math.abs(v - Math.round(v)) < 0.005;
  const s = (whole || opts.whole ? usd0 : usd).format(Math.abs(v));
  if (opts.sign) return v > 0.004 ? `+${s}` : v < -0.004 ? `-${s}` : s;
  return v < 0 ? `-${s}` : s;
}

// 0.0512 to "+5.1%".
export function signedPct(x, digits = 1) {
  if (!Number.isFinite(x)) return '';
  const v = Math.round(x * 100 * 10 ** digits) / 10 ** digits;
  return `${v > 0 ? '+' : v < 0 ? '-' : ''}${Math.abs(v).toFixed(digits)}%`;
}

export function pct(x, digits = 0) {
  return Number.isFinite(x) ? `${(x * 100).toFixed(digits)}%` : '';
}

export const price = (a) => (Number.isFinite(Number(a)) && a !== null && a !== '' ? formatAmerican(a) : '');

export function units(stake, unit) {
  if (!(unit > 0) || !Number.isFinite(stake)) return '';
  const u = stake / unit;
  return `${u >= 10 ? Math.round(u) : Math.round(u * 10) / 10}u`;
}

const dayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
const wkFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short' });

export function dayLabel(d, now = Date.now()) {
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return '';
  const today = new Date(now);
  const a = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const b = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const diff = Math.round((b - a) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';
  return dayFmt.format(t);
}

export function kickoff(iso, now = Date.now()) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const d = dayLabel(t, now);
  const near = ['Today', 'Tomorrow', 'Yesterday'].includes(d);
  const far = Math.abs(t.getTime() - now) > 6 * 86400000;
  return `${near ? d : far ? dayFmt.format(t) : wkFmt.format(t)} ${timeFmt.format(t)}`;
}

export function since(ms, now = Date.now()) {
  if (!ms) return '';
  const m = Math.max(0, Math.round((now - ms) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

export function until(ms, now = Date.now()) {
  const m = Math.round((ms - now) / 60000);
  if (m <= 0) return 'started';
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `in ${h} h ${m % 60 ? `${m % 60} min` : ''}`.trim() : `in ${Math.round(h / 24)} days`;
}

const ICONS = {
  edges: '<path d="M4 18h16M4 12h10M4 6h6"/><circle cx="18" cy="8" r="3"/>',
  games: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>',
  promos: '<path d="M4 9h16v11H4zM2 6h20v3H2zM12 6v14"/><path d="M12 6c-1.5-3-5-3-5-1s3 1 5 1c2 0 5 1 5-1s-3.5-2-5 1z"/>',
  arbs: '<path d="M4 8h12l-3-3M20 16H8l3 3"/>',
  record: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  scan: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  out: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
};

export function icon(name) {
  return `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
}

// Running profit against the profit the closing prices said to expect, bet by bet.
export function recordChart(rows, w = 360, h = 160) {
  if (rows.length < 2) return '';
  const pad = { l: 48, r: 10, t: 12, b: 18 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const vals = rows.flatMap((r) => [r.actual, r.expected]);
  const lo = Math.min(0, ...vals);
  const hi = Math.max(0, ...vals);
  const span = hi - lo || 1;
  const x = (i) => pad.l + (i / (rows.length - 1)) * iw;
  const y = (v) => pad.t + (1 - (v - lo) / span) * ih;
  const path = (k) => rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(r[k]).toFixed(1)}`).join(' ');
  const last = rows[rows.length - 1];
  const fmt = (v) => money(v, { whole: true });
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(`Profit ${money(last.actual, { sign: true })} against ${money(last.expected, { sign: true })} expected from closing prices`)}">`
    + `<line class="zero" x1="${pad.l}" x2="${w - pad.r}" y1="${y(0)}" y2="${y(0)}"/>`
    + `<text class="lbl" x="${pad.l - 6}" y="${y(hi) + 4}" text-anchor="end">${esc(fmt(hi))}</text>`
    + `<text class="lbl" x="${pad.l - 6}" y="${y(lo) + 4}" text-anchor="end">${esc(fmt(lo))}</text>`
    + `<path class="exp" d="${path('expected')}"/><path class="act" d="${path('actual')}"/></svg>`;
}
