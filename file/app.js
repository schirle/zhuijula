(function (win, doc) {
  'use strict';

  const ua = win.navigator.userAgent || '';
  const DEVICE = /iPad|iPhone|iPod/i.test(ua) ? 'ios' : 'android';
  const DATA_TIMEOUT = 10000;
  const SKELETON_COUNT = 6;

  const PLATFORMS = {
    android: { icon: 'fab fa-android', dataKey: 'android-list', label: '安卓APP', sub: '安卓应用 · 网盘下载', cta: '下载', ctaIcon: 'fas fa-download' },
    ios: { icon: 'fab fa-apple', dataKey: 'ios-list', label: '苹果APP', sub: 'iOS 应用 · App Store', cta: '下载', ctaIcon: 'fas fa-download' },
    web: { icon: 'fas fa-globe', dataKey: 'website-list', label: '更多网站', sub: '在线影视网站 · 点开即看', cta: '打开', ctaIcon: 'fas fa-external-link-alt' },
  };

  const PAN_DISK = {
    icons: {
      uc: 'https://pp.myapp.com/ma_icon/0/icon_10936_1787015999/96',
      bd: 'https://pp.myapp.com/ma_icon/0/icon_116071_1789549946/96',
      kk: 'https://pp.myapp.com/ma_icon/0/icon_42375936_1789644866/96',
      xl: 'https://pp.myapp.com/ma_icon/0/icon_113692_1775128288/96',
    },
    labels: { uc: 'UC 网盘', bd: '百度网盘', kk: '夸克网盘', xl: '迅雷网盘' },
    order: ['uc', 'bd', 'kk', 'xl'],
  };

  let data = null;
  let dataPromise = null;
  let currentCategory = DEVICE;
  let filteredApps = [];

  const getData = (key) => (data ? data[key] : null) || [];
  const findByName = (list, name) => list.find((i) => i.name === name) || null;

  const loadData = () => {
    if (dataPromise) return dataPromise;
    const embedded = win.__ZUIJU_DATA__;
    dataPromise = embedded
      ? Promise.resolve(embedded)
      : Promise.race([
          fetch('/api/zhuiju').then((r) => (r.ok ? r.json() : {})),
          new Promise((resolve) => setTimeout(() => resolve({}), DATA_TIMEOUT)),
        ]).catch(() => ({}));
    return dataPromise.then((d) => { data = d || {}; return data; });
  };

  const renderChips = () => {
    const el = $('#appChips');
    if (!el) return;
    el.innerHTML = Object.keys(PLATFORMS)
      .map((k) => {
        const p = PLATFORMS[k];
        const active = k === currentCategory ? ' active' : '';
        return `<button type="button" class="app-chip${active}" data-category="${k}"><i class="${p.icon}"></i><span>${esc(p.label)}</span></button>`;
      })
      .join('');
  };

  const renderSkeleton = (count) => {
    const list = $('#appList');
    if (!list) return;
    let html = '';
    for (let i = 0; i < count; i++) {
      html += '<div class="app-card skeleton"><div class="app-card__media"></div><div class="app-card__name"></div><div class="app-card__btn"></div></div>';
    }
    list.innerHTML = html;
  };

  const buildCard = (category, app) => {
    const p = PLATFORMS[category];
    const div = doc.createElement('div');
    div.className = 'app-card';
    div.dataset.category = category;
    div.dataset.name = app.name;
    div.innerHTML =
      `<div class="app-card__media"><img src="${esc(app.pic || '')}" alt="${esc(app.name)}" loading="lazy" onerror="window.imgFallback(this)"></div>` +
      `<h3 class="app-card__name">${esc(app.name)}</h3>` +
      `<button class="app-card__btn" type="button"><i class="${p.ctaIcon}"></i> ${esc(p.cta)}</button>`;
    return div;
  };

  const paint = (apps) => {
    const list = $('#appList');
    if (!list) return;
    if (!apps.length) {
      list.innerHTML = '<div class="no-result"><i class="fas fa-inbox"></i>该分类暂无数据，敬请期待</div>';
      return;
    }
    const frag = doc.createDocumentFragment();
    for (const a of apps) frag.appendChild(buildCard(currentCategory, a));
    list.innerHTML = '';
    list.appendChild(frag);
  };

  const renderAppList = async (category, opts) => {
    opts = opts || {};
    currentCategory = category;
    const list = $('#appList');
    if (!list) return;
    if (!opts.skipSkeleton) renderSkeleton(SKELETON_COUNT);
    await new Promise((r) => setTimeout(r, 60));
    const apps = getData(PLATFORMS[category].dataKey).filter((a) => a.name);
    filteredApps = apps;
    paint(apps);
  };

  const initChips = () => {
    const box = $('#appChips');
    if (!box) return;
    box.addEventListener('click', (e) => {
      const chip = e.target.closest('.app-chip');
      if (!chip || chip.classList.contains('active')) return;
      $$('.app-chip').forEach((x) => x.classList.remove('active'));
      chip.classList.add('active');
      renderAppList(chip.dataset.category);
    });
    renderAppList(DEVICE);
  };

  const copyText = (text) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    }
    return fallbackCopy(text);
  };

  const fallbackCopy = (text) =>
    new Promise((resolve, reject) => {
      try {
        const ta = doc.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        doc.body.appendChild(ta);
        ta.select();
        const ok = doc.execCommand('copy');
        doc.body.removeChild(ta);
        ok ? resolve() : reject();
      } catch (e) {
        reject(e);
      }
    });

  const openModal = (title, bodyHtml) => {
    const overlay = $('#app-modal');
    if (!overlay) return;
    $('#appModalTitle').textContent = title;
    $('#appModalBody').innerHTML = bodyHtml;
    overlay.classList.add('show');
    doc.body.style.overflow = 'hidden';
  };

  const closeModal = () => {
    const overlay = $('#app-modal');
    if (!overlay) return;
    overlay.classList.remove('show');
    doc.body.style.overflow = '';
  };

  const buildDownloadContent = (category, info) => {
    let html = '';
    if (category === 'android') {
      const links = PAN_DISK.order
        .filter((k) => info[k])
        .map(
          (k) =>
            `<a href="${esc(info[k])}" target="_blank" rel="nofollow noopener" class="download-link-item"><img src="${esc(
              PAN_DISK.icons[k]
            )}" alt="" loading="lazy" onerror="window.imgFallback(this)"><span>${esc(PAN_DISK.labels[k])}</span></a>`
        )
        .join('');
      html += links
        ? `<div class="download-title">选择下载方式</div><div class="download-links-container">${links}</div>`
        : '<div class="no-download-link">暂无下载链接</div>';
    } else if (category === 'ios') {
      const text = (info.text || '').replace(/\\n/g, '\n').replace(/\n/g, '<br>');
      if (text) html += `<div class="download-title">${text}</div>`;
      html += `<div class="app-store-link-box">口令：<span id="appStoreLink">${esc(info.copy || info.link || '')}</span></div>`;
      html += '<button class="copy-btn" type="button"><i class="fas fa-copy"></i> 复制口令</button>';
      html += `<a href="https://apps.apple.com/cn/app/id${esc(info.link || '')}" target="_blank" rel="noopener" class="app-store-download-btn"><i class="fab fa-apple"></i> AppStore 下载</a>`;
    }
    return html;
  };

  const flashBtn = (btn, ok) => {
    if (!btn) return;
    const old = btn.innerHTML;
    btn.innerHTML = ok ? '<i class="fas fa-check"></i> 复制成功' : '<i class="fas fa-times"></i> 复制失败';
    setTimeout(() => { btn.innerHTML = old; }, 1500);
  };

  const openDownloadPopup = (category, info) => {
    if (!info) return;
    openModal(`下载 ${info.name || ''}`, buildDownloadContent(category, info));
    if (category === 'ios') {
      const btn = $('#app-modal').querySelector('.copy-btn');
      if (btn)
        btn.addEventListener('click', () => {
          const linkEl = $('#appStoreLink');
          const text = linkEl ? linkEl.textContent : '';
          copyText(text).then(() => flashBtn(btn, true), () => flashBtn(btn, false));
        });
    }
  };

  const handleAppClick = (e) => {
    const item = e.target.closest('.app-card');
    if (!item) return;
    const category = item.dataset.category;
    const name = item.dataset.name;
    if (category === 'web') {
      const site = findByName(getData(PLATFORMS.web.dataKey), name);
      if (site && site.link) win.open(site.link, '_blank', 'noopener');
      return;
    }
    const info = findByName(getData(PLATFORMS[category].dataKey), name);
    openDownloadPopup(category, info);
  };

  const init = () => {
    renderSkeleton(SKELETON_COUNT);
    doc.addEventListener('click', (e) => {
      if (e.target.closest('.app-card')) handleAppClick(e);
    });
    const overlay = $('#app-modal');
    if (overlay) overlay.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });
    loadData().then(() => {
      renderChips();
      initChips();
    });
  };

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
})(window, document);
