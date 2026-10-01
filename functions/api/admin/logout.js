import { makeRoute, json, CORS, destroyAdminSession, adminCookieHeader, getClientIP, checkRateLimit } from '../../_shared.js';

export const onRequest = makeRoute(handleAdminLogout);

async function handleAdminLogout(request, _url, context) {
  if (request.method !== 'POST') return json({ code: 0, msg: '仅支持 POST' }, 405);
  // 登出本身不需要登录态（用来清掉过期 Cookie），但要限流，避免被当成免费接口刷
  if (!checkRateLimit(getClientIP(request), 30, 'logout')) return json({ code: 0, msg: '请求过于频繁' }, 429);
  const env = context?.env || {};
  await destroyAdminSession(request, env);
  return new Response(JSON.stringify({ code: 1 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json;charset=utf-8', 'Set-Cookie': adminCookieHeader(''), ...CORS },
  });
}
