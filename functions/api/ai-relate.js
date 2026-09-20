import { makeRoute, isAIConfigured, callAI, json, jsonErr, getClientIP, checkRateLimit, resolveEnv } from '../_shared.js';

export const onRequest = makeRoute(handleAiRelate);

// 播放页「AI 相关搜索」：给定片名 → LLM 产出可点击的搜索建议
// （主演其他作品 / 导演其他作品 / 同题材 / 同风格），点击即跳首页检索
// 未配置 AI 时返回基于片名的通用建议
async function handleAiRelate(request, url, context) {
  const ip = getClientIP(request);
  if (!checkRateLimit(ip)) return jsonErr('请求过于频繁，请稍后再试', 429);

  const title = (url.searchParams.get('title') || '').trim();
  if (!title) return jsonErr('缺少片名', 400);
  if (title.length > 100) return jsonErr('片名过长', 400);

  const env = await resolveEnv(context);
  let items = null;
  if (isAIConfigured(env)) {
    items = await callAI([
      { role: 'system', content: '你是影视推荐助手。给定一部影视作品名称，输出观众常搜的“相关搜索”建议。JSON：{"items":[{"label":"展示文案","query":"用于搜索的关键词"}]}，最多6条。覆盖：主演的其他作品、导演的其他作品、同题材/同类型作品、类似风格。只输出 JSON。' },
      { role: 'user', content: '作品：《' + title + '》' },
    ], env);
  }
  if (!items || !Array.isArray(items.items) || !items.items.length) {
    items = { items: [
      { label: '类似《' + title + '》的推荐', query: title + ' 类似' },
      { label: '《' + title + '》同类型', query: title },
      { label: title + ' 主演的其他作品', query: title + ' 主演' },
    ] };
  }

  const out = (items.items || [])
    .slice(0, 8)
    .map(it => ({ label: String(it.label || ''), query: String(it.query || '') }))
    .filter(it => it.query && it.label);
  return json({ code: 1, items: out, ai: isAIConfigured(env) });
}
