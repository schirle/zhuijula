// 逐个压缩 file/ 下的静态资源；缺失或压缩失败的单文件不影响整体构建（保留原始文件可用）
import { build } from 'esbuild';
import { existsSync } from 'node:fs';

const srcs = [
  'file/app.js', 'file/common.js', 'file/index.js', 'file/links.js', 'file/play.js',
  'file/vip.js', 'file/search.js', 'file/rank.js', 'file/wechat-tip.js',
  'file/app.css', 'file/common.css', 'file/index.css', 'file/links.css', 'file/play.css',
  'file/vip.css', 'file/search.css', 'file/rank.css', 'file/plugin.css',
];

for (const s of srcs) {
  if (!existsSync(s)) { console.warn('[minify] skip (missing):', s); continue; }
  try {
    await build({
      entryPoints: [s],
      minify: true,
      bundle: false,
      outbase: 'file',
      outdir: 'file',
      outExtension: { '.js': '.min.js', '.css': '.min.css' },
      allowOverwrite: true,
      logLevel: 'silent',
    });
    console.log('[minify] ok:', s);
  } catch (e) {
    console.warn('[minify] failed (kept raw):', s, e && e.message ? e.message : e);
  }
}
