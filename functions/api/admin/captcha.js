import { makeRoute, json, CORS, getClientIP, checkRateLimit, captchaCreate } from '../../_shared.js';

export const onRequest = makeRoute(handleCaptcha);

async function handleCaptcha(request, _url, context) {
  if (request.method !== 'GET') return json({ code: 0, msg: '仅支持 GET' }, 405);
  if (!checkRateLimit(getClientIP(request), 30, 'captcha')) return json({ code: 0, msg: '请求过于频繁，请稍后再试' }, 429);
  const { id, q } = await captchaCreate(context?.env || {});
  return new Response(JSON.stringify({ code: 1, id, q }), {
    status: 200,
    headers: { 'Content-Type': 'application/json;charset=utf-8', 'Cache-Control': 'no-store', ...CORS },
  });
}
