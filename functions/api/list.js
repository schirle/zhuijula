// 片单接口：
//   /api/list?id=数字        → 抓取豆瓣片单(doulist)标题 + 影片列表
//   /api/list                → 返回 PDlist 变量驱动的片单索引（与首页精选片单一致）
//
// 配置：Cloudflare Pages 后台 Settings → Environment variables 添加
//       名称 PDlist，值 11,22,33,44,55,66,88,99（豆瓣 doulist 数字 id，逗号分隔）
//
// 豆瓣片单里的每部影片，前端会根据片名调用 /api/search（数据源由后台 ZUIJU_URL 或「追剧自定义数据」提供）自动匹配播放源。
//
// 分页策略：首次请求时把整份片单（已过滤掉非影视条目）抓取并缓存，
// 后续「加载更多」只做数组切片，保证条目不重不漏，hasMore 基于真实影视数量判断。

import { buildPdlist } from './pdlist.js';
import { fetchDoubanJson as fetchJson, cacheGet, cachePut, resolveEnv, CORS } from '../_shared.js';

// 抓取片单元信息 + 全部影视条目（已过滤 非 movie/tv）
// 并发抓取前若干页（默认 8 页 / 400 条），单请求 6s 超时，整体必在数秒内返回，
// 避免串行翻页在大列表下把 worker 挂起（表现为前端一直转圈）。
async function fetchDoulistFull(id) {
  const meta = await fetchJson(`https://m.douban.com/rexxar/api/v2/doulist/${id}?start=0&count=1`, 6000);
  if (!meta || !meta.title) return null;

  const title = meta.title;
  const cover = meta.cover_url || '';
  const items = [];
  const PAGES = 8; // 上限 400 条原始条目，足够展示且不会拖垮请求

  const reqs = [];
  for (let p = 0; p < PAGES; p++) {
    reqs.push(fetchJson(`https://m.douban.com/rexxar/api/v2/doulist/${id}/items?start=${p * 50}&count=50`, 6000));
  }
  const results = await Promise.all(reqs);
  for (const d of results) {
    if (!d || !Array.isArray(d.items)) continue;
    for (const it of d.items) {
      if (it.type && it.type !== 'movie' && it.type !== 'tv') continue; // 跳过非影视条目
      const name = it.title || '';
      if (!name) continue;
      items.push({ name, pic: it.cover_url || '', year: '' });
    }
  }
  return { title, cover, items, total: items.length };
}

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  // 缩短浏览器缓存：避免 rexxar 抖动期间的残缺数据在用户端滞留 30 天
  'Cache-Control': 'public, s-maxage=21600, max-age=3600, stale-while-revalidate=86400',
  ...CORS,
};
const noStoreHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  ...CORS,
};

export async function onRequest(context) {
  const env = await resolveEnv(context);
  const url = new URL(context.request.url);
  const id = url.searchParams.get('id');

  // 无 id：返回 PDlist 变量驱动的片单索引（与首页精选片单一致）
  if (!id) {
    const playlists = (await buildPdlist(env)).map(({ desc, ...p }) => p);
    return new Response(JSON.stringify({ success: true, playlists }), { headers: jsonHeaders });
  }

  // 分页参数（用于「加载更多」）
  const start = parseInt(url.searchParams.get('start') || '0', 10) || 0;
  const count = Math.min(parseInt(url.searchParams.get('count') || '30', 10) || 30, 50);

  // 纯数字 → 豆瓣片单
  if (/^\d+$/.test(id)) {
    // 整份片单缓存：首次抓取全量，之后分页只切片，避免重复抓取 + 漏加载
    const cacheKey = new Request(url.origin + '/__doulist_v2__/' + id);
    let full = null;
    const hit = await cacheGet(cacheKey);
    if (hit) full = await hit.json();

    if (!full) {
      const f = await fetchDoulistFull(id);
      if (!f) {
        return new Response(
          JSON.stringify({ success: false, message: '片单不存在或抓取失败' }),
          { status: 404, headers: noStoreHeaders }
        );
      }
      full = f;
      try {
        const r = new Response(JSON.stringify(full), {
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, s-maxage=2592000, max-age=2592000' },
        });
        await cachePut(cacheKey, r);
      } catch (_) { }
    }

    const items = full.items.slice(start, start + count);
    const hasMore = start + count < full.items.length;
    return new Response(
      JSON.stringify({
        success: true,
        playlist: {
          id,
          isDouban: true,
          title: full.title,
          cover: full.cover,
          items,
          hasMore,
          total: full.total,
        },
      }),
      { headers: jsonHeaders }
    );
  }

  // 文本 id：内置片单已删除，不再支持
  return new Response(
    JSON.stringify({ success: false, message: '片单不存在' }),
    { status: 404, headers: noStoreHeaders }
  );
}
