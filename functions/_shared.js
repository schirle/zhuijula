// ══════════════════════════════════════════════
// 共享核心：配置、工具、数据加载
// ══════════════════════════════════════════════

export const CFG = {
  TIMEOUT_MS: 12000,
  CACHE_TTL_SEC: 600,
  MAX_RETRIES: 2,
  SEARCH_CONCURRENCY: 10,
  DETAIL_CONCURRENCY: 8,
  SEARCH_RATE_LIMIT: 30,
  RATE_WINDOW_SEC: 60,
  FAIL_BACKOFF_SEC: 15,
};

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
};

export const DOUBAN_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Referer': 'https://m.douban.com/',
};

// ── 响应工具 ──
export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json;charset=utf-8', ...CORS },
  });
export const jsonErr = (msg, status = 502) => json({ code: 0, msg }, status);

// ════════════════════════════════════════════════
// KV 站点配置 + 后台鉴权
// 绑定一个 KV 命名空间即可（变量名 KV 或 SEARCH_KV 均可识别）。
// CF Pages 环境变量只保留 ADMIN_USER / ADMIN_PASS（后台登录账号），
// 其余全部动态配置（AI、网盘转存、片单、导航、追剧数据源等）都在后台页维护，
// 存于 KV 的 site_config；环境变量作为兜底（后台留空的项自动回退环境变量）。
// ════════════════════════════════════════════════
// 进程内内存 KV 兜底：仅在本地 wrangler pages dev 且未绑定真实 KV 时启用，
// 让本地也能登录 / 保存配置进行调试（重启即清空）。线上绑定 KV 后自动走真实 KV，不受影响。
const _memKV = (() => {
  const m = new Map();
  return { get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, String(v)); }, delete: async (k) => { m.delete(k); } };
})();
export const getKV = (env) => (env && (env.KV || env.SEARCH_KV)) || _memKV;
const SITE_CONFIG_KEY = 'site_config';

let _cfgCache = null, _cfgTs = 0;
export async function loadSiteConfig(env, fresh = false) {
  const kv = getKV(env);
  if (!kv) return {};
  const now = Date.now();
  if (!fresh && _cfgCache && now - _cfgTs < 15000) return _cfgCache; // 进程内短缓存，省 KV 读取额度
  try {
    const t = await kv.get(SITE_CONFIG_KEY);
    const cfg = t ? (JSON.parse(t) || {}) : {};
    _cfgCache = cfg; _cfgTs = now;
    return cfg;
  } catch (_) { return _cfgCache || {}; }
}

export async function saveSiteConfig(env, cfg) {
  const kv = getKV(env);
  if (!kv) return false;
  try {
    await kv.put(SITE_CONFIG_KEY, JSON.stringify(cfg || {}));
    _cfgCache = cfg || {}; _cfgTs = Date.now(); // 本隔离实例立即生效
    return true;
  } catch (_) { return false; }
}

// 配置项读取优先级：KV（后台设置）> 环境变量；均未配置返回 ''
export function cfgVal(cfg, env, kvKey, envKey) {
  const a = cfg?.[kvKey];
  if (a != null && String(a).trim() !== '') return String(a).trim();
  const b = env?.[envKey || kvKey.toUpperCase()];
  if (b != null && String(b).trim() !== '') return String(b).trim();
  return '';
}

// 后台可维护的配置项 → 兼容的环境变量名（老部署不变也能跑）
const CONFIG_ENV_MAP = {
  nav_links: 'NAV_LINKS',
  pdlist: 'PDlist',
  wp_api_host: 'WP_API_HOST',
  quark_cookie: 'QUARK_COOKIE',
  quark_dir: 'QUARK_DIR',
  baidu_cookie: 'BAIDU_COOKIE',
  baidu_dir: 'BAIDU_DIR',
  jjsou_api_key: 'JJSOU_API_KEY',
  web3forms_access_key: 'WEB3FORMS_ACCESS_KEY',
  daily_api: 'DAILY_API',
  zhuiju_url: 'ZUIJU_URL',
};

// 后台环境变量兜底提示：统一所有后台会读取的环境变量，返回是否已设置（不泄露值）。
// 单点定义，避免 /api/admin/login 与 /api/admin/config 各自硬编码键集导致不一致（前端徽标漏显）。
export const buildEnvSet = (env) => {
  const set = {};
  for (const ek of Object.values(CONFIG_ENV_MAP)) set[ek] = !!(env[ek] && String(env[ek]).trim());
  return set;
};

// 返回「KV 配置覆盖后的 env」：各 API 顶部 await resolveEnv(context)，之后照常 env.XXX
export async function resolveEnv(context) {
  const env = context?.env || {};
  const cfg = await loadSiteConfig(env);
  const merged = { ...env };
  for (const [k, ek] of Object.entries(CONFIG_ENV_MAP)) {
    const v = cfgVal(cfg, env, k, ek);
    if (v) merged[ek] = v;
  }
  merged._siteCfg = cfg;
  return merged;
}

// ── 后台会话（KV 存储，7 天有效；HttpOnly Cookie 携带 token）──
const ADMIN_COOKIE = 'ftv_admin_sess';
const ADMIN_SESSION_TTL = 7 * 86400;
const randHex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('');

export async function createAdminSession(env) {
  const kv = getKV(env);
  if (!kv) return null;
  const token = randHex(32);
  try { await kv.put('admin_sess_' + token, '1', { expirationTtl: ADMIN_SESSION_TTL }); } catch (_) { return null; }
  return token;
}

export async function isAdminRequest(request, env) {
  const kv = getKV(env);
  if (!kv) return false;
  const m = (request.headers.get('Cookie') || '').match(new RegExp('(?:^|;\\s*)' + ADMIN_COOKIE + '=([a-f0-9]{32,128})'));
  if (!m) return false;
  try { return !!(await kv.get('admin_sess_' + m[1])); } catch (_) { return false; }
}

export async function destroyAdminSession(request, env) {
  const kv = getKV(env);
  if (!kv) return;
  const m = (request.headers.get('Cookie') || '').match(new RegExp('(?:^|;\\s*)' + ADMIN_COOKIE + '=([a-f0-9]{32,128})'));
  if (m) { try { await kv.delete('admin_sess_' + m[1]); } catch (_) {} }
}

export const adminCookieHeader = (token) => token
  ? `${ADMIN_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ADMIN_SESSION_TTL}`
  : `${ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
export const adminDenied = () => json({ code: 0, msg: '未登录或登录已过期' }, 401);

// ── 缓存读写（统一封装，避免各 handler 重复样板）──
export const cacheGet = async (key) => {
  try { return await caches.default.match(new Request(key)); } catch (_) { return null; }
};
export const cachePut = async (key, res) => {
  if (!res) return;
  try { await caches.default.put(new Request(key), res.clone()); } catch (_) { }
};

// 统一「命中缓存 → 生成 JSON → 写 Cache-Control → 落 CDN 缓存」流程，消除各 handler 重复样板
export async function cachedJson(keyReq, data, { smax = 120, maxAge = 60, stale = 3600 } = {}) {
  const res = json(data);
  res.headers.set('Cache-Control', `public, s-maxage=${smax}, max-age=${maxAge}, stale-while-revalidate=${stale}`);
  await cachePut(keyReq, res);
  return res;
}

// 豆瓣接口专用 fetch（复用通用 fetch：超时 + 失败返回 null；4xx/网络错误均归一为 null）
export const fetchDoubanJson = async (url, timeout = 10000) => {
  const r = await fetchWithRetry(url, { timeout, headers: DOUBAN_HEADERS, retries: 0, asJson: true });
  return (r && !r._error) ? r : null;
};

// 统一路由包装：处理 OPTIONS 预检 + 异常兜底
// 用法：export const onRequest = makeRoute((request, url, context) => handleXxx(request, url));
export function makeRoute(handler) {
  return async function onRequest(context) {
    const { request } = context;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    try {
      return await handler(request, url, context);
    } catch (err) {
      console.error('[api] error:', err?.message, err?.stack);
      return jsonErr('服务器内部错误', 500);
    }
  };
}

// ── 通用并发控制 ──
export async function asyncPool(limit, items, fn) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      try { results[i] = await fn(items[i], i); } catch (e) { results[i] = null; }
    }
  });
  await Promise.all(workers);
  return results;
}

const isErr = v => v && typeof v === 'object' && v._error;

// ── 通用 fetch（超时 + 重试 + 指数退避）──
export async function fetchWithRetry(url, { timeout = 12000, retries = 1, headers = BROWSER_HEADERS, asJson = false } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const r = await fetch(url, { headers, signal: ctrl.signal });
      if (r.status >= 400 && r.status < 500) throw new Error(`HTTP ${r.status}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      if (asJson) {
        try { return await r.json(); } catch { return { _error: true, _msg: 'invalid json' }; }
      }
      return await r.text();
    } catch (e) {
      lastErr = e;
      if (lastErr.message?.startsWith('HTTP 4')) break;
      if (i < retries) await new Promise(r => setTimeout(r, 500 << i));
    } finally {
      clearTimeout(timer);
    }
  }
  if (asJson) return { _error: true, _msg: lastErr?.message || 'fetch failed' };
  return { _error: true, _msg: lastErr?.message || 'fetch failed' };
}

// ── IP 限流 ──（scope 用于隔离不同接口的计数桶，避免互相挤占额度）
const rateBuckets = new Map();
export function checkRateLimit(ip, limit = CFG.SEARCH_RATE_LIMIT, scope = 'search') {
  const now = Date.now();
  const key = scope + '|' + ip + ':' + Math.floor(now / (CFG.RATE_WINDOW_SEC * 1000));
  const count = (rateBuckets.get(key) || 0) + 1;
  rateBuckets.set(key, count);
  if (rateBuckets.size > 5000) {
    const expire = Math.floor(now / (CFG.RATE_WINDOW_SEC * 1000)) - 2;
    for (const k of rateBuckets.keys()) {
      if (parseInt(k.split(':')[1]) < expire) rateBuckets.delete(k);
    }
  }
  return count <= limit;
}
export function getClientIP(request) {
  return request.headers.get('CF-Connecting-IP') ||
         request.headers.get('X-Real-IP') ||
         request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
         '0.0.0.0';
}

// ═══════════════════════════════════════════════
// 追剧数据加载（带缓存、防重入、失败退避）
// ═══════════════════════════════════════════════
let API_SOURCES = {};
let _zhuijuData = null, _zhuijuTs = 0, _zhuijuRunning = null, _zhuijuFailCount = 0, _zhuijuFailTs = 0;
let _overrideVer = null; // 后台自定义数据的版本号（zhuiju_updated），变更即热加载

function extractBalancedJson(text, marker) {
  const start = text.indexOf(marker);
  if (start < 0) return null;
  let i = start + marker.length;
  while (i < text.length && (text[i] === '=' || text[i] === ':' || text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++;
  const open = text[i];
  if (open !== '{' && open !== '[') return null;
  const closeSym = open === '{' ? '}' : ']';
  const openIdx = i;
  let depth = 0, inStr = null, escaped = false;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === open) depth++;
    else if (c === closeSym) {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(openIdx, i + 1)); } catch (_) { return null; }
      }
    }
  }
  return null;
}

function parseZhuijuData(text) {
  const data = extractBalancedJson(text, 'appData');
  if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try { return JSON.parse(trimmed); } catch (_) {}
  }
  const fi = text.indexOf('{'), li = text.lastIndexOf('}');
  if (fi >= 0 && li > fi) {
    try { return JSON.parse(text.slice(fi, li + 1)); } catch (_) {}
  }
  return null;
}
export { parseZhuijuData };

function syncApiSources(data) {
  const jk = data['jiekou-list'];
  if (!Array.isArray(jk) || !jk.length) return;
  const src = {};
  for (const item of jk) {
    if (!item?.url) continue;
    const k = (item.alias || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (k) src[k] = item.url;
  }
  if (Object.keys(src).length) API_SOURCES = src;
}
export const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'src';

async function loadZhuiju(env) {
  const now = Date.now();
  const ttl = CFG.CACHE_TTL_SEC * 1000;

  // 0) 后台自定义数据（KV site_config.zhuiju_data）优先：完全不依赖上游，保存即生效
  if (env) {
    const cfg = env._siteCfg || await loadSiteConfig(env);
    // 后台「播放源」结构化配置：直接注入搜索源（独立于上游，上游挂了也能用）
    if (Array.isArray(cfg?.play_sources) && cfg.play_sources.length) {
      syncApiSources({ 'jiekou-list': cfg.play_sources.map(s => ({
        alias: String(s.alias || '').trim() || slugify(String(s.name || '')),
        name: String(s.name || ''),
        url: String(s.url || ''),
      })) });
    }
    const override = (cfg && cfg.zhuiju_data && typeof cfg.zhuiju_data === 'object' && !Array.isArray(cfg.zhuiju_data))
      ? cfg.zhuiju_data : null;
    if (override) {
      const ver = String(cfg.zhuiju_updated || '1');
      if (ver !== _overrideVer) {
        syncApiSources(override);
        const copy = { ...override };
        delete copy['jiekou-list'];
        if (Object.keys(API_SOURCES).length) {
          _zhuijuData = copy; _zhuijuTs = now; _overrideVer = ver;
          _zhuijuFailCount = 0; _zhuijuFailTs = 0;
        }
      }
      if (_overrideVer === ver && _zhuijuData) return _zhuijuData;
      // 自定义数据缺播放源（jiekou-list）→ 继续走上游兜底
    } else if (_overrideVer !== null) {
      _overrideVer = null; // 后台清空自定义数据，恢复上游模式
    }
  }

  if (_zhuijuData && (now - _zhuijuTs) < ttl) return _zhuijuData;
  if (!_zhuijuData && (now - _zhuijuFailTs) < CFG.FAIL_BACKOFF_SEC * 1000) return null;
  if (_zhuijuRunning) return await _zhuijuRunning;

  const zUrl = (env && env.ZUIJU_URL) ? String(env.ZUIJU_URL).trim() : '';
  if (!zUrl) { _zhuijuFailTs = now; return null; } // 未配置数据源（需后台设置 ZUIJU_URL），不请求内置默认地址

  _zhuijuRunning = (async () => {
    try {
      let text = null, fromCache = false;
      try {
        const c = await caches.default.match(ZUIJU_REQ(zUrl));
        if (c) { text = await c.text(); fromCache = true; }
      } catch (_) {}
      if (!text) {
        const fresh = await fetchWithRetry(zUrl, { timeout: 12000, retries: 2 });
        if (!isErr(fresh)) { text = fresh; await cachePutZhuiju(zUrl, fresh); }
      }
      if (!text) { _zhuijuFailCount++; _zhuijuFailTs = now; return _zhuijuData; } // 无新数据且有旧缓存时返回旧数据兜底，避免上游抖动导致整站不可用
      const data = parseZhuijuData(text);
      if (data) { syncApiSources(data); }
      delete data['jiekou-list'];
      if (Object.keys(API_SOURCES).length === 0) {
        _zhuijuFailCount++; _zhuijuFailTs = now; return _zhuijuData; // 解析出数据但无可用源：返回旧缓存兜底
      }
      _zhuijuData = data; _zhuijuTs = now;
      _zhuijuFailCount = 0; _zhuijuFailTs = 0;
      if (fromCache) refreshZhuiju(zUrl).catch(() => {});
      return data;
    } catch (e) {
      _zhuijuFailCount++; _zhuijuFailTs = now; return _zhuijuData; // 异常时返回旧缓存兜底
    }
  })();
  try { return await _zhuijuRunning; } finally { _zhuijuRunning = null; }
}

const ZUIJU_REQ = (url) => new Request(url);
async function cachePutZhuiju(url, text) {
  try {
    await caches.default.put(ZUIJU_REQ(url), new Response(text, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=600' },
    }));
  } catch (_) {}
}
async function refreshZhuiju(url) {
  const fresh = await fetchWithRetry(url, { timeout: 12000, retries: 2 });
  if (isErr(fresh)) return;
  const data = parseZhuijuData(fresh);
  if (data) { syncApiSources(data); }
  delete data['jiekou-list'];
  if (Object.keys(API_SOURCES).length) {
    _zhuijuData = data; _zhuijuTs = Date.now(); _zhuijuFailCount = 0; _zhuijuFailTs = 0;
  }
  await cachePutZhuiju(url, fresh);
}

export async function ensureSources(env) {
  if (Object.keys(API_SOURCES).length) return true;
  await loadZhuiju(env);
  return Object.keys(API_SOURCES).length > 0;
}

// ── 搜索结果直接走边缘缓存（cachedJson），不再维护进程内 _searchCache，省内存且多实例一致 ──

export async function doSearch(wd) {
  let entries = Object.entries(API_SOURCES);
  const MAX_SEARCH_SOURCES = 16;
  if (entries.length > MAX_SEARCH_SOURCES) entries = entries.slice(0, MAX_SEARCH_SOURCES);

  // 不去重合并：按各源返回完成的先后顺序收集（越快越靠前），同一部剧不同源分别成条
  const buckets = [];
  let okSources = 0;
  let finishOrder = 0;

  // 总体截止时间：无论多少源未返回，最多等待这么久就返回已就绪结果，避免极端情况下整页卡死
  const OVERALL_DEADLINE = 6000;
  const firstPhase = asyncPool(CFG.SEARCH_CONCURRENCY, entries, async ([name, base]) => {
    const u = `${base}?wd=${encodeURIComponent(wd)}&page=1`;
    const data = await fetchWithRetry(u, { timeout: 8000, retries: 1, asJson: true });
    if (!data || data._error) return;
    // 标准成功码为 1；若源返回非 1 但带有有效列表，也视为成功（避免个别源 code 字段异常被误杀）
    const validList = Array.isArray(data.list) && data.list.length > 0;
    if (String(data.code) !== '1' && !validList) return;
    okSources++;
    const items = (data.list || []).filter(it => it.vod_id).map(it => ({ ...it, _api_source: name }));
    if (items.length) buckets.push({ order: finishOrder++, items });
  });
  await Promise.race([firstPhase, new Promise(r => setTimeout(r, OVERALL_DEADLINE))]);

  // 按源返回速度排序（快的排前面），再展开
  buckets.sort((a, b) => a.order - b.order);
  const all = [];
  for (const b of buckets) for (const it of b.items) all.push(it);
  if (all.length > 240) all.length = 240;
  if (!all.length) return { code: 1, list: [], total: 0 };

  const needPic = all.filter(it => !it.vod_pic);
  if (needPic.length) {
    const needBySrc = {};
    for (const it of needPic) (needBySrc[it._api_source] ??= []).push(it.vod_id);
    const picMap = new Map();
    await asyncPool(CFG.DETAIL_CONCURRENCY, Object.entries(needBySrc), async ([src, ids]) => {
      const base = API_SOURCES[src];
      if (!base) return;
      const data = await fetchWithRetry(`${base}?ac=detail&ids=${ids.join(',')}`, { timeout: 5000, asJson: true });
      if (!data._error && String(data.code) === '1' && Array.isArray(data.list)) {
        for (const d of data.list) {
          if (d.vod_id && d.vod_pic) picMap.set(`${src}_${d.vod_id}`, d.vod_pic);
        }
      }
    });
    for (const it of needPic) {
      const p = picMap.get(`${it._api_source}_${it.vod_id}`);
      if (p) it.vod_pic = p;
    }
  }
  // 若有源未成功返回（超时被丢弃等），标记为残缺，避免长缓存污染后续请求
  const partial = okSources < entries.length;
  return { code: 1, list: all, total: all.length, _partial: partial };
}

// ═══════════════════════════════════════════════
// API 处理器
// ═══════════════════════════════════════════════

// ── 搜索 ──
export async function handleSearch(request, url, context) {
  const ip = getClientIP(request);
  if (!checkRateLimit(ip)) return jsonErr('请求过于频繁，请稍后再试', 429);
  const wd = (url.searchParams.get('key') || '').trim();
  if (!wd) return jsonErr('请输入关键词', 400);
  if (wd.length > 100) return jsonErr('搜索关键词过长', 400);
  const env = await resolveEnv(context);
  if (!await ensureSources(env)) return jsonErr('数据源未就绪', 503);

  const ckey = new Request(url.origin + '/api/search?key=' + encodeURIComponent(wd));
  const hit = await cacheGet(ckey); if (hit) return hit;
  const result = await doSearch(wd);
  // 残缺结果（有源失败）只短缓存，尽快重试；完整结果长缓存
  const maxAge = result._partial ? 15 : 120;
  return cachedJson(ckey, result, { smax: maxAge, maxAge: 60, stale: 600 });
}

// ── 详情 ──
export async function handleDetail(request, url, context) {
  const ids = (url.searchParams.get('ids') || '').trim();
  if (!ids) return jsonErr('缺少影片ID', 400);
  await ensureSources(await resolveEnv(context));
  const form = (url.searchParams.get('form') || '').trim();
  const base = API_SOURCES[form] || Object.values(API_SOURCES)[0];
  if (!base) return jsonErr('数据源未就绪，请返回首页刷新后再试', 503);
  const ckey = new Request(url.origin + url.pathname + url.search);
  const hit = await cacheGet(ckey); if (hit) return hit;
  const data = await fetchWithRetry(`${base}?ac=detail&ids=${encodeURIComponent(ids)}`, { timeout: 8000, asJson: true });
  if (data._error) return jsonErr('获取详情超时，请重试', 502);
  return cachedJson(ckey, data, { smax: 300, maxAge: 120, stale: 3600 });
}

// ── 今日推荐 ──
export async function handleDaily(request, url, context) {
  const env = await resolveEnv(context);
  const api = env.DAILY_API || '';
  // 不再内置第三方默认源：未配置 DAILY_API 时返回空列表，数据完全由后台/环境变量提供
  if (!api) return cachedJson(new Request(url.origin + '/__daily__'), { code: 1, list: [], total: 0 }, { smax: 60, maxAge: 60, stale: 300 });
  const data = await fetchWithRetry(api, { timeout: 8000, retries: 1, asJson: true });
  if (data._error) return jsonErr('推荐数据加载失败', 502);
  return cachedJson(new Request(url.origin + '/__daily__'), data, { smax: 600, maxAge: 300, stale: 1800 });
}

// ── 豆瓣热门（电影最近热门 + 剧集地区榜单）──
// 剧集地区榜单：type → j/search_subjects 的 tag（实测可用）
const DOUBAN_TV_TAG = {
  '韩剧': '韩剧',
  '日剧': '日剧',
  '美剧': '美剧',
  '英剧': '英剧',
  '国产剧': '国产剧',
};
export async function handleDoubanHot(request, url) {
  const type = (url.searchParams.get('type') || '全部').trim();
  const start = parseInt(url.searchParams.get('start') || '0', 10) || 0;
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 50);
  const cacheKey = new Request(url.origin + '/__douban_hot__/' + encodeURIComponent(type) + '/' + start + '/' + limit);
  const hit = await cacheGet(cacheKey); if (hit) return hit;

  // 剧集地区榜单走 j/search_subjects（稳定）；电影/全部也走 j/search_subjects（比 rexxar 更稳定）
  const tag = DOUBAN_TV_TAG[type];
  let apiUrl;
  if (tag) {
    const page = Math.floor(start / Math.max(limit, 1)) + 1;
    apiUrl = `https://movie.douban.com/j/search_subjects?type=tv&tag=${encodeURIComponent(tag)}&page_limit=${limit}&page=${page}`;
  } else {
    // 电影类（含『全部』）走 j/search_subjects，比 rexxar recent_hot 更稳定
    const DOUBAN_MOVIE_TAG = { '全部': '热门', '热门': '热门', '最新': '最新', '经典': '经典', '可播放': '可播放', '豆瓣高分': '豆瓣高分', '冷门佳片': '冷门佳片' };
    const movieTag = DOUBAN_MOVIE_TAG[type] || '热门';
    const moviePage = Math.floor(start / Math.max(limit, 1)) + 1;
    apiUrl = `https://movie.douban.com/j/search_subjects?type=movie&tag=${encodeURIComponent(movieTag)}&page_limit=${limit}&page=${moviePage}`;
  }
  const data = await fetchWithRetry(apiUrl, { timeout: 8000, headers: DOUBAN_HEADERS, retries: 1, asJson: true });
  if (data._error) return jsonErr('豆瓣数据加载失败，请稍后重试', 502);

  // recent_hot 返回 { items }；search_subjects 返回 { subjects: [{ title, rate, cover }] }；subject_collection 返回 { items: [{ subject }] }
  let subjects = Array.isArray(data?.items) ? data.items
    : Array.isArray(data?.subjects) ? data.subjects : [];
  if (!subjects.length) return cachedJson(cacheKey, { code: 1, list: [], total: 0, type }, { smax: 604800, maxAge: 604800, stale: 604800 });
  const list = subjects.map(s => ({
    id: s.id || '', title: s.title || '', rating: s.rating?.value || (typeof s.rating === 'number' ? s.rating : 0) || (parseFloat(s.rate) || 0),
    year: s.year || '', genres: s.genres || [],
    directors: (s.directors || []).map(d => d.name).filter(Boolean).join(' / '),
    cast: (s.cast || []).map(c => c.name).filter(Boolean).join(' / '),
    pic: (s.pic?.normal || s.pic?.large || s.cover?.url || s.cover_url || s.cover || s.image || '').trim(),
    url: s.url || (s.uri ? s.uri.replace('douban://douban.com', 'https://movie.douban.com') : `https://movie.douban.com/subject/${s.id}/`),
    card_subtitle: s.card_subtitle || (Array.isArray(s.countries) ? s.countries.join(' / ') : ''),
  }));
  return cachedJson(cacheKey, { code: 1, list, total: list.length, type }, { smax: 604800, maxAge: 604800, stale: 604800 });
}

// ── TMDB 地区剧集热播榜（免费公开 API，key 存环境变量 TMDB_KEY，前端不暴露）──
const TMDB_REGION = { kr: 'KR', jp: 'JP', us: 'US', tw: 'TW', gb: 'GB', cn: 'CN' };
export async function handleRank(request, url, context) {
  const region = (url.searchParams.get('region') || 'kr').toLowerCase();
  const country = TMDB_REGION[region] || TMDB_REGION.kr;
  const env = await resolveEnv(context);
  const key = env.TMDB_KEY || '';
  if (!key) return jsonErr('未配置 TMDB_KEY（后台或环境变量）', 503);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 50);
  // 时间窗：默认近 90 天首播，保证是「最新在播」而非历年老剧；range=week/month/season 可切换
  const rangeMap = { week: 7, month: 30, season: 90 };
  const days = rangeMap[(url.searchParams.get('range') || '').toLowerCase()] || 7;
  const d = new Date(Date.now() - days * 86400000);
  const gte = d.toISOString().slice(0, 10);
  const cacheKey = new Request(url.origin + '/__tmdb_rank__/' + country + '/' + days + '/' + limit);
  const hit = await cacheGet(cacheKey); if (hit) return hit;
  // 限定近 N 天首播 + 按热度排序；翻多页凑足近期在播剧（小语种近期剧集少）
  const collected = [];
  let page = 1;
  while (page <= 3 && collected.length < limit) {
    const apiUrl = 'https://api.themoviedb.org/3/discover/tv?api_key=' + encodeURIComponent(key) +
      '&with_origin_country=' + country + '&sort_by=popularity.desc&language=zh-CN' +
      '&first_air_date.gte=' + gte + '&page=' + page;
    const data = await fetchWithRetry(apiUrl, { timeout: 9000, retries: 1, asJson: true });
    if (data._error) break;
    const arr = Array.isArray(data?.results) ? data.results : [];
    if (!arr.length) break;
    collected.push(...arr);
    if (collected.length >= limit || (data.total_pages && page >= Math.min(data.total_pages, 3))) break;
    page++;
  }
  const results = collected;
  if (!results.length) return cachedJson(cacheKey, { code: 1, list: [], total: 0, region, country, range: days }, { smax: 43200, maxAge: 43200, stale: 43200 });
  const list = results.slice(0, limit).map(s => {
    const poster = s.poster_path ? ('https://image.tmdb.org/t/p/w342' + s.poster_path) : '';
    return {
      id: s.id || '',
      title: s.name || s.original_name || '',
      rating: s.vote_average || 0,
      year: (s.first_air_date || '').slice(0, 4),
      overview: s.overview || '',
      pic: poster ? ('/api/img?u=' + encodeURIComponent(poster)) : '',
    };
  });
  return cachedJson(cacheKey, { code: 1, list, total: list.length, region, country, range: days }, { smax: 43200, maxAge: 43200, stale: 43200 });
}

// ── 站点配置（顶部导航优先取后台 KV 配置的 nav_links，其次 Cloudflare 环境变量 NAV_LINKS(JSON)，最后回退默认）──
// 示例 NAV_LINKS：[{"key":"app","href":"/app","icon":"fa-download","label":"APP下载"},{"key":"vip","href":"/vip","icon":"fa-bolt","label":"VIP视频解析"}]
export async function handleConfig(request, url, context) {
  const env = await resolveEnv(context);
  let cfg = {};
  try { cfg = await loadSiteConfig(env, true); } catch (_) {}
  let nav = [];
  const cleanNav = (arr) => (Array.isArray(arr) ? arr : [])
    .filter(it => it && typeof it === 'object')
    .map(it => {
      const href = String(it.href || '#').trim();
      const key = String(it.key || '').trim() || href.replace(/^\//, '').split('/')[0] || '';
      return {
        key,
        href,
        icon: String(it.icon || 'fa-link').trim(),
        label: String(it.label || '').trim(),
      };
    })
    .filter(it => it.label && it.href);
  if (cleanNav(cfg.nav_links).length) nav = cleanNav(cfg.nav_links);
  else if (env.NAV_LINKS) {
    try { const p = JSON.parse(env.NAV_LINKS); if (cleanNav(p).length) nav = cleanNav(p); } catch (_) { /* 配置非法时回退默认 */ }
  }
  // 不再内置默认导航：后台/环境变量未配置时返回空数组，导航完全由运营在后台设置
  return cachedJson(new Request(url.origin + '/__config__'), {
    code: 1, nav,
    nav_links: Array.isArray(cfg.nav_links) ? cfg.nav_links : [],
    carousels: Array.isArray(cfg.carousels) ? cfg.carousels : [],
    stats_code: cfg.stats_code || '',
    vip_jx: Array.isArray(cfg.vip_jx) ? cfg.vip_jx : [],
    first_popup: (cfg.first_popup && typeof cfg.first_popup === 'object') ? cfg.first_popup : null,
    promo_ad: (cfg.promo_ad && typeof cfg.promo_ad === 'object') ? cfg.promo_ad : null,
  }, { smax: 300, maxAge: 300, stale: 3600 });
}

// ── 图片代理（项目自有兜底：任意图片源均可代理；仅作访图用途，带 SSRF 基础防护）──
// gimg0.baidu.com 仅作首选加速、不消耗自有配额；/api/img 才是真正兜底，需支持任意图
const isPrivateIP = s => {
  const p = String(s).split('.').map(Number);
  if (p.length !== 4 || p.some(n => Number.isNaN(n) || n > 255)) return false;
  return p[0] === 10 || p[0] === 127 || p[0] === 0 ||
         (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
         (p[0] === 192 && p[1] === 168) ||
         (p[0] === 169 && p[1] === 254) ||
         (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
};
const isSafeImgHost = host => {
  host = String(host || '').toLowerCase();
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === 'ip6-localhost') return false;
  if (host === 'metadata.google.internal' || host === 'metadata') return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return !isPrivateIP(host);
  return true; // 公网域名交由 Cloudflare 网络层限制，拒绝非预期内网访问
};
export async function handleImgProxy(request, url) {
  const raw = (url.searchParams.get('u') || '').trim();
  if (!raw) return jsonErr('缺少图片地址', 400);
  let target;
  try { target = new URL(raw); } catch (_) { return jsonErr('图片地址无效', 400); }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return jsonErr('协议不支持', 400);
  if (!isSafeImgHost(target.hostname)) return jsonErr('不支持的图片源', 403);
  // 先查缓存再限流：命中缓存不消耗额度（否则一个首页几十张图会打满 120/分钟 导致整页图片 429 空白）
  const cacheKey = new Request(url.origin + '/__imgproxy__?u=' + encodeURIComponent(target.href));
  const hit = await cacheGet(cacheKey); if (hit) return hit;
  if (!checkRateLimit(getClientIP(request), 600, 'img')) return jsonErr('请求过于频繁，请稍后再试', 429);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    // 豆瓣图床有 Referer 防盗链：带 movie.douban.com 来源更易通过；其余站点用自身 origin
    const isDouban = /(^|\.)doubanio\.com$|(^|\.)douban\.com$/.test(target.hostname);
    const upstream = await fetch(target.href, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': isDouban ? 'https://movie.douban.com/' : target.origin + '/',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });
    if (!upstream.ok) return jsonErr('图片获取失败 (' + upstream.status + ')', 502);
    const ct = upstream.headers.get('Content-Type') || '';
    if (!ct.startsWith('image/')) return jsonErr('非图片内容', 403);
    const body = await upstream.arrayBuffer();
    if (body.byteLength > 10 * 1024 * 1024) return jsonErr('图片过大', 413);
    const res = new Response(body, {
      status: 200,
      headers: { 'Content-Type': ct, 'Cache-Control': 'public, max-age=1296000, s-maxage=1296000, stale-while-revalidate=1296000', ...CORS },
    });
    await cachePut(cacheKey, res);
    return res;
  } catch (e) { return jsonErr('图片代理失败', 502); }
  finally { clearTimeout(timer); }
}

// ── 友链列表 ──
export async function handleFriendList(request, url, context) {
  const env = await resolveEnv(context);
  // 后台「其他设置 → 友链」优先（运营随时增删，无需改上游数据）
  const cfg = env._siteCfg || await loadSiteConfig(env, true);
  const cacheKey = new Request(url.origin + '/__friend__');
  if (Array.isArray(cfg.links) && cfg.links.length) {
    const list = cfg.links
      .map(l => ({ name: String(l.name || '').trim(), url: String(l.url || '').trim() }))
      .filter(l => l.name && l.url);
    if (list.length) return cachedJson(cacheKey, { code: 1, list }, { smax: 300, maxAge: 300, stale: 3600 });
  }
  // 兜底：回退上游追剧数据里的 friend-list
  const data = await loadZhuiju(env);
  if (!data) return jsonErr('数据加载失败', 502);
  const list = Array.isArray(data['friend-list']) ? data['friend-list'] : [];
  return cachedJson(cacheKey, { code: 1, list }, { smax: 300, maxAge: 300, stale: 3600 });
}

// ── 福利列表（fuli-list：name 分类 / title 标题 / link 链接）──
// 福利分类由运营随时增删，故实时拉取最新数据（仅 CDN 缓存 60s），避免旧缓存导致页面停留在死数据
export async function handleFuli(request, url, context) {
  const env = await resolveEnv(context);
  const cfg = env._siteCfg || {};
  let list = null;
  // 后台自定义数据优先
  const override = cfg.zhuiju_data;
  if (override && typeof override === 'object' && Array.isArray(override['fuli-list'])) {
    list = override['fuli-list'];
  }
  if (!list) {
    const zUrl = (env && env.ZUIJU_URL) ? String(env.ZUIJU_URL).trim() : '';
    if (zUrl) {
      try {
        const fresh = await fetchWithRetry(zUrl, { timeout: CFG.TIMEOUT_MS, retries: 1 });
        if (!isErr(fresh)) {
          const parsed = extractBalancedJson(fresh, 'fuli-list');
          if (Array.isArray(parsed)) list = parsed;
          else if (parsed && Array.isArray(parsed['fuli-list'])) list = parsed['fuli-list'];
        }
      } catch (_) {}
    }
  }
  // 兜底：回退到已加载的追剧全量缓存
  if (!list) {
    const data = await loadZhuiju(env);
    if (data && Array.isArray(data['fuli-list'])) list = data['fuli-list'];
  }
  if (!list || !list.length) return jsonErr('福利数据加载失败', 502);
  return cachedJson(new Request(url.origin + '/__fuli__'), { code: 1, list }, { smax: 60, maxAge: 0, stale: 120 });
}

// ── 追剧全数据 ──
export async function handleZhuiju(request, url, context) {
  const env = await resolveEnv(context);
  const data = await loadZhuiju(env);
  const cfg = env._siteCfg || await loadSiteConfig(env);
  let out = (data && typeof data === 'object') ? data : {};
  if (cfg && typeof cfg === 'object') {
    // 后台「首页轮播」结构化配置优先于上游 carousel-list
    if (Array.isArray(cfg.carousels) && cfg.carousels.length) {
      out = { ...out, 'carousel-list': cfg.carousels.map(c => ({
        pic: String(c.pic || ''),
        link: String(c.link || ''),
        mode: c.mode === 'external' ? 'external' : 'search',
      })) };
    }
    if (cfg.site_name) out.site_name = cfg.site_name;
    if (cfg.site_desc) out.site_desc = cfg.site_desc;
    // 后台「APP页」结构化配置优先于上游 android-list / ios-list（ut 为最近新增/修改时间，仅用于前端「新」角标判断）
    if (Array.isArray(cfg.android_apps) && cfg.android_apps.length) {
      out['android-list'] = cfg.android_apps.map(a => ({
        name: String(a.name || ''),
        pic: String(a.image || ''),
        methods: (Array.isArray(a.methods) ? a.methods : [])
          .filter(m => m && m.url)
          .map(m => ({ type: String(m.type || ''), url: String(m.url || '') })),
        ut: Number(a.updated_at || a.created_at || 0) || undefined,
      })).filter(a => a.name);
    }
    if (Array.isArray(cfg.ios_apps) && cfg.ios_apps.length) {
      out['ios-list'] = cfg.ios_apps.map(a => ({
        name: String(a.name || ''),
        pic: String(a.image || ''),
        link: String(a.link || ''),
        copy: String(a.copy || ''),
        text: String(a.text || ''),
        ut: Number(a.updated_at || a.created_at || 0) || undefined,
      })).filter(a => a.name);
    }
  }
  if (!out || !Object.keys(out).length) return jsonErr('数据加载失败，请稍后刷新重试', 502);
  return cachedJson(new Request(url.origin + '/__zhuiju__'), out, { smax: 60, maxAge: 30, stale: 600 });
}


