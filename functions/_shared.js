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
export const json = (data, status = 200, headers) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json;charset=utf-8', ...CORS, ...(headers || {}) },
  });
export const jsonErr = (msg, status = 502) => json({ code: 0, msg }, status);
const _memKV = (() => {
  const m = new Map();
  return { get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, String(v)); }, delete: async (k) => { m.delete(k); } };
})();
export const getKV = (env) => {
  const db = env && (env.DB || env.D1);
  if (db && typeof db.prepare === 'function') return d1KV(db);
  return _memKV;
};
let _kvTableReady = null;
function ensureKvTable(db) {
  if (!_kvTableReady) {
    _kvTableReady = (async () => {
      try { await db.prepare('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, exp INTEGER)').run(); } catch (_) {}
      try { await db.prepare('ALTER TABLE kv ADD COLUMN exp INTEGER').run(); } catch (_) {}
    })();
  }
  return _kvTableReady;
}
function d1KV(db) {
  const ensure = () => ensureKvTable(db);
  return {
    get: async (k) => {
      await ensure();
      try {
        const r = await db.prepare('SELECT v FROM kv WHERE k = ? AND (exp IS NULL OR exp > ?)').bind(String(k), Date.now()).first();
        return r ? r.v : null;
      } catch (_) { return null; }
    },
    put: async (k, v, opts) => {
      await ensure();
      const exp = opts && opts.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : null;
      try {
        await db.prepare('INSERT INTO kv (k, v, exp) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, exp = excluded.exp')
          .bind(String(k), String(v), exp).run();
      } catch (_) {}
    },
    delete: async (k) => {
      await ensure();
      try { await db.prepare('DELETE FROM kv WHERE k = ?').bind(String(k)).run(); } catch (_) {}
    },
  };
}
const SITE_CONFIG_KEY = 'site_config';
let _cfgCache = null, _cfgTs = 0;
export async function loadSiteConfig(env, fresh = false) {
  const kv = getKV(env);
  if (!kv) return {};
  const now = Date.now();
  if (!fresh && _cfgCache && now - _cfgTs < 30000) return _cfgCache;
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
    _cfgCache = cfg || {}; _cfgTs = Date.now();
    return true;
  } catch (_) { return false; }
}
export function cfgVal(cfg, env, kvKey, envKey) {
  const a = cfg?.[kvKey];
  if (a != null && String(a).trim() !== '') return String(a).trim();
  const b = env?.[envKey || kvKey.toUpperCase()];
  if (b != null && String(b).trim() !== '') return String(b).trim();
  return '';
}
const CONFIG_ENV_MAP = {
nav_links: 'NAV_LINKS',
  wp_api_host: 'WP_API_HOST',
  quark_cookie: 'QUARK_COOKIE',
  quark_dir: 'QUARK_DIR',
  baidu_cookie: 'BAIDU_COOKIE',
  baidu_dir: 'BAIDU_DIR',
  uc_cookie: 'UC_COOKIE',
  uc_dir: 'UC_DIR',
  search_banned: 'SEARCH_BANNED',
  web3forms_access_key: 'WEB3FORMS_ACCESS_KEY',
  daily_api: 'DAILY_API',
  purge_skip_min: 'PURGE_SKIP_MIN',
  zhuiju_url: 'ZUIJU_URL',
};
export const buildEnvSet = (env) => {
  const set = {};
  for (const ek of Object.values(CONFIG_ENV_MAP)) set[ek] = !!(env[ek] && String(env[ek]).trim());
  return set;
};
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
  // 跨站请求直接拒绝：浏览器发起的跨站写请求一定会带 Origin，主机名不一致就是 CSRF 尝试。
  //（Cookie 本身是 SameSite=Lax，这里再加一层纵深防御）
  try {
    const org = request.headers.get('Origin');
    if (org) {
      const reqHost = new URL(request.url).host;
      let orgHost = '';
      try { orgHost = new URL(org).host; } catch (_) { orgHost = ''; }
      if (!orgHost || orgHost !== reqHost) return false;
    }
  } catch (_) { /* 解析异常放行，交给下面的 token 校验 */ }
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
const LOGIN_MAX_PER_IP = 6;
const LOGIN_MAX_PER_USER = 10;
const LOGIN_WINDOW_SEC = 15 * 60;
const _loginFailMem = new Map();
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const safeJson = (s) => { try { const o = JSON.parse(s); return (o && typeof o === 'object') ? o : null; } catch (_) { return null; } };
async function loginCounter(kv, key) {
  const now = Date.now();
  let v;
  if (kv) {
    let raw = null;
    try { raw = await kv.get(key); } catch (_) {}
    v = safeJson(raw);
  } else {
    v = _loginFailMem.get(key);
  }
  if (!v || now > (v.reset || 0)) v = { count: 0, reset: now + LOGIN_WINDOW_SEC * 1000 };
  return v;
}
async function setLoginCounter(kv, key, v) {
  if (kv) { try { await kv.put(key, JSON.stringify(v), { expirationTtl: LOGIN_WINDOW_SEC + 120 }); } catch (_) {} }
  else _loginFailMem.set(key, v);
}
export async function loginGuard(ip, user, env) {
  const kv = getKV(env);
  const ipC = await loginCounter(kv, 'lf_ip:' + ip);
  const usC = await loginCounter(kv, 'lf_user:' + (user || '?'));
  const now = Date.now();
  if (ipC.count >= LOGIN_MAX_PER_IP) {
    const retry = Math.max(1, Math.ceil((ipC.reset - now) / 1000));
    return { ok: false, retryAfter: retry, msg: `该 IP 尝试次数过多，已被临时锁定，请约 ${Math.ceil(retry / 60)} 分钟后再试` };
  }
  if (usC.count >= LOGIN_MAX_PER_USER) {
    const retry = Math.max(1, Math.ceil((usC.reset - now) / 1000));
    return { ok: false, retryAfter: retry, msg: '该账号尝试次数过多，已被临时锁定，请稍后再试' };
  }
  return { ok: true };
}
export async function loginFail(ip, user, env) {
  const kv = getKV(env);
  let ipCount = 0;
  for (const key of ['lf_ip:' + ip, 'lf_user:' + (user || '?')]) {
    const c = await loginCounter(kv, key);
    c.count++;
    if (key === 'lf_ip:' + ip) ipCount = c.count;
    await setLoginCounter(kv, key, c);
  }
  return ipCount;
}
export async function loginOk(ip, user, env) {
  const kv = getKV(env);
  for (const key of ['lf_ip:' + ip, 'lf_user:' + (user || '?')]) {
    if (kv) { try { await kv.delete(key); } catch (_) {} }
    else _loginFailMem.delete(key);
  }
}
export function checkPasswordStrength(p) {
  p = String(p || '');
  if (p.length < 6) return '后台密码过弱：请到 Cloudflare 变量 ADMIN_PASS 设置至少 6 位的密码';
  return null;
}
const CAPTCHA_TTL_SEC = 300;
const _captchaMem = new Map();
export async function captchaCreate(env) {
  const r = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
  const usePlus = Math.random() < 0.5;
  let a, b, ans;
  if (usePlus) {
    a = r(10, 79);
    b = r(10, Math.min(89, 99 - a));
    ans = a + b;
  } else {
    a = r(10, 99);
    b = r(10, a);
    ans = a - b;
  }
  const id = 'cap_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const kv = getKV(env);
  if (kv) { try { await kv.put('cap:' + id, String(ans), { expirationTtl: CAPTCHA_TTL_SEC }); } catch (_) {} }
  _captchaMem.set(id, { ans, exp: Date.now() + CAPTCHA_TTL_SEC * 1000 });
  const now = Date.now();
  for (const [k, v] of _captchaMem) { if (now > v.exp) _captchaMem.delete(k); }
  return { id, q: `${a} ${usePlus ? '+' : '-'} ${b} = ?` };
}
export async function captchaVerify(env, id, answer) {
  id = String(id || ''); answer = String(answer || '').trim();
  if (!id || !answer) return false;
  const kv = getKV(env);
  let ans = null;
  if (kv) { try { ans = await kv.get('cap:' + id); } catch (_) {} }
  if (ans == null) {
    const m = _captchaMem.get(id);
    if (m && Date.now() < m.exp) ans = String(m.ans);
  }
  if (kv) { try { await kv.delete('cap:' + id); } catch (_) {} }
  _captchaMem.delete(id);
  return ans != null && answer === String(ans);
}
export const cacheGet = async (key) => {
  try { return await caches.default.match(new Request(key)); } catch (_) { return null; }
};
export const cachePut = async (key, res) => {
  if (!res) return;
  try { await caches.default.put(new Request(key), res.clone()); } catch (_) { }
};
export async function purgeSiteCaches(origin) {
  const keys = ['/__friend__v2', '/__config__', '/__zhuiju__', '/__daily__', '/__widgets__'];
  try {
    await Promise.all(keys.map(k => caches.default.delete(new Request(origin + k)).catch(() => false)));
  } catch (_) {  }
}
export async function cachedJson(keyReq, data, { smax = 120, maxAge = 60, stale = 3600 } = {}) {
  const res = json(data);
  res.headers.set('Cache-Control', `public, s-maxage=${smax}, max-age=${maxAge}, stale-while-revalidate=${stale}`);
  await cachePut(keyReq, res);
  return res;
}
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
let API_SOURCES = {};
let _zhuijuData = null, _zhuijuTs = 0, _zhuijuRunning = null, _zhuijuFailCount = 0, _zhuijuFailTs = 0;
let _overrideVer = null;
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
  if (env) {
    const cfg = env._siteCfg || await loadSiteConfig(env);
    // 播放源**只认后台「播放设置」里填的**：站点不自带、也不从别处偷偷补。
    // 后台清空后这里会把上一次的残留一起清掉，避免"删了却还在用"。
    if (Array.isArray(cfg?.play_sources) && cfg.play_sources.length) {
      syncApiSources({ 'jiekou-list': cfg.play_sources.map(s => ({
        alias: String(s.alias || '').trim() || slugify(String(s.name || '')),
        name: String(s.name || ''),
        url: String(s.url || ''),
      })) });
    } else if (!(cfg && cfg.zhuiju_data)) {
      API_SOURCES = {};
    }
    const override = (cfg && cfg.zhuiju_data && typeof cfg.zhuiju_data === 'object' && !Array.isArray(cfg.zhuiju_data))
      ? cfg.zhuiju_data : null;
    if (override) {
      const ver = String(cfg.zhuiju_updated || '1');
      if (ver !== _overrideVer) {
        // 自定义数据同样只用来填 APP 页等展示内容，里面的播放源不参与搜索
        const copy = { ...override };
        delete copy['jiekou-list'];
        _zhuijuData = copy; _zhuijuTs = now; _overrideVer = ver;
        _zhuijuFailCount = 0; _zhuijuFailTs = 0;
      }
      if (_overrideVer === ver && _zhuijuData) return _zhuijuData;
    } else if (_overrideVer !== null) {
      _overrideVer = null; // 后台清空自定义数据，恢复远端模式
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
      delete data['jiekou-list'];   // 这份远端数据只用来填 APP 页列表，不参与播放源
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
  if (!data) return;
  delete data['jiekou-list'];   // 同 loadZhuiju：只用于 APP 页列表
  _zhuijuData = data; _zhuijuTs = Date.now(); _zhuijuFailCount = 0; _zhuijuFailTs = 0;
  await cachePutZhuiju(url, fresh);
}
export async function ensureSources(env) {
  if (Object.keys(API_SOURCES).length) return true;
  await loadZhuiju(env);
  return Object.keys(API_SOURCES).length > 0;
}
export async function doSearch(wd) {
  let entries = Object.entries(API_SOURCES);
  const MAX_SEARCH_SOURCES = 16;
  if (entries.length > MAX_SEARCH_SOURCES) entries = entries.slice(0, MAX_SEARCH_SOURCES);
  const buckets = [];
  let okSources = 0;
  let finishOrder = 0;
  const OVERALL_DEADLINE = 6000;
  const ENOUGH_ITEMS = 48;
  let got = 0, finished = 0, enoughReached = false;
  let _resolveEnough;
  const enough = new Promise(r => { _resolveEnough = r; });
  const firstPhase = asyncPool(CFG.SEARCH_CONCURRENCY, entries, async ([name, base]) => {
    const u = `${base}?wd=${encodeURIComponent(wd)}&page=1`;
    const data = await fetchWithRetry(u, { timeout: 8000, retries: 1, asJson: true });
    if (!data || data._error) { finished++; if (finished >= entries.length) _resolveEnough(); return; }
    const validList = Array.isArray(data.list) && data.list.length > 0;
    if (String(data.code) !== '1' && !validList) { finished++; if (finished >= entries.length) _resolveEnough(); return; }
    okSources++;
    const items = (data.list || []).filter(it => it.vod_id).map(it => ({ ...it, _api_source: name }));
    if (items.length) {
      buckets.push({ order: finishOrder++, items });
      got += items.length;
      if (got >= ENOUGH_ITEMS) { enoughReached = true; _resolveEnough(); }
    }
    finished++;
    if (finished >= entries.length) _resolveEnough();
  });
  await Promise.race([firstPhase, enough, new Promise(r => setTimeout(r, OVERALL_DEADLINE))]);
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
  const partial = !enoughReached && okSources < entries.length;
  return { code: 1, list: all, total: all.length, _partial: partial };
}
export function bannedWordsOf(env) {
  const raw = String((env && env.SEARCH_BANNED) || '').trim();
  if (!raw) return [];
  return [...new Set(raw.split(/[\n\r,，;；|、\s]+/).map((s) => s.trim()).filter(Boolean))];
}
export function bannedHit(env, word) {
  const w = String(word || '').toLowerCase();
  if (!w) return '';
  for (const b of bannedWordsOf(env)) {
    if (w.includes(String(b).toLowerCase())) return b;
  }
  return '';
}
// ── 搜索防刷 / 配额保护 ──────────────────────────────────────
// 每次搜索 = 1 次 Functions 调用（免费额度 10 万次/天），所以不光要防刷榜，更要防"把配额刷光"：
//   ① 同一个 IP 在 10 分钟内重复搜同一个词 → 只第一次计入热搜榜（搜索结果照常返回）
//   ② 1 分钟内搜索超过 10 次，或同一个词 10 分钟内搜了 5 次以上 → 要求过验证码
//   ③ 同一个 IP 每天搜索超过 200 次（超出后要验证码，400 次后直接拒绝）—— 防单点刷爆配额
//   ④ 全站每天搜索超过 4 万次 → 一律要求验证码（把剩下的额度留给正常访客）
// 正常访客一天的搜索次数是个位数，上面任何一条都碰不到。
const SEARCH_GUARD = new Map();
const SG_WINDOW_MS = 60 * 1000;
const SG_DUP_MS = 10 * 60 * 1000;
const SG_DUP_MAX = 5;
const SG_COOL_MS = 10 * 60 * 1000;
const SG_OK_MS = 30 * 60 * 1000;
// 下面这些默认值都可以在后台「搜索排行 → 搜索防刷与配额」里改（留空即用默认）
const SD_DEF = {
  all: 40000,      // 全站每天搜索上限（超过后一律要验证码）
  ip: 200,         // 同一个 IP 每天搜索上限（超过后要验证码）
  ipHard: 400,     // 同一个 IP 每天硬上限（超过后当天直接拒绝）
  rateMin: 10,     // 每分钟搜索超过多少次就要验证码
  hotPerDay: 300,  // 同一个词每天最多计入榜单多少
};
const posInt = (v, dflt) => {
  const n = parseInt(String(v == null ? '' : v).trim(), 10);
  return (Number.isFinite(n) && n > 0) ? n : dflt;
};
export function searchLimits(env) {
  const cfg = (env && env._siteCfg && typeof env._siteCfg === 'object') ? env._siteCfg : {};
  return {
    all: posInt(cfgVal(cfg, env, 'search_daily_all', 'SEARCH_DAILY_ALL'), SD_DEF.all),
    ip: posInt(cfgVal(cfg, env, 'search_daily_ip', 'SEARCH_DAILY_IP'), SD_DEF.ip),
    ipHard: posInt(cfgVal(cfg, env, 'search_daily_ip_hard', 'SEARCH_DAILY_IP_HARD'), SD_DEF.ipHard),
    rateMin: posInt(cfgVal(cfg, env, 'search_rate_min', 'SEARCH_RATE_MIN'), SD_DEF.rateMin),
    hotPerDay: posInt(cfgVal(cfg, env, 'hot_max_per_day', 'HOT_MAX_PER_DAY'), SD_DEF.hotPerDay),
  };
}
function searchGuard(ip) {
  const now = Date.now();
  let g = SEARCH_GUARD.get(ip);
  if (!g) {
    g = { start: now, n: 0, words: new Map(), coolUntil: 0, okUntil: 0 };
    SEARCH_GUARD.set(ip, g);
  }
  if (SEARCH_GUARD.size > 5000) {
    for (const [k, v] of SEARCH_GUARD) {
      if (now - v.start > 30 * 60 * 1000) SEARCH_GUARD.delete(k);
    }
  }
  return g;
}
const dayStamp = () => new Date(Date.now() + 28800000).toISOString().slice(0, 10);   // 东八区日期
// IP 不落库明文：只存一个短哈希，用于按 IP 计数
const hashIp = (ip) => {
  let h = 5381;
  const s = String(ip || '');
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
};
let _gDay = '', _gBuf = 0, _gCount = 0;
// 全站计数：攒够 25 次再落库一次，避免每次搜索都读写数据库
async function bumpGlobalSearches(kv) {
  const day = dayStamp();
  if (_gDay !== day) { _gDay = day; _gBuf = 0; _gCount = 0; }
  _gBuf++;
  if (_gBuf >= 25) {
    _gBuf = 0;
    const key = 'sqt:' + day;
    try {
      let n = Number(await kv.get(key)) || 0;
      n += 25;
      await kv.put(key, String(n), { expirationTtl: 2 * 86400 });
      _gCount = n;
    } catch (_) { /* 计数失败不影响搜索 */ }
  }
  return _gCount;
}
export async function handleSearch(request, url, context) {
  const ip = getClientIP(request);
  if (!checkRateLimit(ip, 20, 'search')) return jsonErr('搜索太频繁，请稍后再试', 429);
  const wd = (url.searchParams.get('key') || '').trim();
  if (!wd) return jsonErr('请输入关键词', 400);
  if (wd.length > 100) return jsonErr('搜索关键词过长', 400);
  const env = await resolveEnv(context);
  if (bannedHit(env, wd)) return json({ code: 0, msg: '无法搜索该关键词，请更换关键词后再试' });
  const LIM = searchLimits(env);   // 限额都取后台「搜索防刷与配额」里的设置

  // 防刷判定（在缓存判断之前做，缓存命中的请求同样受管）
  const now = Date.now();
  const g = searchGuard(ip);
  if (now - g.start > SG_WINDOW_MS) { g.start = now; g.n = 0; }
  g.n++;
  const prev = g.words.get(wd);
  const rec = (prev && typeof prev === 'object') ? prev : { ts: 0, n: 0 };
  const dupInWindow = (now - rec.ts) < SG_DUP_MS;
  const countIt = !dupInWindow;                     // ① 时间窗内重复搜同一个词 → 不重复计入榜单
  const nextN = dupInWindow ? rec.n + 1 : 1;
  if (g.n > LIM.rateMin || nextN > SG_DUP_MAX) {
    g.coolUntil = Math.max(g.coolUntil, now + SG_COOL_MS);   // ② 触发验证码
  }
  g.words.set(wd, { ts: now, n: nextN });
  if (g.words.size > 60) {                          // 只留最近的词，避免内存膨胀
    const cut = now - SG_DUP_MS;
    for (const [w, v] of g.words) { if ((v && v.ts ? v.ts : 0) < cut) g.words.delete(w); }
  }
  // ③④ 按量配额（走数据库，跨实例都算数）：单 IP 每日 / 全站每日
  let ipUsed = 0;
  const kv = getKV(env);
  if (kv) {
    try {
      const ipKey = 'sq:' + dayStamp() + ':' + hashIp(ip);
      ipUsed = (Number(await kv.get(ipKey)) || 0) + 1;
      await kv.put(ipKey, String(ipUsed), { expirationTtl: 2 * 86400 });
    } catch (_) { ipUsed = 0; }
    const allUsed = await bumpGlobalSearches(kv);
    if (ipUsed > LIM.ip || allUsed > LIM.all) {
      g.coolUntil = Math.max(g.coolUntil, now + SG_COOL_MS);
    }
  }
  // 单 IP 一天刷到这个数就直接停：再多也不能让你把全站配额吃掉
  if (ipUsed > LIM.ipHard) {
    try { console.warn('[search] 单 IP 每日搜索超限：' + hashIp(ip) + ' 共 ' + ipUsed + ' 次'); } catch (_) { /* 忽略 */ }
    return jsonErr('今日搜索次数已达上限，请明天再试', 429);
  }
  if (g.coolUntil > now && g.okUntil < now) {
    const ok = await captchaVerify(env, url.searchParams.get('cap_id'), url.searchParams.get('cap_ans'));
    if (!ok) {
      const c = await captchaCreate(env);
      return json({ code: 2, need_captcha: true, cap_id: c.id, cap_q: c.q, msg: '搜索太频繁，请完成验证后继续' }, 200, { 'Cache-Control': 'no-store' });
    }
    g.okUntil = now + SG_OK_MS;                     // 验证通过，半小时内不再打扰
  }
  // 站点不自带播放源：一个都没配置时直接说明原因（站长去后台「播放设置」加一个即可）
  if (!await ensureSources(env)) return jsonErr('站点尚未添加播放源，暂时无法搜索（站长可在后台「播放设置」中添加）', 503);
  // 顺手记录热搜词：原来由前端额外打一次 /api/search-rank?record=，
  // 现在直接在搜索接口里写入，省掉一次 Functions 调用。
  // 同一个 IP 时间窗内重复搜同一个词时 countIt=false，不再重复计数（防刷榜）。
  if (countIt) {
    try {
      const { recordHot } = await import('./_hotrank.js');
      await recordHot(env, wd, LIM.hotPerDay);   // 同一个词每天最多计这么多次（后台可改）
    } catch (_) { /* 记录失败不影响搜索 */ }
  }
  const ckey = new Request(url.origin + '/api/search?key=' + encodeURIComponent(wd));
  const hit = await cacheGet(ckey); if (hit) return hit;
  const result = await doSearch(wd);
  const maxAge = result._partial ? 15 : 120;
  return cachedJson(ckey, result, { smax: maxAge, maxAge: 60, stale: 600 });
}
export async function handleDetail(request, url, context) {
  // 详情页每次访问打一条，正常访客远低于此；限流只挡脚本刷接口
  if (!checkRateLimit(getClientIP(request), 120, 'detail')) return jsonErr('请求过于频繁，请稍后再试', 429);
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
export async function handleDaily(request, url, context) {
  if (!checkRateLimit(getClientIP(request), 60, 'daily')) return jsonErr('请求过于频繁，请稍后再试', 429);
  const env = await resolveEnv(context);
  const api = env.DAILY_API || '';
  if (!api) return cachedJson(new Request(url.origin + '/__daily__'), { code: 1, list: [], total: 0, disabled: true }, { smax: 60, maxAge: 60, stale: 300 });
  const data = await fetchWithRetry(api, { timeout: 8000, retries: 2, asJson: true });
  if (data._error) {
    try {
      const last = await getKV(env).get('daily_last');
      if (last) {
        const j = JSON.parse(last);
        if (j && j.mov_title) return new Response(JSON.stringify(j), { headers: { 'content-type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
      }
    } catch (_) {  }
    return jsonErr('推荐数据加载失败', 502);
  }
  try { await getKV(env).put('daily_last', JSON.stringify(data), { expirationTtl: 604800 }); } catch (_) {  }
  if (data._error) return jsonErr('推荐数据加载失败', 502);
  return cachedJson(new Request(url.origin + '/__daily__'), data, { smax: 600, maxAge: 300, stale: 1800 });
}
const DOUBAN_TV_TAG = {
  '韩剧': '韩剧',
  '日剧': '日剧',
  '美剧': '美剧',
  '英剧': '英剧',
  '国产剧': '国产剧',
};
export async function handleDoubanHot(request, url) {
  if (!checkRateLimit(getClientIP(request), 120, 'hot')) return jsonErr('请求过于频繁，请稍后再试', 429);
  const type = (url.searchParams.get('type') || '全部').trim();
  const start = parseInt(url.searchParams.get('start') || '0', 10) || 0;
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 50);
  const cacheKey = new Request(url.origin + '/__douban_hot__/' + encodeURIComponent(type) + '/' + start + '/' + limit);
  const hit = await cacheGet(cacheKey); if (hit) return hit;
  const tag = DOUBAN_TV_TAG[type];
  let apiUrl;
  if (tag) {
    const page = Math.floor(start / Math.max(limit, 1)) + 1;
    apiUrl = `https://movie.douban.com/j/search_subjects?type=tv&tag=${encodeURIComponent(tag)}&page_limit=${limit}&page=${page}`;
  } else {
    const DOUBAN_MOVIE_TAG = { '全部': '热门', '热门': '热门', '最新': '最新', '经典': '经典', '可播放': '可播放', '豆瓣高分': '豆瓣高分', '冷门佳片': '冷门佳片' };
    const movieTag = DOUBAN_MOVIE_TAG[type] || '热门';
    const moviePage = Math.floor(start / Math.max(limit, 1)) + 1;
    apiUrl = `https://movie.douban.com/j/search_subjects?type=movie&tag=${encodeURIComponent(movieTag)}&page_limit=${limit}&page=${moviePage}`;
  }
  const data = await fetchWithRetry(apiUrl, { timeout: 8000, headers: DOUBAN_HEADERS, retries: 1, asJson: true });
  if (data._error) return jsonErr('豆瓣数据加载失败，请稍后重试', 502);
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
export async function handleConfig(request, url, context) {
  if (!checkRateLimit(getClientIP(request), 120, 'config')) return jsonErr('请求过于频繁，请稍后再试', 429);
  const env = await resolveEnv(context);
  let cfg = (env._siteCfg && typeof env._siteCfg === 'object') ? env._siteCfg : {};
  if (!Object.keys(cfg).length) {
    try { cfg = await loadSiteConfig(env); } catch (_) { cfg = {}; }
  }
  return cachedJson(new Request(url.origin + '/__config__'), {
    code: 1,
    nav_links: Array.isArray(cfg.nav_links) ? cfg.nav_links : [],
    carousels: Array.isArray(cfg.carousels) ? cfg.carousels : [],
    site_name: cfg.site_name || '',
    site_desc: cfg.site_desc || '',
    site_icon: cfg.site_icon || '',
    link_reqs: cfg.link_reqs || '',
    userscript_name: cfg.userscript_name || '',
    plugin_steps: Array.isArray(cfg.plugin_steps) ? cfg.plugin_steps : [],
    plugin_faq: Array.isArray(cfg.plugin_faq) ? cfg.plugin_faq : [],
    plugin_feats: Array.isArray(cfg.plugin_feats) ? cfg.plugin_feats : [],
    app_page: (cfg.app_page && typeof cfg.app_page === 'object') ? cfg.app_page : null,
    play_page: (cfg.play_page && typeof cfg.play_page === 'object') ? cfg.play_page : null,
    vip_jx: Array.isArray(cfg.vip_jx) ? cfg.vip_jx : [],
    first_popup: (cfg.first_popup && typeof cfg.first_popup === 'object') ? cfg.first_popup : null,
    promo_ad: (cfg.promo_ad && typeof cfg.promo_ad === 'object') ? cfg.promo_ad : null,
    // 搜索页违禁词（前台搜索框先本地拦一次，避免把词发给接口）
    search_banned: String(cfgVal(cfg, env, 'search_banned', 'SEARCH_BANNED') || '')
      .split(/[\s,，、;；|]+/).map((s) => s.trim()).filter(Boolean).slice(0, 800),
    // 下面这些是「有没有配置」的开关：前台据此决定某个入口 / 分类显不显示 —— 没配就不显示
    wp_enabled: !!cfgVal(cfg, env, 'wp_api_host', 'WP_API_HOST'),
    plugin_enabled: cfgVal(cfg, env, 'plugin_enabled', 'PLUGIN_ENABLED') === '1',
    has_app: (Array.isArray(cfg.android_apps) && cfg.android_apps.length > 0)
      || (Array.isArray(cfg.ios_apps) && cfg.ios_apps.length > 0),
    vip_enabled: Array.isArray(cfg.vip_jx) && cfg.vip_jx.length > 0,
    friend_apply_enabled: !!cfgVal(cfg, env, 'web3forms_access_key', 'WEB3FORMS_ACCESS_KEY'),
    // 后台自己填的友链随配置一起下发：首页/友链页就不用再单独请求一次接口
    //（远端数据里的友链仍走 /api/friend-list，那个带失效检测）
    friends: Array.isArray(cfg.links)
      ? cfg.links.slice(0, 30)
        .map((l) => ({ name: String(l.name || '').trim(), url: String(l.url || '').trim() }))
        .filter((l) => l.name && l.url)
      : [],
  }, { smax: 60, maxAge: 30, stale: 600 });
}
const isPrivateIP = s => {
  const p = String(s).split('.').map(Number);
  if (p.length !== 4 || p.some(n => Number.isNaN(n) || n > 255)) return false;
  return p[0] === 10 || p[0] === 127 || p[0] === 0 ||
         (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
         (p[0] === 192 && p[1] === 168) ||
         (p[0] === 169 && p[1] === 254) ||
         (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
};
// 内网 / 本机 / 云元数据地址一律拒绝（图片代理是公开接口，必须挡住 SSRF）
// URL 会把 IPv6 统一成 [::1] 这种带方括号的形式，这里一并处理；
// 另外挡掉十进制 / 十六进制 / 八进制写法的 IPv4（如 2130706433、0x7f000001 都能指到 127.0.0.1）
const isSafeImgHost = (host) => {
  let h = String(host || '').toLowerCase().trim();
  if (!h) return false;
  h = h.replace(/^\[|\]$/g, '');                       // 去掉 IPv6 方括号
  if (h.includes(':')) {                               // IPv6 字面量：只放行公网地址
    if (h === '::1' || h === '::' ) return false;
    if (/^f[cd][0-9a-f]{2}:/.test(h)) return false;     // fc00::/7 唯一本地地址
    if (/^fe[89ab][0-9a-f]:/.test(h)) return false;     // fe80::/10 链路本地
    if (h.startsWith('::ffff:')) {                      // IPv4 映射地址，还原后再判断
      const v4 = h.slice(7);
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) return !isPrivateIP(v4);
      return false;
    }
    return true;
  }
  if (h === 'localhost' || h.endsWith('.localhost') || h === 'ip6-localhost') return false;
  if (h === 'metadata' || h === 'metadata.google.internal' || h.endsWith('.internal') || h.endsWith('.local')) return false;
  if (h.endsWith('.home.arpa') || h === 'instance-data') return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return !isPrivateIP(h);   // 标准点分十进制
  if (/^(0x[0-9a-f]+|\d+)$/.test(h)) return false;                 // 十进制 / 十六进制 IP 写法
  return true;
};
// 跟随重定向时逐个复查主机，避免"第一跳公网、第二跳内网"绕过
async function fetchImageSafely(startUrl, init, maxHops = 3) {
  let cur = startUrl;
  for (let i = 0; i <= maxHops; i++) {
    const res = await fetch(cur, { ...init, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('Location');
      if (!loc) return res;
      let next;
      try { next = new URL(loc, cur); } catch (_) { return res; }
      if (next.protocol !== 'https:' && next.protocol !== 'http:') return res;
      if (!isSafeImgHost(next.hostname)) return res;
      cur = next.href;
      continue;
    }
    return res;
  }
  throw new Error('too many redirects');
}
export async function handleImgProxy(request, url) {
  const raw = (url.searchParams.get('u') || '').trim();
  if (!raw) return jsonErr('缺少图片地址', 400);
  let target;
  try { target = new URL(raw); } catch (_) { return jsonErr('图片地址无效', 400); }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return jsonErr('协议不支持', 400);
  if (!isSafeImgHost(target.hostname)) return jsonErr('不支持的图片源', 403);
  const cacheKey = new Request(url.origin + '/__imgproxy__?u=' + encodeURIComponent(target.href));
  const hit = await cacheGet(cacheKey); if (hit) return hit;
  if (!checkRateLimit(getClientIP(request), 600, 'img')) return jsonErr('请求过于频繁，请稍后再试', 429);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const isDouban = /(^|\.)doubanio\.com$|(^|\.)douban\.com$/.test(target.hostname);
    // 自己跟随重定向并逐跳校验主机（fetch 默认 follow 时不会复查，存在第二跳打内网的可能）
    const upstream = await fetchImageSafely(target.href, {
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
    // 先读响应头里的大小：超标就不下载内容，避免把大文件整个读进内存再判断
    const MAX_BYTES = 10 * 1024 * 1024;
    const declared = Number(upstream.headers.get('Content-Length') || 0);
    if (declared > MAX_BYTES) { ctrl.abort(); return jsonErr('图片过大', 413); }
    const body = await upstream.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return jsonErr('图片过大', 413);
    const res = new Response(body, {
      status: 200,
      headers: { 'Content-Type': ct, 'Cache-Control': 'public, max-age=1296000, s-maxage=1296000, stale-while-revalidate=1296000', ...CORS },
    });
    await cachePut(cacheKey, res);
    return res;
  } catch (e) { return jsonErr('图片代理失败', 502); }
  finally { clearTimeout(timer); }
}
const FRIEND_UA = 'Mozilla/5.0 (compatible; FreeTV-LinkCheck/1.0; +https://' + (typeof location !== 'undefined' ? location.host : '') + ')';
async function checkFriendLink(item) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    const r = await fetch(item.url, {
      method: 'GET', redirect: 'follow', signal: ctrl.signal,
      headers: { 'User-Agent': FRIEND_UA, 'Accept': 'text/html,application/xhtml+xml,*/*', 'Accept-Language': 'zh-CN,zh;q=0.9' },
    });
    if (r.status === 404 || r.status === 410) return { ...item, _bad: true };
    try { await r.body?.cancel(); } catch (_) {} // 不读 body，尽快释放
    return item;
  } catch (_) {
    return item; // 网络/超时异常保守保留，避免误删
  } finally {
    clearTimeout(timer);
  }
}
async function checkFriendLinks(list, deadline) {
  const results = new Array(list.length);
  let idx = 0;
  const LIMIT = 8;
  async function worker() {
    while (idx < list.length) {
      const i = idx++;
      if (deadline.signal.aborted) { results[i] = list[i]; continue; }
      results[i] = await checkFriendLink(list[i]).catch(() => list[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(LIMIT, list.length) }, worker));
  return results
    .filter(Boolean)
    .filter(l => !l._bad)
    .map(({ _bad, ...rest }) => rest);
}
export async function handleFriendList(request, url, context) {
  if (!checkRateLimit(getClientIP(request), 60, 'friends')) return jsonErr('请求过于频繁，请稍后再试', 429);
  const env = await resolveEnv(context);
  const cfg = env._siteCfg || await loadSiteConfig(env, true);
  const cacheKey = new Request(url.origin + '/__friend__v2');
  if (Array.isArray(cfg.links) && cfg.links.length) {
    const list = cfg.links
      .map(l => ({ name: String(l.name || '').trim(), url: String(l.url || '').trim() }))
      .filter(l => l.name && l.url);
    if (list.length) {
      const deadline = new AbortController();
      const timer = setTimeout(() => deadline.abort(), 15000);
      let checked;
      try { checked = await checkFriendLinks(list, deadline); }
      finally { clearTimeout(timer); }
      return cachedJson(cacheKey, { code: 1, list: checked, checked: true }, { smax: 300, maxAge: 60, stale: 600 });
    }
  }
  const data = await loadZhuiju(env);
  if (!data) return jsonErr('数据加载失败', 502);
  const list = Array.isArray(data['friend-list']) ? data['friend-list'] : [];
  return cachedJson(cacheKey, { code: 1, list }, { smax: 300, maxAge: 60, stale: 600 });
}
export async function handleZhuiju(request, url, context) {
  if (!checkRateLimit(getClientIP(request), 120, 'zhuiju')) return jsonErr('请求过于频繁，请稍后再试', 429);
  const env = await resolveEnv(context);
  const data = await loadZhuiju(env);
  const cfg = env._siteCfg || await loadSiteConfig(env);
  let out = (data && typeof data === 'object') ? data : {};
  if (cfg && typeof cfg === 'object') {
    if (Array.isArray(cfg.carousels) && cfg.carousels.length) {
      out = { ...out, 'carousel-list': cfg.carousels.map(c => ({
        pic: String(c.pic || ''),
        link: String(c.link || ''),
        mode: c.mode === 'external' ? 'external' : 'search',
      })) };
    }
    if (cfg.site_name) out.site_name = cfg.site_name;
    if (cfg.site_desc) out.site_desc = cfg.site_desc;
    if (cfg.site_icon) out.site_icon = cfg.site_icon;
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
