import { makeRoute, json, CORS, getClientIP, checkRateLimit, createAdminSession, adminCookieHeader, loadSiteConfig } from '../../_shared.js';

export const onRequest = makeRoute(handleAdminLogin);

// 后台登录：账号密码只来自 CF Pages 环境变量 ADMIN_USER / ADMIN_PASS（按需求仅这两个变量），
// 会话 token 存 KV（7 天有效），HttpOnly Cookie 携带；KV 未绑定则无法登录并明确提示。
async function sha256hex(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
}

async function handleAdminLogin(request, _url, context) {
  if (request.method !== 'POST') return json({ code: 0, msg: '仅支持 POST' }, 405);
  const env = context?.env || {};
  const user = (env.ADMIN_USER || '').toString().trim();
  const pass = (env.ADMIN_PASS || '').toString();
  if (!user || !pass) return json({ code: 0, msg: '服务端未配置 ADMIN_USER / ADMIN_PASS 环境变量' }, 500);
  // 登录爆破防护：每 IP 每分钟 5 次
  if (!checkRateLimit(getClientIP(request), 5, 'adminlogin')) return json({ code: 0, msg: '尝试过于频繁，请稍后再试' }, 429);

  let body = {};
  try { body = await request.json(); } catch (_) {}
  const u = String(body.user || '').trim();
  const p = String(body.pass || '');
  // 哈希后比较，避免时序侧信道
  const [hu, hp] = await Promise.all([sha256hex(u), sha256hex(p)]);
  const [eu, ep] = await Promise.all([sha256hex(user), sha256hex(pass)]);
  if (hu !== eu || hp !== ep) return json({ code: 0, msg: '账号或密码错误' }, 401);

  const token = await createAdminSession(env);
  if (!token) return json({ code: 0, msg: 'KV 未绑定，无法创建会话（请绑定 KV 命名空间，变量名 KV 或 SEARCH_KV）' }, 500);
  // 登录成功同时把后台配置一并返回，避免前端再做一次依赖 Cookie 的二次请求（那次请求若没带上 Cookie 会被静默踢回登录页）
  let cfg = {};
  try { cfg = await loadSiteConfig(env, true); } catch (_) {}
  const env_set = {};
  for (const k of ['AI_API_KEY','AI_MODEL','AI_BASE_URL','NAV_LINKS','PDlist','WP_API_HOST','QUARK_COOKIE','QUARK_DIR','JJSOU_API_KEY','WEB3FORMS_ACCESS_KEY','TMDB_KEY','DAILY_API','ZUIJU_URL']) {
    env_set[k] = !!(env[k] && String(env[k]).trim());
  }
  return new Response(JSON.stringify({ code: 1, cfg, env_set, kv_ready: !!(env.KV || env.SEARCH_KV) }), {
    status: 200,
    headers: { 'Content-Type': 'application/json;charset=utf-8', 'Set-Cookie': adminCookieHeader(token), ...CORS },
  });
}
