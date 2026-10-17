// Builds public/index.html (one file: styles and script inlined), copies the font and stamps
// the service worker with a content hash so phones pick up new versions.
//
//   npm run build
import { build, transform } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = (...p) => path.join(root, ...p);

const js = await build({
  entryPoints: [r('src/app.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  target: ['es2020', 'safari15'],
  // Keeps the /*! license notices of code adapted from MIT projects (src/fairprice.js).
  legalComments: 'eof',
});
const script = js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = (await transform(fs.readFileSync(r('src/styles.css'), 'utf8'), { loader: 'css', minify: true, target: ['safari15', 'chrome100'] })).code;
const html = fs.readFileSync(r('src/index.html'), 'utf8')
  .replace('/*__CSS__*/', () => css)
  .replace('/*__JS__*/', () => script);
fs.writeFileSync(r('public/index.html'), html);

fs.mkdirSync(r('public/fonts'), { recursive: true });
const font = r('node_modules/@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2');
if (fs.existsSync(font)) fs.copyFileSync(font, r('public/fonts/archivo-wdth.woff2'));
else if (!fs.existsSync(r('public/fonts/archivo-wdth.woff2'))) throw new Error('Missing the Archivo font. Run npm install.');

const hash = createHash('sha256').update(html).digest('hex').slice(0, 10);
fs.writeFileSync(r('public/sw.js'), fs.readFileSync(r('src/sw.js'), 'utf8').replace('__VERSION__', `number-${hash}`));
console.log(`Built public/index.html (${Math.round(html.length / 1024)} KB), service worker number-${hash}`);
