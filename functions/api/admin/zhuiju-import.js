import { makeRoute, json, CFG, isAdminRequest, adminDenied, loadSiteConfig, cfgVal, parseZhuijuData } from '../../_shared.js';

export const onRequest = makeRoute(handleZhuijuImport);

// 后台「从上游导入」：按当前配置的追剧源 URL 拉一次数据，解析成 JSON 返回给后台编辑保存
async function handleZhuijuImport(request, _url, context) {
  if (request.method !== 'POST') return json({ code: 0, msg: '仅支持 POST' }, 405);
  const env = context?.env || {};
  if (!await isAdminRequest(request, env)) return adminDenied();

  const cfg = await loadSiteConfig(env, true);
  const url = cfgVal(cfg, env, 'zhuiju_url', 'ZUIJU_URL') || CFG.ZUIJU_API;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' } });
    if (!r.ok) return json({ code: 0, msg: '上游返回 HTTP ' + r.status }, 502);
    const text = await r.text();
    const data = parseZhuijuData(text);
    if (!data || typeof data !== 'object') return json({ code: 0, msg: '上游数据解析失败（未找到 appData JSON）' }, 502);
    const keys = Object.keys(data);
    return json({ code: 1, url, keys, data });
  } catch (e) {
    return json({ code: 0, msg: '拉取失败：' + (e?.name === 'AbortError' ? '超时' : (e?.message || '网络错误')) }, 502);
  } finally {
    clearTimeout(t);
  }
}
