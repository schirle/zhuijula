import { makeRoute, json, resolveEnv, isAdminRequest, adminDenied, getClientIP, checkRateLimit } from '../../_shared.js';
import { panList, panDelete } from '../transfer.js';

// 后台「网盘文件管理」：列目录 + 删除勾选项。
// 只做这两件事，且必须已登录后台；删除的永远只是站长自己勾中的条目。
async function handlePan(request, url, context) {
  const env = await resolveEnv(context);
  if (!checkRateLimit(getClientIP(request), 20, 'panadmin')) {
    return json({ code: 0, msg: '操作太频繁，请稍等几秒再试' }, 429);
  }
  if (!await isAdminRequest(request, env)) return adminDenied();

  const type = (url.searchParams.get('type') || 'quark').trim();
  const dir = (url.searchParams.get('dir') || '').trim();
  const action = (url.searchParams.get('action') || 'list').trim();
  if (type === 'baidu') {
    return json({ code: 0, msg: '百度网盘不支持在线管理（接口限制，删除会被风控拦截），请到百度网盘 App / 网页里手动删除' }, 400);
  }
  if (!['quark', 'uc'].includes(type)) return json({ code: 0, msg: '网盘类型不正确' }, 400);

  if (action === 'list') {
    const r = await panList(env, type, dir);
    return json({ code: r.ok ? 1 : 0, ok: !!r.ok, dir: r.dir || '', items: r.items || [], msg: r.why || '' });
  }
  if (action === 'del') {
    const ids = (url.searchParams.get('ids') || '').split('|').map((s) => s.trim()).filter(Boolean);
    if (!ids.length) return json({ code: 0, msg: '没有选中要删除的项目' }, 400);
    if (ids.length > 200) return json({ code: 0, msg: '一次最多删 200 项，请分批操作' }, 400);
    const r = await panDelete(env, type, dir, ids);
    return json({ code: r.ok ? 1 : 0, ok: !!r.ok, deleted: r.ok ? ids.length : 0, msg: r.msg });
  }
  return json({ code: 0, msg: '不支持的操作' }, 400);
}

export const onRequest = makeRoute(handlePan);
