import { makeRoute, json, getClientIP, checkRateLimit } from '../_shared.js';
async function handleFriendApply(request, _url, context) {
  if (request.method !== 'POST') return json({ success: false, message: '仅支持 POST' }, 405);
  if (!checkRateLimit(getClientIP(request), 10, 'friendapply')) return json({ success: false, message: '请求过于频繁，请稍后再试' }, 429);
  const env = context?.env || {};
  const apiKey = env.WEB3FORMS_ACCESS_KEY;
  if (!apiKey) return json({ success: false, message: '服务端未配置 Web3Forms key（后台或环境变量）' }, 500);
  let payload;
  try {
    payload = await request.json();
  } catch (_) {
    return json({ success: false, message: '请求格式错误' }, 400);
  }
  payload.access_key = apiKey;
  try {
    const resp = await fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await resp.text();
    return new Response(text, { status: resp.status, headers: { 'content-type': 'application/json' } });
  } catch (_) {
    return json({ success: false, message: '转发到 Web3Forms 失败' }, 502);
  }
}
export const onRequest = makeRoute(handleFriendApply);
