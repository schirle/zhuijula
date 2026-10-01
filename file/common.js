'use strict';
const $ = (sel, ctx) => (ctx || document).querySelector(sel);
const $$ = (sel, ctx) => [...(ctx || document).querySelectorAll(sel)];
const esc = str => String(str == null ? '' : str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
window.esc = esc;
let _toastTimer = null, _toastEl = null;
const showToast = (msg, type = '', duration = 2000) => {
  if (!_toastEl) {
    _toastEl = document.getElementById('toast') || (() => {
      const el = document.createElement('div');
      el.id = 'toast';
      el.style.cssText =
        'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:200;' +
        'padding:10px 20px;border-radius:999px;background:var(--bg-card);' +
        'border:1px solid rgba(255,255,255,0.1);color:var(--text);' +
        'font-size:13px;font-weight:500;box-shadow:0 8px 32px rgba(0,0,0,0.5);' +
        'opacity:0;transition:opacity 0.3s;pointer-events:none;';
      document.body.appendChild(el);
      return el;
    })();
  }
  _toastEl.textContent = msg;
  _toastEl.style.opacity = '1';
  _toastEl.style.borderColor = type === 'error' ? 'rgba(239,68,68,0.4)' : '';
  _toastEl.style.color = type === 'error' ? '#fca5a5' : '';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { _toastEl.style.opacity = '0'; }, duration);
};
window.showToast = showToast;
const Toast = { show: showToast, error: (msg, d) => showToast(msg, 'error', d) };
window.Toast = Toast;
const lsGet = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
const lsGetJson = k => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (_) { return []; } };
const lsSetJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
const proxyImg = url => String(url || '').trim();
// 站外链接统一过一遍：只放行 http/https，挡掉 javascript: / data: 这类可执行协议
// （友链、广告位、网盘分享链接都来自接口或后台，不能直接塞进 href / window.open）
const safeUrl = (url) => {
  const s = String(url == null ? '' : url).trim();
  return /^https?:\/\//i.test(s) ? s : '';
};
window.safeUrl = safeUrl;
const ERROR_JPG = (location.origin || '') + '/file/error.jpg';
const imgFallback = img => {
  const cur = img.getAttribute('src') || '';
  if (cur.indexOf('/api/img') !== -1) {
    if (!img.dataset.errjpg) {
      img.dataset.errjpg = '1';
      img.onerror = null;
      img.src = ERROR_JPG;
    }
    return;
  }
  let original = null;
  if (cur.indexOf('gimg0.baidu.com') !== -1) {
    try {
      let s = new URL(cur).searchParams.get('src');
      if (s && !/^https?:\/\//.test(s)) s = 'https://' + s;
      original = s;
    } catch (_) { }
  } else if (/^https?:\/\//.test(cur)) {
    original = cur;
  }
  if (original) {
    img.dataset.guarded = '';
    img.src = '/api/img?u=' + encodeURIComponent(original);
    guardImg(img, 6000);
  }
};
window.imgFallback = imgFallback;
const guardImg = (img, ms = 4000) => {
  if (!img || img.dataset.guarded === '1') return;
  img.dataset.guarded = '1';
  const t = setTimeout(() => {
    if (!img.complete || img.naturalWidth === 0) imgFallback(img);
  }, ms);
  const clear = () => { clearTimeout(t); img.dataset.guarded = ''; };
  img.addEventListener('load', clear, { once: true });
  img.addEventListener('error', clear, { once: true });
};
window.guardImg = guardImg;
// 站点配置：内存缓存 60 秒 + sessionStorage 缓存 3 分钟。
// 目的：访客在一次浏览里翻多个页面时不再重复请求 /api/config ——
// Cloudflare Pages 免费额度按 Functions 调用次数计（每天 10 万次），省一次是一次。
const CFG_SESSION_KEY = 'ftv_cfg_v1';
const readSession = (key, ttlMs) => {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (j && j.ts && (Date.now() - j.ts) < ttlMs && j.data) return j.data;
  } catch (_) { /* 隐私模式等场景忽略即可 */ }
  return null;
};
const writeSession = (key, data) => {
  try { sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch (_) { }
};
let _cfgCache = null, _cfgTs = 0, _cfgPromise = null;
const getSiteConfig = async (force = false) => {
  if (!force && _cfgCache && (Date.now() - _cfgTs) < 60000) return _cfgCache;
  if (!force && _cfgPromise) return _cfgPromise;
  if (!force) {
    const cached = readSession(CFG_SESSION_KEY, 120000);   // 2 分钟：够覆盖一次连续浏览，又不至于改了后台半天不生效
    if (cached) { _cfgCache = cached; _cfgTs = Date.now(); return cached; }
  }
  _cfgPromise = (async () => {
    try {
      const r = await fetch('/api/config');
      if (!r.ok) { if (_cfgCache) return _cfgCache; throw new Error('HTTP ' + r.status); }
      const d = await r.json();
      _cfgCache = d; _cfgTs = Date.now();
      writeSession(CFG_SESSION_KEY, d);
      return d;
    } catch (e) {
      if (_cfgCache) return _cfgCache;
      throw e;
    } finally {
      _cfgPromise = null;
    }
  })();
  return _cfgPromise;
};
window.getSiteConfig = getSiteConfig;
window.getSiteName = () => (_cfgCache && _cfgCache.site_name) || '免费追剧';
// 侧栏小部件（搜索排行 + 今日推荐）：合并成一次请求，并做 2 分钟会话缓存。
// 搜索页原来要打 2~3 个接口（排行 / 今日推荐 / 封面图），现在合起来只需 1 个。
const WD_SESSION_KEY = 'ftv_widgets_v1';
let _wdCache = null, _wdTs = 0, _wdPromise = null;
const getWidgets = async () => {
  if (_wdCache && (Date.now() - _wdTs) < 120000) return _wdCache;
  if (_wdPromise) return _wdPromise;
  const cached = readSession(WD_SESSION_KEY, 120000);
  if (cached) { _wdCache = cached; _wdTs = Date.now(); return cached; }
  _wdPromise = (async () => {
    try {
      const r = await fetch('/api/widgets?range=day');
      if (!r.ok) { if (_wdCache) return _wdCache; throw new Error('HTTP ' + r.status); }
      const d = await r.json();
      _wdCache = d; _wdTs = Date.now();
      writeSession(WD_SESSION_KEY, d);
      return d;
    } catch (e) {
      if (_wdCache) return _wdCache;
      throw e;
    } finally {
      _wdPromise = null;
    }
  })();
  return _wdPromise;
};
window.getWidgets = getWidgets;
const fallbackCopy = (text) =>
  new Promise((resolve, reject) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy') ? resolve() : reject();
      document.body.removeChild(ta);
    } catch (e) { reject(e); }
  });
const copyText = (text) => {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  }
  return fallbackCopy(text);
};
window.copyText = copyText;
window.onReady = (fn) => {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
  else fn();
};
const isMobile = () => window.innerWidth <= 768;
const getParam = name => new URLSearchParams(location.search).get(name);
const getPlayParams = () => {
  const sp = new URLSearchParams(location.search);
  return { id: sp.get('id'), form: sp.get('form') || 'xg' };
};
const playHref = (id, form = 'xg') => `/play?id=${encodeURIComponent(id || '')}&form=${encodeURIComponent(form || 'xg')}`;
const _downloadFile = (url, filename) => {
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  if (typeof showToast === 'function') showToast('已开始下载「' + filename + '」，按提示安装即可使用');
};
const installExtension = async () => {
  const cfg = await getSiteConfig().catch(() => ({}));
  // 下载地址完全由后台「插件设置 → Chrome 扩展」决定：
  // 没填就不下载（以前这里写死了 file/zhuiju-extension.crx，后台没配也会去下这个不存在的文件）
  const url = String((cfg && cfg.crx_url) || '').trim();
  if (!url) {
    if (typeof showToast === 'function') showToast('扩展下载暂未开放，敬请期待', false);
    return;
  }
  // 下载时保存的文件名直接从地址里取（取不到才用通用名），不再单独配置一项
  let name = '';
  try {
    name = decodeURIComponent(url.split('?')[0].split('#')[0].split('/').pop() || '');
  } catch (_) { name = url.split('/').pop() || ''; }
  name = String(name).replace(/[\\/:*?"<>|]/g, '').trim() || 'extension.crx';
  _downloadFile(url, name);
};
const installUserScript = async () => {
  const cfg = await getSiteConfig().catch(() => ({}));
  const n = String((cfg && cfg.userscript_name) || '').trim().replace(/[\\/]/g, '') || 'zhuiju.user.js';
  location.href = '/api/' + n;
};
window.installExtension = installExtension;
window.installUserScript = installUserScript;
window.getPlayParams = getPlayParams;
window.playHref = playHref;
const initLazyImages = (rootMargin = '300px') => {
  const observed = new WeakSet();
  const ob = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const img = e.target;
      const src = img.getAttribute('data-src');
      if (src) {
        img.onload = () => { img.parentElement && img.parentElement.classList.add('loaded'); };
        img.onerror = () => { img.parentElement && img.parentElement.classList.add('error'); imgFallback(img); };
        img.src = src;
        img.removeAttribute('data-src');
        guardImg(img, 4000);
      } else {
        img.parentElement && img.parentElement.classList.add('loaded');
      }
      ob.unobserve(img);
    }
  }, { rootMargin });
  const observe = el => {
    $$('img[data-src]', el).forEach(img => {
      if (!observed.has(img)) { observed.add(img); ob.observe(img); }
    });
  };
  return { observer: ob, observe };
};
const initBackToTop = () => {
  const btn = document.getElementById('back-to-top');
  if (!btn) return;
  const threshold = 400;
  const toggle = () => {
    if (window.scrollY > threshold) btn.classList.add('show');
    else btn.classList.remove('show');
  };
  window.addEventListener('scroll', toggle, { passive: true });
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  toggle();
};
onReady(initBackToTop);
const NAV_PAGES = {
  home:  { title: '' },
  app:   { title: 'APP下载', back: true, active: 'app' },
  vip:   { title: 'VIP视频解析', back: true, active: 'vip' },
  play:  { title: '加载中…', titleId: 'nav-page-title-el', back: true },
  search:{ title: '搜索', titleId: 'nav-page-title-el', back: true },
  rank:  { title: '搜索排行榜', back: true },
  links: { title: '友情链接', back: true },
  plugin:{ title: '追剧插件', back: true, active: 'plugin' },
};
const renderNav = async () => {
  const root = document.getElementById('top-nav');
  if (!root) return;
  const data = await getSiteConfig().catch(() => ({}));
  const page = document.body.dataset.page || '';
  const cfg = NAV_PAGES[page] || {};
  const siteName = (data && data.site_name) || '免费追剧';
  if (page === 'home') document.title = siteName;
  const brand =
    '<a class="nav-brand" href="/">' +
      '<div class="nav-logo"><img src="' + esc((data && data.site_icon) || 'file/zhuiju.png') + '" alt="' + esc(siteName) + '"></div>' +
      (page === 'home' ? '<div class="nav-title">' + esc(siteName) + '</div>' : '') +
      (page !== 'home' && cfg.title ? '<span class="nav-page-title"' + (cfg.titleId ? ' id="' + cfg.titleId + '"' : '') + '>' + esc(cfg.title) + '</span>' : '') +
    '</a>';
  let actions = '';
  if (['home', 'search', 'play'].includes(page)) actions += '<button id="nav-history" class="nav-btn" type="button" title="观看历史"><i class="fas fa-clock-rotate-left"></i></button>';
  actions += '<button id="theme-toggle" class="nav-btn" type="button" title="切换深色 / 浅色"><i class="fas fa-moon"></i></button>';
  root.innerHTML = brand + '<div class="nav-actions">' + actions + '</div>';
  initThemeToggle();
  if (['home', 'search', 'play'].includes(page)) initHistoryPanel();
  const links = Array.isArray(data.nav_links) ? data.nav_links : [];
  const navActions = root.querySelector('.nav-actions');
  if (navActions) {
    let html = '';
    for (const l of links) {
      const isActive = cfg.active === (l.key || l.label);
      html += '<a class="nav-btn primary' + (isActive ? ' active' : '') + '" href="' + esc(l.href || '#') + '"' +
        (isActive ? ' aria-current="page"' : '') + ' title="' + esc(l.label || '') + '">' +
        '<i class="fas ' + esc(l.icon || 'fa-link') + '"></i><span>' + esc(l.label || '') + '</span></a>';
    }
    navActions.insertAdjacentHTML('beforeend', html);
  }
};
const injectStats = (html) => {
  if (!html || !html.trim()) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  tmp.querySelectorAll('script').forEach(s => {
    const ns = document.createElement('script');
    if (s.src) ns.src = s.src;
    if (s.type) ns.type = s.type;
    if (s.async) ns.async = true;
    ns.textContent = s.textContent;
    (document.body || document.documentElement).appendChild(ns);
    s.remove();
  });
  while (tmp.firstChild) (document.body || document.documentElement).appendChild(tmp.firstChild);
};
const renderPluginPage = (data) => {
  // 插件功能没开启：前台不展示任何插件内容
  //（服务端也会把 /plugin 跳回首页，这里是缓存 / 直连静态文件时的兜底）
  if (!data.plugin_enabled) {
    const main = document.querySelector('.plugin-main');
    if (main) {
      main.innerHTML = '<section class="plugin-section" style="text-align:center;padding:56px 20px;opacity:.75;font-size:14px">该功能暂未开放</section>';
    }
    return;
  }
  const steps = Array.isArray(data.plugin_steps) ? data.plugin_steps : [];
  const faq = Array.isArray(data.plugin_faq) ? data.plugin_faq : [];
  const feats = Array.isArray(data.plugin_feats) ? data.plugin_feats : [];
  // 插件页大标题跟随后台站名（没填站名就用中性标题）
  const hero = document.getElementById('plugin-hero-title');
  if (hero && data.site_name) hero.textContent = data.site_name + ' 插件';
  // 三块内容都只在后台填了才显示（页面里不再留任何写死的示例文案）
  const show = (id, html) => {
    const sec = document.getElementById(id);
    if (!sec) return;
    if (!html) { sec.style.display = 'none'; return; }
    const body = sec.querySelector('ol, .feat-grid, .faq-list');
    if (body) body.innerHTML = html;
    sec.style.display = '';
  };
  show('sec-plugin-steps', steps.filter(s => s && s.title).map((s, i) =>
    '<li><span class="step-num">' + (i + 1) + '</span><div><b>' + esc(s.title) + '</b>'
    + (s.desc ? '<p>' + esc(s.desc) + '</p>' : '') + '</div></li>'
  ).join(''));
  show('sec-plugin-feats', feats.filter(f => f && f.title).map((f) =>
    '<div class="feat-card"><div class="feat-ico"><i class="fas ' + esc(f.icon || 'fa-star') + '"></i></div>'
    + '<div class="feat-title">' + esc(f.title) + '</div>'
    + (f.desc ? '<p>' + esc(f.desc) + '</p>' : '') + '</div>'
  ).join(''));
  show('sec-plugin-faq', faq.filter(f => f && f.q).map((f) =>
    '<details class="faq-item"><summary>' + esc(f.q) + '</summary><p>' + esc(f.a || '') + '</p></details>'
  ).join(''));
};
const initSiteMeta = async () => {
  if (window.__ftvSiteMetaDone) return;
  window.__ftvSiteMetaDone = true;
  const data = await getSiteConfig().catch(() => null);
  if (!data) return;
  const serverInjected = !!document.querySelector('meta[name="ftv-stats"]');
  if (!serverInjected && data.stats_code) injectStats(data.stats_code);
  const name = data.site_name || '免费追剧';
  const page = document.body.dataset.page || '';
  // 与服务端中间件保持同一套写法（页面前缀 + 站名 / 描述），免得地址栏和搜索结果两套标题
  const TITLE_SUFFIX = {
    home: '', search: '影视搜索', rank: '搜索排行', links: '友情链接',
    play: '在线播放', plugin: '浏览器插件', vip: 'VIP 视频解析', app: '应用下载',
  };
  const suffix = TITLE_SUFFIX[page];
  if (suffix !== undefined) {
    const desc = String(data.site_desc || '').trim();
    document.title = suffix
      ? suffix + (name ? ' - ' + name : '')
      : (desc ? name + ' - ' + desc : name);
    let mDesc = document.querySelector('meta[name="description"]');
    const descText = suffix ? [suffix, desc].filter(Boolean).join('｜') : desc;
    if (descText) {
      if (!mDesc) { mDesc = document.createElement('meta'); mDesc.name = 'description'; document.head.appendChild(mDesc); }
      mDesc.setAttribute('content', descText);
    }
  }
  document.querySelectorAll('[data-site-footer]').forEach((el) => {
    el.textContent = data.site_desc ? (name + ' · ' + data.site_desc) : name;
  });
  if (data.site_icon) {
    ['link[rel="icon"]', 'link[rel="shortcut icon"]', 'link[rel="apple-touch-icon"]']
      .forEach((sel) => document.querySelectorAll(sel).forEach((l) => l.setAttribute('href', data.site_icon)));
    document.querySelectorAll('.nav-logo img').forEach((img) => { img.src = data.site_icon; });
  }

  // 插件页的「安装步骤 / 常见问题」由后台编辑决定（后台为空则保留页面里的默认内容）
  if (page === 'plugin') renderPluginPage(data);
};
const initThemeToggle = () => {
  const b = document.getElementById('theme-toggle');
  if (!b) return;
  const apply = t => {
    document.documentElement.setAttribute('data-theme', t);
    b.innerHTML = t === 'dark' ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
  };
  const t = localStorage.getItem('ftv_theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  apply(t);
  b.addEventListener('click', () => {
    const c = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('ftv_theme', c); } catch (e) {}
    apply(c);
  });
};
const CONTINUE_KEY = 'ftv_continue';
const initHistoryPanel = () => {
  const btn = document.getElementById('nav-history');
  if (!btn) return;
  let panel = document.getElementById('nav-history-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'nav-history-panel';
    panel.className = 'nav-history-panel';
    panel.innerHTML =
      '<div class="nhp-head"><span class="nhp-title">观看历史</span>' +
      '<span class="nhp-count">0 条</span>' +
      '<button class="nhp-clear" type="button" title="清空全部"><i class="fas fa-trash-can"></i> 清空</button></div>' +
      '<div class="nhp-list"></div>';
    document.body.appendChild(panel);
  }
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    renderHistoryPanel();
    panel.classList.toggle('show');
  });
  document.addEventListener('click', (e) => {
    if (!panel.classList.contains('show')) return;
    if (panel.contains(e.target) || btn.contains(e.target)) return;
    panel.classList.remove('show');
  });
  panel.querySelector('.nhp-clear').addEventListener('click', () => {
    lsSetJson(CONTINUE_KEY, []);
    showToast('已清空观看历史');
    renderHistoryPanel();
    document.getElementById('rail-continue')?.style.setProperty('display', 'none');
  });
  panel.querySelector('.nhp-list').addEventListener('click', (e) => {
    const del = e.target.closest('.nhp-del');
    if (del) {
      e.stopPropagation();
      const idx = parseInt(del.dataset.idx, 10);
      const list = lsGetJson(CONTINUE_KEY) || [];
      if (Array.isArray(list) && list[idx]) { list.splice(idx, 1); lsSetJson(CONTINUE_KEY, list); renderHistoryPanel(); }
      return;
    }
    const row = e.target.closest('.nhp-item');
    if (row && row.dataset.href) location.href = row.dataset.href;
  });
};
const renderHistoryPanel = () => {
  const panel = document.getElementById('nav-history-panel');
  if (!panel) return;
  let list = [];
  try { list = lsGetJson(CONTINUE_KEY) || []; } catch (_) {}
  if (!Array.isArray(list)) list = [];
  const listEl = panel.querySelector('.nhp-list');
  panel.querySelector('.nhp-count').textContent = list.length + ' 条';
  if (!list.length) { listEl.innerHTML = '<div class="nhp-empty"><i class="fas fa-clock-rotate-left"></i>暂无观看记录</div>'; return; }
  listEl.innerHTML = list.map((it, i) => {
    const href = '/play.html?id=' + encodeURIComponent(it.id || '') + '&form=' + encodeURIComponent(it.form || 'xg');
    const ep = (it.ep != null && it.ep > 0) ? '第' + (it.ep + 1) + '集' : '继续观看';
    const pic = it.pic
      ? '<img src="' + esc(it.pic) + '" alt="" loading="lazy" onerror="window.imgFallback(this)">'
      : '<i class="fas fa-film nhp-noimg"></i>';
    return '<div class="nhp-item" data-href="' + esc(href) + '">' + pic +
      '<div class="nhp-info"><div class="nhp-name">' + esc(it.name || '未命名') + '</div>' +
      '<div class="nhp-ep">' + esc(ep) + '</div></div>' +
      '<button class="nhp-del" type="button" title="删除" data-idx="' + i + '"><i class="fas fa-xmark"></i></button></div>';
  }).join('');
};
const initFirstPopup = () => {
  try {
    if (location.pathname.includes('admin') || location.pathname.includes('console') || location.pathname === '/c' || location.pathname.startsWith('/c/')) return;
    const KEY = 'ftv_firstpopup_v1';
    const seen = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
    const mark = v => { try { localStorage.setItem(KEY, v); } catch (e) {} };
    const hash = o => (o.title || '') + ' ' + (o.content || '') + ' ' + (o.btn_text || '');
    getSiteConfig().then(d => {
      const fp = d && d.code === 1 ? d.first_popup : null;
      if (!fp || !fp.enabled || !fp.title) return;
      if (seen() === hash(fp)) return;
      if (!document.getElementById('ftv-popup-style')) {
        const st = document.createElement('style'); st.id = 'ftv-popup-style';
        st.textContent = '.ftv-pop{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:0 16px;background:rgba(15,23,42,.55);opacity:0;transition:opacity .25s}.ftv-pop.show{opacity:1}.ftv-pop *{box-sizing:border-box}.ftv-card{width:100%;max-width:420px;background:var(--bg-card,#fff);color:var(--text,#1e293b);border-radius:16px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.35);transform:translateY(10px);transition:transform .25s;position:relative}.ftv-pop.show .ftv-card{transform:none}.ftv-card h3{margin:0 0 12px;font-size:18px;font-weight:800}.ftv-card p{margin:0 0 18px;font-size:14px;line-height:1.7;white-space:pre-wrap;color:var(--text-secondary,#475569)}.ftv-pop .close{position:absolute;top:14px;right:16px;border:none;background:none;font-size:18px;color:var(--text-muted,#94a3b8);cursor:pointer}.ftv-pop .ftv-btn{display:block;width:100%;text-align:center;padding:12px;border-radius:12px;background:var(--grad-primary,linear-gradient(135deg,#3b82f6,#2563eb));color:#fff;font-weight:700;text-decoration:none;font-size:14px}';
        document.head.appendChild(st);
      }
      const overlay = document.createElement('div'); overlay.className = 'ftv-pop';
      const card = document.createElement('div'); card.className = 'ftv-card';
      card.innerHTML = '<button class="close" aria-label="关闭">✕</button>'
        + '<h3>' + esc(fp.title) + '</h3>'
        + '<p>' + esc(fp.content || '') + '</p>'
        + (fp.btn_text && fp.btn_link ? '<a class="ftv-btn" href="' + esc(fp.btn_link) + '" target="_blank" rel="noopener">' + esc(fp.btn_text) + '</a>' : '');
      overlay.appendChild(card);
      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('show'));
      const close = () => { overlay.classList.remove('show'); mark(hash(fp)); setTimeout(() => overlay.remove(), 260); };
      overlay.addEventListener('click', e => { if (e.target === overlay || e.target.classList.contains('close')) close(); });
    }).catch(() => {});
  } catch (e) {}
};
onReady(renderNav);
onReady(initSiteMeta);
onReady(initFirstPopup);
