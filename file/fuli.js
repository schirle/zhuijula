(() => {
  'use strict';

  const catsEl = document.getElementById('fuli-cats');
  const itemsEl = document.getElementById('fuli-items');
  if (!catsEl || !itemsEl) return;

  let active = '全部';
  let allItems = [];

  const renderItems = (cat) => {
    const rows = cat === '全部' ? allItems : allItems.filter(i => (i.name || '未分类') === cat);
    if (!rows.length) {
      itemsEl.innerHTML = '<span class="fl-empty">该分类暂无福利</span>';
      return;
    }
    const frag = document.createDocumentFragment();
    for (const it of rows) {
      const a = document.createElement('a');
      a.className = 'fuli-item';
      a.href = it.link || '#';
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.innerHTML = '<span class="fi-title">' + esc(it.title || '未命名') + '</span><i class="fas fa-arrow-up-right-from-square fi-go"></i>';
      frag.appendChild(a);
    }
    itemsEl.innerHTML = '';
    itemsEl.appendChild(frag);
  };

  const renderCats = (cats) => {
    catsEl.innerHTML = '';
    ['全部', ...cats].forEach(cat => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fuli-cat' + (cat === active ? ' active' : '');
      b.textContent = cat;
      b.addEventListener('click', () => { active = cat; renderCats(cats); renderItems(active); });
      catsEl.appendChild(b);
    });
  };

  const load = async () => {
    itemsEl.innerHTML = '<span class="fl-loading">福利加载中…</span>';
    let data;
    try {
      const r = await fetch('/api/fuli', { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      data = await r.json().catch(() => null);
    } catch (e) {
      itemsEl.innerHTML = '<span class="fl-empty">福利加载失败，请稍后再试</span>';
      return;
    }
    if (!data || !Array.isArray(data.list) || !data.list.length) {
      itemsEl.innerHTML = '<span class="fl-empty">暂无福利数据</span>';
      return;
    }
    allItems = data.list.filter(i => i && i.title);
    if (!allItems.length) {
      itemsEl.innerHTML = '<span class="fl-empty">暂无福利数据</span>';
      return;
    }
    const cats = [];
    for (const it of allItems) {
      const n = it.name || '未分类';
      if (!cats.includes(n)) cats.push(n);
    }
    active = (active === '全部' || cats.includes(active)) ? active : '全部';
    renderCats(cats);
    renderItems(active);
  };

  const refreshBtn = document.getElementById('fuli-refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', () => load());

  load();
})();
