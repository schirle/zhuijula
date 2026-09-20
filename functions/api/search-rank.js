import { makeRoute, json, getClientIP, checkRateLimit } from '../_shared.js';
import { readHotMap, recordHot, topHot, TOP_N, DEFAULT_HOT } from '../_hotrank.js';

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
  const map = await readHotMap(env);
  const list = Object.keys(map).length ? topHot(map, TOP_N) : DEFAULT_HOT;
  return json({ code: 1, list });
}
