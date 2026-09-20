(() => {
        'use strict';

        const MAX_CARDS = 240;
        const SEARCH_PAGE_SIZE = 14;
        const SEARCH_TIMEOUT_MS = 35000;
        const MAX_HISTORY = 20;
        const SEARCH_RANK_KEY = 'ftv_search_rank';
        const HISTORY_KEY = 'ftv_history';

        const WP_PAGE_SIZE = 10;
        const WP_CATS = [
            { key: 'all', label: '全部' },
            { key: 'quark', label: '夸克' },
            { key: 'baidu', label: '百度' },
            { key: 'uc', label: 'UC' },
            { key: 'xunlei', label: '迅雷' },
        ];
        const WP_TYPE_LABEL = { baidu: '百度网盘', quark: '夸克', xunlei: '迅雷', uc: 'UC', other: '网盘' };

        let abortCtrl = null, lastSearch = '';
        let searchList = [], searchShown = 0;
        let wpList = [], wpShown = WP_PAGE_SIZE, wpCat = 'all', wpLoadedFor = '';
        let curTab = 'all';
        let currentKw = '';

        const { observe: observeImages } = initLazyImages('300px');

        /* ══════════ 搜索历史 / 热搜上报 ══════════ */
        let searchHistory = lsGetJson(HISTORY_KEY) || [];
        const addHistory = word => {
            if (!word) return;
            searchHistory = searchHistory.filter(w => w !== word);
            searchHistory.unshift(word);
            if (searchHistory.length > MAX_HISTORY) searchHistory.pop();
            lsSetJson(HISTORY_KEY, searchHistory);
        };
        const recordHotSearch = w => {
            try { fetch('/api/search-rank?record=' + encodeURIComponent(w), { keepalive: true }).catch(() => {}); } catch (_) {}
        };
        const incSearchRank = word => {
            if (!word) return;
            try {
                const m = lsGetJson(SEARCH_RANK_KEY) || {};
                m[word] = (m[word] || 0) + 1;
                lsSetJson(SEARCH_RANK_KEY, m);
            } catch (_) {}
        };

        /* ══════════ 卡片 ══════════ */
        function makeCard({ pic, title, sub = '', badge = '', badgeClass = 'card-badge', quality = '', href, newTab = false }) {
            const a = document.createElement('a');
            a.className = 'card'; a.title = title;
            if (href) { a.href = href; if (newTab) { a.target = '_blank'; a.rel = 'noopener'; } }
            else { a.href = 'javascript:void(0)'; a.addEventListener('click', e => e.preventDefault()); }

            const imgWrap = document.createElement('div');
            imgWrap.className = 'card-img-wrap';
            const img = document.createElement('img');
            img.alt = title; img.loading = 'lazy';
            if (pic) img.setAttribute('data-src', proxyImg(pic));
            imgWrap.appendChild(img);

            const loadingEl = document.createElement('div');
            loadingEl.className = 'img-loading';
            loadingEl.innerHTML = '<img src="file/loading.gif" alt="">';
            imgWrap.appendChild(loadingEl);

            if (quality) { const q = document.createElement('span'); q.className = 'card-quality'; q.textContent = quality; imgWrap.appendChild(q); }
            if (badge) { const b = document.createElement('span'); b.className = badgeClass; b.textContent = badge; imgWrap.appendChild(b); }

            const mask = document.createElement('div');
            mask.className = 'play-mask';
            mask.innerHTML = '<span class="play-ico"><i class="fas fa-play"></i></span>';
            imgWrap.appendChild(mask);

            const h2 = document.createElement('h2');
            h2.className = 'card-title'; h2.textContent = title;
            a.appendChild(imgWrap); a.appendChild(h2);
            if (sub) { const p = document.createElement('p'); p.className = 'card-sub'; p.textContent = sub; a.appendChild(p); }
            return a;
        }
        const createResultCard = item => makeCard({
            pic: item.vod_pic, title: item.vod_name || '未知',
            sub: item._api_source ? '来源：' + item._api_source : '',
            badge: item.vod_remarks || '',
            href: playHref(item.vod_id || 0, item._api_source || ''),
            newTab: false,
        });

        /* ══════════ 搜索主流程 ══════════ */
        function showSkeleton() {
            const area = document.getElementById('result-area');
            if (!area) return;
            document.title = '搜索中… - 免费追剧';
            const isPC = window.matchMedia('(min-width: 768px)').matches;
            const count = isPC ? 10 : 6;
            area.innerHTML = '<div class="result-header"><span class="section-title"><i class="fas fa-spinner fa-spin" style="color:var(--primary)"></i> 正在搜索中…</span></div>'
                + '<div class="grid-container">' + '<div class="card"><div class="card-img-wrap"><div class="skeleton-img"></div></div><div class="skeleton-text"></div></div>'.repeat(count) + '</div>';
        }

        async function doSearch(keyword) {
            const kw = (keyword || '').trim();
            if (!kw || kw === lastSearch) return;
            lastSearch = kw;
            currentKw = kw;
            recordHotSearch(kw);
            addHistory(kw);
            incSearchRank(kw);
            if (location.search !== `?key=${encodeURIComponent(kw)}`) history.replaceState(null, '', `${location.pathname}?key=${encodeURIComponent(kw)}`);
            const sInput = document.getElementById('s-input');
            if (sInput) { sInput.value = kw; document.getElementById('s-clear')?.classList.add('visible'); }

            abortCtrl?.abort();
            abortCtrl = new AbortController();

            // 切回「全部」Tab 并重置网盘
            if (curTab !== 'all') switchTab('all', true);
            wpLoadedFor = '';
            const wpArea = document.getElementById('wp-area');
            if (wpArea) { wpArea.style.display = 'none'; wpArea.innerHTML = ''; }

            showSkeleton();
            const timeoutId = setTimeout(() => abortCtrl?.abort(), SEARCH_TIMEOUT_MS);
            try {
                const resp = await fetch(`/api/search?key=${encodeURIComponent(kw)}`, { signal: abortCtrl.signal });
                let data;
                if (resp.ok) data = await resp.json();
                else {
                    let msg = '服务器开小差，请稍后重试';
                    if (resp.status === 503) msg = '数据源暂时繁忙，请稍后重试';
                    else if (resp.status === 429) msg = '请求过于频繁，请稍后再试';
                    else if (resp.status === 502) msg = '片源响应超时，请重试';
                    data = { code: 0, msg };
                }
                renderResults(data, kw);
            } catch (err) {
                if (err.name === 'AbortError') renderResults({ code: 0, msg: '搜索超时，片源响应较慢，请稍后重试' }, kw);
                else renderResults({ code: 0, msg: '网络错误，请检查连接后重试' }, kw);
            } finally {
                clearTimeout(timeoutId);
                abortCtrl = null;
            }
        }

        function renderResults(data, keyword) {
            const area = document.getElementById('result-area');
            if (!area) return;
            document.title = `搜索：${keyword} - 免费追剧`;
            const hasList = data && data.code === 1 && Array.isArray(data.list) && data.list.length;
            if (!hasList) {
                const msg = (data && data.code === 0 && data.msg) ? esc(data.msg)
                    : `未找到与 "${esc(keyword)}" 相关的结果<br><small style="opacity:0.6;margin-top:6px;display:inline-block">试试换个关键词</small>`;
                area.innerHTML = `<div class="empty-result"><div class="empty-icon"><i class="fas fa-circle-exclamation"></i></div>${msg}<br><button class="retry-btn" id="s-retry"><i class="fas fa-rotate-right"></i> 重新搜索</button></div>`;
                document.getElementById('s-retry')?.addEventListener('click', () => { lastSearch = ''; doSearch(keyword); });
                return;
            }
            searchList = data.list.slice(0, MAX_CARDS);
            searchShown = 0;
            area.innerHTML = '<div class="result-header"><span class="section-title">搜索结果</span><span class="result-count">共 <strong>' + searchList.length + '</strong> 条</span></div>'
                + '<div class="grid-container" id="result-grid"></div>'
                + '<div class="s-more-wrap"><button class="s-more" id="s-more" style="display:none">展开更多 <i class="fas fa-chevron-down"></i></button></div>';
            document.getElementById('s-more')?.addEventListener('click', () => showMoreResults());
            showMoreResults();
        }

        function showMoreResults() {
            const grid = document.getElementById('result-grid');
            const more = document.getElementById('s-more');
            if (!grid) return;
            const start = searchShown;
            const end = Math.min(start + SEARCH_PAGE_SIZE, searchList.length);
            const frag = document.createDocumentFragment();
            for (let i = start; i < end; i++) frag.appendChild(createResultCard(searchList[i]));
            grid.appendChild(frag);
            searchShown = end;
            observeImages(grid);
            if (more) {
                if (end < searchList.length) { more.style.display = ''; more.disabled = false; more.innerHTML = '展开更多 <i class="fas fa-chevron-down"></i>'; }
                else more.style.display = 'none';
            }
        }

        /* ══════════ Tab 切换 ══════════ */
        function switchTab(tab, silent) {
            curTab = tab;
            document.querySelectorAll('#s-tabs .s-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
            const resultArea = document.getElementById('result-area');
            const wpArea = document.getElementById('wp-area');
            if (tab === 'all') {
                if (resultArea) resultArea.style.display = '';
                if (wpArea) wpArea.style.display = 'none';
            } else {
                if (resultArea) resultArea.style.display = 'none';
                if (wpArea) wpArea.style.display = '';
                if (currentKw && wpLoadedFor !== currentKw) loadWp(currentKw);
            }
        }

        /* ══════════ 网盘资源 ══════════ */
        async function loadWp(keyword) {
            const wpEl = document.getElementById('wp-area');
            if (!wpEl) return;
            wpLoadedFor = keyword;
            wpEl.innerHTML = '<div class="wp-header"><span class="section-title"><i class="fas fa-cloud" style="color:var(--primary)"></i> 网盘资源</span><span class="wp-hint">资源来自网络，请自行甄别</span></div><div class="wp-loading"><i class="fas fa-spinner fa-spin"></i> 正在检索网盘资源…</div>';
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 30000);
            try {
                const resp = await fetch(`/api/wp?word=${encodeURIComponent(keyword)}`, { signal: ctrl.signal });
                if (!resp.ok) throw new Error('status ' + resp.status);
                const data = await resp.json();
                renderWp(wpEl, data, keyword);
            } catch (e) {
                wpEl.innerHTML = '<div class="wp-header"><span class="section-title"><i class="fas fa-cloud" style="color:var(--primary)"></i> 网盘资源</span></div><div class="wp-empty">网盘资源检索暂不可用，请稍后重试</div>';
            } finally { clearTimeout(t); }
        }

        function renderWp(wpEl, data, keyword) {
            const list = Array.isArray(data?.results) ? data.results : [];
            if (!list.length) {
                wpEl.innerHTML = '<div class="wp-header"><span class="section-title"><i class="fas fa-cloud" style="color:var(--primary)"></i> 网盘资源</span></div><div class="wp-empty">未找到与 "' + esc(keyword) + '" 相关的网盘资源</div>';
                return;
            }
            wpList = list; wpShown = WP_PAGE_SIZE; wpCat = 'all';
            renderWpPage();
        }

        function renderWpPage() {
            const wpEl = document.getElementById('wp-area');
            if (!wpEl) return;
            const filtered = wpCat === 'all' ? wpList : wpList.filter(it => it.type === wpCat);
            const shown = Math.min(wpShown, filtered.length);
            const header = '<div class="wp-header"><span class="section-title"><i class="fas fa-cloud" style="color:var(--primary)"></i> 网盘资源</span><span class="wp-count">共 ' + filtered.length + ' 条</span></div>';
            const cats = '<div class="wp-cats">' + WP_CATS.map(c =>
                '<button class="wp-cat' + (c.key === wpCat ? ' active' : '') + '" data-cat="' + c.key + '">' + c.label + '</button>').join('') + '</div>';
            const items = [];
            for (let i = 0; i < shown; i++) {
                const it = filtered[i];
                const typeLabel = WP_TYPE_LABEL[it.type] || '网盘';
                items.push('<div class="wp-item" data-type="' + esc(it.type) + '" data-url="' + esc(it.link) + '" data-title="' + esc(it.title || '') + '">'
                    + '<span class="wp-type wp-type-' + esc(it.type) + '">' + typeLabel + '</span>'
                    + '<span class="wp-title">' + esc(it.title || '') + '</span></div>');
            }
            let html = header + cats + '<div class="wp-list">' + items.join('') + '</div>';
            if (shown < filtered.length) {
                html += '<div class="s-more-wrap"><button class="s-more" data-pg="more">加载更多 (' + (filtered.length - shown) + ')</button></div>';
            }
            wpEl.innerHTML = html;
            wpEl.onclick = e => {
                const item = e.target.closest('.wp-item');
                if (item) { openWpModal({ type: item.dataset.type, link: item.dataset.url, title: item.dataset.title || '' }); return; }
                if (e.target.closest('[data-pg="more"]')) { wpShown += WP_PAGE_SIZE; renderWpPage(); }
            };
            wpEl.querySelectorAll('.wp-cat').forEach(btn => {
                btn.onclick = () => {
                    const cat = btn.getAttribute('data-cat');
                    if (cat === wpCat) return;
                    wpCat = cat; wpShown = WP_PAGE_SIZE;
                    renderWpPage();
                };
            });
        }

        /* 网盘转存弹窗 */
        function ensureWpTip() {
            let el = document.getElementById('wp-tip-overlay');
            if (el) return el;
            el = document.createElement('div');
            el.id = 'wp-tip-overlay';
            el.className = 'modal-overlay';
            el.innerHTML = '<div class="modal-content"></div>';
            el.addEventListener('click', e => { if (e.target === el) el.classList.remove('show'); });
            document.body.appendChild(el);
            return el;
        }
        function showWpTip({ icon, title, body, link, openLabel = '打开链接', status = 'info' }) {
            const el = ensureWpTip();
            const box = el.querySelector('.modal-content');
            box.innerHTML = '<div class="modal-icon"><i class="fas ' + icon + '"></i></div>'
                + '<div class="modal-title">' + title + '</div>'
                + '<div class="modal-body">' + body + '</div>'
                + (link ? '<button class="modal-btn" id="wp-tip-open">' + openLabel + '</button>' : '');
            box.classList.add('wp-tip', 'wp-tip-' + status);
            if (link) box.querySelector('#wp-tip-open').addEventListener('click', () => window.open(link, '_blank', 'noopener'));
            el.classList.add('show');
        }

        const _transferring = new Set();
        async function openWpModal(it) {
            const label = WP_TYPE_LABEL[it.type] || '网盘';
            const canTransfer = (it.type === 'quark' || it.type === 'baidu');
            if (!canTransfer) {
                showWpTip({
                    icon: 'fa-arrow-up-right-from-square', title: label + '资源',
                    body: '该资源为 ' + label + '，请点击下方按钮保存到我的网盘。',
                    link: it.link, openLabel: '保存到我的网盘', status: 'info',
                });
                return;
            }
            if (_transferring.has(it.link)) {
                showWpTip({ icon: 'fa-spinner fa-spin', title: label + ' · 正在获取链接', body: '正在获取链接，请稍候…', status: 'loading' });
                return;
            }
            _transferring.add(it.link);
            showWpTip({ icon: 'fa-spinner fa-spin', title: label + ' · 正在获取链接', body: '正在获取链接，请稍候…', status: 'loading' });
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 75000);
            try {
                const r = await fetch('/api/transfer?type=' + encodeURIComponent(it.type) + '&url=' + encodeURIComponent(it.link), { signal: ctrl.signal });
                const data = await r.json().catch(() => ({}));
                if (data.error) {
                    showWpTip({ icon: 'fa-circle-exclamation', title: label + ' · 链接已失效', body: '该资源链接可能已失效，请尝试其他资源或稍后重试。', status: 'error' });
                } else {
                    showWpTip({
                        icon: 'fa-circle-check', title: label + ' · 链接获取成功',
                        body: '链接已生成，<b>仅有效 1 天</b>，请尽快保存到你的网盘。',
                        link: data.url, openLabel: '保存到我的网盘', status: 'success',
                    });
                }
            } catch (e) {
                showWpTip({ icon: 'fa-circle-exclamation', title: label + ' · 链接已失效', body: '网络异常，请稍后重试。', status: 'error' });
            } finally {
                clearTimeout(timer);
                _transferring.delete(it.link);
            }
        }

        /* ══════════ 右侧榜单 ══════════ */
        const sideGoSearch = (el, word) => {
            el.addEventListener('click', () => {
                doSearch(word);
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
        };
        async function loadSideHot() {
            const list = document.getElementById('side-hot');
            if (!list) return;
            try {
                const r = await fetch('/api/search-rank');
                const data = await r.json();
                const arr = (data && Array.isArray(data.list)) ? data.list : [];
                if (!arr.length) { list.innerHTML = '<li class="side-rank-empty">暂无热搜数据</li>'; return; }
                list.innerHTML = '';
                arr.slice(0, 10).forEach((it, i) => {
                    const li = document.createElement('li');
                    if (i === 0) li.className = 'top'; else if (i === 1) li.className = 'top2'; else if (i === 2) li.className = 'top3';
                    li.innerHTML = '<span class="rk-word">' + esc(it.word) + '</span>' + (it.count ? '<span class="rk-count">' + it.count + '</span>' : '');
                    sideGoSearch(li, it.word);
                    list.appendChild(li);
                });
            } catch (_) { list.innerHTML = '<li class="side-rank-empty">加载失败</li>'; }
        }
        async function loadSideDouban() {
            const list = document.getElementById('side-douban');
            if (!list) return;
            try {
                const r = await fetch('/api/douban-hot?type=全部&limit=10');
                const data = await r.json();
                const arr = (data && Array.isArray(data.list)) ? data.list : [];
                if (!arr.length) { list.innerHTML = '<li class="side-rank-empty">暂无数据</li>'; return; }
                list.innerHTML = '';
                arr.slice(0, 10).forEach((m, i) => {
                    const li = document.createElement('li');
                    if (i === 0) li.className = 'top'; else if (i === 1) li.className = 'top2'; else if (i === 2) li.className = 'top3';
                    li.innerHTML = '<span class="rk-word">' + esc(m.title || '') + '</span>' + (m.rating ? '<span class="rk-count">★' + Number(m.rating).toFixed(1) + '</span>' : '');
                    sideGoSearch(li, m.title);
                    list.appendChild(li);
                });
            } catch (_) { list.innerHTML = '<li class="side-rank-empty">加载失败</li>'; }
        }
        async function loadSidePl() {
            const box = document.getElementById('side-pl-box');
            const el = document.getElementById('side-pl');
            if (!box || !el) return;
            try {
                const r = await fetchWithTimeout('/api/pdlist', {}, 12000);
                const data = await r.json();
                const lists = ((data && data.lists) || []).filter(l => l && l.cover && l.title).slice(0, 4);
                if (!lists.length) { box.style.display = 'none'; return; }
                el.innerHTML = '';
                lists.forEach(pl => {
                    const a = document.createElement('a');
                    a.className = 'side-pl-item';
                    a.href = '/list.html?id=' + encodeURIComponent(pl.id);
                    a.innerHTML = '<img src="' + esc(proxyImg(pl.cover)) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility=\'hidden\'">'
                        + '<div class="side-pl-info"><div class="side-pl-name">' + esc(cleanPlaylistTitle(pl.title)) + '</div>'
                        + '<div class="side-pl-meta">' + (pl.count ? pl.count + ' 部作品' : '精选片单') + '</div></div>';
                    el.appendChild(a);
                });
                box.style.display = '';
            } catch (_) { box.style.display = 'none'; }
        }

        /* 今日推荐（每日推荐接口，失败回退豆瓣热门） */
        function parseDaily(data) {
            const src = (data && (data.data || data)) || {};
            let arr = [];
            if (Array.isArray(src.list)) arr = src.list;
            else if (Array.isArray(src.data?.list)) arr = src.data.list;
            else if (Array.isArray(src)) arr = src;
            else if (Array.isArray(data?.list)) arr = data.list;
            return arr.map(it => ({ title: it.vod_name || it.title || '', rating: it.rating || 0 })).filter(it => it.title);
        }
        async function loadSideToday() {
            const list = document.getElementById('side-today');
            if (!list) return;
            const render = arr => {
                if (!arr.length) { list.innerHTML = '<li class="side-today-loading">暂无推荐</li>'; return; }
                list.innerHTML = '';
                arr.slice(0, 8).forEach((m, i) => {
                    const li = document.createElement('li');
                    if (i === 0) li.className = 'top'; else if (i === 1) li.className = 'top2'; else if (i === 2) li.className = 'top3';
                    li.innerHTML = '<span class="rk-word">' + esc(m.title) + '</span>' + (m.rating ? '<span class="rk-count">★' + Number(m.rating).toFixed(1) + '</span>' : '');
                    sideGoSearch(li, m.title);
                    list.appendChild(li);
                });
            };
            try {
                const r = await fetch('/api/daily');
                const arr = parseDaily(await r.json());
                if (arr.length) { render(arr); return; }
                throw new Error('empty');
            } catch (_) {
                try {
                    const r2 = await fetch('/api/douban-hot?type=全部&limit=8');
                    const d2 = await r2.json();
                    render((d2 && Array.isArray(d2.list)) ? d2.list : []);
                } catch (__) { list.innerHTML = '<li class="side-today-loading">加载失败</li>'; }
            }
        }

        /* APP下载（zhuiju 的 android-list / ios-list） */
        async function loadSideApp() {
            const box = document.getElementById('side-app-box');
            const el = document.getElementById('side-app');
            if (!box || !el) return;
            try {
                const r = await fetch('/api/zhuiju');
                const data = await r.json();
                const android = (data && Array.isArray(data['android-list'])) ? data['android-list'] : [];
                const ios = (data && Array.isArray(data['ios-list'])) ? data['ios-list'] : [];
                const apps = [];
                for (const a of android) {
                    const url = (Array.isArray(a.methods) && a.methods[0] && a.methods[0].url) || '';
                    if (a.name && url) apps.push({ name: a.name, pic: a.pic, url, kind: '安卓' });
                }
                for (const a of ios) {
                    if (a.name && a.link) apps.push({ name: a.name, pic: a.pic, url: a.link, kind: 'iOS' });
                }
                if (!apps.length) { box.style.display = 'none'; return; }
                el.innerHTML = '';
                apps.slice(0, 6).forEach(app => {
                    const a = document.createElement('a');
                    a.className = 'side-app-item';
                    a.href = app.url; a.target = '_blank'; a.rel = 'noopener'; a.title = app.name;
                    a.innerHTML = (app.pic ? '<img src="' + esc(proxyImg(app.pic)) + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">' : '<i class="fas fa-download"></i>')
                        + '<span class="sa-name">' + esc(app.name) + '</span>'
                        + '<span class="sa-kind">' + esc(app.kind) + '</span>';
                    el.appendChild(a);
                });
                box.style.display = '';
            } catch (_) { box.style.display = 'none'; }
        }

        /* ══════════ 初始化 ══════════ */
        const init = () => {
            const form = document.getElementById('s-form');
            const input = document.getElementById('s-input');
            const clearBtn = document.getElementById('s-clear');

            form?.addEventListener('submit', e => {
                e.preventDefault();
                const kw = (input?.value || '').trim();
                if (kw) doSearch(kw); else input?.focus();
            });
            input?.addEventListener('input', () => {
                clearBtn?.classList.toggle('visible', (input.value || '').trim().length > 0);
            });
            clearBtn?.addEventListener('click', () => {
                if (input) input.value = '';
                clearBtn?.classList.remove('visible');
                input?.focus();
            });

            document.querySelectorAll('#s-tabs .s-tab').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (btn.dataset.tab === curTab) return;
                    switchTab(btn.dataset.tab);
                });
            });

            loadSideHot();
            loadSideDouban();
            loadSidePl();
            loadSideToday();
            loadSideApp();

            const key = new URLSearchParams(location.search).get('key');
            if (key?.trim()) doSearch(key.trim());
            else input?.focus();
        };

        document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
