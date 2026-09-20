(function (win, doc) {
  'use strict';

  const ua = win.navigator.userAgent || '';
  const DEVICE = /iPad|iPhone|iPod/i.test(ua) ? 'ios' : 'android';
  const DATA_TIMEOUT = 10000;
  const SKELETON_COUNT = 6;

  const PLATFORMS = {
    android: { icon: 'fab fa-android', dataKey: 'android-list', label: '安卓APP', sub: '安卓应用 · 网盘下载', cta: '下载', ctaIcon: 'fas fa-download' },
    ios: { icon: 'fab fa-apple', dataKey: 'ios-list', label: '苹果APP', sub: 'iOS 应用 · App Store', cta: '下载', ctaIcon: 'fas fa-download' },
  };

  const PAN_DISK = {
    icons: {
      uc: 'https://pp.myapp.com/ma_icon/0/icon_10936_1787015999/96',
      baidu: 'https://pp.myapp.com/ma_icon/0/icon_116071_1789549946/96',
      quark: 'https://pp.myapp.com/ma_icon/0/icon_42375936_1789644866/96',
      thunder: 'https://pp.myapp.com/ma_icon/0/icon_113692_1775128288/96',
      other: 'https://pp.myapp.com/ma_icon/0/icon_116071_1789549946/96',
    },
    labels: { uc: 'UC网盘', baidu: '百度网盘', quark: '夸克网盘', thunder: '迅雷网盘', other: '其他网盘' },
    order: ['uc', 'quark', 'baidu', 'thunder', 'other'],
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

  // 当天（本地日期）新增/修改的 APP 显示「新」角标；ut 由后台保存时间生成，仅作判断不展示
  const isToday = (ts) => {
    if (!ts) return false;
    const d = new Date(ts < 1e12 ? ts * 1000 : ts);
    const n = new Date();
    return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
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
      `<button class="app-card__btn" type="button"><i class="${p.ctaIcon}"></i> ${esc(p.cta)}</button>` +
      (isToday(app.ut) ? '<span class="app-card__badge">新</span>' : '');
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
      let methods = Array.isArray(info.methods) ? info.methods.filter((m) => m && m.url) : [];
      if (!methods.length) methods = PAN_DISK.order.filter((k) => info[k]).map((k) => ({ type: k, url: info[k] }));
      const links = methods
        .map((m) => {
          const icon = PAN_DISK.icons[m.type] || PAN_DISK.icons.other;
          const label = PAN_DISK.labels[m.type] || '下载';
          return `<a href="${esc(m.url)}" target="_blank" rel="nofollow noopener" class="download-link-item"><img src="${esc(
            icon
          )}" alt="" loading="lazy" onerror="window.imgFallback(this)"><span>${esc(label)}</span><i class="fas fa-arrow-right dl-arrow"></i></a>`;
        })
        .join('');
      html += links
        ? `<div class="download-title">选择下载方式</div><div class="download-links-container">${links}</div>`
        : '<div class="no-download-link">暂无下载链接</div>';
    } else if (category === 'ios') {
      if (info.link) {
        html += `<a href="https://apps.apple.com/cn/app/id${esc(info.link)}" target="_blank" rel="noopener" class="app-store-download-btn"><i class="fab fa-apple"></i> App Store 下载</a>`;
      }
      const code = String(info.copy || '').trim();
      if (code) {
        html += `<div class="download-title">兑换口令（复制后在 App Store 粘贴）</div><div class="dl-code">${esc(code)}</div><button class="copy-btn" type="button"><i class="fas fa-copy"></i> 复制口令</button>`;
      } else if (info.text) {
        const t = String(info.text).replace(/\n/g, '<br>');
        html += `<div class="download-title">${t}</div>`;
      }
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
    const cover = info.pic
      ? `<div class="download-cover"><img src="${esc(info.pic)}" alt="${esc(info.name)}" loading="lazy" onerror="window.imgFallback(this)"></div>`
      : '';
    openModal(`下载 ${esc(info.name || '')}`, cover + buildDownloadContent(category, info));
    if (category === 'ios') {
      const btn = $('#app-modal').querySelector('.copy-btn');
      if (btn)
        btn.addEventListener('click', () => {
          const codeEl = $('#app-modal').querySelector('.dl-code');
          const text = codeEl ? codeEl.textContent : '';
          copyText(text).then(() => flashBtn(btn, true), () => flashBtn(btn, false));
        });
    }
  };

  const handleAppClick = (e) => {
    const item = e.target.closest('.app-card');
    if (!item) return;
    const category = item.dataset.category;
    const name = item.dataset.name;
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
