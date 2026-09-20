import { makeRoute, json, CORS, destroyAdminSession, adminCookieHeader } from '../../_shared.js';

export const onRequest = makeRoute(handleAdminLogout);

// 退出登录：删除 KV 会话 + 清 Cookie
async function handleAdminLogout(request, _url, context) {
  if (request.method !== 'POST') return json({ code: 0, msg: '仅支持 POST' }, 405);
  const env = context?.env || {};
  await destroyAdminSession(request, env);
  return new Response(JSON.stringify({ code: 1 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json;charset=utf-8', 'Set-Cookie': adminCookieHeader(''), ...CORS },
  });
}
