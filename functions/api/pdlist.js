// 精选片单：读取 Cloudflare Pages 环境变量 PDlist（逗号分隔的豆瓣片单 id），
// 返回每个片单的元信息（标题、封面、数量），供首页「精选片单」展示。
// 配置：Cloudflare Pages 后台 Settings → Environment variables 添加
//       名称 PDlist，值 11,22,33,44,55,66,88,99（即豆瓣 doulist 的数字 id）
// 首页点击任意片单卡片 → 跳转 /list.html?id=<该id>，由 /api/list 抓取豆瓣片单内容。

import { fetchDoubanJson as fetchJson, cacheGet, cachePut, resolveEnv, asyncPool, CORS } from '../_shared.js';

// 取片单元信息：标题 + 封面（片单封面或首条影片海报）+ 数量
// 注意：douban 主接口不再内联 items，影片在 /doulist/{id}/items 子接口
async function fetchDoulistMeta(id) {
  // rexxar 接口不稳定，失败自动重试一次；彻底失败返回 null（由上层过滤，不产出空壳片单）
  let meta = await fetchJson(`https://m.douban.com/rexxar/api/v2/doulist/${id}?start=0&count=1`, 6000);
  if (!meta || !meta.title) {
    meta = await fetchJson(`https://m.douban.com/rexxar/api/v2/doulist/${id}?start=0&count=1`, 6000);
  }
  if (!meta || !meta.title) return null;

  let cover = meta.cover_url || '';
  if (!cover) {
    const first = await fetchJson(`https://m.douban.com/rexxar/api/v2/doulist/${id}/items?start=0&count=1`, 6000);
    if (first && Array.isArray(first.items) && first.items[0] && first.items[0].cover_url) {
      cover = first.items[0].cover_url;
    }
  }
  const count = (typeof meta.items_count === 'number') ? meta.items_count : 0;
  return { id, title: meta.title, desc: meta.desc || meta.description || '', cover, count, ok: true };
}

const jsonHeaders = {
    'content-type': 'application/json; charset=utf-8',
    // 缩短缓存：rexxar 抖动时残缺数据最多停留 1 小时（浏览器）/ 6 小时（边缘），并可后台刷新自愈
    'Cache-Control': 'public, s-maxage=21600, max-age=3600, stale-while-revalidate=86400',
    ...CORS,
};

// 解析 PDlist 环境变量，并发抓取每个豆瓣片单的元信息，返回列表。
// 供 /api/pdlist 与 /api/list（无 id）复用，保证首页与片单索引一致。
export async function buildPdlist(env) {
  const raw = (env && env.PDlist) || '';
  const ids = raw.split(',').map(s => s.trim()).filter(s => /^\d+$/.test(s));
  if (!ids.length) return [];
  const metas = await asyncPool(6, ids, id => fetchDoulistMeta(id));
  // 过滤抓取失败的片单，避免首页出现无封面/无标题的空壳卡片
  return metas.filter(m => m && m.ok && m.title && m.cover);
}

export async function onRequest(context) {
  const key = new Request(context.request.url.origin + '/__pdlist_v2__');
  const hit = await cacheGet(key);
  if (hit) return hit; // 命中缓存直接返回，避免每次回源豆瓣逐个片单元信息
  const env = await resolveEnv(context);
  const lists = await buildPdlist(env);
  const res = new Response(JSON.stringify({ success: true, lists }), { headers: jsonHeaders });
  if (lists.length) await cachePut(key, res); // 仅缓存成功结果，避免空/失败被长期缓存
  return res;
}
