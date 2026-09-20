(() => {
        'use strict';

        const MAX_CARDS = 200;
        const SEARCH_TIMEOUT_MS = 35000;
        const MAX_HISTORY = 20;
        const RAIL_LIMIT = 12;
        const FRIEND_MAX = 12;
        const CONTINUE_KEY = 'ftv_continue';
        const IS_HOME_PAGE = location.pathname === '/' || location.pathname === '/index.html' || location.pathname === '';
        const SEARCH_RESULT_NEW_TAB = !IS_HOME_PAGE;
        const DEFAULT_TITLE = document.title;

        let abortCtrl = null, lastSearch = '', lastKeyword = '';
        let searchHistory = [];

        let searchList = [];
        let searchPage = 1;
        const SEARCH_PAGE_SIZE = 14;
        let wpList = [];
        let wpShown = 10;
        const WP_PAGE_SIZE = 10;
        let wpCat = 'all';
        const WP_CATS = [
            { key: 'all', label: '全部' },
            { key: 'quark', label: '夸克' },
            { key: 'baidu', label: '百度' },
            { key: 'uc', label: 'UC' },
            { key: 'xunlei', label: '迅雷' },
        ];

        
        const DOM = {};
        const cacheDOM = () => {
            DOM.hsInput = $('#hs-input');
            DOM.hsForm = $('#hs-form');
            DOM.hsClear = $('#hs-clear');
            DOM.hsHistory = $('#hs-history');
            DOM.hsHistoryList = $('#hs-history-list');
            DOM.hsHistoryClear = $('#hs-history-clear');
            DOM.hsAi = $('#hs-ai');
            DOM.resultSection = $('#search-result-section');
            DOM.wpSection = $('#wp-result-section');
            DOM.friendLinks = $('#friend-links');
            DOM.friendList = $('#friend-list');
            DOM.flMore = $('#fl-more');
            DOM.btnHistory = $('#hs-history-btn');
            DOM.hsClassic = $('#hs-classic');
            DOM.hotBoard = $('#hot-board');
            DOM.hotList = $('#hot-list');
            DOM.pluginPopup = $('#plugin-popup');
            DOM.dailyPopup = $('#daily-popup');
            DOM.railPl = $('#rail-pl');
            DOM.railPlScroll = $('#rail-pl-scroll');
        };

        const { observe: observeImages } = initLazyImages('300px');

        
        const loadHistory = () => { searchHistory = lsGetJson('ftv_history'); };
        const saveHistory = () => { lsSetJson('ftv_history', searchHistory); };
        const addHistory = word => {
            if (!word) return;
            searchHistory = searchHistory.filter(w => w !== word);
            searchHistory.unshift(word);
            if (searchHistory.length > MAX_HISTORY) searchHistory.pop();
            saveHistory();
            renderHistory();
        };

        const SEARCH_RANK_KEY = 'ftv_search_rank';
        const incSearchRank = word => {
            if (!word) return;
            try {
                const m = lsGetJson(SEARCH_RANK_KEY) || {};
                m[word] = (m[word] || 0) + 1;
                lsSetJson(SEARCH_RANK_KEY, m);
            } catch (_) {}
        };

        const updateHistoryBtn = () => {
            if (DOM.btnHistory) DOM.btnHistory.classList.toggle('visible', searchHistory.length > 0);
        };
        const renderHistory = () => {
            updateHistoryBtn();
            const el = DOM.hsHistoryList;
            if (!el) return;
            const clearBtn = DOM.hsHistoryClear;
            el.innerHTML = '';
            if (!searchHistory.length) {
                el.innerHTML = '<span style="font-size:12px;color:var(--text-muted);padding:4px 0">暂无搜索历史</span>';
                if (clearBtn) clearBtn.style.display = 'none';
                return;
            }
            if (clearBtn) clearBtn.style.display = '';
            const frag = document.createDocumentFragment();
            for (const w of searchHistory) {
                const span = document.createElement('span');
                span.className = 'hot-word';
                span.textContent = w;
                span.addEventListener('click', () => quickSearch(w));
                frag.appendChild(span);
            }
            el.appendChild(frag);
        };

        window.toggleHistory = () => {
            const section = DOM.hsHistory;
            if (!section) return;
            const visible = section.style.display !== 'none';
            if (visible) { section.style.display = 'none'; return; }
            renderHistory();
            if (DOM.hsInput) DOM.hsInput.focus();
            section.style.display = '';
        };

        window.clearHistory = () => {
            searchHistory = [];
            saveHistory();
            renderHistory();
            if (DOM.hsHistory) DOM.hsHistory.style.display = 'none';
            showToast('搜索历史已清空');
        };

        window.quickSearch = word => {
            if (!word) return;
            if (DOM.hsInput) DOM.hsInput.value = word;
            if (DOM.hsHistory) DOM.hsHistory.style.display = 'none';
            doSearch(word);
        };

        window.retrySearch = () => {
            lastSearch = '';
            if (lastKeyword) {
                if (DOM.hsInput) DOM.hsInput.value = lastKeyword;
                doSearch(lastKeyword);
            }
        };

        window.searchMovie = name => {
            if (!name) return;
            if (DOM.hsInput) DOM.hsInput.value = name;
            if (DOM.hsHistory) DOM.hsHistory.style.display = 'none';
            doSearch(name);
        };

        
        const clearUrlKey = () => {
            const sp = new URLSearchParams(location.search);
            if (sp.has('key')) {
                sp.delete('key');
                const qs = sp.toString();
                history.replaceState(null, '', qs ? `${location.pathname}?${qs}` : location.pathname);
            }
        };

        
        window.exitSearch = () => {
            if (DOM.hsInput) DOM.hsInput.value = '';
            if (DOM.hsClear) DOM.hsClear.classList.remove('visible');
            abortCtrl?.abort();
            lastSearch = '';
            clearUrlKey();
            DOM.resultSection?.classList.remove('show');
            DOM.wpSection?.classList.remove('show');
            DOM.browseView?.classList.add('show');
            if (DOM.hsHistory) DOM.hsHistory.style.display = 'none';
            document.title = DEFAULT_TITLE;
            window.scrollTo({ top: 0, behavior: 'smooth' });
        };

        
        let doubanHotList = [];

        async function loadDoubanHot() {
            const CACHE = 'ftv_cache_douban';
            const cached = lsGetJson(CACHE);
            if (cached && cached.ts && Date.now() - cached.ts < 3600000) { doubanHotList = cached.list; return; }
            try {
                const resp = await fetch('/api/douban-hot?type=全部&limit=20');
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                const data = await resp.json();
                if (data.code !== 1 || !Array.isArray(data.list) || !data.list.length) return;
                doubanHotList = data.list;
                lsSetJson(CACHE, { ts: Date.now(), list: data.list });
            } catch (e) {
                console.warn('[douban-hot] 加载失败:', e.message);
            }
        }

        function createCard({ pic, title, badge = '', badgeClass = 'card-badge', extraHtml = '', href, onClick, newTab = true }) {
            const a = document.createElement('a');
            a.className = 'card'; a.title = title;
            if (href) { a.href = href; if (newTab) a.target = '_blank'; }
            if (onClick) a.addEventListener('click', e => { e.preventDefault(); onClick(); });

            const imgWrap = document.createElement('div');
            imgWrap.className = 'card-img-wrap';

            const img = document.createElement('img');
            img.alt = title; img.loading = 'lazy';
            if (pic) img.setAttribute('data-src', proxyImg(pic));

            imgWrap.appendChild(img);
            const loadingEl = document.createElement('div');
            loadingEl.className = 'img-loading';
            const loadingImg = document.createElement('img');
            loadingImg.src = 'file/loading.gif'; loadingImg.alt = '';
            loadingEl.appendChild(loadingImg);
            imgWrap.appendChild(loadingEl);

            if (badge) { const b = document.createElement('span'); b.className = badgeClass; b.textContent = badge; imgWrap.appendChild(b); }
            if (extraHtml) imgWrap.insertAdjacentHTML('beforeend', extraHtml);
            const mask = document.createElement('div');
            mask.className = 'play-mask';
            mask.innerHTML = '<i class="fas fa-play"></i>';
            imgWrap.appendChild(mask);

            const h2 = document.createElement('h2');
            h2.className = 'card-title'; h2.textContent = title;

            a.appendChild(imgWrap); a.appendChild(h2);
            return a;
        }

        
        const makeSearchCard = ({ pic, title, badge }) =>
            createCard({ pic, title, badge, onClick: () => searchMovie(title) });

        
        const createResultCard = (item, newTab = false) => createCard({
            pic: item.vod_pic, title: item.vod_name || '未知',
            badge: item._api_source || '',
            extraHtml: item.vod_remarks ? `<span class="card-quality">${esc(item.vod_remarks)}</span>` : '',
            href: playHref(item.vod_id || 0, item._api_source || ''),
            newTab,
        });

        
        function showRailSkeleton(scrollEl) {
            scrollEl.innerHTML = '';
            const row = document.createElement('div');
            row.className = 'skeleton-row';
            row.innerHTML = '<div class="sk"><div class="skeleton-img"></div><div class="skeleton-text"></div></div>'.repeat(6);
            scrollEl.appendChild(row);
        }
        async function loadRail(scrollEl, loader) {
            if (!scrollEl) return;
            showRailSkeleton(scrollEl);
            try {
                const items = await loader();
                if (!items || !items.length) {
                    scrollEl.innerHTML = '<div class="rail-error">暂无内容，稍后刷新</div>';
                    return;
                }
                scrollEl.innerHTML = '';
                const frag = document.createDocumentFragment();
                for (const it of items.slice(0, RAIL_LIMIT)) frag.appendChild(it);
                scrollEl.appendChild(frag);
                observeImages(scrollEl);
            } catch (e) {
                scrollEl.innerHTML = '';
                const errBox = document.createElement('div');
                errBox.className = 'rail-error';
                errBox.style.cssText = 'display:flex;align-items:center;gap:10px;color:var(--text-muted);padding:18px 0';
                errBox.appendChild(document.createTextNode('加载失败'));
                const retry = document.createElement('button');
                retry.className = 'load-more-btn';
                retry.textContent = '重试';
                retry.addEventListener('click', () => loadRail(scrollEl, loader));
                errBox.appendChild(retry);
            }
        }

        
        function doubanToCard(m) {
            return makeSearchCard({ pic: m.pic, title: m.title, badge: m.rating ? '★' + Number(m.rating).toFixed(1) : '' });
        }
        
        async function fetchDaily() {
            const CACHE = 'ftv_cache_daily';
            const cached = lsGetJson(CACHE);
            if (cached && cached.ts && Date.now() - cached.ts < 3600000) return cached.list;
            const r = await fetchWithTimeout('/api/daily', {}, 8000);
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const data = await r.json();
            if (!data || !data.mov_title) throw new Error('空');
            const list = [data];
            lsSetJson(CACHE, { ts: Date.now(), list });
            return list;
        }
        // ── 继续观看：读取本地播放记录（play.js 写入的 ftv_continue），有记录才显示，无则隐藏 ──
        const makeContinueCard = it => {
            const href = playHref(it.id || '', it.form || 'xg');
            const badge = (it.ep != null && it.ep > 0) ? `第${it.ep + 1}集` : '继续观看';
            return createCard({ pic: it.pic, title: it.name, badge, href, newTab: false });
        };
        const loadContinueWatching = () => {
            const wrap = $('#rail-continue'), scroll = $('#rail-continue-scroll');
            if (!wrap || !scroll) return;
            let list = [];
            try { list = lsGetJson(CONTINUE_KEY) || []; } catch (_) {}
            if (!Array.isArray(list) || !list.length) { wrap.style.display = 'none'; return; }
            scroll.innerHTML = '';
            const frag = document.createDocumentFragment();
            for (const it of list.slice(0, RAIL_LIMIT)) frag.appendChild(makeContinueCard(it));
            scroll.appendChild(frag);
            observeImages(scroll);
            wrap.style.display = '';
        };

        async function loadAllRails() {
            loadContinueWatching();
            loadRail($('#rail-hot-scroll'), async () => {
                if (!doubanHotList.length) await loadDoubanHot();
                return doubanHotList.slice(0, RAIL_LIMIT).map(doubanToCard);
            });

            // 剧集地区热播榜（韩剧/日剧/美剧），走豆瓣 j/search_subjects
            const loadTvRank = (scrollSel, type) => loadRail($(scrollSel), async () => {
                const r = await fetch('/api/douban-hot?type=' + encodeURIComponent(type) + '&limit=20');
                if (!r.ok) throw new Error('HTTP ' + r.status);
                const data = await r.json();
                if (!data || !Array.isArray(data.list)) throw new Error('空');
                return data.list.slice(0, RAIL_LIMIT).map(doubanToCard);
            });
            loadTvRank('#rail-kr-scroll', '韩剧');
            loadTvRank('#rail-jp-scroll', '日剧');
            loadTvRank('#rail-us-scroll', '美剧');

            loadDailyQuickCards();
            
            loadCarousel();
            
            loadPlaylists();
        }

        
        let _zhuijuCache = null;
        async function getZhuijuData() {
            if (_zhuijuCache) return _zhuijuCache;
            try {
                const r = await fetch('/api/zhuiju');
                if (!r.ok) throw new Error('HTTP ' + r.status);
                _zhuijuCache = await r.json();
            } catch (e) { _zhuijuCache = {}; }
            return _zhuijuCache;
        }
        async function loadCarousel() {
            const track = document.getElementById('hc-track');
            const dotsEl = document.getElementById('hc-dots');
            const carouselEl = document.getElementById('hero-carousel');
            if (!track || !carouselEl) return;
            let items = [];
            try {
                const data = await getZhuijuData();
                items = (data && Array.isArray(data['carousel-list'])) ? data['carousel-list'] : [];
            } catch (e) { items = []; }
            if (!items.length) { carouselEl.style.display = 'none'; return; }
            track.innerHTML = ''; dotsEl.innerHTML = '';
            items.forEach((it, i) => {
                const slide = document.createElement('div');
                slide.className = 'hc-slide';
                const link = it.link || '#';
                const isExternal = /^https?:\/\//.test(link);
                const a = document.createElement('a');
                a.href = esc(link);
                const img = document.createElement('img');
                img.src = esc(it.pic ? proxyImg(it.pic) : ''); img.alt = '';
                img.loading = (i === 0) ? 'eager' : 'lazy';
                if (i === 0) img.setAttribute('fetchpriority', 'high');
                img.onerror = () => window.imgFallback(img);
                // 宽幅 banner 铺满不留白边；竖版海报保持 contain 完整展示
                const fitImg = () => {
                    if (img.naturalWidth && img.naturalHeight && img.naturalWidth / img.naturalHeight >= 2.1) {
                        img.classList.add('fit-cover');
                    }
                };
                img.addEventListener('load', fitImg);
                if (img.complete && img.naturalWidth) fitImg();
                window.guardImg(img, 4000);
                a.appendChild(img);
                if (isExternal) {
                    a.target = '_blank'; a.rel = 'nofollow noopener';
                } else {
                    
                    a.addEventListener('click', e => {
                        e.preventDefault();
                        const m = link.match(/[?&]key=([^&]+)/);
                        window.searchMovie(m ? decodeURIComponent(m[1]) : '');
                    });
                }
                slide.appendChild(a);
                track.appendChild(slide);
                const dot = document.createElement('span');
                dot.className = 'hc-dot' + (i === 0 ? ' active' : '');
                dot.addEventListener('click', () => goSlide(i));
                dotsEl.appendChild(dot);
            });
            const total = items.length;
            let idx = 0, timer = null;
            const dotEls = () => dotsEl.querySelectorAll('.hc-dot');
            function goSlide(n) {
                idx = (n + total) % total;
                track.style.transform = 'translateX(-' + idx * 100 + '%)';
                dotEls().forEach((d, i) => d.classList.toggle('active', i === idx));
            }
            function start() { stop(); timer = setInterval(() => goSlide(idx + 1), 3500); }
            function stop() { if (timer) { clearInterval(timer); timer = null; } }
            carouselEl.addEventListener('mouseenter', stop);
            carouselEl.addEventListener('mouseleave', start);
            let sx = 0;
            carouselEl.addEventListener('touchstart', e => { sx = e.touches[0].clientX; stop(); }, { passive: true });
            carouselEl.addEventListener('touchend', e => {
                const dx = e.changedTouches[0].clientX - sx;
                if (Math.abs(dx) > 40) goSlide(idx + (dx < 0 ? 1 : -1));
                start();
            });
            goSlide(0);
            window.addEventListener('pagehide', stop, { once: true });
        }

        async function loadDailyQuickCards() {
            const el = document.getElementById('side-daily-body');
            if (!el) return;
            el.innerHTML = '<div class="loading-wrap visible"><div class="spinner"></div><div class="loading-text">加载中…</div></div>';
            try {
                const list = await fetchDaily();
                el.innerHTML = '';
                const items = (list || []).filter(Boolean);
                if (!items.length) { el.innerHTML = '<div class="sc-empty">暂无推荐</div>'; return; }
                items.slice(0, 4).forEach(d => {
                    if (!d || !d.mov_title) return;
                    const a = document.createElement('a');
                    a.className = 'daily-row';
                    a.href = '/?key=' + encodeURIComponent(d.mov_title);
                    
                    a.addEventListener('click', e => { e.preventDefault(); window.searchMovie(d.mov_title); });
                    const sub = [d.mov_rating ? '评分 ' + d.mov_rating : '', d.mov_year || ''].filter(Boolean).join(' · ');
                    const rawPic = d.mov_pic || '';
                    const proxied = rawPic ? proxyImg(rawPic) : '';
                    const picBlock = proxied
                        ? '<div class="dr-pic"><img class="dr-pic-img" src="' + esc(proxied) + '" loading="lazy" alt="" referrerpolicy="no-referrer" onload="this.parentElement.classList.add(\'loaded\')" onerror="imgFallback(this)"><div class="img-loading"><img src="file/loading.gif" alt=""></div></div>'
                        : '<div class="dr-pic dr-pic-default"><i class="fas fa-film"></i></div>';
                    a.innerHTML =
                        picBlock +
                        '<div class="dr-info"><div class="dr-title">' + esc(d.mov_title) + '</div><div class="dr-sub">' + esc(sub || '为你精选好剧') + '</div></div>' +
                        '<div class="dr-arrow"><i class="fas fa-chevron-right"></i></div>';
                    el.appendChild(a);
                });
            } catch (e) { el.innerHTML = '<div class="sc-empty">加载失败</div>'; }
        }

        async function loadPlaylists() {
            const wrap = DOM.railPl, scroll = DOM.railPlScroll;
            if (!wrap || !scroll) return;

            wrap.style.display = '';
            const titleEl = document.getElementById('rail-pl-title');
            if (titleEl) titleEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 正在加载中…';
            scroll.innerHTML = '';
            const skFrag = document.createDocumentFragment();
            for (let i = 0; i < 2; i++) {
                const sk = document.createElement('div');
                sk.className = 'sk-card';
                sk.style.cssText = 'flex:0 0 auto;width:132px';
                sk.innerHTML = '<div class="skeleton-img"></div><div class="skeleton-text"></div>';
                skFrag.appendChild(sk);
            }
            scroll.appendChild(skFrag);
            try {
                const r = await fetchWithTimeout('/api/pdlist', {}, 12000);
                if (!r.ok) throw new Error('HTTP ' + r.status);
                const data = await r.json();
                // 过滤抓取失败的空壳片单（无封面/无标题），避免首页出现空白卡片
                const lists = ((data && data.lists) || []).filter(l => l && l.cover && l.title);
                if (!lists.length) {
                    if (titleEl) titleEl.innerHTML = '<i class="fas fa-clapperboard"></i> 推荐片单';
                    scroll.innerHTML = '<div class="rail-empty" style="grid-column:1/-1;color:var(--text-muted);padding:18px 0;text-align:center">暂无片单</div>';
                    return;
                }
                scroll.innerHTML = '';

                const LIMIT = 8;
                const count = Math.min(lists.length, LIMIT);
                const frag = document.createDocumentFragment();
                for (let i = 0; i < count; i++) {
                    const pl = lists[i];
                    const a = createCard({
                        pic: pl.cover,
                        title: cleanPlaylistTitle(pl.title),
                        badge: '片单',
                        href: '/list.html?id=' + encodeURIComponent(pl.id),
                        newTab: false,
                    });
                    a.classList.add('pl-card');
                    a.style.animation = 'fadeUp .35s both';
                    a.style.animationDelay = (i * 45) + 'ms';
                    frag.appendChild(a);
                }
                scroll.appendChild(frag);
                observeImages(scroll);

                if (lists.length > LIMIT) {
                    const more = document.createElement('a');
                    more.className = 'card pl-more-card';
                    more.href = 'list.html';
                    more.innerHTML = '<div class="pl-more-inner"><div class="pl-more-ico"><i class="fas fa-chevron-right"></i></div><div class="pl-more-text">查看更多</div></div>';
                    scroll.appendChild(more);
                }

                if (titleEl) titleEl.innerHTML = '<i class="fas fa-clapperboard"></i> 推荐片单';
            } catch (e) {

                if (titleEl) titleEl.innerHTML = '<i class="fas fa-clapperboard"></i> 推荐片单';
                scroll.innerHTML = '';
                const errBox = document.createElement('div');
                errBox.className = 'rail-error';
                errBox.style.cssText = 'display:flex;align-items:center;gap:10px;color:var(--text-muted);padding:18px 0';
                errBox.appendChild(document.createTextNode('片单加载失败'));
                const retry = document.createElement('button');
                retry.className = 'load-more-btn';
                retry.textContent = '重试';
                retry.addEventListener('click', () => loadPlaylists());
                errBox.appendChild(retry);
                scroll.appendChild(errBox);
            }
        }

        const renderFriendLinks = (list, max) => {
            const section = DOM.friendLinks, el = DOM.friendList, more = DOM.flMore;
            if (!section || !el) return;
            const arr = Array.isArray(list) ? list : [];
            if (!arr.length) { section.style.display = 'none'; return; }
            el.innerHTML = '';
            const frag = document.createDocumentFragment();
            const linkSvg = '<i class="fas fa-arrow-up-right-from-square"></i>';
            const shown = max ? arr.slice(0, max) : arr;
            for (const item of shown) {
                const name = item.name || item.title || '';
                const link = item.link || item.url || '';
                if (!name || !link) continue;
                const a = document.createElement('a');
                a.className = 'friend-item';
                a.href = link; a.target = '_blank'; a.rel = 'noopener'; a.title = name;
                a.innerHTML = `<span class="fi-icon">${linkSvg}</span>`;
                const span = document.createElement('span');
                span.textContent = name;
                a.appendChild(span);
                frag.appendChild(a);
            }
            if (max && arr.length > max) {
                const m = document.createElement('a');
                m.className = 'friend-item friend-more';
                m.href = 'links.html'; m.title = '查看全部友情链接';
                m.innerHTML = `<span class="fi-icon">${linkSvg}</span>`;
                const span = document.createElement('span');
                span.textContent = `查看全部 ${arr.length} 个友链 ›`;
                m.appendChild(span);
                frag.appendChild(m);
            }
            if (!frag.childNodes.length) { section.style.display = 'none'; return; }
            el.appendChild(frag);
            if (more) more.style.display = (max && arr.length > max) ? '' : 'none';
            section.style.display = '';
        };

        const loadFriendLinks = () => {
            const CACHE = 'ftv_cache_friends';
            const cached = lsGetJson(CACHE);
            if (cached && cached.ts && Date.now() - cached.ts < 7200000) {
                renderFriendLinks(cached.list, FRIEND_MAX);
                return;
            }
            const el = DOM.friendList;
            if (el) el.innerHTML = '<span class="fl-loading">友情链接加载中…</span>';
            fetch('/api/friend-list').then(r => r.json()).then(data => {
                const list = (data && data.code === 1 && Array.isArray(data.list)) ? data.list : [];
                lsSetJson(CACHE, { ts: Date.now(), list });
                renderFriendLinks(list, FRIEND_MAX);
            }).catch(() => renderFriendLinks([], FRIEND_MAX));
        };

        // 把搜索词上报到全站排行榜（KV 聚合），失败静默忽略
        const recordHotSearch = (w) => {
            try { fetch('/api/search-rank?record=' + encodeURIComponent(w), { method: 'GET', keepalive: true }).catch(() => {}); } catch (_) {}
        };

        // 加载首页「大家都在搜」排行榜，点词条走 AI 搜索
        async function loadHotSearch() {
            const board = DOM.hotBoard, list = DOM.hotList;
            if (!board || !list) return;
            try {
                const r = await fetch('/api/search-rank');
                if (!r.ok) throw new Error('HTTP ' + r.status);
                const data = await r.json();
                const arr = (data && Array.isArray(data.list)) ? data.list : [];
                if (!arr.length) { board.style.display = 'none'; return; }
                list.innerHTML = '';
                const frag = document.createDocumentFragment();
                arr.slice(0, 12).forEach((it, i) => {
                    const no = i + 1;
                    const item = document.createElement('button');
                    item.type = 'button';
                    item.className = 'hot-item' + (no <= 3 ? ' top' : '');
                    item.innerHTML = '<span class="hot-no' + (no <= 3 ? ' hot-no-' + no : '') + '">' + no + '</span>'
                        + '<span class="hot-word">' + esc(it.word) + '</span>'
                        + (it.count ? '<span class="hot-count">' + it.count + '</span>' : '');
                    item.addEventListener('click', () => {
                        const w = it.word;
                        if (DOM.hsInput) DOM.hsInput.value = w;
                        setAiMode(true);
                        doAiSearch(w);
                    });
                    frag.appendChild(item);
                });
                list.appendChild(frag);
                board.style.display = '';
            } catch (e) { board.style.display = 'none'; }
        }

        let aiMode = true;
        const setAiMode = (on) => {
            aiMode = !!on;
            if (DOM.hsAi) {
                DOM.hsAi.classList.toggle('active', aiMode);
                DOM.hsAi.setAttribute('aria-pressed', String(aiMode));
            }
            if (DOM.hsInput) DOM.hsInput.placeholder = aiMode
                ? '用大白话描述想看的，例如：想看复仇的国产电视剧'
                : '搜全网影视，免会员免费看…';
        };

        async function doSearch(keyword) {
            const kw = keyword.trim();
            if (!kw || kw === lastSearch) return;
            lastSearch = kw;
            lastKeyword = kw;
            recordHotSearch(kw);
            if (DOM.wpSection) { DOM.wpSection.classList.remove('show'); DOM.wpSection.innerHTML = ''; }
            addHistory(kw);
            incSearchRank(kw);
            if (location.search !== `?key=${encodeURIComponent(kw)}`) history.replaceState(null, '', `${location.pathname}?key=${encodeURIComponent(kw)}`);

            abortCtrl?.abort();
            abortCtrl = new AbortController();

            const resultEl = DOM.resultSection;
            if (!resultEl) return;

            showSkeleton();
            resultEl.classList.add('show');
            DOM.browseView?.classList.remove('show');
            requestAnimationFrame(() => {
                // 补偿顶部 sticky 导航高度，确保“正在搜索”标题/搜索列表不被导航遮住，尽量下滑定位到搜索列表
                const nav = document.querySelector('.top-nav');
                const navH = nav ? nav.getBoundingClientRect().height : 0;
                resultEl.style.scrollMarginTop = (navH + 12) + 'px';
                resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });

            const timeoutId = setTimeout(() => abortCtrl?.abort(), SEARCH_TIMEOUT_MS);
            try {
                const resp = await fetch(`/api/search?key=${encodeURIComponent(kw)}`, { signal: abortCtrl.signal });
                let data;
                if (resp.ok) {
                    data = await resp.json();
                } else {
                    let msg = '服务器开小差，请稍后重试';
                    if (resp.status === 503) msg = '数据源暂时繁忙，请稍后重试';
                    else if (resp.status === 429) msg = '请求过于频繁，请稍后再试';
                    else if (resp.status === 502) msg = '片源响应超时，请重试';
                    data = { code: 0, msg };
                }
                renderResults(data, kw);
                loadWp(kw);
            } catch (err) {
                if (err.name === 'AbortError') renderResults({ code: 0, msg: '搜索超时，片源响应较慢，请稍后重试' }, kw);
                else renderResults({ code: 0, msg: '网络错误，请检查连接后重试' }, kw);
            } finally {
                clearTimeout(timeoutId);
                abortCtrl = null;
            }
        }

        // AI 语义搜索：复用 doSearch 的 UI 流程，但请求 /api/ai-search 并展示解析意图
        async function doAiSearch(keyword) {
            const kw = keyword.trim();
            if (!kw || kw === lastSearch) return;
            lastSearch = kw; lastKeyword = kw;
            if (DOM.wpSection) { DOM.wpSection.classList.remove('show'); DOM.wpSection.innerHTML = ''; }
            addHistory(kw); incSearchRank(kw);
            if (location.search !== `?key=${encodeURIComponent(kw)}`) history.replaceState(null, '', `${location.pathname}?key=${encodeURIComponent(kw)}`);

            abortCtrl?.abort();
            abortCtrl = new AbortController();

            const resultEl = DOM.resultSection;
            if (!resultEl) return;

            showSkeleton();
            resultEl.classList.add('show');
            DOM.browseView?.classList.remove('show');
            requestAnimationFrame(() => {
                const nav = document.querySelector('.top-nav');
                const navH = nav ? nav.getBoundingClientRect().height : 0;
                resultEl.style.scrollMarginTop = (navH + 12) + 'px';
                resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });

            const timeoutId = setTimeout(() => abortCtrl?.abort(), SEARCH_TIMEOUT_MS);
            try {
                const resp = await fetch(`/api/ai-search?q=${encodeURIComponent(kw)}`, { signal: abortCtrl.signal });
                let data;
                if (resp.ok) {
                    data = await resp.json();
                } else {
                    let msg = '服务器开小差，请稍后再试';
                    if (resp.status === 503) msg = '数据源暂时繁忙，请稍后重试';
                    else if (resp.status === 429) msg = '请求过于频繁，请稍后再试';
                    else if (resp.status === 502) msg = '片源响应超时，请重试';
                    else if (resp.status === 400) msg = '请输入搜索内容';
                    data = { code: 0, msg };
                }
                renderResults(data, kw);
                if (data && data.intent) renderAiIntent(data.intent, kw);
                loadWp(kw);
            } catch (err) {
                if (err.name === 'AbortError') renderResults({ code: 0, msg: '搜索超时，片源响应较慢，请稍后重试' }, kw);
                else renderResults({ code: 0, msg: '网络错误，请检查连接后重试' }, kw);
            } finally {
                clearTimeout(timeoutId);
                abortCtrl = null;
            }
        }

        // 在结果区顶部展示 AI 解析出的意图标签（类型/题材/地区/年代等）
        function renderAiIntent(intent, kw) {
            const section = DOM.resultSection;
            if (!section) return;
            let bar = section.querySelector('.ai-intent');
            if (!bar) {
                bar = document.createElement('div');
                bar.className = 'ai-intent';
                section.insertBefore(bar, section.firstChild);
            }
            const tags = [];
            if (intent.ai) tags.push('<span class="ai-tag ai-on"><i class="fas fa-wand-magic-sparkles"></i> AI 智能理解</span>');
            if (intent.type && intent.type !== '不限') tags.push(`<span class="ai-tag">${esc(intent.type)}</span>`);
            (intent.tags || []).forEach(t => { if (t) tags.push(`<span class="ai-tag">${esc(t)}</span>`); });
            if (intent.region) tags.push(`<span class="ai-tag">${esc(intent.region)}</span>`);
            if (intent.year) tags.push(`<span class="ai-tag">${esc(intent.year)}</span>`);
            if (intent.filtered && intent.matched) tags.push(`<span class="ai-tag ai-on"><i class="fas fa-filter"></i> 已按条件筛选出 ${intent.matched} 部</span>`);
            bar.innerHTML = (tags.length ? tags.join('') : '<span class="ai-tag">' + esc(intent.keyword || kw) + '</span>');
        }

        const showSkeleton = () => {
            const section = DOM.resultSection;
            if (!section) return;
            document.title = '搜索中… - 免费追剧';
            // PC 端显示 14 个骨架，手机端显示 6 个骨架
            const isPC = window.matchMedia('(min-width: 768px)').matches;
            const count = isPC ? 14 : 6;
            section.innerHTML = '';
            const frag = document.createDocumentFragment();
            const header = document.createElement('div');
            header.className = 'result-header';
            header.innerHTML = '<span class="section-title"><i class="fas fa-spinner fa-spin"></i> 正在搜索中…</span>';
            frag.appendChild(header);
            const grid = document.createElement('div');
            grid.className = 'grid-container';
            const cardHtml = '<div class="card"><div class="card-img-wrap"><div class="skeleton-img" style="aspect-ratio:2/3"></div></div><div class="skeleton-text"></div></div>';
            grid.innerHTML = cardHtml.repeat(count);
            frag.appendChild(grid);
            section.appendChild(frag);
        };

        function renderResults(data, keyword) {
            const section = DOM.resultSection;
            if (!section) return;

            const hasList = data && data.code === 1 && Array.isArray(data.list) && data.list.length;
            if (!hasList) {
                const isEmpty = data && data.code === 1;
                const err = isEmpty
                    ? `未找到与 "${esc(keyword)}" 相关的结果<br><small style="opacity:0.5;margin-top:4px;display:inline-block">试试换个关键词</small>`
                    : (data?.code === 0 ? (data?.msg ? esc(data.msg) : '未知错误')
                        : `未找到与 "${esc(keyword)}" 相关的结果<br><small style="opacity:0.5;margin-top:4px;display:inline-block">试试换个关键词</small>`);
                const countLabel = isEmpty ? ' 0 条' : '';
                document.title = `搜索列表${keyword ? '：' + keyword : ''} - 免费追剧`;
                section.innerHTML = `<div class="result-header"><span class="section-title">搜索列表${countLabel}</span><button class="hs-back" onclick="exitSearch()">‹ 取消搜索</button></div><div class="empty-result"><div class="empty-icon"><i class="fas fa-circle-exclamation"></i></div>${err}<br><button onclick="retrySearch()" style="margin-top:12px;padding:8px 20px;border-radius:20px;background:var(--primary);color:#fff;border:none;cursor:pointer;font-size:13px;font-weight:600"><i class="fas fa-rotate-right"></i>重新搜索</button></div>`;
                return;
            }

            searchList = data.list.slice(0, MAX_CARDS);
            searchPage = 1;
            document.title = `搜索列表${keyword ? '：' + keyword : ''} - 免费追剧`;
            const header = document.createElement('div');
            header.className = 'result-header';
            const titleSpan = document.createElement('span');
            titleSpan.className = 'section-title';
            titleSpan.textContent = '搜索列表';
            const countSpan = document.createElement('span');
            countSpan.className = 'result-count';
            const backBtn = document.createElement('button');
            backBtn.className = 'hs-back';
            backBtn.textContent = '‹ 取消搜索';
            backBtn.onclick = () => window.exitSearch();
            header.append(titleSpan, countSpan, backBtn);

            const grid = document.createElement('div');
            grid.className = 'grid-container';
            section.innerHTML = '';
            section.appendChild(header);
            section.appendChild(grid);

            renderSearchPage();
        }

        function renderSearchPage() {
            const section = DOM.resultSection;
            if (!section) return;
            const grid = section.querySelector('.grid-container');
            if (!grid) return;
            const start = (searchPage - 1) * SEARCH_PAGE_SIZE;
            const end = Math.min(start + SEARCH_PAGE_SIZE, searchList.length);
            const frag = document.createDocumentFragment();
            for (let i = start; i < end; i++) frag.appendChild(createResultCard(searchList[i], SEARCH_RESULT_NEW_TAB));
            grid.innerHTML = '';
            grid.appendChild(frag);
            observeImages(section);
            const titleSpan = section.querySelector('.section-title');
            const countSpan = section.querySelector('.result-count');
            if (titleSpan) titleSpan.textContent = '搜索列表';
            if (countSpan) countSpan.innerHTML = `共 <strong>${searchList.length}</strong> 条`;
            renderSearchPager();
        }

        function renderSearchPager() {
            const section = DOM.resultSection;
            if (!section) return;
            const old = section.querySelector('.search-pager');
            if (old) old.remove();
            const total = Math.ceil(searchList.length / SEARCH_PAGE_SIZE);
            if (total <= 1) return;
            const pager = document.createElement('div');
            pager.className = 'search-pager';
            const prev = document.createElement('button');
            prev.className = 'pg-btn';
            prev.textContent = '上一页';
            prev.disabled = searchPage <= 1;
            prev.onclick = () => { if (searchPage > 1) { searchPage--; renderSearchPage(); scrollToSection(section); } };
            const info = document.createElement('span');
            info.className = 'pg-info';
            info.textContent = `${searchPage} / ${total}`;
            const next = document.createElement('button');
            next.className = 'pg-btn';
            next.textContent = '下一页';
            next.disabled = searchPage >= total;
            next.onclick = () => { if (searchPage < total) { searchPage++; renderSearchPage(); scrollToSection(section); } };
            pager.append(prev, info, next);
            section.appendChild(pager);
        }

        function scrollToSection(section) {
            const y = (section.getBoundingClientRect().top + window.pageYOffset) - 80;
            window.scrollTo({ top: y, behavior: 'smooth' });
        }

        async function loadWp(keyword) {
            const wpEl = DOM.wpSection;
            if (!wpEl) return;
            wpEl.innerHTML = '<div class="wp-header"><span class="section-title"><i class="fas fa-cloud"></i> 网盘资源</span><span class="wp-hint">资源来自网络，请自行甄别</span></div><div class="wp-loading"><i class="fas fa-spinner fa-spin"></i> 正在检索网盘资源…</div>';
            wpEl.classList.add('show');

            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 30000);
            try {
                const resp = await fetch(`/api/wp?word=${encodeURIComponent(keyword)}`, { signal: ctrl.signal });
                if (!resp.ok) throw new Error('status ' + resp.status);
                const data = await resp.json();
                renderWp(wpEl, data, keyword);
            } catch (e) {
                wpEl.innerHTML = '<div class="wp-header"><span class="section-title"><i class="fas fa-cloud"></i> 网盘资源</span></div><div class="wp-empty">网盘资源检索暂不可用，请稍后重试</div>';
            } finally {
                clearTimeout(t);
            }
        }

        const WP_TYPE_LABEL = { baidu: '百度网盘', quark: '夸克', xunlei: '迅雷', uc: 'UC', other: '网盘' };

        // 网盘条目点击：夸克/百度转存，uc/迅雷提示自行打开；均不自动跳转，由用户点按钮打开
        function ensureWpTip() {
            let el = document.getElementById('wp-tip-overlay');
            if (el) return el;
            el = document.createElement('div');
            el.id = 'wp-tip-overlay';
            el.className = 'modal-overlay';
            el.innerHTML = '<div class="modal-content"></div>';
            el.addEventListener('click', (e) => { if (e.target === el) el.classList.remove('show'); });
            document.body.appendChild(el);
            return el;
        }
        function renderWpTip(html) {
            const el = ensureWpTip();
            el.querySelector('.modal-content').innerHTML = html;
            el.classList.add('show');
            return el.querySelector('.modal-content');
        }

        // 统一渲染网盘提示弹窗；status 控制配色（loading/success/error/info）
        function showWpTip({ icon, title, body, link, openLabel = '打开链接', status = 'info' }) {
            const box = renderWpTip(
                '<div class="modal-icon"><i class="fas ' + icon + '"></i></div>'
                + '<div class="modal-title">' + title + '</div>'
                + '<div class="modal-body">' + body + '</div>'
                + (link ? '<button class="modal-btn" id="wp-tip-open">' + openLabel + '</button>' : '')
            );
            box.classList.add('wp-tip', 'wp-tip-' + status);
            if (link) box.querySelector('#wp-tip-open').addEventListener('click', () => window.open(link, '_blank', 'noopener'));
            return box;
        }

        // 正在转存中的链接集合，避免重复点击造成网盘重复转存
        const _transferring = new Set();

        async function openWpModal(it) {
            // 统一平台标题，夸克/百度/uc/迅雷弹窗都显示对应平台名
            const label = WP_TYPE_LABEL[it.type] || '网盘';
            const canTransfer = (it.type === 'quark' || it.type === 'baidu');
            if (!canTransfer) {
                // uc / 迅雷：无转存能力，提示用户自行打开原链接
                showWpTip({
                    icon: 'fa-arrow-up-right-from-square',
                    title: label + '资源',
                    body: '该资源为 ' + label + '，请点击下方按钮保存到我的网盘。',
                    link: it.link,
                    openLabel: '保存到我的网盘',
                    status: 'info',
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
                    // 失败：提示链接失效（绝不给原链接入口，否则用户流失、失去转链收益）
                    console.error('[transfer fail]', it.type, it.link, data.error);
                    showWpTip({ icon: 'fa-circle-exclamation', title: label + ' · 链接已失效', body: '该资源链接可能已失效，请尝试其他资源或稍后重试。', status: 'error' });
                } else {
                    showWpTip({
                        icon: 'fa-circle-check',
                        title: label + ' · 链接获取成功',
                        body: '链接已生成，<b>仅有效 1 天</b>，请尽快保存到你的网盘。',
                        link: data.url,
                        openLabel: '保存到我的网盘',
                        status: 'success',
                    });
                }
            } catch (e) {
                showWpTip({ icon: 'fa-circle-exclamation', title: label + ' · 链接已失效', body: '网络异常，请稍后重试。', status: 'error' });
            } finally {
                clearTimeout(timer);
                _transferring.delete(it.link);
            }
        }

        function renderWp(wpEl, data, keyword) {
            const list = Array.isArray(data?.results) ? data.results : [];
            if (!list.length) {
                wpEl.innerHTML = '<div class="wp-header"><span class="section-title"><i class="fas fa-cloud"></i> 网盘资源</span></div><div class="wp-empty">未找到与 "' + esc(keyword) + '" 相关的网盘资源</div>';
                return;
            }
            wpList = list;
            wpShown = WP_PAGE_SIZE;
            wpCat = 'all';
            renderWpPage();
        }

        function renderWpPage() {
            const wpEl = DOM.wpSection;
            if (!wpEl) return;
            const filtered = wpCat === 'all' ? wpList : wpList.filter((it) => it.type === wpCat);
            const shown = Math.min(wpShown, filtered.length);
            const header = '<div class="wp-header"><span class="section-title"><i class="fas fa-cloud"></i> 网盘资源</span><span class="wp-count">共 ' + filtered.length + ' 条</span></div>';
            const cats = '<div class="wp-cats">' + WP_CATS.map((c) =>
                '<button class="wp-cat' + (c.key === wpCat ? ' active' : '') + '" data-cat="' + c.key + '">' + c.label + '</button>'
            ).join('') + '</div>';
            const items = [];
            for (let i = 0; i < shown; i++) {
                const it = filtered[i];
                const typeLabel = WP_TYPE_LABEL[it.type] || '网盘';
                items.push('<div class="wp-item" data-type="' + esc(it.type) + '" data-url="' + esc(it.link) + '" data-title="' + esc(it.title) + '">'
                    + '<span class="wp-type wp-type-' + esc(it.type) + '">' + typeLabel + '</span>'
                    + '<span class="wp-title">' + esc(it.title) + '</span>'
                    + '</div>');
            }
            let html = header + cats + '<div class="wp-list">' + items.join('') + '</div>';
            // 未全部显示时提供「加载更多」，逐批展开（不一次性全部显示）
            if (shown < filtered.length) {
                html += '<div class="wp-pager"><button class="pg-btn" data-pg="more">加载更多 (' + (filtered.length - shown) + ')</button></div>';
            }
            wpEl.innerHTML = html;
            wpEl.onclick = (e) => {
                const item = e.target.closest('.wp-item');
                if (!item) return;
                openWpModal({
                    type: item.dataset.type,
                    link: item.dataset.url,
                    title: item.dataset.title || '',
                });
            };
            const moreBtn = wpEl.querySelector('[data-pg="more"]');
            if (moreBtn) moreBtn.onclick = () => { wpShown += WP_PAGE_SIZE; renderWpPage(); };
            wpEl.querySelectorAll('.wp-cat').forEach((btn) => {
                btn.onclick = () => {
                    const cat = btn.getAttribute('data-cat');
                    if (cat === wpCat) return;
                    wpCat = cat;
                    wpShown = WP_PAGE_SIZE;
                    renderWpPage();
                };
            });
        }

        const bindEvents = () => {
            if (!DOM.hsForm || !DOM.hsInput) return;

            DOM.hsForm.addEventListener('submit', e => {
                e.preventDefault();
                const kw = DOM.hsInput.value.trim();
                if (kw) { aiMode ? doAiSearch(kw) : doSearch(kw); }
            });

            setAiMode(true); // 首屏默认 AI 模式
            DOM.hsAi?.addEventListener('click', () => { setAiMode(!aiMode); if (aiMode) DOM.hsInput?.focus(); });
            DOM.hsClassic?.addEventListener('click', (e) => { e.preventDefault(); setAiMode(!aiMode); if (!aiMode) DOM.hsInput?.focus(); });
            $$('#hs-suggest .hs-chip').forEach(chip => {
                chip.addEventListener('click', () => {
                    const w = chip.textContent.trim();
                    if (!w) return;
                    if (DOM.hsInput) DOM.hsInput.value = w;
                    setAiMode(true);
                    doAiSearch(w);
                });
            });

            DOM.btnHistory?.addEventListener('click', () => window.toggleHistory());

            DOM.hsInput.addEventListener('input', function() {
                const v = this.value.trim();
                DOM.hsClear?.classList.toggle('visible', v.length > 0);

                if (!v.length) exitSearch();
            });

            DOM.hsInput.addEventListener('focus', () => {
                if (searchHistory.length) { renderHistory(); if (DOM.hsHistory) DOM.hsHistory.style.display = ''; }
            });

            DOM.hsClear?.addEventListener('click', function() {
                DOM.hsInput.value = '';
                this.classList.remove('visible');
                abortCtrl?.abort();
                lastSearch = '';
                clearUrlKey();
                DOM.resultSection?.classList.remove('show');
                DOM.wpSection?.classList.remove('show');
                DOM.browseView?.classList.add('show');
                document.title = DEFAULT_TITLE;
                DOM.hsInput.focus();
            });

            $$('.rail-arrow').forEach(btn => {
                btn.addEventListener('click', () => {
                    const wrap = btn.closest('.rail-wrap');
                    const scroll = wrap?.querySelector('.rail-scroll');
                    if (!scroll) return;
                    const dir = btn.dataset.dir === 'next' ? 1 : -1;
                    scroll.scrollBy({ left: dir * scroll.clientWidth * 0.8, behavior: 'smooth' });
                });
            });

            document.addEventListener('keydown', e => {
                if (e.key === 'Escape') { closePopup(); closePluginPopup(); }
            });

            document.addEventListener('click', e => {
                const hist = DOM.hsHistory;
                if (hist && hist.style.display !== 'none') {
                    if (!hist.contains(e.target) && !DOM.btnHistory?.contains(e.target) && !DOM.hsInput?.contains(e.target)) {
                        hist.style.display = 'none';
                    }
                }
            });
        };

        const showPopup = () => {
            const today = new Date().toLocaleDateString();
            if (lsGet('free_tv_notice_date') !== today) {
                DOM.dailyPopup?.classList.add('show');
                lsSet('free_tv_notice_date', today);
            }
        };
        window.closePopup = () => DOM.dailyPopup?.classList.remove('show');

        window.showPluginPopup = () => DOM.pluginPopup?.classList.add('show');
        window.closePluginPopup = () => DOM.pluginPopup?.classList.remove('show');

        // 生成并下载 Chrome 扩展（逻辑已抽到 common.js 的 installExtension）
        window.goInstall = () => { installExtension(); closePluginPopup(); };

        const init = () => {
            cacheDOM();
            DOM.browseView = $('#browse-view');
            DOM.browseView?.classList.add('show');

            if (isMobile()) {
                const el = document.getElementById('plugin-card');
                if (el) el.remove();
            }
            loadHistory();
            updateHistoryBtn();
            bindEvents();

            loadAllRails();
            loadFriendLinks();
            loadHotSearch();
            showPopup();

            const key = new URLSearchParams(location.search).get('key');
            if (key?.trim()) {
                if (DOM.hsInput) DOM.hsInput.value = key.trim();
                doSearch(key.trim());
            }
        };

        document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
    })();


