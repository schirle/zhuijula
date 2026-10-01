import { makeRoute, json, isAdminRequest, adminDenied, getKV } from '../../_shared.js';
import { readHotMap, writeHotMap, topHot, HOT_KEY, HOT_MAX_AGE_MS, pruneHot } from '../../_hotrank.js';

export const onRequest = makeRoute(handleAdminRank);

async function handleAdminRank(request, url, context) {
  const env = context?.env || {};
  if (!await isAdminRequest(request, env)) return adminDenied();
  const kv = getKV(env);
  if (!kv) return json({ code: 0, msg: 'D1 未绑定' }, 500);

  if (request.method === 'POST') {
    const removed = await pruneHot(env, HOT_MAX_AGE_MS, true);
    return json({ code: 1, msg: '已清理 ' + removed + ' 个词（30 天前的旧词 + 单字符/纯符号等无效词）', removed });
  }

  if (request.method === 'GET') {
    await pruneHot(env);
    const map = await readHotMap(env);
    const range = url.searchParams.get('range');
    const list = (range && ['day', 'week', 'month'].includes(range))
      ? topHot(map, 50, range)
      : topHot(map, 50);
    return json({ code: 1, list, total: Object.keys(map).length, range: range || 'all' });
  }

  if (request.method === 'DELETE') {
    const word = (url.searchParams.get('word') || '').trim();
    const map = await readHotMap(env);
    if (word) delete map[word]; else for (const k of Object.keys(map)) delete map[k];
    const ok = await writeHotMap(env, map);
    if (!ok) return json({ code: 0, msg: 'D1 写入失败' }, 500);
    return json({ code: 1, msg: word ? '已删除：' + word : '已清空', key: HOT_KEY });
  }

  return json({ code: 0, msg: '不支持的方法' }, 405);
}
