import { makeRoute, json, loadSiteConfig } from '../_shared.js';

export const onRequest = makeRoute(handleCustomPage);

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function handleCustomPage(request, url, context) {
  const env = context?.env || {};
  const slug = (url.pathname.split('/').filter(Boolean).pop() || '').toLowerCase();
  const cfg = await loadSiteConfig(env, true);
  const pages = Array.isArray(cfg.custom_pages) ? cfg.custom_pages : [];
  const page = pages.find(p => p && String(p.slug || '').trim().toLowerCase() === slug);
  if (!page) return json({ code: 0, msg: '页面不存在' }, 404);

  const siteName = cfg.site_name || '免费追剧';
  const title = page.title || siteName;
  const intro = page.intro || '';
  const content = page.content || '';
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} - ${esc(siteName)}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#f4f6f9;color:#1f2d3d}
  .wrap{max-width:760px;margin:0 auto;padding:36px 18px}
  .back{display:inline-block;margin-bottom:20px;color:#3b82f6;text-decoration:none;font-weight:600}
  h1{font-size:23px;margin:0 0 8px}
  .intro{color:#7a8aa0;margin:0 0 24px;font-size:14px}
  .content{line-height:1.85;font-size:15px}
  .content img{max-width:100%;border-radius:10px}
  .content a{color:#3b82f6}
</style>
</head>
<body>
  <div class="wrap">
    <a class="back" href="/">‹ 返回首页</a>
    <h1>${esc(title)}</h1>
    ${intro ? `<p class="intro">${esc(intro)}</p>` : ''}
    <div class="content">${content}</div>
  </div>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
