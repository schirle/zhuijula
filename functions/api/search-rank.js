import { makeRoute, json, getClientIP, checkRateLimit } from '../_shared.js';
import { readHotMap, readHotTs, recordHot, topHot, TOP_N, DEFAULT_HOT, pruneHot } from '../_hotrank.js';

export const onRequest = makeRoute(handleSearchRank);

// 全站「搜索排行榜」：聚合所有用户真实搜索词，做成公共热搜榜（点词条直接搜）
// 存储走 KV（后台可管理），未绑定 KV 时自动降级为静态推荐词，功能不中断、不报错。
export async function handleSearchRank(request, url, context) {
  const env = context?.env || {};
  const recordWord = url.searchParams.get('record');
  if (recordWord) {
    if (!checkRateLimit(getClientIP(request))) return json({ code: 0, msg: '请求过于频繁' }, 429);
    await recordHot(env, recordWord);
  }
  const range = url.searchParams.get('range');
  // n：单页返回条数，用于 rank 页展示更多（最多 30，防止超大响应）；缺省沿用 TOP_N
  const nParam = parseInt(url.searchParams.get('n'), 10);
  const n = (Number.isFinite(nParam) && nParam > 0) ? Math.min(nParam, 30) : TOP_N;
  await pruneHot(env); // 自动清理超过 30 天的搜索词（每次查询顺手执行）
  const map = await readHotMap(env);
  const tsMap = range ? await readHotTs(env) : null;
  let list;
  if (Object.keys(map).length) {
    list = topHot(map, n, range, tsMap);
    if (range && !list.length) list = topHot(map, n); // 该时间窗口暂无数据，回退累计榜
  } else {
    list = DEFAULT_HOT.slice(0, n);
  }
  return json({ code: 1, list, range: range || 'all' });
}
