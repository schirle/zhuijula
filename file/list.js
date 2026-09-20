(() => {
        'use strict';

        const { observe: observeImages } = initLazyImages('300px');
        const heroEl = document.getElementById('playlist-hero');
        const gridEl = document.getElementById('playlist-grid');
        const indexEl = document.getElementById('playlist-index');
        const id = getParam('id');

        function createCard({ pic, title, badge = '', badgeClass = 'card-badge', extraHtml = '', href, onClick, proxy }) {
            const a = document.createElement('a');
            a.className = 'card'; a.title = title;
            if (href) { a.href = href; a.target = '_blank'; }
            if (onClick) a.addEventListener('click', e => { e.preventDefault(); onClick(); });

            const imgWrap = document.createElement('div');
            imgWrap.className = 'card-img-wrap';
            const img = document.createElement('img');
            img.alt = title; img.loading = 'lazy';
            if (pic) img.setAttribute('data-src', proxy ? proxyImg(pic) : pic);
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
            mask.innerHTML = '<span class="play-ico">▶</span>';
            imgWrap.appendChild(mask);

            const h2 = document.createElement('h2');
            h2.className = 'card-title'; h2.textContent = title;

            a.appendChild(imgWrap); a.appendChild(h2);
            return a;
        }

        async function showIndex() {
            document.title = '片单 - ' + getSiteName();
            heroEl.style.display = 'none';
            gridEl.style.display = 'none';
            indexEl.style.display = '';

            indexEl.innerHTML = '';
            const header = document.createElement('div');
            header.className = 'section-header';
            const titleSpan = document.createElement('span');
            titleSpan.className = 'section-title';
            titleSpan.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 正在加载中…';
            header.appendChild(titleSpan);
            indexEl.appendChild(header);
            const grid = document.createElement('div');
            grid.className = 'pl-index-grid';

            const skFrag = document.createDocumentFragment();
            for (let i = 0; i < 4; i++) {
                const sk = document.createElement('div');
                sk.className = 'sk-index-card';
                sk.innerHTML = '<div class="sk-cover"></div><div class="sk-lines"><div class="skeleton-text"></div><div class="skeleton-text"></div></div>';
                skFrag.appendChild(sk);
            }
            grid.appendChild(skFrag);
            indexEl.appendChild(grid);
            setNavTitle('推荐片单');

            let playlists = [];
            try {
                const res = await fetch('/api/list');
                const data = await res.json();
                playlists = ((data && data.playlists) || []).filter(p => p && p.cover && p.title);
            } catch (e) {  }

            titleSpan.innerHTML = '📋 全部片单';
            grid.innerHTML = '';

            if (!playlists.length) {
                grid.innerHTML = '<div class="empty" style="grid-column:1/-1">暂无片单</div>';
                return;
            }

            const frag = document.createDocumentFragment();
            for (let i = 0; i < playlists.length; i++) {
                const pl = playlists[i];
                const card = document.createElement('a');
                card.className = 'pl-index-card';
                card.href = 'list.html?id=' + encodeURIComponent(pl.id);
                const hasCover = !!pl.cover;
                const coverImg = hasCover
                    ? `<img class="pl-cover-img" src="${esc(proxyImg(pl.cover))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="imgFallback(this)">`
                    : '';
                card.innerHTML =
                    `<div class="pl-cover${hasCover ? '' : ' pl-cover--empty'}">${coverImg}</div>` +
                    `<div class="pl-meta"><div class="pl-title">${esc(cleanPlaylistTitle(pl.title))}</div></div>` +
                    `<div class="pl-arrow">›</div>`;
                frag.appendChild(card);
            }
            grid.appendChild(frag);
        }

        function setNavTitle(text) {
            const el = document.getElementById('navPageTitle');
            if (el) el.textContent = text || '推荐片单';
        }

        function goSearch(name) {
            location.href = '/search?key=' + encodeURIComponent(name);
        }

        let detail = null; 
        let loadingMore = false;
        let pendingLoad = false;


        async function appendMovies(items) {
            if (!items.length) {
                if (detail.loaded === 0) gridEl.innerHTML = '<div class="empty">该片单暂无内容，换个片单看看～</div>';
                return;
            }
            const frag = document.createDocumentFragment();
            for (let i = 0; i < items.length; i++) {
                const card = createCard({
                    pic: items[i].pic, title: items[i].name, proxy: true,
                    onClick: () => goSearch(items[i].name),
                });
                frag.appendChild(card);
                detail.loaded += 1;
            }
            gridEl.appendChild(frag);
            observeImages(gridEl);
        }

        function renderLoadMore() {
            const old = gridEl.parentElement.querySelector('.load-more-wrap');
            if (old) old.remove();
            if (!detail || !detail.hasMore) {
                if (sentinelObserver) { sentinelObserver.disconnect(); sentinelObserver = null; }
                return;
            }
            const wrap = document.createElement('div');
            wrap.className = 'load-more-wrap';
            const count = detail.total ? `<span class="lm-count">(已 ${detail.loaded}/${detail.total})</span>` : '';
            wrap.innerHTML = `<button class="load-more-btn" id="load-more-btn">加载更多 ${count}</button>`;
            gridEl.insertAdjacentElement('afterend', wrap);
            const btn = wrap.querySelector('#load-more-btn');
            btn.dataset.base = btn.innerHTML;
            btn.onclick = () => loadNext();
        }

        function setLoadMoreBusy(busy) {
            const btn = gridEl.parentElement && gridEl.parentElement.querySelector('#load-more-btn');
            if (!btn) return;
            btn.classList.toggle('loading', busy);
            if (busy) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 加载中…';
            else if (btn.dataset.base) btn.innerHTML = btn.dataset.base;
        }

        let sentinel = null, sentinelObserver = null;
        function ensureSentinel() {
            if (sentinel) return;
            sentinel = document.createElement('div');
            sentinel.className = 'pl-sentinel';
            sentinel.style.cssText = 'width:100%;height:1px;';
            gridEl.insertAdjacentElement('afterend', sentinel);
            sentinelObserver = new IntersectionObserver(entries => {
                if (entries.some(e => e.isIntersecting)) loadNext();
            }, { rootMargin: '500px' });
            sentinelObserver.observe(sentinel);
        }

        async function loadNext() {
            if (!detail || !detail.hasMore) return;
            if (loadingMore) { pendingLoad = true; return; }
            loadingMore = true;
            setLoadMoreBusy(true);
            try {
                const res = await fetch(`/api/list?id=${encodeURIComponent(detail.id)}&start=${detail.loaded}&count=30`);
                const data = await res.json();
                if (data && data.success && data.playlist) {
                    const pl = data.playlist;
                    detail.hasMore = !!pl.hasMore;
                    if (pl.total) detail.total = pl.total;
                    await appendMovies(pl.items || []);
                    renderLoadMore();
                } else {
                    showToast('加载失败，请重试');
                    renderLoadMore();
                }
            } catch (e) {
                showToast('加载失败，请重试');
                renderLoadMore();
            } finally {
                loadingMore = false;
                setLoadMoreBusy(false);
                if (pendingLoad && detail && detail.hasMore) {
                    pendingLoad = false;
                    loadNext();
                }
            }
        }

        function renderHeroSkeleton() {
            heroEl.innerHTML =
                '<a class="pl-back" href="list.html">‹ 全部片单</a>' +
                '<div class="pl-hero">' +
                    '<div class="pl-hero-cover skeleton-block"></div>' +
                    '<div style="flex:1;min-width:0">' +
                        '<div class="skeleton-text" style="height:22px;width:55%;margin:0 0 10px"></div>' +
                        '<div class="skeleton-text" style="height:13px;width:28%"></div>' +
                    '</div>' +
                '</div>';
        }

        function renderHero(pl) {
            const total = pl.total || (pl.items ? pl.items.length : 0);
            heroEl.innerHTML =
                '<a class="pl-back" href="list.html">‹ 全部片单</a>' +
                `<div class="pl-hero">${pl.cover ? `<img class="pl-hero-cover" src="${esc(proxyImg(pl.cover))}" alt="" referrerpolicy="no-referrer" onerror="imgFallback(this)">` : ''}` +
                `<div style="flex:1;min-width:0"><h1 class="pl-hero-title">${esc(cleanPlaylistTitle(pl.title))}</h1>` +
                `<div class="pl-hero-sub">共 ${total} 部</div></div></div>`;
        }

        async function showDetail(plId, { append = false } = {}) {
            if (!append) {
                indexEl.style.display = 'none';
                heroEl.style.display = '';
                gridEl.style.display = '';
                detail = { id: plId, loaded: 0, hasMore: false, total: 0 };
                loadingMore = false;
                pendingLoad = false;

                renderHeroSkeleton();
                gridEl.innerHTML = '';
                const skCount = 2; 
                const skFrag = document.createDocumentFragment();
                for (let i = 0; i < skCount; i++) {
                    const sk = document.createElement('div');
                    sk.className = 'sk-card';
                    sk.innerHTML = '<div class="skeleton-img"></div><div class="skeleton-text"></div>';
                    skFrag.appendChild(sk);
                }
                gridEl.appendChild(skFrag);
                setNavTitle('正在加载中…');
            }

            let pl = null;
            try {
                const qs = append
                    ? `?id=${encodeURIComponent(plId)}&start=${detail.loaded}&count=30`
                    : `?id=${encodeURIComponent(plId)}&start=0&count=30`;
                const res = await fetch('/api/list' + qs);
                const data = await res.json();
                if (data && data.success) pl = data.playlist;
            } catch (e) {  }

            if (!append) {
                if (!pl) {
                    heroEl.style.display = 'none';
                    gridEl.style.display = '';
                    gridEl.innerHTML = '<div class="error-box">片单不存在，<a href="list.html">返回片单首页</a></div>';
                    setNavTitle('片单不存在');
                    return;
                }
                const cleanTitle = cleanPlaylistTitle(pl.title);
                document.title = cleanTitle + ' - ' + getSiteName();
                setNavTitle(cleanTitle);
                renderHero(pl);
                detail.total = pl.total || (pl.items ? pl.items.length : 0);
                detail.hasMore = !!pl.hasMore;
                gridEl.innerHTML = ''; 

                await appendMovies(pl.items || []);
                renderLoadMore();
                ensureSentinel();
            } else {
                if (!pl) { showToast('加载失败，请重试'); return; }
                detail.hasMore = !!pl.hasMore;
                if (pl.total) detail.total = pl.total;
                await appendMovies(pl.items || []);
                renderLoadMore();
            }
        }

        if (id) showDetail(id); else showIndex();
    })();


