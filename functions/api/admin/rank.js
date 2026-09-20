import { makeRoute, json, isAdminRequest, adminDenied, getKV } from '../../_shared.js';
import { readHotMap, writeHotMap, topHot, HOT_KEY } from '../../_hotrank.js';

export const onRequest = makeRoute(handleAdminRank);

// 后台排行榜管理：GET 查看前 50；DELETE ?word=xxx 删单个，不带 word 清空全部
async function handleAdminRank(request, url, context) {
  const env = context?.env || {};
  if (!await isAdminRequest(request, env)) return adminDenied();
  const kv = getKV(env);
  if (!kv) return json({ code: 0, msg: 'KV 未绑定' }, 500);

  if (request.method === 'GET') {
    const map = await readHotMap(env);
    return json({ code: 1, list: topHot(map, 50), total: Object.keys(map).length });
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
