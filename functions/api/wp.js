import { makeRoute, resolveEnv, fetchWithRetry, CORS, bannedHit, getClientIP, checkRateLimit, jsonErr } from '../_shared.js';

const TYPES = ['baidu', 'quark', 'uc', 'xunlei'];

async function fetchType(word, type, host) {
  const apiUrl = `https://${host}?cloud_types=${encodeURIComponent(type)}&kw=${encodeURIComponent(word)}`;
  const r = await fetchWithRetry(apiUrl, {
    timeout: 15000,
    retries: 0,
    asJson: true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    },
  });
  if (!r || r._error) return [];

  const bucket = r?.data?.merged_by_type?.[type] || r?.data?.results?.[type] || [];
  return Array.isArray(bucket) ? bucket : [];
}

function normalize(items, type) {
  const out = [];
  const seen = new Set();
  for (const it of items) {
    const link = (it.url || '').toString().trim();
    if (!link) continue;
    if (seen.has(link)) continue;
    seen.add(link);
    out.push({
      title: (it.note || '网盘资源').toString().trim(),
      link,
      type,

      code: (it.password || it.pwd || it.code || '').toString().trim(),
    });
  }
  return out;
}

const DEAD_MARKERS = [
  '已失效', '你来晚了', '来晚一步', '分享已删除', '分享已被删除',
  '该分享已', '该分享不存在', '链接已失效', '此链接已失效', '已取消分享',
  '资源不存在', '分享页面不存在', '访问的页面不存在', '页面不存在',
  '分享已过期', '该内容不存在', '文件不存在', '链接不存在', '不存在或已删除',
  '分享已不存在', '该分享已取消', '资源已失效',
];

async function checkLinkDead(link) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch(link, {
      method: 'GET',
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    });

    if (r.status === 404) return true;
    const text = await r.text();
    return DEAD_MARKERS.some((m) => text.includes(m));
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function filterDeadLinks(items, deadline) {

  const keep = new Array(items.length).fill(false);
  let idx = 0;
  const LIMIT = 12;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      if (deadline.signal.aborted) { keep[i] = true; continue; }
      const dead = await checkLinkDead(items[i].link).catch(() => false);
      keep[i] = !dead;
    }
  }
  await Promise.all(Array.from({ length: Math.min(LIMIT, items.length) }, worker));
  return items.filter((_, i) => keep[i]);
}

async function searchWord(word, host) {
  const results = await Promise.all(
    TYPES.map((t) => fetchType(word, t, host).then((list) => normalize(list, t)).catch(() => []))
  );
  const items = results.flat();

  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), 10000);
  let valid;
  try {
    valid = await filterDeadLinks(items, deadline);
  } finally {
    clearTimeout(timer);
  }
  return valid;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, max-age=3600',
      ...CORS,
    },
  });
}

async function handleWp(request, url, context) {
  // 网盘搜索同样要限流（原来这个接口完全没有限制，可被脚本猛刷）
  if (!checkRateLimit(getClientIP(request), 30, 'wp')) return jsonErr('搜索太频繁，请稍后再试', 429);
  const word = (url.searchParams.get('word') || '').trim();
  if (!word) return json({ error: '缺少关键词' }, 400);
  const env = await resolveEnv(context);

  if (bannedHit(env, word)) {
    return json({ error: '无法搜索该关键词，请更换关键词后再试', total: 0, results: [] });
  }

  const host = (env.WP_API_HOST || '').toString().trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!host) return json({ error: '站点尚未开通「网盘」搜索（请到后台「网盘设置」填写搜索接口）' }, 500);
  try {
    const results = await searchWord(word, host);
    const safe = results.slice(0, 60);
    return json({ keyword: word, type: word, total: safe.length, results: safe });
  } catch (e) {
    // 具体原因只进服务器日志，页面上给一句通用提示
    try { console.warn('[wp] 网盘搜索失败：' + (e?.message || e)); } catch (_) { /* 忽略 */ }
    return json({ error: '搜索服务暂时不可用，请稍后再试', total: 0, results: [] }, 500);
  }
}

export const onRequest = makeRoute((request, url, context) => handleWp(request, url, context));
