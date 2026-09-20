import { makeRoute, json, isAdminRequest, adminDenied, getKV } from '../../_shared.js';
import { readHotMap, writeHotMap, readHotTs, topHot, HOT_KEY, pruneHot } from '../../_hotrank.js';

export const onRequest = makeRoute(handleAdminRank);

// 后台排行榜管理：GET 查看（支持 range=day/week/month）；DELETE ?word=xxx 删单个（不带则清空全部）；POST 手动清理 >30 天数据
async function handleAdminRank(request, url, context) {
  const env = context?.env || {};
  if (!await isAdminRequest(request, env)) return adminDenied();
  const kv = getKV(env);
  if (!kv) return json({ code: 0, msg: 'KV 未绑定' }, 500);

  if (request.method === 'POST') {
    const removed = await pruneHot(env);
    return json({ code: 1, msg: '已清理 ' + removed + ' 个过期搜索词（>30 天）', removed });
  }

  if (request.method === 'GET') {
    await pruneHot(env); // 后台查看时顺手清理过期数据
    const map = await readHotMap(env);
    const range = url.searchParams.get('range');
    let list;
    if (range && ['day', 'week', 'month'].includes(range)) {
      const tsMap = await readHotTs(env);
      list = topHot(map, 50, range, tsMap);
    } else {
      list = topHot(map, 50);
    }
    return json({ code: 1, list, total: Object.keys(map).length, range: range || 'all' });
  }

  if (request.method === 'DELETE') {
    const word = (url.searchParams.get('word') || '').trim();
    const map = await readHotMap(env);
    if (word) delete map[word]; else for (const k of Object.keys(map)) delete map[k];
    const ok = await writeHotMap(env, map);
    if (!ok) return json({ code: 0, msg: 'KV 写入失败' }, 500);
    return json({ code: 1, msg: word ? '已删除：' + word : '已清空', key: HOT_KEY });
  }

  return json({ code: 0, msg: '不支持的方法' }, 405);
}
