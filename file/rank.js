(() => {
  'use strict';
  const RANK_MAX = 30;          // 拉取条数
  const PODIUM_N = 3;           // 领奖台取前 3
  const CLOUD_N = 16;           // 词云最多显示几个
  const DEFAULT_RANGE = 'day';
  let curRange = DEFAULT_RANGE;

  const $ = (id) => document.getElementById(id);
  const nf = (n) => (Number(n) || 0).toLocaleString('zh-CN');   // 1234 → 1,234
  const goSearch = (word) => { location.href = '/search?key=' + encodeURIComponent(word); };
  const MEDALS = [
    { cls: 'rank-1', icon: 'fa-crown', label: '第 1 名' },
    { cls: 'rank-2', icon: 'fa-medal', label: '第 2 名' },
    { cls: 'rank-3', icon: 'fa-medal', label: '第 3 名' },
  ];

  // 趋势徽标：新上榜 / 上升 / 下降（今天和昨天比）
  const trendHtml = (it) => {
    if (it.trend === 'new') return '<span class="rk-trend new">新上榜</span>';
    if (it.trend === 'up') return '<span class="rk-trend up"><i class="fas fa-caret-up"></i>上升</span>';
    if (it.trend === 'down') return '<span class="rk-trend down"><i class="fas fa-caret-down"></i>下降</span>';
    return '';
  };

  const skeletonRows = () => '<li class="rank-skeleton"></li>'.repeat(6);

  // 顶部统计条：只在有真实数据时显示
  const renderStats = (meta) => {
    const box = $('rank-stats');
    if (!box) return;
    if (!meta || meta.demo) { box.innerHTML = ''; box.style.display = 'none'; return; }
    const items = [
      { icon: 'fa-hashtag', val: nf(meta.words), label: '收录热词' },
      { icon: 'fa-magnifying-glass-chart', val: nf(meta.sum), label: '榜单搜索量' },
      { icon: 'fa-fire', val: nf(meta.todaySum), label: '今日搜索' },
      { icon: 'fa-bolt', val: nf(meta.todayWords), label: '今日活跃词' },
    ];
    box.style.display = '';
    box.innerHTML = items.map((x) =>
      '<div class="rank-stat"><i class="fas ' + x.icon + '"></i><div class="rs-text"><b>' + x.val + '</b><span>' + x.label + '</span></div></div>'
    ).join('');
  };

  // 领奖台（前 3 名单独做成卡片）
  const renderPodium = (list) => {
    const box = $('rank-podium');
    if (!box) return;
    const top = list.slice(0, PODIUM_N);
    if (top.length < PODIUM_N) { box.style.display = 'none'; box.innerHTML = ''; return; }
    box.style.display = '';
    box.innerHTML = top.map((it, i) => {
      const m = MEDALS[i];
      return '<button type="button" class="pod-item ' + m.cls + '" data-word="' + esc(it.word) + '">'
        + '<span class="pod-medal"><i class="fas ' + m.icon + '"></i></span>'
        + '<span class="pod-rank">' + (i + 1) + '</span>'
        + '<span class="pod-word">' + esc(it.word) + '</span>'
        + '<span class="pod-count">' + nf(it.count) + ' 次</span>'
        + trendHtml(it)
        + '</button>';
    }).join('');
    box.querySelectorAll('.pod-item').forEach((el) => {
      el.addEventListener('click', () => goSearch(el.dataset.word || ''));
    });
  };

  // 完整榜单：序号 + 词 + 热度条 + 次数 + 趋势
  const renderList = (list, meta) => {
    const listEl = $('rank-list');
    if (!listEl) return;
    const note = $('rank-note');
    const max = Math.max(1, ...list.map((x) => Number(x.count) || 0));
    listEl.innerHTML = list.map((it, i) => {
      const cnt = Number(it.count) || 0;
      const pct = Math.max(4, Math.round((cnt / max) * 100));   // 相对第一名的热度
      const cls = i === 0 ? ' top1' : (i === 1 ? ' top2' : (i === 2 ? ' top3' : ''));
      return '<li class="rk-row' + cls + '" data-word="' + esc(it.word) + '">'
        + '<span class="rk-word">' + esc(it.word) + '</span>'
        + trendHtml(it)
        + '<span class="rk-count">' + nf(cnt) + '</span>'
        + '<span class="rk-heat" style="width:' + pct + '%"></span>'
        + '</li>';
    }).join('');
    if (note) {
      const t = meta && meta.updated ? new Date(meta.updated) : null;
      note.textContent = t && !meta.demo
        ? '更新于 ' + t.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        : '';
    }
    listEl.querySelectorAll('.rk-row').forEach((el) => {
      el.addEventListener('click', () => goSearch(el.dataset.word || ''));
    });
  };

  // 热词云：字号按搜索量缩放
  const renderCloud = (list) => {
    const box = $('rank-cloud-box');
    const cloud = $('rank-cloud');
    const layout = $('rank-layout');
    if (!box || !cloud) return;
    const arr = list.slice(0, CLOUD_N);
    if (arr.length < 6) {
      box.style.display = 'none';
      // 词云不显示时让榜单占满整行（PC 两栏布局下右侧不留空柱）
      if (layout) layout.classList.add('no-side');
      return;
    }
    const max = Math.max(1, ...arr.map((x) => Number(x.count) || 0));
    const min = Math.min(...arr.map((x) => Number(x.count) || 0));
    box.style.display = '';
    if (layout) layout.classList.remove('no-side');
    cloud.innerHTML = arr.map((it) => {
      const c = Number(it.count) || 0;
      const k = max > min ? (c - min) / (max - min) : 1;
      const size = (13 + k * 7).toFixed(1);          // 13px ~ 20px
      const w = (400 + Math.round(k * 300));         // 字重也跟着变
      return '<button type="button" class="cloud-tag" data-word="' + esc(it.word) + '" style="font-size:' + size + 'px;font-weight:' + w + '">'
        + esc(it.word) + '</button>';
    }).join('');
    cloud.querySelectorAll('.cloud-tag').forEach((el) => {
      el.addEventListener('click', () => goSearch(el.dataset.word || ''));
    });
  };

  const showEmpty = (listEl, msg, isErr) => {
    if (!listEl) return;
    listEl.innerHTML = '<li class="rank-empty"><i class="fas ' + (isErr ? 'fa-triangle-exclamation' : 'fa-ghost') + '"></i> '
      + msg
      + (isErr ? ' <button type="button" class="rank-retry" id="rank-retry">重试</button>' : '')
      + '</li>';
    const btn = $('rank-retry');
    if (btn) btn.addEventListener('click', () => loadRank(curRange));
  };

  async function loadRank(range) {
    const listEl = $('rank-list');
    const podium = $('rank-podium');
    const cloudBox = $('rank-cloud-box');
    if (!listEl) return;
    listEl.innerHTML = skeletonRows();
    if (podium) { podium.style.display = 'none'; podium.innerHTML = ''; }
    if (cloudBox) {
      cloudBox.style.display = 'none';
      const layout = $('rank-layout');
      if (layout) layout.classList.add('no-side');   // 加载/空数据期间榜单先占满整行
    }
    renderStats(null);
    try {
      const r = await fetch('/api/search-rank?range=' + encodeURIComponent(range) + '&n=' + RANK_MAX);
      const data = await r.json();
      const arr = (data && Array.isArray(data.list)) ? data.list : [];
      if (!arr.length) {
        showEmpty(listEl, '还没有人搜索过，去首页逛逛吧');
        const note = $('rank-note'); if (note) note.textContent = '';
        return;
      }
      const meta = data.meta || null;
      renderStats(meta);
      renderPodium(arr);
      renderList(arr, meta);
      renderCloud(arr);
      if (meta && meta.demo) {
        // 真实数据还没攒起来：说明一下，别让访客以为这些数字是站内真实搜索量
        const note = $('rank-note');
        if (note) note.textContent = '数据积累中 · 以下为热门推荐';
      }
    } catch (_) {
      showEmpty(listEl, '加载失败，请稍后重试', true);
      const note = $('rank-note'); if (note) note.textContent = '';
    }
  }

  const init = () => {
    document.querySelectorAll('#rank-tabs .rank-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.classList.contains('active')) return;
        document.querySelectorAll('#rank-tabs .rank-tab').forEach((x) => x.classList.remove('active'));
        btn.classList.add('active');
        curRange = btn.dataset.range;
        loadRank(curRange);
      });
    });
    loadRank(curRange);
  };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
