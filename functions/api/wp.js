// 网盘资源搜索接口（整合自 iyuns 的 wpysso 接口）
//   /api/wp?word=关键词   →   请求 iyuns 的 wpysso 接口
//
// 通过 cloud_types 区分网盘平台：baidu=百度 quark=夸克 uc=UC xunlei=迅雷
// 返回 JSON（非流式），结构示例：
// {
//   "code": 0, "message": "success",
//   "data": {
//     "total": 19,
//     "merged_by_type": {
//       "baidu": [ { "url": "...", "password": "8888", "note": "...", "datetime": "...", "source": "...", "images": ["..."] } ]
//     }
//   },
//   "request_id": "..."
// }
//
// 接口地址前缀通过 Pages 环境变量 WP_API_HOST 配置（必须配置，无默认值），
// 形如 api.iyuns.com/api/wpysso（含路径，不要带协议头，也不要带尾部斜杠）。
// 实际请求 = https://{WP_API_HOST}?cloud_types=...&kw=...，路径变更只需改变量。
import { makeRoute, resolveEnv } from '../_shared.js';

// 支持的平台：作为 cloud_types 逐个请求（与示例格式 cloud_types=baidu 一致，最稳妥）
const TYPES = ['baidu', 'quark', 'uc', 'xunlei'];

async function fetchType(word, type, host) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const apiUrl = `https://${host}?cloud_types=${encodeURIComponent(type)}&kw=${encodeURIComponent(word)}`;
    const r = await fetch(apiUrl, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    });
    if (r.status !== 200) return [];
    const j = await r.json().catch(() => ({}));
    // 兼容：data.merged_by_type[type] 或 data.results[type]
    const bucket = j?.data?.merged_by_type?.[type] || j?.data?.results?.[type] || [];
    return Array.isArray(bucket) ? bucket : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
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
    });
  }
  return out;
}

// 资源有效性：打开链接后页面含以下任一标记即视为「无资源/已失效」，不进入列表
const DEAD_MARKERS = [
  '已失效', '你来晚了', '来晚一步', '分享已删除', '分享已被删除',
  '该分享已', '该分享不存在', '链接已失效', '此链接已失效', '已取消分享',
  '资源不存在', '分享页面不存在', '访问的页面不存在', '页面不存在',
  '分享已过期', '该内容不存在', '文件不存在', '链接不存在', '不存在或已删除',
  '分享已不存在', '该分享已取消', '资源已失效',
];

// 轻量探测单个分享链接是否失效；网络/超时/被拦截等异常一律视为“有效”以保守保留
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
    // 仅 404 明确判定失效；403 多为网盘风控拦截，保守视为有效，避免误删真实资源
    if (r.status === 404) return true;
    const text = await r.text();
    return DEAD_MARKERS.some((m) => text.includes(m));
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// 并发探测并剔除失效链接；受 deadline 控制，超时后剩余链接保守保留，避免拖垮函数
async function filterDeadLinks(items, deadline) {
  const out = [];
  let idx = 0;
  const LIMIT = 12;
  async function worker() {
    while (idx < items.length) {
      if (deadline.signal.aborted) { out.push(items[idx++]); continue; }
      const i = idx++;
      const dead = await checkLinkDead(items[i].link).catch(() => false);
      if (!dead) out.push(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(LIMIT, items.length) }, worker));
  return out;
}

async function searchWord(word, host) {
  const results = await Promise.all(
    TYPES.map((t) => fetchType(word, t, host).then((list) => normalize(list, t)).catch(() => []))
  );
  const items = results.flat();
  // 资源有效性校验：打开链接有资源=有效，失效/无资源=剔除，不进入网盘列表
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), 15000);
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
    },
  });
}

async function handleWp(_request, url, context) {
  const word = (url.searchParams.get('word') || '').trim();
  if (!word) return json({ error: '缺少关键词' }, 400);
  const env = await resolveEnv(context);
  // 去掉可能的协议头与尾部斜杠，使得变量填 "https://api.iyuns.com/api/wpysso/" 也能正常工作
  const host = (env.WP_API_HOST || '').toString().trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!host) return json({ error: '服务端未配置网盘搜索接口（WP_API_HOST，后台或环境变量）' }, 500);
  try {
    const results = await searchWord(word, host);
    const safe = results.slice(0, 60);
    return json({ keyword: word, type: word, total: safe.length, results: safe });
  } catch (e) {
    return json({ error: '搜索失败：' + (e?.message || e), total: 0, results: [] }, 500);
  }
}

export const onRequest = makeRoute((request, url, context) => handleWp(request, url, context));
