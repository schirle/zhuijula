import { makeRoute, json, getClientIP, checkRateLimit, resolveEnv, bannedHit, searchLimits } from '../_shared.js';
import { readHotMap, recordHot, topHotDetail, statsHot, DEFAULT_HOT, pruneHot } from '../_hotrank.js';
export const onRequest = makeRoute(handleSearchRank);
export async function handleSearchRank(request, url, context) {
  const env = context?.env || {};
  const cfgEnv = await resolveEnv(context);
  const recordWord = url.searchParams.get('record');
  // 读榜单也要限流（列表模式原来完全没限）
  if (!recordWord && !checkRateLimit(getClientIP(request), 60, 'rankread')) {
    return json({ code: 0, msg: '请求过于频繁' }, 429, { 'Cache-Control': 'no-store' });
  }
  if (recordWord) {
    if (!checkRateLimit(getClientIP(request))) return json({ code: 0, msg: '请求过于频繁' }, 429);
    if (bannedHit(cfgEnv, recordWord)) return json({ code: 1, skipped: true });
    await recordHot(env, recordWord, searchLimits(cfgEnv).hotPerDay);
  }
  const range = url.searchParams.get('range');
  const nParam = parseInt(url.searchParams.get('n'), 10);
  const n = (Number.isFinite(nParam) && nParam > 0) ? Math.min(nParam, 30) : TOP_N;
  await pruneHot(env);
  const map = await readHotMap(env);
  let list;
  let demo = false;
  if (Object.keys(map).length) {
    list = topHotDetail(map, n, range);
    if (!list.length) { list = DEFAULT_HOT.slice(0, n); demo = true; }   // 还没攒到有效词 → 先给推荐词
  } else {
    list = DEFAULT_HOT.slice(0, n);
    demo = true;
  }
  list = list.filter((it) => it && !bannedHit(cfgEnv, it.word));   // 被违禁词拦过的词不上榜
  // demo = 真实数据还没攒起来，前台据此隐藏统计数字（免得拿推荐词的数字糊弄访客）
  const meta = demo
    ? { demo: true, updated: Date.now(), range: range || 'all' }
    : Object.assign(statsHot(map, range), { demo: false, updated: Date.now(), range: range || 'all' });
  return json({ code: 1, list, meta, range: range || 'all' }, 200, { 'Cache-Control': 'no-store' });
}
