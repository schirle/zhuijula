(() => {
        'use strict';

        const CONTINUE_KEY = 'ftv_continue';
        const FRIEND_MAX = 12;
        const RAIL_LIMIT = 12;
        const FEED_BATCH = 24;
        const FEED_TYPES = [
            { key: '热门', label: '近期热播' },
            { key: '国产剧', label: '国产剧' },
            { key: '韩剧', label: '韩剧' },
            { key: '日剧', label: '日剧' },
            { key: '美剧', label: '美剧' },
            { key: '英剧', label: '英剧' },
        ];

        const { observe: observeImages } = initLazyImages('300px');

        /* ══════════ 通用卡片（海报 + 角标 + 标题 + 副标题） ══════════ */
        function makeCard({ pic, title, sub = '', badge = '', badgeClass = 'card-badge', rate = '', href, newTab = false }) {
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

            if (rate) { const r = document.createElement('span'); r.className = 'card-rate'; r.textContent = '★' + Number(rate).toFixed(1); imgWrap.appendChild(r); }
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

        /* ══════════ 频道筛选 + 推荐网格 ══════════ */
        const feedCache = {};
        const feedPage = {};
        let curType = '热门';

        function renderChips() {
            const box = document.getElementById('chips');
            if (!box) return;
            box.innerHTML = '';
            const frag = document.createDocumentFragment();
            FEED_TYPES.forEach(t => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'chip' + (t.key === curType ? ' active' : '');
                b.textContent = t.label;
                b.addEventListener('click', () => {
                    if (curType === t.key) return;
                    curType = t.key;
                    box.querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
                    b.classList.add('active');
                    loadFeed(1);
                });
                frag.appendChild(b);
            });
            box.appendChild(frag);
        }

        function wireHomeSearch() {
            const form = document.getElementById('home-search-form');
            if (!form) return;
            const input = document.getElementById('home-search-input');
            form.addEventListener('submit', e => {
                e.preventDefault();
                const kw = (input?.value || '').trim();
                if (!kw) { input?.focus(); return; }
                location.href = '/search?key=' + encodeURIComponent(kw);
            });
        }

        function feedSub(m) {
            if (m.card_subtitle) return m.card_subtitle;
            const g = Array.isArray(m.genres) ? m.genres.join(' / ') : '';
            return [m.year, g].filter(Boolean).join(' · ');
        }
        function feedCard(m) {
            return makeCard({
                pic: m.pic, title: m.title || '未知', sub: feedSub(m),
                badge: '免费', badgeClass: 'card-badge free', rate: m.rating,
                href: '/search?key=' + encodeURIComponent(m.title || ''),
            });
        }
        function dedupe(list) {
            const seen = new Set(); const out = [];
            for (const m of list) {
                const k = m.title || m.pic || '';
                if (!k || seen.has(k)) continue;
                seen.add(k); out.push(m);
            }
            return out;
        }

        async function loadFeed(page) {
            const grid = document.getElementById('feed-grid');
            if (!grid) return;
            const type = curType;
            grid.innerHTML = '<div class="sk"><div class="skeleton-img"></div><div class="skeleton-text"></div></div>'.repeat(12);
            try {
                if (!feedCache[type]) {
                    const r = await fetch('/api/douban-hot?type=' + encodeURIComponent(type) + '&limit=50');
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    const data = await r.json();
                    feedCache[type] = (data && data.code === 1 && Array.isArray(data.list)) ? data.list : [];
                }
                if (type !== curType) return; // 已切到其它频道，丢弃过期结果
                const list = dedupe(feedCache[type]);
                if (!list.length) { grid.innerHTML = '<div class="feed-error">暂无内容，稍后再来看看</div>'; renderFeedPager(0, 0); return; }
                const totalPages = Math.max(1, Math.ceil(list.length / FEED_BATCH));
                const cur = Math.min(Math.max(1, page || feedPage[type] || 1), totalPages);
                feedPage[type] = cur;
                grid.innerHTML = '';
                const frag = document.createDocumentFragment();
                for (const m of list.slice((cur - 1) * FEED_BATCH, cur * FEED_BATCH)) frag.appendChild(feedCard(m));
                grid.appendChild(frag);
                observeImages(grid);
                renderFeedPager(cur, totalPages);
            } catch (e) {
                if (type !== curType) return;
                grid.innerHTML = '';
                const err = document.createElement('div');
                err.className = 'feed-error';
                err.innerHTML = '加载失败，请检查网络后重试';
                const retry = document.createElement('button');
                retry.className = 'feed-retry';
                retry.textContent = '重新加载';
                retry.addEventListener('click', () => loadFeed(1));
                err.appendChild(retry);
                grid.appendChild(err);
            }
        }

        /* 列表页码切换（每页 FEED_BATCH 条） */
        function renderFeedPager(cur, total) {
            const pager = document.getElementById('feed-pager');
            if (!pager) return;
            if (!total || total <= 1) { pager.innerHTML = ''; return; }
            let html = '<button class="pg-btn" data-pg="prev" aria-label="上一页"' + (cur === 1 ? ' disabled' : '') + '><i class="fas fa-chevron-left"></i></button>';
            for (let n = 1; n <= total; n++) html += '<button class="pg-btn' + (n === cur ? ' active' : '') + '" data-pg="' + n + '">' + n + '</button>';
            html += '<button class="pg-btn" data-pg="next" aria-label="下一页"' + (cur === total ? ' disabled' : '') + '><i class="fas fa-chevron-right"></i></button>';
            pager.innerHTML = html;
            pager.onclick = e => {
                const b = e.target.closest('.pg-btn');
                if (!b || b.disabled) return;
                const v = b.getAttribute('data-pg');
                const np = v === 'prev' ? cur - 1 : v === 'next' ? cur + 1 : parseInt(v, 10);
                loadFeed(np);
                const chips = document.getElementById('chips');
                if (chips) window.scrollTo({ top: chips.getBoundingClientRect().top + window.scrollY - 70, behavior: 'smooth' });
            };
        }

        /* ══════════ 轮播 banner（图片来自后台「首页轮播」配置，未配置则隐藏） ══════════ */
        async function loadCarousel() {
            const track = document.getElementById('hc-track');
            const carouselEl = document.getElementById('hero-carousel');
            if (!track || !carouselEl) return;
            let items = [];
            try { const d = await window.getSiteConfig().catch(() => ({})); if (d && Array.isArray(d.carousels) && d.carousels.length) items = d.carousels; } catch (_) {}
            // 轮播为空：只隐藏轮播图区域，悬浮搜索框必须保留显示
            if (!items.length) { carouselEl.style.display = 'none'; const thumbs = document.getElementById('hc-thumbs'); if (thumbs) thumbs.style.display = 'none'; return; }
            track.innerHTML = '';

            const thumbs = document.getElementById('hc-thumbs');
            if (thumbs) thumbs.innerHTML = '';

            const multi = items.length > 1;
            // 左右箭头
            let prevBtn = null, nextBtn = null;
            if (multi) {
                prevBtn = document.createElement('button');
                prevBtn.className = 'hc-arrow prev'; prevBtn.setAttribute('aria-label', '上一个');
                prevBtn.innerHTML = '<i class="fas fa-chevron-left"></i>';
                nextBtn = document.createElement('button');
                nextBtn.className = 'hc-arrow next'; nextBtn.setAttribute('aria-label', '下一个');
                nextBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';
                carouselEl.appendChild(prevBtn); carouselEl.appendChild(nextBtn);
            }

            items.forEach((it, i) => {
                const slide = document.createElement('div');
                slide.className = 'hc-slide';
                const link = it.link || '#';
                const mode = it.mode || (/^https?:\/\//.test(link) ? 'external' : 'search');
                const a = document.createElement('a');
                a.href = esc(link);
                const img = document.createElement('img');
                img.src = esc(it.pic ? proxyImg(it.pic) : ''); img.alt = '';
                img.loading = (i === 0) ? 'eager' : 'lazy';
                if (i === 0) img.setAttribute('fetchpriority', 'high');
                img.onerror = () => window.imgFallback(img);
                const fitImg = () => {
                    if (img.naturalWidth && img.naturalHeight && img.naturalWidth / img.naturalHeight >= 2.1) {
                        img.classList.add('fit-cover');
                    }
                };
                img.addEventListener('load', fitImg);
                if (img.complete && img.naturalWidth) fitImg();
                window.guardImg(img, 4000);
                a.appendChild(img);
                if (mode === 'external') {
                    a.target = '_blank'; a.rel = 'nofollow noopener';
                } else {
                    a.addEventListener('click', e => { e.preventDefault(); location.href = '/search?key=' + encodeURIComponent(link.trim()); });
                }
                slide.appendChild(a);
                track.appendChild(slide);

                // 缩略图条（每张一个，点击切换）
                if (thumbs) {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'hc-thumb' + (i === 0 ? ' active' : '');
                    const t = document.createElement('img');
                    t.src = esc(it.pic ? proxyImg(it.pic) : ''); t.alt = ''; t.loading = 'lazy';
                    b.appendChild(t);
                    b.addEventListener('click', () => goSlide(i));
                    thumbs.appendChild(b);
                }
            });
            if (thumbs) thumbs.style.display = '';

            const total = items.length;
            let idx = 0, timer = null;
            const thumbEls = () => (thumbs ? thumbs.querySelectorAll('.hc-thumb') : []);
            function goSlide(n) {
                idx = (n + total) % total;
                track.style.transform = 'translateX(-' + idx * 100 + '%)';
                const thumbsEls = thumbEls();
                thumbsEls.forEach((d, i) => d.classList.toggle('active', i === idx));
                // 只横向滚动缩略图条容器自身（scrollLeft），绝不用 scrollIntoView——
                // 后者会连带滚动页面纵向位置，造成用户浏览时页面被「带飞」
                const active = thumbsEls[idx];
                if (active && thumbs) {
                    const tr = thumbs.getBoundingClientRect();
                    const ar = active.getBoundingClientRect();
                    const left = thumbs.scrollLeft + (ar.left - tr.left) - (thumbs.clientWidth - ar.width) / 2;
                    thumbs.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
                }
            }
            if (prevBtn) prevBtn.addEventListener('click', () => { goSlide(idx - 1); start(); });
            if (nextBtn) nextBtn.addEventListener('click', () => { goSlide(idx + 1); start(); });
            function start() { stop(); timer = setInterval(() => goSlide(idx + 1), 3800); }
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
            start();
            window.addEventListener('pagehide', stop, { once: true });
        }

        /* ══════════ 首页文字广告（后台可配置） ══════════ */
        async function loadPromoAd() {
            const el = document.querySelector('.promo-ad');
            if (!el) return;
            try {
                const d = await window.getSiteConfig().catch(() => ({}));
                const pa = d && d.promo_ad;
                if (!pa) { if (el) el.style.display = 'none'; return; } // 后台未配置 → 隐藏
                if (!(pa.enabled && pa.text)) { el.style.display = 'none'; return; }
                const textEl = el.querySelector('.promo-text');
                if (textEl) textEl.textContent = pa.text;
                const ic = el.querySelector('.promo-icon');
                if (ic) ic.className = 'fas ' + String(pa.icon || 'fa-fire').replace(/^fa[sb]?\s+/, '');
                el.setAttribute('href', pa.link ? String(pa.link).trim() : '#');
                if (!pa.link) { el.removeAttribute('target'); el.removeAttribute('rel'); }
                else { el.target = '_blank'; el.rel = 'nofollow noopener'; }
                el.style.display = '';
            } catch (_) { /* 接口异常时保留默认展示 */ }
        }

        /* ══════════ 友情链接 ══════════ */
        const renderFriendLinks = (list, max) => {
            const section = document.getElementById('friend-links');
            const el = document.getElementById('friend-list');
            const more = document.getElementById('fl-more');
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
            const el = document.getElementById('friend-list');
            if (el) el.innerHTML = '<span class="fl-loading">友情链接加载中…</span>';
            fetch('/api/friend-list').then(r => r.json()).then(data => {
                const list = (data && data.code === 1 && Array.isArray(data.list)) ? data.list : [];
                lsSetJson(CACHE, { ts: Date.now(), list });
                renderFriendLinks(list, FRIEND_MAX);
            }).catch(() => renderFriendLinks([], FRIEND_MAX));
        };

        /* ══════════ 初始化 ══════════ */
        const init = () => {
            // 刷新一律回到顶部：禁用浏览器滚动恢复，避免恢复到旧位置后被
            // 懒加载图片撑开布局，「停」在影视列表开头而不是页面顶部
            if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
            const htmlEl = document.documentElement;
            const prevSb = htmlEl.style.scrollBehavior;
            htmlEl.style.scrollBehavior = 'auto'; // 绕过全局 smooth，瞬时归零
            window.scrollTo(0, 0);
            htmlEl.style.scrollBehavior = prevSb;
            renderChips();
            loadFeed(1);
            wireHomeSearch();
            loadCarousel();
            loadPromoAd();
            loadFriendLinks();

        };

        document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
