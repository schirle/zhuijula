import { loadSiteConfig, resolveEnv, checkRateLimit, getClientIP } from './_shared.js';
import { flushTrash } from './api/transfer.js';
import { buildUserScript } from './api/zhuiju.user.js';
let _lastTrashFlush = 0;
function maybeFlushTrash(context) {
  const now = Date.now();
  if (now - _lastTrashFlush < 60000) return;
  _lastTrashFlush = now;
  try {
    const p = resolveEnv(context).then((e) => flushTrash(e)).catch(() => 0);
    if (context && typeof context.waitUntil === 'function') context.waitUntil(p);
  } catch (_) {  }
}
const SKIP = [/^\/api\//, /^\/console/, /^\/admin/, /^\/c(\/|$)/, /^\/file\//];
const MARK = '<meta name="ftv-stats" content="1">';
const DEFAULT_SITE_NAME = '免费追剧';
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// 各页在后台「网站名称 / 网站描述」前面加的前缀（首页留空 → 直接"站名 - 描述"）
const PAGE_META = {
  '/search': '影视搜索', '/sou': '影视搜索',
  '/play': '在线播放',
  '/rank': '搜索排行',
  '/links': '友情链接',
  '/app': '应用下载',
  '/vip': 'VIP 视频解析',
  '/plugin': '浏览器插件', '/plugin.html': '浏览器插件',
};
// 把 title / description / 分享卡片（og 系列）/ 苹果图标统一写好：
// 之前这些值要么写死在各个 html 里、要么靠前端 JS 事后补 ——
// 服务端直接产出，首屏、搜索引擎和"分享到微信"看到的都是后台设置的那份。
function setPageMeta(html, opt) {
  const title = opt.title || '';
  const desc = opt.desc || '';
  const siteName = opt.siteName || '';
  const icon = opt.icon || '';
  const abs = (u) => (/^https?:\/\//i.test(u) ? u : opt.origin + '/' + String(u).replace(/^\/+/, ''));
  let s = html;
  if (title) {
    s = /<title>[\s\S]*?<\/title>/i.test(s)
      ? s.replace(/<title>[\s\S]*?<\/title>/i, '<title>' + escHtml(title) + '</title>')
      : s.replace(/<head([^>]*)>/i, '<head$1><title>' + escHtml(title) + '</title>');
  }
  if (desc) {
    const tag = '<meta name="description" content="' + escHtml(desc) + '">';
    s = /<meta[^>]+name=["']description["'][^>]*>/i.test(s)
      ? s.replace(/<meta[^>]+name=["']description["'][^>]*>/i, tag)
      : s.replace(/<\/head>/i, tag + '</head>');
  }
  if (!/property=["']og:title["']/i.test(s)) {
    const og = (title ? '<meta property="og:title" content="' + escHtml(title) + '">' : '')
      + (desc ? '<meta property="og:description" content="' + escHtml(desc) + '">' : '')
      + '<meta property="og:type" content="website">'
      + '<meta property="og:url" content="' + escHtml(opt.url || opt.origin) + '">'
      + (siteName ? '<meta property="og:site_name" content="' + escHtml(siteName) + '">' : '')
      + (icon ? '<meta property="og:image" content="' + escHtml(abs(icon)) + '">' : '');
    if (og) s = s.replace(/<\/head>/i, og + '</head>');
  }
  if (icon && !/rel=["']apple-touch-icon["']/i.test(s)) {
    s = s.replace(/<\/head>/i, '<link rel="apple-touch-icon" href="' + escHtml(abs(icon)) + '">' + '</head>');
  }
  return s;
}
function passHeaders(src) {
  const h = new Headers(src);
  h.delete('content-length');
  h.delete('content-encoding');
  h.delete('etag');
  h.set('content-type', 'text/html; charset=utf-8');
  return h;
}
// 插件功能是否开启（后台「插件设置 → 插件功能总开关」，也可用环境变量 PLUGIN_ENABLED=1）
const pluginOn = (cfg, env) => String((cfg && cfg.plugin_enabled) || env.PLUGIN_ENABLED || '').trim() === '1';
export async function onRequest(context) {
  const { request, env } = context;
  maybeFlushTrash(context);
  // 未开启插件功能：插件页直接跳回首页（避免访客从收藏 / 外链直达一个"不存在"的页面）
  try {
    const up = new URL(request.url);
    if (up.pathname === '/plugin' || up.pathname === '/plugin/' || up.pathname === '/plugin.html') {
      let on = String(env.PLUGIN_ENABLED || '').trim() === '1';
      if (!on) {
        try { on = pluginOn(await loadSiteConfig(env), env); } catch (_) { on = false; }
      }
      if (!on) return Response.redirect(up.origin + '/', 302);
    }
  } catch (_) {  }
  try {
    const u0 = new URL(request.url);
    if (u0.pathname.startsWith('/api/')) {
      const c0 = await loadSiteConfig(env);
      const nm = String((c0 && c0.userscript_name) || '').trim().replace(/[\\/]/g, '') || 'zhuiju.user.js';
      const p = u0.pathname;
      if (p === '/api/' + nm || p === '/api/zhuiju.user.js' || p === '/api/zhuiju.user') {
        // 脚本下载地址原来完全没限流，会被当成免费接口刷
        if (!checkRateLimit(getClientIP(request), 30, 'userscript')) {
          return new Response('// 请求过于频繁\n', {
            status: 429,
            headers: { 'content-type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' },
          });
        }
        // 插件功能没开就不提供脚本下载
        if (!pluginOn(c0, env)) {
          return new Response('// 插件功能未开启\n', {
            status: 404,
            headers: { 'content-type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' },
          });
        }
        return new Response(buildUserScript(c0 || {}, u0.origin), {
          headers: { 'content-type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' },
        });
      }
    }
  } catch (_) {  }
  const res = await context.next();
  if (request.method !== 'GET') return res;
  let path = '';
  try { path = new URL(request.url).pathname; } catch (_) { return res; }
  if (SKIP.some(re => re.test(path))) return res;
  if (!(res.headers.get('content-type') || '').includes('text/html')) return res;
  let html = '';
  try {
    const cfg = await loadSiteConfig(env);
    const code = (cfg && cfg.stats_code ? String(cfg.stats_code) : '').trim();
    const name = (cfg && cfg.site_name ? String(cfg.site_name) : '').trim();
    const desc = (cfg && cfg.site_desc ? String(cfg.site_desc) : '').trim();
    const rename = (name && name !== DEFAULT_SITE_NAME) ? name : '';
    const icon = (cfg && cfg.site_icon ? String(cfg.site_icon) : '').trim();
    const DEFAULT_ICON = 'file/zhuiju.png';
    // Chrome 扩展的显示开关 = 部署变量 CRXTURE（=1 才有），地址取自后台「Chrome 扩展下载地址」
    const crxOn = String(env.CRXTURE || '').trim() === '1';
    const crxUrl = (cfg && cfg.crx_url ? String(cfg.crx_url) : '').trim();
    const usName = (cfg && cfg.userscript_name ? String(cfg.userscript_name) : '').trim();
    const isPluginPage = path === '/plugin' || path === '/plugin.html';
    if (!code && !rename && !icon && !name && !desc && !usName && !crxOn && !isPluginPage) return res;
    html = await res.text();
    let out = html;
    if (rename) out = out.split(DEFAULT_SITE_NAME).join(escHtml(rename));
    if (icon) {
      const safe = escHtml(icon);
      out = out.split('/' + DEFAULT_ICON).join(safe);
      out = out.split(DEFAULT_ICON).join(safe);
    }
    const CRX_RE = /<button[^>]*data-crx[^>]*>[\s\S]*?<\/button>/;
    if (CRX_RE.test(out)) {
      if (!crxOn || !crxUrl) {
        // ① 没配 CRXTURE 变量（功能没开）或 ② 后台没填下载地址（没有可下载的文件）
        //    → 两种情况都不显示下载按钮：站点不自带扩展文件，绝不去下一个不存在的默认文件
        out = out.replace(CRX_RE, '');
      } else {
        // 变量已开 + 填了地址 → 按钮直接指向后台填的地址
        out = out.replace(CRX_RE, '<a class="btn-install" style="text-decoration:none" href="' + escHtml(crxUrl) + '"><i class="fas fa-download"></i> 下载 Chrome 扩展</a>');
      }
    }
    if (usName) {
      out = out.split('zhuiju-douban.user.js').join(escHtml(usName));
      out = out.split('zhuiju.user.js').join(escHtml(usName));
    }
    if (code) {
      const inject = code + MARK;
      out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, inject + '</body>') : out + inject;
    }
    // 标题 / 描述 / 分享卡片：全站跟随后台「网站名称 + 网站描述」
    if (name || desc) {
      const origin = new URL(request.url).origin;
      const page = PAGE_META[path] || '';
      const title = page ? (name ? page + ' - ' + name : page) : [name, desc].filter(Boolean).join(' - ');
      const pageDesc = page ? [page, desc].filter(Boolean).join('｜') : desc;
      out = setPageMeta(out, { title, desc: pageDesc, icon, siteName: name, origin, url: origin + path });
    }
    return new Response(out, { status: res.status, headers: passHeaders(res.headers) });
  } catch (_) {
    return html
      ? new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
      : res;
  }
}
