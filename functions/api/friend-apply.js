// 友链申请代理：前端只调本站 /api/friend-apply，由本函数在服务端带上 Web3Forms key 转发。
// key 不出现在前端源码里，避免泄露。
// 配置：在 Cloudflare Pages 后台 Settings → Environment variables 添加 WEB3FORMS_ACCESS_KEY（建议设为 Secret）。

import { resolveEnv } from '../_shared.js';

export async function onRequestPost(context) {
  const { request } = context;
  const env = await resolveEnv(context);
  const apiKey = env.WEB3FORMS_ACCESS_KEY;

  if (!apiKey) {
    return new Response(
      JSON.stringify({ success: false, message: '服务端未配置 Web3Forms key（后台或环境变量）' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, message: '请求格式错误' }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    );
  }

  // 服务端注入 key（覆盖前端任何传入，确保安全）
  payload.access_key = apiKey;

  try {
    const resp = await fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await resp.text();
    return new Response(text, {
      status: resp.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, message: '转发到 Web3Forms 失败' }),
      { status: 502, headers: { 'content-type': 'application/json' } }
    );
  }
}
