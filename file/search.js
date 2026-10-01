(() => {
        'use strict';
        const MAX_CARDS = 240;
        const SEARCH_PAGE_SIZE = 15;
        const SEARCH_TIMEOUT_MS = 35000;
        const MAX_HISTORY = 20;
        const HISTORY_KEY = 'ftv_history';
        const DEBUG = (() => {
            try {
                if (new URLSearchParams(location.search).get('debug') === '1') sessionStorage.setItem('ftv_debug', '1');
                return sessionStorage.getItem('ftv_debug') === '1';
            } catch (_) { return false; }
        })();
        const WP_PAGE_SIZE = 16;
        const WP_CATS = [
            { key: 'all', label: '全部' },
            { key: 'quark', label: '夸克' },
            { key: 'baidu', label: '百度' },
            { key: 'uc', label: 'UC' },
            { key: 'xunlei', label: '迅雷' },
        ];
        const WP_TYPE_LABEL = { baidu: '百度网盘', quark: '夸克', xunlei: '迅雷', uc: 'UC', other: '网盘' };
        const wpHeader = extra => '<div class="wp-header"><span class="section-title"><i class="fas fa-cloud" style="color:var(--primary)"></i> 网盘</span>' + (extra || '') + '</div>';
        const NEW_TAB_PLAY = location.pathname.endsWith('/sou');
        let abortCtrl = null, lastSearch = '';
        let searchList = [], resultPage = 1;
        let wpList = [], wpPage = 1, wpCat = 'all', wpLoadedFor = '';
        let curTab = 'all';
        let curType = 'all';
        let currentKw = '';
        const { observe: observeImages } = initLazyImages('300px');
        let searchHistory = lsGetJson(HISTORY_KEY) || [];
        const addHistory = word => {
            if (!word) return;
            searchHistory = searchHistory.filter(w => w !== word);
            searchHistory.unshift(word);
            if (searchHistory.length > MAX_HISTORY) searchHistory.pop();
            lsSetJson(HISTORY_KEY, searchHistory);
        };

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
        function showSkeleton() {
            const area = document.getElementById('result-area');
            if (!area) return;
            document.title = '搜索中… - ' + getSiteName();
            const isPC = window.matchMedia('(min-width: 768px)').matches;
            const count = isPC ? 10 : 6;
            area.innerHTML = '<div class="result-header"><span class="section-title"><i class="fas fa-spinner fa-spin" style="color:var(--primary)"></i> 正在搜索中…</span></div>'
                + '<div class="grid-container">' + '<div class="card"><div class="card-img-wrap"><div class="skeleton-img"></div></div><div class="skeleton-text"></div></div>'.repeat(count) + '</div>';
        }
        async function bannedHitLocal(kw) {
            let list = [];
            try {
                const cfg = window.getSiteConfig ? await window.getSiteConfig() : null;
                list = (cfg && Array.isArray(cfg.search_banned)) ? cfg.search_banned : [];
            } catch (_) { list = []; }
            const w = String(kw || '').toLowerCase();
            if (!w || !list.length) return '';
            return list.find(b => b && w.includes(String(b).toLowerCase())) || '';
        }
        function showBannedTip() {
            const area = document.getElementById('result-area');
            if (!area) return;
            area.innerHTML = '<div class="empty-result"><div class="empty-icon"><i class="fas fa-magnifying-glass"></i></div>'
                + '无法搜索该关键词<br><small style="opacity:0.6;margin-top:6px;display:inline-block">请更换关键词后再试</small></div>';
        }
        // 触发式验证码：同 IP 短时间内搜太多次 / 反复搜同一个词时，服务端会要求验证。
        // 正常访客不会遇到；验证通过后 30 分钟内不再打扰。
        let capModal = null;
        function ensureCapModal() {
            if (capModal) return capModal;
            capModal = document.createElement('div');
            capModal.id = 'cap-modal';
            capModal.className = 'modal-overlay';
            capModal.innerHTML = '<div class="modal-content">'
                + '<div class="modal-icon"><i class="fas fa-shield-halved"></i></div>'
                + '<div class="modal-title">搜索太频繁，请先验证</div>'
                + '<div class="modal-body">完成下面的计算即可继续搜索：<br><b id="cap-qtxt" style="font-size:17px;letter-spacing:1px"></b></div>'
                + '<input id="cap-atxt" inputmode="numeric" autocomplete="off" placeholder="计算结果" style="width:100%;padding:11px 13px;border:1px solid #d9e0ec;border-radius:10px;font-size:15px;margin:0 0 12px">'
                + '<button class="modal-btn" id="cap-go">继续搜索</button>'
                + '<button class="modal-btn modal-btn-ghost" id="cap-cancel">取消</button>'
                + '</div>';
            document.body.appendChild(capModal);
            capModal.addEventListener('click', (e) => { if (e.target === capModal) capModal.classList.remove('show'); });
            capModal.querySelector('#cap-cancel').addEventListener('click', () => capModal.classList.remove('show'));
            return capModal;
        }
        function showSearchCaptcha(keyword, cap) {
            const el = ensureCapModal();
            const q = el.querySelector('#cap-qtxt');
            const a = el.querySelector('#cap-atxt');
            const go = el.querySelector('#cap-go');
            if (q) q.textContent = cap && cap.cap_q ? cap.cap_q : '';
            if (a) a.value = '';
            el.classList.add('show');
            if (a) setTimeout(() => a.focus(), 50);
            const submit = () => {
                const ans = (a && a.value || '').trim();
                if (!ans) { if (a) a.focus(); return; }
                el.classList.remove('show');
                lastSearch = '';   // 允许原关键词重搜
                doSearch(keyword, { id: cap && cap.cap_id, ans });
            };
            if (go) go.onclick = submit;
            if (a) a.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } };
        }
        async function doSearch(keyword, cap) {
            const kw = (keyword || '').trim();
            if (!kw || (kw === lastSearch && !cap)) return;
            if (await bannedHitLocal(kw)) { showBannedTip(); return; }
            lastSearch = kw;
            currentKw = kw;
            const navTitle = document.getElementById('nav-page-title-el');
            if (navTitle) navTitle.textContent = kw;
            addHistory(kw);   // 热搜由服务端在 /api/search 里记录，前端不再单独打接口
            if (location.search !== `?key=${encodeURIComponent(kw)}`) history.replaceState(null, '', `${location.pathname}?key=${encodeURIComponent(kw)}`);
            const sInput = document.getElementById('s-input');
            if (sInput) { sInput.value = kw; document.getElementById('s-clear')?.classList.add('visible'); }
            abortCtrl?.abort();
            abortCtrl = new AbortController();
            if (curTab !== 'all') switchTab('all', true);
            wpLoadedFor = '';
            curType = 'all';
            const wpArea = document.getElementById('wp-area');
            if (wpArea) { wpArea.style.display = 'none'; wpArea.innerHTML = ''; }
            showSkeleton();
            const timeoutId = setTimeout(() => abortCtrl?.abort(), SEARCH_TIMEOUT_MS);
            try {
                const capQs = cap && cap.id ? '&cap_id=' + encodeURIComponent(cap.id) + '&cap_ans=' + encodeURIComponent(cap.ans || '') : '';
                const resp = await fetch(`/api/search?key=${encodeURIComponent(kw)}${capQs}`, { signal: abortCtrl.signal });
                let data;
                if (resp.ok) data = await resp.json();
                else {
                    let msg = '服务器开小差，请稍后重试';
                    if (resp.status === 503) msg = '数据源暂时繁忙，请稍后重试';
                    else if (resp.status === 429) msg = '请求过于频繁，请稍后再试';
                    else if (resp.status === 502) msg = '片源响应超时，请重试';
                    data = { code: 0, msg };
                }
                // code=2：服务端要求过验证码（被判定刷搜索），弹框后再带着答案重搜
                if (data && data.code === 2 && data.need_captcha) {
                    const area = document.getElementById('result-area');
                    if (area) area.innerHTML = '<div class="empty-result"><div class="empty-icon"><i class="fas fa-shield-halved"></i></div>搜索太频繁<br><small style="opacity:0.6;margin-top:6px;display:inline-block">请在弹出的验证框中完成验证</small></div>';
                    showSearchCaptcha(kw, data);
                    return;
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
            // 一次遍历把各分类的数量统计出来（原来是每个分类都 filter 全表一遍，结果越多越慢）
            const typeCount = new Map();
            for (const it of searchList) {
                const t = it.type_name || '';
                if (t) typeCount.set(t, (typeCount.get(t) || 0) + 1);
            }
            let filterHtml = '';
            if (typeCount.size > 1) {
                const tags = ['<button type="button" class="type-tag' + (curType === 'all' ? ' active' : '') + '" data-type="all">全部<span>（' + searchList.length + '）</span></button>']
                    .concat([...typeCount].map(([t, c]) =>
                        '<button type="button" class="type-tag' + (curType === t ? ' active' : '') + '" data-type="' + esc(t) + '">' + esc(t) + '<span>（' + c + '）</span></button>'
                    ));
                filterHtml = '<div class="result-filter"><div class="rf-tags" id="s-type-tags">' + tags.join('') + '</div></div>';
            }
            area.innerHTML = '<div class="result-header"><span class="section-title">搜索结果</span><span class="result-count">共 <strong>' + searchList.length + '</strong> 条</span></div>'
                + filterHtml
                + '<div class="grid-container" id="result-grid"></div>'
                + '<div class="s-pager" id="s-pager"></div>';
            const tagBox = document.getElementById('s-type-tags');
            if (tagBox) {
                tagBox.addEventListener('click', e => {
                    const btn = e.target.closest('.type-tag');
                    if (!btn || btn.dataset.type === curType) return;
                    curType = btn.dataset.type;
                    tagBox.querySelectorAll('.type-tag').forEach(x => x.classList.toggle('active', x === btn));
                    renderResultPage(1);
                });
            }
            renderResultPage(1);
        }
        function getFilteredList() {
            if (curType === 'all') return searchList;
            return searchList.filter(it => (it.type_name || '') === curType);
        }
        function renderResultPage(p) {
            const grid = document.getElementById('result-grid');
            const pager = document.getElementById('s-pager');
            if (!grid) return;
            const list = getFilteredList();
            const totalPages = Math.max(1, Math.ceil(list.length / SEARCH_PAGE_SIZE));
            resultPage = Math.min(Math.max(1, p), totalPages);
            const start = (resultPage - 1) * SEARCH_PAGE_SIZE;
            const end = Math.min(start + SEARCH_PAGE_SIZE, list.length);
            grid.innerHTML = '';
            const frag = document.createDocumentFragment();
            for (let i = start; i < end; i++) frag.appendChild(createResultCard(list[i]));
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
                const msg = (data && data.error) ? esc(String(data.error)) : ('未找到与 "' + esc(keyword) + '" 相关的网盘资源');
                wpEl.innerHTML = wpHeader() + '<div class="wp-empty">' + msg + '</div>';
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
                items.push('<div class="wp-item" data-type="' + esc(it.type) + '" data-url="' + esc(it.link) + '" data-code="' + esc(it.code || '') + '" data-title="' + esc(it.title || '') + '">'
                    + '<span class="wp-type wp-type-' + esc(it.type) + '">' + typeLabel + '</span>'
                    + '<span class="wp-title">' + esc(it.title || '') + '</span></div>');
            }
            let html = header + cats + '<div class="wp-list">' + items.join('') + '</div>';
            if (totalPages > 1) html += renderWpPager(totalPages);
            wpEl.innerHTML = html;
            wpEl.onclick = e => {
                const item = e.target.closest('.wp-item');
                if (item) { openWpModal({ type: item.dataset.type, link: item.dataset.url, code: item.dataset.code || '', title: item.dataset.title || '' }); return; }
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
        function showWpTip({ icon, title, body, link, openLabel = '打开链接', status = 'info', detail = '' }) {
            const el = ensureWpTip();
            const box = el.querySelector('.modal-content');
            box.innerHTML = '<div class="modal-icon"><i class="fas ' + esc(icon) + '"></i></div>'
                + '<div class="modal-title">' + esc(title) + '</div>'
                + '<div class="modal-body">' + body + '</div>'
                + (detail ? '<details class="modal-detail"><summary>查看 / 复制完整报错</summary>'
                    + '<div class="modal-detail-text">' + esc(detail) + '</div>'
                    + '<button class="modal-btn modal-btn-ghost" id="wp-tip-copy">复制报错</button></details>' : '')
                + (link ? '<button class="modal-btn" id="wp-tip-open">' + openLabel + '</button>' : '');
            box.classList.add('wp-tip', 'wp-tip-' + status);
            const safeLink = (typeof safeUrl === 'function') ? safeUrl(link) : '';
            const openBtn = box.querySelector('#wp-tip-open');
            if (link && openBtn) {
                if (safeLink) openBtn.addEventListener('click', () => window.open(safeLink, '_blank', 'noopener'));
                else openBtn.disabled = true;   // 非法链接：按钮留着但不执行
            }
            if (detail) {
                const cp = box.querySelector('#wp-tip-copy');
                if (cp) cp.addEventListener('click', () => {
                    const done = () => { cp.textContent = '已复制 ✓'; };
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(detail).then(done).catch(() => { cp.textContent = '请长按上方文本复制'; });
                    } else { cp.textContent = '请长按上方文本复制'; }
                });
            }
            el.classList.add('show');
        }
        const _transferring = new Set();
        async function openWpModal(it) {
            const label = WP_TYPE_LABEL[it.type] || '网盘';
            const canTransfer = (it.type === 'quark' || it.type === 'baidu' || it.type === 'uc');
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
                const r = await fetch('/api/transfer?type=' + encodeURIComponent(it.type) + '&url=' + encodeURIComponent(it.link)
                    + (it.code ? '&code=' + encodeURIComponent(it.code) : ''), { signal: ctrl.signal });
                const data = await r.json().catch(() => ({}));
                if (data.error) {
                    const full = String(data.error);
                    const detail = DEBUG ? full : '';
                    if (data.url) {
                        showWpTip({
                            icon: 'fa-link', title: label + ' · 已获取原分享链接',
                            body: '点击下方按钮即可打开原分享链接，保存到你的网盘。'
                                + (data.code ? '<br>提取码：<b>' + esc(data.code) + '</b>' : ''),
                            link: data.url, openLabel: '打开原分享链接', status: 'success', detail,
                        });
                    } else if (data.srv) {
                        showWpTip({
                            icon: 'fa-triangle-exclamation', title: label + ' · 本站服务异常',
                            body: '本站转存服务临时异常（<b>与资源本身无关</b>），请稍后再试或反馈给站长。',
                            status: 'error', detail,
                        });
                    } else {
                        showWpTip({
                            icon: 'fa-circle-exclamation', title: label + ' · 获取失败',
                            body: '该资源链接可能已失效，请尝试其他资源或稍后重试。',
                            status: 'error', detail,
                        });
                    }
                } else if (data.origin) {
                    showWpTip({
                        icon: 'fa-arrow-up-right-from-square', title: label + ' · 已获取原分享链接',
                        body: '该资源为<b>原分享链接</b>，点击打开后可在网盘里自行查看 / 保存。'
                            + (data.code ? '<br>提取码：<b>' + esc(data.code) + '</b>' : ''),
                        link: data.url, openLabel: '打开原分享链接', status: 'success',
                    });
                } else {
                    const ttl = Number(data.ttl) > 0 ? Number(data.ttl) : 0;
                    const tipBody = ttl
                        ? '链接已生成，请在 <b>' + ttl + ' 分钟</b>内保存到你的网盘，超时后本站会自动清理中转副本。'
                        : ('链接已生成，请尽快保存到你的网盘。' + (it.type === 'quark' ? '（<b>仅有效 1 天</b>）' : ''));
                    showWpTip({
                        icon: 'fa-circle-check', title: label + ' · 链接获取成功',
                        body: tipBody + (data.code ? '<br>提取码：<b>' + esc(data.code) + '</b>' : ''),
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
        const sideGoSearch = (el, word) => {
            el.addEventListener('click', () => {
                doSearch(word);
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
        };
        // 排行日/周/月三份数据由 /api/widgets 一次带回，切榜只切本地数据、不再发请求
        let sideRankData = null;
        function renderSideHot(range) {
            const list = document.getElementById('side-hot');
            if (!list) return;
            const box = document.getElementById('side-hot-box');
            const arr = (sideRankData && Array.isArray(sideRankData[range || 'day'])) ? sideRankData[range || 'day'] : [];
            // 没有排行数据就整块不显示（不留"暂无数据"的空壳）
            if (!arr.length) {
                list.innerHTML = '';
                if (box) box.style.display = 'none';
                return;
            }
            if (box) box.style.display = '';
            list.innerHTML = '';
            arr.slice(0, 8).forEach((it, i) => {
                const li = document.createElement('li');
                if (i === 0) li.className = 'top'; else if (i === 1) li.className = 'top2'; else if (i === 2) li.className = 'top3';
                const cnt = Number(it.count);
                li.innerHTML = '<span class="rk-word">' + esc(it.word) + '</span>' + (Number.isFinite(cnt) && cnt > 0 ? '<span class="rk-count">' + cnt + '</span>' : '');
                sideGoSearch(li, it.word);
                list.appendChild(li);
            });
        }
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
            a.innerHTML = (m.pic ? '<img class="side-today-pic" src="' + esc(m.pic) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility=\'hidden\'">' : '<div class="side-today-pic"></div>')
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
        function renderSideToday(data) {
            const el = document.getElementById('side-today');
            if (!el) return;
            const box = document.getElementById('side-today-box');
            if (!data || data.disabled) { if (box) box.style.display = 'none'; return; }   // 后台没配就不显示
            const m = parseDaily(data);
            if (m && m.title) { if (box) box.style.display = ''; renderDailyCard(el, m); return; }
            el.innerHTML = '<div class="side-today-loading">暂无今日推荐</div>';
        }
        // 侧栏两个部件一次取回：/api/widgets（合并请求，省 Functions 调用次数）
        async function loadSideWidgets() {
            let d = null;
            try { d = window.getWidgets ? await window.getWidgets() : null; } catch (_) { d = null; }
            if (d && (d.rank || d.daily)) {
                sideRankData = d.rank || null;
                renderSideHot('day');
                renderSideToday(d.daily);
                return;
            }
            // 兜底：合并接口暂时不可用时，退回原来的两个接口
            //（多花一次 Functions 调用，但保证侧栏/今日推荐不会空着）
            const [rankRes, dailyRes] = await Promise.all([
                fetch('/api/search-rank?range=day').then(r => (r.ok ? r.json() : null)).catch(() => null),
                fetch('/api/daily').then(r => (r.ok ? r.json() : null)).catch(() => null),
            ]);
            if (rankRes && Array.isArray(rankRes.list)) sideRankData = { day: rankRes.list };
            renderSideHot('day');
            renderSideToday(dailyRes);
            const list = document.getElementById('side-hot');
            if (list && !sideRankData && !list.querySelector('li')) list.innerHTML = '<li class="side-rank-empty">加载失败</li>';
        }
        // 后台没配置的功能，前台一律不显示：
        //   · 没填「网盘搜索接口」→ 不显示「网盘」分类页签
        //   · APP 页没有安卓 / 苹果数据 → 不显示侧栏「APP下载」
        //   · 插件总开关没开 → 不显示侧栏「插件」入口
        const applyConfigVisibility = async () => {
            let cfg = null;
            try { cfg = window.getSiteConfig ? await window.getSiteConfig() : null; } catch (_) { cfg = null; }
            if (!cfg) return;
            if (!cfg.wp_enabled) {
                const tab = document.querySelector('#s-tabs .s-tab[data-tab="wp"]');
                if (tab) tab.remove();
                if (curTab === 'wp') switchTab('all', true);
                const wpArea = document.getElementById('wp-area');
                if (wpArea) { wpArea.style.display = 'none'; wpArea.innerHTML = ''; }
                // 只剩一个分类就没必要留着切换栏
                const tabs = document.getElementById('s-tabs');
                if (tabs && tabs.querySelectorAll('.s-tab').length < 2) tabs.style.display = 'none';
            }
            if (!cfg.has_app) { const b = document.getElementById('side-app-box'); if (b) b.remove(); }
            if (!cfg.plugin_enabled) { const b = document.getElementById('side-plugin-box'); if (b) b.remove(); }
        };
        // 侧栏所有小块都没内容时，整条侧栏一起收起（避免留一条空白窄栏）
        const collapseSideIfEmpty = () => {
            const side = document.querySelector('.s-side');
            if (!side) return;
            const anyVisible = Array.from(side.querySelectorAll('.side-box'))
                .some(b => b.offsetParent !== null && getComputedStyle(b).display !== 'none');
            if (!anyVisible) side.style.display = 'none';
        };
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
            applyConfigVisibility();
            loadSideWidgets().then(collapseSideIfEmpty, collapseSideIfEmpty);
            document.querySelectorAll('#side-rank-tabs .srt').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (btn.classList.contains('active')) return;
                    document.querySelectorAll('#side-rank-tabs .srt').forEach(x => x.classList.remove('active'));
                    btn.classList.add('active');
                    renderSideHot(btn.dataset.range);   // 三榜数据已在本地，切榜不再发请求
                });
            });
            const key = new URLSearchParams(location.search).get('key');
            if (key?.trim()) doSearch(key.trim());
            else input?.focus();
        };
        document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
