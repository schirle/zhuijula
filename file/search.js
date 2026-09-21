(() => {
        'use strict';

        const MAX_CARDS = 240;
        const SEARCH_PAGE_SIZE = 15;
        const SEARCH_TIMEOUT_MS = 35000;
        const MAX_HISTORY = 20;
        const SEARCH_RANK_KEY = 'ftv_search_rank';
        const HISTORY_KEY = 'ftv_history';

        const WP_PAGE_SIZE = 16;
        const WP_CATS = [
            { key: 'all', label: '全部' },
            { key: 'quark', label: '夸克' },
            { key: 'baidu', label: '百度' },
            { key: 'uc', label: 'UC' },
            { key: 'xunlei', label: '迅雷' },
        ];
        const WP_TYPE_LABEL = { baidu: '百度网盘', quark: '夸克', xunlei: '迅雷', uc: 'UC', other: '网盘' };
        // 网盘区头部（title 后可附 hint / 计数等 extra）
        const wpHeader = extra => '<div class="wp-header"><span class="section-title"><i class="fas fa-cloud" style="color:var(--primary)"></i> 网盘</span>' + (extra || '') + '</div>';

        // /sou 路由：结果列表点击在新标签页打开播放页（其余路由保持当前页打开）
        const NEW_TAB_PLAY = location.pathname.endsWith('/sou');

        let abortCtrl = null, lastSearch = '';
        let searchList = [], resultPage = 1;
        let wpList = [], wpPage = 1, wpCat = 'all', wpLoadedFor = '';
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
            newTab: NEW_TAB_PLAY,
        });

        /* ══════════ 搜索主流程 ══════════ */
        function showSkeleton() {
            const area = document.getElementById('result-area');
            if (!area) return;
            document.title = '搜索中… - ' + getSiteName();
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
            const navTitle = document.getElementById('nav-page-title-el');
            if (navTitle) navTitle.textContent = kw;
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
            document.title = `搜索：${keyword} - ` + getSiteName();
            const hasList = data && data.code === 1 && Array.isArray(data.list) && data.list.length;
            if (!hasList) {
                const msg = (data && data.code === 0 && data.msg) ? esc(data.msg)
                    : `未找到与 "${esc(keyword)}" 相关的结果<br><small style="opacity:0.6;margin-top:6px;display:inline-block">试试换个关键词</small>`;
                area.innerHTML = `<div class="empty-result"><div class="empty-icon"><i class="fas fa-circle-exclamation"></i></div>${msg}<br><button class="retry-btn" id="s-retry"><i class="fas fa-rotate-right"></i> 重新搜索</button></div>`;
                document.getElementById('s-retry')?.addEventListener('click', () => { lastSearch = ''; doSearch(keyword); });
                return;
            }
            searchList = data.list.slice(0, MAX_CARDS);
            area.innerHTML = '<div class="result-header"><span class="section-title">搜索结果</span><span class="result-count">共 <strong>' + searchList.length + '</strong> 条</span></div>'
                + '<div class="grid-container" id="result-grid"></div>'
                + '<div class="s-pager" id="s-pager"></div>';
            renderResultPage(1);
        }

        /* 结果分页：页码切换，每页 SEARCH_PAGE_SIZE 条 */
        function renderResultPage(p) {
            const grid = document.getElementById('result-grid');
            const pager = document.getElementById('s-pager');
            if (!grid) return;
            const totalPages = Math.max(1, Math.ceil(searchList.length / SEARCH_PAGE_SIZE));
            resultPage = Math.min(Math.max(1, p), totalPages);
            const start = (resultPage - 1) * SEARCH_PAGE_SIZE;
            const end = Math.min(start + SEARCH_PAGE_SIZE, searchList.length);
            grid.innerHTML = '';
            const frag = document.createDocumentFragment();
            for (let i = start; i < end; i++) frag.appendChild(createResultCard(searchList[i]));
            grid.appendChild(frag);
            observeImages(grid);
            if (!pager) return;
            if (totalPages <= 1) { pager.innerHTML = ''; return; }
            let btns = '<button class="pg-btn" data-pg="prev" aria-label="上一页"' + (resultPage === 1 ? ' disabled' : '') + '><i class="fas fa-chevron-left"></i></button>';
            for (let n = 1; n <= totalPages; n++) btns += '<button class="pg-btn' + (n === resultPage ? ' active' : '') + '" data-pg="' + n + '">' + n + '</button>';
            btns += '<button class="pg-btn" data-pg="next" aria-label="下一页"' + (resultPage === totalPages ? ' disabled' : '') + '><i class="fas fa-chevron-right"></i></button>';
            pager.innerHTML = btns;
            pager.onclick = e => {
                const b = e.target.closest('.pg-btn');
                if (!b || b.disabled) return;
                const v = b.getAttribute('data-pg');
                const np = v === 'prev' ? resultPage - 1 : v === 'next' ? resultPage + 1 : parseInt(v, 10);
                renderResultPage(np);
                const ra = document.getElementById('result-area');
                if (ra) window.scrollTo({ top: ra.getBoundingClientRect().top + window.scrollY - 76, behavior: 'smooth' });
            };
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
            wpEl.innerHTML = wpHeader('<span class="wp-hint">资源来自网络，请自行甄别</span>') + '<div class="wp-loading"><i class="fas fa-spinner fa-spin"></i> 正在检索网盘资源…</div>';
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 30000);
            try {
                const resp = await fetch(`/api/wp?word=${encodeURIComponent(keyword)}`, { signal: ctrl.signal });
                if (!resp.ok) throw new Error('status ' + resp.status);
                const data = await resp.json();
                renderWp(wpEl, data, keyword);
            } catch (e) {
                wpEl.innerHTML = wpHeader() + '<div class="wp-empty">网盘资源检索暂不可用，请稍后重试</div>';
            } finally { clearTimeout(t); }
        }

        function renderWp(wpEl, data, keyword) {
            const list = Array.isArray(data?.results) ? data.results : [];
            if (!list.length) {
                wpEl.innerHTML = wpHeader() + '<div class="wp-empty">未找到与 "' + esc(keyword) + '" 相关的网盘资源</div>';
                return;
            }
            wpList = list; wpPage = 1; wpCat = 'all';
            renderWpPage();
        }

        function renderWpPage() {
            const wpEl = document.getElementById('wp-area');
            if (!wpEl) return;
            const filtered = wpCat === 'all' ? wpList : wpList.filter(it => it.type === wpCat);
            const total = filtered.length;
            const totalPages = Math.max(1, Math.ceil(total / WP_PAGE_SIZE));
            if (wpPage > totalPages) wpPage = totalPages;
            if (wpPage < 1) wpPage = 1;
            const startIdx = (wpPage - 1) * WP_PAGE_SIZE;
            const endIdx = Math.min(startIdx + WP_PAGE_SIZE, total);
            const header = wpHeader('<span class="wp-count">共 ' + total + ' 条</span>');
            const cats = '<div class="wp-cats">' + WP_CATS.map(c =>
                '<button class="wp-cat' + (c.key === wpCat ? ' active' : '') + '" data-cat="' + c.key + '">' + c.label + '</button>').join('') + '</div>';
            const items = [];
            for (let i = startIdx; i < endIdx; i++) {
                const it = filtered[i];
                const typeLabel = WP_TYPE_LABEL[it.type] || '网盘';
                items.push('<div class="wp-item" data-type="' + esc(it.type) + '" data-url="' + esc(it.link) + '" data-title="' + esc(it.title || '') + '">'
                    + '<span class="wp-type wp-type-' + esc(it.type) + '">' + typeLabel + '</span>'
                    + '<span class="wp-title">' + esc(it.title || '') + '</span></div>');
            }
            let html = header + cats + '<div class="wp-list">' + items.join('') + '</div>';
            if (totalPages > 1) html += renderWpPager(totalPages);
            wpEl.innerHTML = html;
            wpEl.onclick = e => {
                const item = e.target.closest('.wp-item');
                if (item) { openWpModal({ type: item.dataset.type, link: item.dataset.url, title: item.dataset.title || '' }); return; }
                const pg = e.target.closest('[data-pg]');
                if (pg) {
                    const v = pg.getAttribute('data-pg');
                    if (v === 'prev') wpPage = Math.max(1, wpPage - 1);
                    else if (v === 'next') wpPage = Math.min(totalPages, wpPage + 1);
                    else wpPage = parseInt(v, 10) || 1;
                    renderWpPage();
                }
            };
            wpEl.querySelectorAll('.wp-cat').forEach(btn => {
                btn.onclick = () => {
                    const cat = btn.getAttribute('data-cat');
                    if (cat === wpCat) return;
                    wpCat = cat; wpPage = 1;
                    renderWpPage();
                };
            });
        }

        // 页码切换：≤7 页全显；多页时窗口化显示（首页/末页 + 当前页 ±1 + 省略号）
        function renderWpPager(totalPages) {
            const cur = wpPage;
            const nums = [];
            if (totalPages <= 7) {
                for (let i = 1; i <= totalPages; i++) nums.push(i);
            } else {
                nums.push(1);
                if (cur > 3) nums.push('...');
                for (let i = Math.max(2, cur - 1); i <= Math.min(totalPages - 1, cur + 1); i++) nums.push(i);
                if (cur < totalPages - 2) nums.push('...');
                nums.push(totalPages);
            }
            const numBtns = nums.map(n => n === '...'
                ? '<span class="wp-pager-ellipsis">…</span>'
                : '<button class="wp-pager-btn' + (n === cur ? ' active' : '') + '" data-pg="' + n + '">' + n + '</button>'
            ).join('');
            const prev = '<button class="wp-pager-btn" data-pg="prev"' + (cur <= 1 ? ' disabled' : '') + ' aria-label="上一页"><i class="fas fa-chevron-left"></i></button>';
            const next = '<button class="wp-pager-btn" data-pg="next"' + (cur >= totalPages ? ' disabled' : '') + ' aria-label="下一页"><i class="fas fa-chevron-right"></i></button>';
            return '<div class="wp-pager">' + prev + numBtns + next + '</div>';
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
        async function loadSideHot(range) {
            const list = document.getElementById('side-hot');
            if (!list) return;
            try {
                const r = await fetch('/api/search-rank?range=' + (range || 'day'));
                const data = await r.json();
                const arr = (data && Array.isArray(data.list)) ? data.list : [];
                if (!arr.length) { list.innerHTML = '<li class="side-rank-empty">暂无热搜数据</li>'; return; }
                list.innerHTML = '';
                arr.slice(0, 8).forEach((it, i) => {
                    const li = document.createElement('li');
                    if (i === 0) li.className = 'top'; else if (i === 1) li.className = 'top2'; else if (i === 2) li.className = 'top3';
                    li.innerHTML = '<span class="rk-word">' + esc(it.word) + '</span>' + (it.count ? '<span class="rk-count">' + it.count + '</span>' : '');
                    sideGoSearch(li, it.word);
                    list.appendChild(li);
                });
            } catch (_) { list.innerHTML = '<li class="side-rank-empty">加载失败</li>'; }
        }
        /* 今日推荐（cikeee 每日单部影片推荐） */
        function renderDailyCard(container, m) {
            container.innerHTML = '';
            const a = document.createElement('a');
            a.className = 'side-today-card';
            a.href = '/search?key=' + encodeURIComponent(m.title);
            a.addEventListener('click', e => { e.preventDefault(); doSearch(m.title); window.scrollTo({ top: 0, behavior: 'smooth' }); });
            const rows = [
                ['地区', m.region],
                ['年份', m.year],
                ['导演', m.director],
                ['类型', m.genres],
            ].filter(r => r[1]);
            a.innerHTML = (m.pic ? '<img class="side-today-pic" src="' + esc('/api/img?u=' + encodeURIComponent(m.pic)) + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">' : '<div class="side-today-pic"></div>')
              + '<div class="side-today-info">'
              + '<div class="side-today-name">' + esc(m.title) + (m.rating ? ' <span class="side-today-rate">' + esc(m.rating) + '</span>' : '') + '</div>'
              + rows.map(r => '<div class="side-today-row"><span class="side-today-label">' + r[0] + '：</span><span class="side-today-val">' + esc(r[1]) + '</span></div>').join('')
              + '</div>';
            container.appendChild(a);
        }
        function parseDaily(data) {
            const d = data || {};
            return {
              title: d.mov_title || '',
              pic: d.mov_pic || '',
              rating: d.mov_rating || '',
              year: d.mov_year || '',
              region: d.mov_area || '',
              director: d.mov_director || '',
              genres: Array.isArray(d.mov_type) ? d.mov_type.join('/') : (d.mov_type || ''),
              desc: d.mov_intro || '',
              word: d.daily_word || '',
            };
        }
        async function loadSideToday() {
            const el = document.getElementById('side-today');
            if (!el) return;
            try {
                const r = await fetch('/api/daily');
                const m = parseDaily(await r.json());
                if (m && m.title) { renderDailyCard(el, m); return; }
                el.innerHTML = '<div class="side-today-loading">暂无今日推荐</div>';
            } catch (_) {
                el.innerHTML = '<div class="side-today-loading">今日推荐加载失败</div>';
            }
        }

        // 日/周/月榜已合并进「大家都搜了什么」模块（侧栏 tab 切换，见 init 中 #side-rank-tabs 绑定）

        // APP下载模块改为静态卡片（见 search.html，跳转 /app），无需前端拉取

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

            loadSideHot('day');
            loadSideToday();

            // 大家都搜了什么：日 / 周 / 月 切换
            document.querySelectorAll('#side-rank-tabs .srt').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (btn.classList.contains('active')) return;
                    document.querySelectorAll('#side-rank-tabs .srt').forEach(x => x.classList.remove('active'));
                    btn.classList.add('active');
                    loadSideHot(btn.dataset.range);
                });
            });

            const key = new URLSearchParams(location.search).get('key');
            if (key?.trim()) doSearch(key.trim());
            else input?.focus();
        };

        document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
