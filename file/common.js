



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


// 终极兜底：自有 /api/img 代理（带防盗链，缓存15天）。不使用占位图。
// 图片加载策略：浏览器直连（本站 no-referrer，豆瓣等图床对空 Referer 通常放行，且无代理延迟）
// 失败链路：直连 onerror → imgFallback → 自有 /api/img（服务端代理，带合法 Referer）→ error.jpg
// 注意：百度 gimg 代理已失效（返回空白占位 GIF 且不触发 onerror，封面会静默空白），不再使用
const proxyImg = url => String(url || '').trim();

// 终极兜底占位图（本地，任意来源均可访问）
const ERROR_JPG = (location.origin || '') + '/file/error.jpg';
// 图片加载失败：百度 gimg 代理 → 自有 /api/img（仅兜底豆瓣图）→ 本地 error.jpg；其余封面（走 gimg 的非豆瓣）失败则保持
const imgFallback = img => {
  const cur = img.getAttribute('src') || '';
  if (cur.indexOf('/api/img') !== -1) {
    // 已是终极代理仍失败：使用本地 error.jpg 占位，避免长期空白（不重复回退）
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
    // 任意图（含非豆瓣）都回退到自有 /api/img 代理；仍失败则落到 error.jpg，避免破图
    img.dataset.guarded = '';
    img.src = '/api/img?u=' + encodeURIComponent(original);
    guardImg(img, 6000);
  }
};
window.imgFallback = imgFallback;

// 加载超时守卫：首跳（gimg/直连）在 ms 内未加载完，主动切到更快的 /api/img 兜底，避免长期空白
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


const fetchWithTimeout = async (url, options = {}, timeoutMs = 10000) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
};


const isMobile = () => window.innerWidth <= 768;

const getParam = name => new URLSearchParams(location.search).get(name);

// 清洗片单标题（去掉「片单｜」前缀）
const cleanPlaylistTitle = t => String(t == null ? '' : t).replace(/^片单[｜|]\s*/, '');
// 播放页参数（id/form），form 默认 'xg'
const getPlayParams = () => {
  const sp = new URLSearchParams(location.search);
  return { id: sp.get('id'), form: sp.get('form') || 'xg' };
};
// 构造播放页链接
const playHref = (id, form = 'xg') => `/play?id=${encodeURIComponent(id || '')}&form=${encodeURIComponent(form || 'xg')}`;



// 追剧插件（豆瓣找资源）：直接使用 file/ 下的静态文件，不再前端生成
// zhuiju.crx 为 Chrome 扩展；zhuiju-douban.user.js 为 Tampermonkey 用户脚本
const _downloadFile = (url, filename) => {
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  if (typeof showToast === 'function') showToast('已开始下载「' + filename + '」，按提示安装即可使用');
};

const installExtension = () => _downloadFile('file/zhuiju.crx', 'zhuiju.crx');
const installUserScript = () => _downloadFile('file/zhuiju-douban.user.js', 'zhuiju-douban.user.js');
window.installExtension = installExtension;
window.installUserScript = installUserScript;


window.cleanPlaylistTitle = cleanPlaylistTitle;
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
        // 无图：隐藏加载动画，避免一直转圈（不再用占位图）
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
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initBackToTop);
else initBackToTop();

// ===== 统一顶部导航：自动渲染、移除福利入口、当前页高亮 =====
const NAV_PAGES = {
  home:  { title: '', back: false },
  app:   { title: '', back: true, active: 'app' },
  vip:   { title: 'VIP视频解析', back: true, active: 'vip' },
  play:  { title: '', back: true },
  list:  { title: '推荐片单', back: true, titleId: 'navPageTitle' },
  search:{ title: '搜索', back: true },
  links: { title: '友情链接', back: true },
  fuli:  { title: '福利中心', back: true },
  plugin:{ title: '追剧插件', back: true, active: 'plugin' },
};

// 默认导航链接（可由 Cloudflare 环境变量 NAV_LINKS(JSON) 覆盖，便于免改代码增删改）
const DEFAULT_NAV_LINKS = [
  { key: 'app', href: '/app', icon: 'fa-download', label: 'APP下载' },
  { key: 'vip', href: '/vip', icon: 'fa-bolt', label: 'VIP视频解析' },
];

// 顶部导航：品牌/主题/返回按钮同步渲染；链接按钮异步读取 /api/config（CF 变量 NAV_LINKS）注入，失败回退默认
const renderNav = async () => {
  const root = document.getElementById('top-nav');
  if (!root) return;
  // 注入后台配置的统计代码（analytics 等），<script> 需重建以执行
  try {
    const r = await fetch('/api/config');
    if (r.ok) { const d = await r.json(); if (d && d.stats_code) injectStats(d.stats_code); }
  } catch (_) {}
  const page = document.body.dataset.page || '';
  const cfg = NAV_PAGES[page] || {};

  const brand =
    '<a class="nav-brand" href="/">' +
      '<div class="nav-logo"><img src="file/zhuiju.png" alt="免费追剧"></div>' +
      '<div class="nav-title">免费<em>追剧</em></div>' +
      (cfg.title ? '<span class="nav-page-title"' + (cfg.titleId ? ' id="' + cfg.titleId + '"' : '') + '>' + esc(cfg.title) + '</span>' : '') +
    '</a>';

  let actions = '<button id="theme-toggle" class="nav-btn" type="button" title="切换深色 / 浅色"><i class="fas fa-moon"></i></button>';
  if (cfg.back) {
    actions += '<button class="nav-btn" id="nav-back" type="button" title="返回"><i class="fas fa-arrow-left"></i><span>返回</span></button>';
  }
  root.innerHTML = brand + '<div class="nav-actions">' + actions + '</div>';

  const back = document.getElementById('nav-back');
  if (back) back.addEventListener('click', () => {
    if (history.length > 1) history.back(); else location.href = '/';
  });
  initThemeToggle();

  // 异步读取 CF 环境变量配置的导航链接（未配置或异常时回退 DEFAULT_NAV_LINKS）
  let links = DEFAULT_NAV_LINKS;
  // 导航配置基本静态（由 CF 环境变量驱动），localStorage 缓存 1 小时，避免每页重复请求 /api/config
  const NAV_CACHE_KEY = 'ftv_nav_cache';
  const cached = lsGetJson(NAV_CACHE_KEY);
  if (cached && cached.ts && Array.isArray(cached.nav) && cached.nav.length && (Date.now() - cached.ts) < 3600000) {
    links = cached.nav;
  } else {
    try {
      const r = await fetch('/api/config');
      if (r.ok) {
        const data = await r.json();
        if (data && Array.isArray(data.nav) && data.nav.length) {
          links = data.nav;
          lsSetJson(NAV_CACHE_KEY, { ts: Date.now(), nav: data.nav });
        }
      }
    } catch (_) { }
  }
  const navActions = root.querySelector('.nav-actions');
  if (navActions) {
    let html = '';
    for (const l of links) {
      const isActive = cfg.active === l.key;
      html += '<a class="nav-btn primary' + (isActive ? ' active' : '') + '" href="' + esc(l.href || '#') + '"' +
        (isActive ? ' aria-current="page"' : '') + ' title="' + esc(l.label || '') + '">' +
        '<i class="fas ' + esc(l.icon || 'fa-link') + '"></i><span>' + esc(l.label || '') + '</span></a>';
    }
    navActions.insertAdjacentHTML('beforeend', html);
  }
};

// 注入统计代码：把后台粘贴的 HTML（通常含 <script>）插入到页面底部，脚本会真正执行
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

// 首次打开弹窗：后台「基础设置 → 首次弹窗」配置，访客首次访问（或内容变更后）弹出一次
const initFirstPopup = () => {
  try {
    if (location.pathname.includes('admin')) return; // 后台页不弹
    const KEY = 'ftv_firstpopup_v1';
    const seen = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
    const mark = v => { try { localStorage.setItem(KEY, v); } catch (e) {} };
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const hash = o => (o.title || '') + ' ' + (o.content || '') + ' ' + (o.btn_text || '');
    fetch('/api/config').then(r => r.json()).then(d => {
      const fp = d && d.code === 1 ? d.first_popup : null;
      if (!fp || !fp.enabled || !fp.title) return;
      if (seen() === hash(fp)) return; // 已看过该版本
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

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderNav);
else renderNav();
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initFirstPopup);
else initFirstPopup();
