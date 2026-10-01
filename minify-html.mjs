import { minify } from 'html-minifier-terser';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const files = ['index.html', 'app.html', 'play.html', 'vip.html', 'links.html', 'plugin.html', 'console.html', 'search.html', 'rank.html'];

const options = {
  collapseWhitespace: true,
  removeComments: true,

  removeOptionalTags: false,
  removeRedundantAttributes: true,
  removeScriptTypeAttributes: true,
  decodeEntities: false,
  minifyCSS: false,
  minifyJS: false,
  caseSensitive: true,
};


const toMinRefs = (html) => html.replace(/(file\/[A-Za-z0-9_-]+\.)(js|css)/g, (m, p1, p2) => {
  const minPath = p1 + 'min.' + p2;
  return existsSync(minPath) ? minPath : m;
});

for (const f of files) {
  try {
    const raw = readFileSync(f, 'utf8');
    const html = toMinRefs(raw);
    const out = await minify(html, options);
    writeFileSync(f, out);
    console.log('minified', f, `(${raw.length} -> ${out.length} bytes)`);
  } catch (e) {
    console.warn('skip minify (kept raw):', f, e && e.message ? e.message : e);
  }
}
