import { minify } from 'html-minifier-terser';
import { readFileSync, writeFileSync } from 'node:fs';

const files = ['index.html', 'app.html', 'play.html', 'vip.html', 'list.html', 'links.html', 'fuli.html', 'plugin.html'];

const options = {
  collapseWhitespace: true,
  removeComments: true,
  removeOptionalTags: true,
  removeRedundantAttributes: true,
  removeScriptTypeAttributes: true,
  decodeEntities: false,
  minifyCSS: false,
  minifyJS: false,
  caseSensitive: true,
};

// 把页面引用的静态资源指向压缩产物（file/x.js -> file/x.min.js，file/x.css -> file/x.min.css）
// 由 build 在 minify:js 生成 .min 之后再改写，确保引用与产物一致；userscript(*.user.js) 不在 HTML 标签中，不受影响
const toMinRefs = (html) => html.replace(/(file\/[A-Za-z0-9_-]+\.)(js|css)/g, '$1min.$2');

for (const f of files) {
  const raw = readFileSync(f, 'utf8');
  const html = toMinRefs(raw);
  const out = await minify(html, options);
  writeFileSync(f, out);
  console.log('minified', f, `(${raw.length} -> ${out.length} bytes)`);
}
