(() => {
  'use strict';

  const RANK_MAX = 30;            // 排行榜最多展示条数
  const DEFAULT_RANGE = 'day';    // 进入页面默认展示「日榜」
  let curRange = DEFAULT_RANGE;

  const goSearch = word => { location.href = '/search?key=' + encodeURIComponent(word); };

  async function loadRank(range) {
    const listEl = document.getElementById('rank-list');
    if (!listEl) return;
    listEl.innerHTML = '<li class="rank-loading"><i class="fas fa-spinner fa-spin"></i> 加载中…</li>';
    try {
      const r = await fetch('/api/search-rank?range=' + encodeURIComponent(range) + '&n=' + RANK_MAX);
      const data = await r.json();
      const arr = (data && Array.isArray(data.list)) ? data.list : [];
      if (!arr.length) { listEl.innerHTML = '<li class="rank-empty">暂无搜索排行数据</li>'; return; }
      listEl.innerHTML = '';
      arr.forEach((it, i) => {
        const li = document.createElement('li');
        if (i === 0) li.className = 'top1';
        else if (i === 1) li.className = 'top2';
        else if (i === 2) li.className = 'top3';
        li.innerHTML = '<span class="rk-word">' + esc(it.word) + '</span>'
          + (it.count != null ? '<span class="rk-count">' + it.count + ' 次搜索</span>' : '');
        li.addEventListener('click', () => goSearch(it.word));
        listEl.appendChild(li);
      });
    } catch (_) {
      listEl.innerHTML = '<li class="rank-empty">加载失败，请稍后重试</li>';
    }
  }

  const init = () => {
    document.querySelectorAll('#rank-tabs .rank-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.classList.contains('active')) return;
        document.querySelectorAll('#rank-tabs .rank-tab').forEach(x => x.classList.remove('active'));
        btn.classList.add('active');
        curRange = btn.dataset.range;
        loadRank(curRange);
      });
    });
    loadRank(curRange);
  };

  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
