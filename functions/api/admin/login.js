import { makeRoute, json, CORS, getClientIP, checkRateLimit, createAdminSession, adminCookieHeader, loadSiteConfig, buildEnvSet, loginGuard, loginFail, loginOk, sleep, checkPasswordStrength, captchaVerify } from '../../_shared.js';

export const onRequest = makeRoute(handleAdminLogin);

async function sha256hex(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
}

async function handleAdminLogin(request, _url, context) {
  if (request.method !== 'POST') return json({ code: 0, msg: '请打开后台登录页 /c（或 /console.html）填写账号密码登录，不要直接访问此接口' }, 405);
  const env = context?.env || {};
  const ip = getClientIP(request);

  if (!checkRateLimit(ip, 12, 'adminlogin')) return json({ code: 0, msg: '请求过于频繁，请稍后再试' }, 429);

  let body = {};
  try { body = await request.json(); } catch (_) {}
  const u = String(body.user || '').trim();
  const p = String(body.pass || '');

  const g = await loginGuard(ip, u, env);
  if (!g.ok) {
    return new Response(JSON.stringify({ code: 0, msg: g.msg }), {
      status: 429,
      headers: { 'Content-Type': 'application/json;charset=utf-8', 'Retry-After': String(g.retryAfter), 'Cache-Control': 'no-store', ...CORS },
    });
  }

  const user = (env.ADMIN_USER || '').toString().trim();
  const pass = (env.ADMIN_PASS || '').toString();
  if (!user || !pass) return json({ code: 0, msg: '服务端未配置 ADMIN_USER / ADMIN_PASS 环境变量' }, 500);

  const capOk = await captchaVerify(env, body.cap_id, body.cap_ans);
  if (!capOk) {
    const ipCount = await loginFail(ip, u, env);
    await sleep(Math.min(800 + ipCount * 200, 3000));
    return new Response(JSON.stringify({ code: 0, msg: '验证码错误或已过期，请重新输入' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json;charset=utf-8', 'Cache-Control': 'no-store', ...CORS },
    });
  }

  const weak = checkPasswordStrength(pass);
  if (weak) {
    await loginFail(ip, u, env);
    return new Response(JSON.stringify({ code: 0, msg: weak }), {
      status: 403,
      headers: { 'Content-Type': 'application/json;charset=utf-8', 'Cache-Control': 'no-store', ...CORS },
    });
  }

  const [hu, hp] = await Promise.all([sha256hex(u), sha256hex(p)]);
  const [eu, ep] = await Promise.all([sha256hex(user), sha256hex(pass)]);
  const ok = (hu === eu && hp === ep);

  if (!ok) {
    const ipCount = await loginFail(ip, u, env);
    await sleep(Math.min(1500 + ipCount * 400, 6000));
    return new Response(JSON.stringify({ code: 0, msg: '账号或密码错误' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json;charset=utf-8', 'Cache-Control': 'no-store', ...CORS },
    });
  }

  await loginOk(ip, u, env);
  const token = await createAdminSession(env);
  if (!token) return json({ code: 0, msg: 'D1 未绑定，无法创建会话（请在 Pages 项目设置里绑定 D1 数据库，变量名 DB）' }, 500);
  let cfg = {};
  try { cfg = await loadSiteConfig(env, true); } catch (_) {}
  const env_set = buildEnvSet(env);
  return new Response(JSON.stringify({ code: 1, cfg, env_set, db_ready: !!(env.DB || env.D1) }), {
    status: 200,
    headers: { 'Content-Type': 'application/json;charset=utf-8', 'Set-Cookie': adminCookieHeader(token), 'Cache-Control': 'no-store', ...CORS },
  });
}
