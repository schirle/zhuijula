// 侧栏小部件合并接口：一次请求取回「搜索排行（日/周/月）+ 今日推荐 + 友链」。
//
// 为什么要有这个接口：Cloudflare Pages 免费额度是每天 10 万次 Functions 调用，
// 而每个页面访问都要消耗（HTML 中间件 1 次 + 页面里 /api/* 若干次）。
// 首页/搜索页原来要打 3~4 个接口，合并后只要 1 个；排行切日/周/月榜也不用再发请求。
import { makeRoute, jsonErr, getClientIP, checkRateLimit, cacheGet, cachedJson, resolveEnv, bannedHit, handleDaily } from '../_shared.js';
import { readHotMap, topHot, TOP_N, DEFAULT_HOT, pruneHot } from '../_hotrank.js';

const readJson = (res) => ((res && typeof res.json === 'function') ? res.json().catch(() => null) : Promise.resolve(null));

// 排行：一次算出日/周/月三份，前端切榜就不再打接口
async function rankPayload(env, n = 8) {
  let map = {};
  try { await pruneHot(env); map = await readHotMap(env); } catch (_) { map = {}; }
  const pick = (range) => {
    let list = Object.keys(map).length ? topHot(map, n, range) : [];
    if (!list.length) list = DEFAULT_HOT.slice(0, n);
    return list.filter((w) => !bannedHit(env, w));
  };
  return { day: pick('day'), week: pick('week'), month: pick('month'), total: Object.keys(map).length };
}

export async function handleWidgets(request, url, context) {
  if (!checkRateLimit(getClientIP(request), 120, 'widgets')) return jsonErr('请求过于频繁，请稍后再试', 429);
  const ckey = new Request(url.origin + '/__widgets__');
  const hit = await cacheGet(ckey);
  if (hit) return hit;

  const env = await resolveEnv(context);
  const [rank, daily] = await Promise.all([
    rankPayload(env).catch(() => null),
    handleDaily(request, url, context).then(readJson).catch(() => null),
  ]);
  return cachedJson(ckey, { code: 1, rank, daily }, { smax: 60, maxAge: 30, stale: 300 });
}

export const onRequest = makeRoute(handleWidgets);
