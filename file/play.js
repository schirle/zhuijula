(() => {
        const CDN = ['//unpkg.byted-static.com/xgplayer/2.31.6/browser/index.js', '//unpkg.byted-static.com/xgplayer-hls.js/2.2.2/browser/index.js'];
        const BACKUP = ['//cdn.jsdelivr.net/npm/xgplayer@2.31.6/browser/index.js', '//cdn.jsdelivr.net/npm/xgplayer-hls.js@2.2.2/browser/index.js'];
        let useCdn = 0;
        function loadSeq(idx) {
            if (idx >= CDN.length) return;
            const s = document.createElement('script');
            s.onload = () => loadSeq(idx + 1);
            s.onerror = () => { if (useCdn === 0) { useCdn = 1; loadSeq(0); } else loadSeq(idx + 1); };
            s.src = (useCdn === 0 ? CDN : BACKUP)[idx];
            document.head.appendChild(s);
        }
        loadSeq(0);
    })();

    (() => {
        'use strict';

        const { observe: observeRelatedImg } = initLazyImages('300px');

        const state = {
            allEpisodes: {}, currentSource: '', currentIndex: 0, retryCount: 0,
            epOrder: 'asc', epSheetOrder: 'asc',
            player: null, playerId: 0, playerWaitTimer: null, destroyed: false,
            _clickHandler: null,
            currentUrl: '', currentInfo: null,
            MAX_RETRIES: 2, PLAYER_WAIT_MAX: 20000,
        };

        const getEpisodeKey = () => {
            try {
                const { id, form } = getPlayParams();
                return id ? `play:ep:${id}:${form}` : '';
            } catch (_) { return ''; }
        };

        // ── 续播 & 倍速 ──
        const SPEED_KEY = 'play:speed';
        const getTimeKey = index => {
            try {
                const { id, form } = getPlayParams();
                if (!id) return '';
                return `play:time:${id}:${form}:${index}`;
            } catch (_) { return ''; }
        };
        const fmtTime = sec => {
            sec = Math.max(0, Math.floor(sec || 0));
            const m = Math.floor(sec / 60);
            const s = sec % 60;
            return `${m}分${String(s).padStart(2, '0')}秒`;
        };
        const saveCurrentTime = t => {
            const tk = getTimeKey(state.currentIndex);
            if (!tk || !isFinite(t) || t <= 1) return;
            try {
                const val = String(t);
                if (window.requestIdleCallback) window.requestIdleCallback(() => lsSet(tk, val));
                else lsSet(tk, val);
            } catch (_) {}
        };
        const getSavedTime = index => {
            const tk = getTimeKey(index);
            if (!tk) return 0;
            try { const v = parseFloat(lsGet(tk)); return (v && v > 3) ? v : 0; } catch (_) { return 0; }
        };
        const getSavedSpeed = () => {
            try { const v = parseFloat(lsGet(SPEED_KEY)); return (v && v > 0) ? v : 1; } catch (_) { return 1; }
        };
        const applySpeed = () => {
            const v = getVideo();
            if (!v) return;
            const sp = getSavedSpeed();
            if (sp === 1) return; // 1x 无需设置，避免偶发重新解码掉帧
            try { v.playbackRate = sp; } catch (_) {}
        };
        const applyResume = () => {
            if (state.resumeApplied) return;
            const rt = state.resumeTime || 0;
            if (!rt) return;
            const v = getVideo();
            if (!v || !isFinite(v.duration) || v.duration <= 0) return;
            if (rt >= v.duration - 3) return; // 接近结尾不续播
            state.resumeApplied = true;
            try {
                v.currentTime = rt;
                Toast.show(`已续播至 ${fmtTime(rt)}`, 1600);
            } catch (_) {}
        };
        // ── 键盘左右键快进/快退：短按短跳，长按连续走进度 ──
        const SEEK_TAP_STEP = 5;     // 短按快进/快退秒数
        const SEEK_HOLD_STEP = 5;    // 长按每跳秒数
        const SEEK_HOLD_DELAY = 280; // 超过该时长视为长按，进入连续快进/快退
        let _seekTimer = null, _seekInterval = null, _seekDir = 0, _seekTap = false;
        const seekBy = delta => {
            const v = getVideo();
            if (!v || !isFinite(v.duration) || v.duration <= 0) return;
            let t = v.currentTime + delta;
            t = Math.max(0, Math.min(v.duration, t));
            try { v.currentTime = t; } catch (_) {}
            try { saveCurrentTime(t); } catch (_) {}
            Toast.show((delta < 0 ? '↶ 后退 ' : '前进 ↷ ') + fmtTime(Math.abs(delta)), 600);
        };
        const startSeek = (dir, repeat) => {
            if (repeat) return; // 长按产生的自动重复事件忽略，由定时器进入连续模式
            _seekDir = dir; _seekTap = true;
            clearTimeout(_seekTimer);
            _seekTimer = setTimeout(() => {
                _seekTap = false;
                seekBy(dir * SEEK_HOLD_STEP);
                _seekInterval = setInterval(() => seekBy(dir * SEEK_HOLD_STEP), 180);
            }, SEEK_HOLD_DELAY);
        };
        const endSeek = () => {
            clearTimeout(_seekTimer);
            if (_seekInterval) { clearInterval(_seekInterval); _seekInterval = null; }
            if (_seekTap) seekBy(_seekDir * SEEK_TAP_STEP); // 短按：一次短跳
            _seekTap = false; _seekDir = 0;
        };
        const isM3u8Url = url => /\.m3u8(\?|$)/i.test(url || '');
        const isTouchDevice = () => ('ontouchstart' in window || navigator.maxTouchPoints > 0 || matchMedia('(pointer:coarse)').matches);

        const setLoading = (text, isError) => {
            const el = $('#player-loading');
            if (!el) return;
            el.classList.remove('hidden');
            // 错误提示不应拦截下方的播放控制（暂停/音量/倍速），故置为穿透
            el.style.pointerEvents = isError ? 'none' : '';
            $('.spinner', el).style.display = isError ? 'none' : '';
            const t = $('.player-loading-text', el);
            if (t) { t.style.color = isError ? '#ff4d4f' : ''; t.textContent = text; }
        };
        const hideLoading = () => $('#player-loading')?.classList.add('hidden');
        const getVideo = () => {
            const p = state.player;
            if (!p) return null;
            if (p.video?.tagName === 'VIDEO') return p.video;
            if (p.media?.tagName === 'VIDEO') return p.media;
            if (p.root) { const v = p.root.querySelector('video'); if (v) return v; }
            return $('#mse')?.querySelector('video') || null;
        };

        const destroyPlayer = () => {
            if (state.playerWaitTimer) { clearInterval(state.playerWaitTimer); state.playerWaitTimer = null; }
            if (state._clickHandler) {
                $('#mse')?.removeEventListener('click', state._clickHandler);
                state._clickHandler = null;
            }
            const p = state.player;
            state.player = null;
            if (p) {
                const events = ['timeupdate', 'canplay', 'loadeddata', 'playing', 'error', 'seeking', 'seeked', 'pause', 'waiting', 'ended', 'loadstart', 'durationchange'];
                for (const ev of events) { try { p.off?.(ev); } catch (_) {} }
                const v = getVideo();
                try { if (v && !v.paused) v.pause(); } catch (_) {}
                try { if (v) { v.removeAttribute('src'); v.load(); } } catch (_) {}
                try { p.destroy?.(); } catch (_) {}
            }
            const mseEl = $('#mse');
            if (mseEl) while (mseEl.firstChild) mseEl.removeChild(mseEl.firstChild);
        };

        const createPlayer = url => {
            if (state.destroyed || !window.HlsJsPlayer) return null;
            try {
                const mseEl = $('#mse');
                if (!mseEl) return null;
                while (mseEl.firstChild) mseEl.removeChild(mseEl.firstChild);
                return new window.HlsJsPlayer({
                    id: 'mse', url, autoplay: true, playsinline: true,
                    // 关掉 xgplayer 自带的错误遮罩（中间会显示“刷新”提示且会打断播放），错误统一走我们的处理逻辑
                    ignores: ['error'],
                    whitelist: [''], crossOrigin: 'anonymous',
                    width: '100%', height: '100%', rotateFullscreen: false,
                    fullscreenTarget: $('#video-section') || mseEl,
                    // 抗卡顿：解封装放到 Worker 线程 + 加大缓冲，缓解「声音在、画面卡」的解码/网络抖动
                    hls: {
                        enableWorker: true,
                        maxBufferLength: 40,
                        maxMaxBufferLength: 80,
                        backBufferLength: 90,
                        fragLoadingMaxRetry: 6,
                        fragLoadingRetryDelay: 1000,
                        manifestLoadingMaxRetry: 6,
                        manifestLoadingRetryDelay: 1000,
                    },
                });
            } catch (e) {
                console.error('[play] createPlayer error:', e);
                return null;
            }
        };

        const initPlayer = url => {
            if (!url || state.destroyed) return;
            state.playerId++;
            const pid = state.playerId;
            state.currentUrl = url;
            state.readyFired = false;
            destroyPlayer();
            setLoading('正在加载视频...', false);
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    if (state.playerId !== pid || state.destroyed) return;
                    const player = createPlayer(url);
                    if (!player) { setLoading('播放器组件未加载，请刷新页面', true); return; }
                    state.player = player;
                    const onReady = () => {
                        if (state.playerId !== pid || state.readyFired) return;
                        state.readyFired = true; hideLoading();
                        try { player.resize?.(); } catch (_) {}
                        applyResume(); applySpeed();
                    };
                    player.on('canplay', () => {
                        if (state.playerId !== pid) return;
                        onReady();
                        applyResume(); applySpeed(); // 切换集（switchURL）时 onReady 已触发过，这里兜底续播/倍速
                    });
                    player.on('playing', () => { if (state.playerId === pid) { onReady(); applyResume(); } });
                    player.on('timeupdate', () => {
                        if (state.playerId !== pid) return;
                        const video = getVideo();
                        if (!video) return;
                        const now = Date.now();
                        if (now - (state._lastSave || 0) > 8000) {
                            state._lastSave = now;
                            saveCurrentTime(video.currentTime);
                        }
                    });
                    player.on('pause', () => {
                        if (state.playerId !== pid) return;
                        const video = getVideo();
                        if (video) saveCurrentTime(video.currentTime);
                    });
                    setTimeout(() => { if (state.playerId === pid && state.player && !state.readyFired) onReady(); }, 5000);
                    // 错误自动恢复：HLS 偶发错误（网络抖动 / 切片加载失败）多半可重连恢复，
                    // 不直接盖死遮罩。最多重试 4 次，全部失败才展示非阻塞的错误提示。
                    let recover = 0;
                    player.on('error', () => {
                        if (state.playerId !== pid) return;
                        const url = state.currentUrl;
                        if (recover < 4 && url) {
                            recover++;
                            setLoading('网络波动，正在恢复播放…', false);
                            setTimeout(() => {
                                if (state.playerId !== pid || !state.player) return;
                                try {
                                    if (typeof state.player.switchURL === 'function') state.player.switchURL(url);
                                    else { initPlayer(url); return; }
                                    if (state.player.play) state.player.play().catch(() => {});
                                } catch (_) {
                                    try { initPlayer(url); } catch (e2) { setLoading('播放失败，请尝试切换其他源', true); }
                                }
                            }, 1000);
                            return;
                        }
                        setLoading('播放失败，请尝试切换其他源', true);
                    });
                    player.on('ended', () => {
                        if (state.playerId !== pid) return;
                        const eps = getCurrentEpisodes();
                        if (!eps.length) return;
                        const ni = state.currentIndex + 1;
                        if (ni < eps.length) playIndex(ni);
                        else { hideLoading(); Toast.show('已播放至最后一集', 2000); }
                    });
                    setTimeout(() => {
                        if (state.playerId !== pid || !state.player) return;
                        const video = getVideo();
                        if (!video) return;
                        if (video.paused && (!video.currentTime || video.currentTime < 0.5)) {
                            video.play().then(() => { if (state.playerId === pid) hideLoading(); }).catch(() => {
                                if (state.playerId !== pid) return;
                                setLoading('点击任意位置开始播放', false);
                                const mseEl = $('#mse');
                                if (!mseEl) return;
                                mseEl.style.cursor = 'pointer';
                                state._clickHandler = () => {
                                    video.play().catch(() => {}); hideLoading();
                                    mseEl.style.cursor = '';
                                    mseEl.removeEventListener('click', state._clickHandler);
                                    state._clickHandler = null;
                                };
                                mseEl.addEventListener('click', state._clickHandler);
                            });
                        }
                    }, 1500);
                });
            });
        };

        const playWhenReady = url => {
            if (!url) return;
            if (state.player && typeof state.player.switchURL === 'function') {
                state.currentUrl = url;
                setLoading('正在加载视频...', false);
                try {
                    state.player.switchURL(url);
                    if (state.player.play) state.player.play().catch(() => {});
                    // 切换集后新视频就绪时续播/倍速（canplay 兜底）
                    setTimeout(() => { applyResume(); applySpeed(); }, 1500);
                    return;
                } catch (e) {
                    /* 回退 */
                }
            }
            if (window.HlsJsPlayer) { initPlayer(url); return; }
            if (state.playerWaitTimer) clearInterval(state.playerWaitTimer);
            const start = Date.now();
            state.playerWaitTimer = setInterval(() => {
                if (state.destroyed) { clearInterval(state.playerWaitTimer); state.playerWaitTimer = null; return; }
                if (window.HlsJsPlayer) {
                    clearInterval(state.playerWaitTimer); state.playerWaitTimer = null; initPlayer(url);
                } else if (Date.now() - start > state.PLAYER_WAIT_MAX) {
                    clearInterval(state.playerWaitTimer); state.playerWaitTimer = null;
                    setLoading('播放器加载超时，请刷新页面', true);
                }
            }, 150);
        };

        // 共享：填充广告到所有 .ad-slot 容器
        const loadAds = () => {
            fetch('/api/zhuiju').then(r => r.ok ? r.json() : null).then(data => {
                const ads = data?.['ad-list'] || [];
                const slots = $$('.ad-slot');
                if (!slots.length || !ads.length) return;
                const html = ads.map(ad => {
                    if (!ad.pic) return '';
                    return `<a class="ad-banner" href="${esc(ad.link || '#')}" target="_blank" rel="nofollow noopener noreferrer">
                        <span class="ad-badge">广告</span>
                        <img src="${esc(proxyImg(ad.pic))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="imgFallback(this)">
                    </a>`;
                }).join('');
                slots.forEach(s => { s.innerHTML = html; });
            }).catch(() => {});
        };

        // 本地记录：继续观看 + 本机热播榜（localStorage，无后端存储）
        const CONTINUE_KEY = 'ftv_continue';
        const PLAY_RANK_KEY = 'ftv_play_rank';
        const saveContinue = info => {
            try {
                const id = String(info.vod_id || '');
                const form = new URLSearchParams(location.search).get('form') || 'xg';
                if (!id && !info.vod_name) return;
                const list = lsGetJson(CONTINUE_KEY) || [];
                const entry = { id, form, name: info.vod_name || '未知影片', pic: info.vod_pic || '', ep: state.currentIndex, ts: Date.now() };
                const filtered = list.filter(e => !(e.id === entry.id && e.form === entry.form));
                filtered.unshift(entry);
                lsSetJson(CONTINUE_KEY, filtered.slice(0, 20));
            } catch (_) {}
        };
        const updateContinueEp = (id, form, ep) => {
            try {
                const list = lsGetJson(CONTINUE_KEY) || [];
                const e = list.find(x => String(x.id) === String(id) && x.form === form);
                if (e) { e.ep = ep; lsSetJson(CONTINUE_KEY, list); }
            } catch (_) {}
        };
        const incPlayRank = (name, pic, id, form) => {
            if (!name) return;
            try {
                const m = lsGetJson(PLAY_RANK_KEY) || {};
                const cur = m[name] || { count: 0, pic: '', id: '', form: '' };
                cur.count += 1;
                if (pic) cur.pic = pic;
                if (id) cur.id = id;
                if (form) cur.form = form;
                m[name] = cur;
                lsSetJson(PLAY_RANK_KEY, m);
            } catch (_) {}
        };

        const showError = msg => {
            $('#page-loading')?.classList.add('hidden');
            const app = $('#app'); if (app) app.style.display = 'none';
            const em = $('#error-msg'); if (em) em.textContent = msg || '加载失败，请稍后重试';
            $('#error-view')?.classList.add('visible');
        };
        const retryLoad = () => { state.retryCount = 0; $('#error-view')?.classList.remove('visible'); loadDetail(); };

        const loadDetail = () => {
            const params = new URLSearchParams(location.search);
            const id = params.get('id');
            const form = params.get('form') || 'xg';
            if (!id) { location.replace('/'); return; }
            fetch(`/api/detail?ids=${encodeURIComponent(id)}&form=${encodeURIComponent(form)}`)
                .then(r => {
                    if (r.status === 503) throw new Error('SOURCE_BUSY');
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    return r.json();
                })
                .then(data => {
                    if (data.code !== 1 || !Array.isArray(data.list) || !data.list.length) throw new Error('NOT_FOUND');
                    renderDetail(data.list[0]);
                })
                .catch(err => {
                    const msgMap = {
                        SOURCE_BUSY: '数据源加载中，请稍候…（若持续失败可先返回首页预热）',
                        NOT_FOUND: '影片信息不存在或已下架',
                    };
                    const msg = msgMap[err.message] || `加载失败 (${err.message})`;
                    if (state.retryCount < state.MAX_RETRIES) {
                        state.retryCount++;
                        setTimeout(loadDetail, err.message === 'SOURCE_BUSY' ? 2000 : 800);
                    } else {
                        showError(msg);
                    }
                });
        };

        const renderDetail = info => {
            if (state.destroyed) return;
            const vodName = info.vod_name || '未知影片';
            state.currentInfo = info;
            saveContinue(info);
            incPlayRank(info.vod_name, info.vod_pic, String(info.vod_id || ''), new URLSearchParams(location.search).get('form') || 'xg');

            // 海报（桌面侧栏）
            const npPoster = $('#np-poster');
            if (npPoster) {
                if (info.vod_pic) { npPoster.src = proxyImg(info.vod_pic); npPoster.onerror = () => imgFallback(npPoster); }
                else npPoster.removeAttribute('src');
            }
            // 海报（手机 sheet）
            const sheetPoster = $('#sheet-poster');
            if (sheetPoster) {
                if (info.vod_pic) { sheetPoster.src = proxyImg(info.vod_pic); sheetPoster.onerror = () => imgFallback(sheetPoster); }
                else sheetPoster.removeAttribute('src');
            }

            // 简介文本（截取纯文本）
            let desc = '';
            if (info.vod_content) {
                desc = info.vod_content.replace(/<[^>]*>/g, '');
                try { const tmp = document.createElement('div'); tmp.innerHTML = desc; desc = tmp.textContent || ''; } catch (_) {}
                desc = desc.replace(/\s+/g, ' ').trim();
            }

            // 桌面：np-title 与 np-meta
            const npTitle = $('#np-title');
            if (npTitle) npTitle.innerHTML = `${esc(vodName)} <span class="tag tag-green">${esc(info.vod_remarks || '高清')}</span>`;
            const npMeta = $('#np-meta');
            if (npMeta) {
                const parts = [];
                if (info.type_name) parts.push(`分类: <span>${esc(info.type_name)}</span>`);
                if (info.vod_year) parts.push(`年份: <span>${esc(info.vod_year)}</span>`);
                if (info.vod_area) parts.push(`地区: <span>${esc(info.vod_area)}</span>`);
                npMeta.innerHTML = parts.join(' · ');
            }

            // 手机：vod-title + vod-desc
            const vodTitle = $('#vod-title');
            if (vodTitle) vodTitle.innerHTML = `${esc(vodName)} <span class="tag tag-green" style="font-size:11px;padding:2px 7px;border-radius:999px;background:var(--primary-dim);color:var(--primary-light);font-weight:600;vertical-align:middle">${esc(info.vod_remarks || '高清')}</span>`;
            const vodDesc = $('#vod-desc');
            if (vodDesc) vodDesc.textContent = desc || '暂无简介';

            // 手机 sheet：完整详情
            const sheetTitle = $('#sheet-title');
            if (sheetTitle) sheetTitle.textContent = vodName;
            const sheetMeta = $('#sheet-meta');
            if (sheetMeta) {
                const parts = [];
                if (info.vod_year) parts.push(esc(info.vod_year));
                if (info.type_name) parts.push(esc(info.type_name));
                if (info.vod_area) parts.push(esc(info.vod_area));
                sheetMeta.textContent = parts.join(' · ');
            }
            const sheetCast = $('#sheet-cast');
            if (sheetCast) {
                const rows = [];
                if (info.vod_director) rows.push(`<dt>导演</dt><dd>${esc(info.vod_director)}</dd>`);
                if (info.vod_actor) rows.push(`<dt>演员</dt><dd>${esc(info.vod_actor)}</dd>`);
                sheetCast.innerHTML = rows.join('');
            }
            const sheetDesc = $('#sheet-desc');
            if (sheetDesc) sheetDesc.textContent = desc || '暂无简介';

            // 桌面：简介 tab 内的 desc-section 与 intro-meta
            const descEl = $('#vod-description');
            const descSection = $('#desc-section');
            if (descEl) {
                descEl.textContent = desc || '暂无简介';
                descEl.classList.add('collapsed');
                const toggleBtn = $('#desc-toggle-btn');
                if (toggleBtn) toggleBtn.textContent = '展开 ▾';
                if (descSection) descSection.style.display = desc ? '' : 'none';
            }
            const introMeta = $('#intro-meta');
            if (introMeta) {
                const rows = [];
                if (info.type_name) rows.push(`<dt>分类</dt><dd>${esc(info.type_name)}</dd>`);
                if (info.vod_year) rows.push(`<dt>年份</dt><dd>${esc(info.vod_year)}</dd>`);
                if (info.vod_area) rows.push(`<dt>地区</dt><dd>${esc(info.vod_area)}</dd>`);
                if (info.vod_actor) rows.push(`<dt>主演</dt><dd>${esc(info.vod_actor)}</dd>`);
                if (info.vod_director) rows.push(`<dt>导演</dt><dd>${esc(info.vod_director)}</dd>`);
            introMeta.innerHTML = rows.join('');
        }

            document.title = `免费追剧 - ${vodName}`;
            const app = $('#app'); if (app) app.style.display = '';
            const pl = $('#page-loading');
            if (pl) { pl.classList.add('hidden'); setTimeout(() => pl.parentNode && pl.remove(), 400); }

            loadAds();
            parseEpisodes(info);
            if (vodName && vodName !== '未知影片') { buildRelated(vodName); }
        };

        const parseEpisodes = info => {
            const fromArr = (info.vod_play_from || '').split('$$$');
            const urlArr = (info.vod_play_url || '').split('$$$');
            const serverArr = (info.vod_play_server || '').split('$$$');
            const noteArr = (info.vod_play_note || '').split('$$$');

            state.allEpisodes = {};
            for (let idx = 0; idx < fromArr.length; idx++) {
                if (!urlArr[idx]) continue;
                const lines = urlArr[idx].split('#');
                const eps = [];
                for (const line of lines) {
                    const di = line.indexOf('$');
                    if (di === -1) continue;
                    const url = line.substring(di + 1).trim();
                    if (!url || !isM3u8Url(url)) continue;
                    eps.push({ name: line.substring(0, di).trim(), url, from: fromArr[idx] });
                }
                if (eps.length) state.allEpisodes[fromArr[idx]] = { name: fromArr[idx], server: serverArr[idx] || '', note: noteArr[idx] || '', list: eps };
            }
            const sourceNames = Object.keys(state.allEpisodes);
            const oRow = $('#ep-one-row');
            const cnt = $('#ep-count-text');
            const eList = $('#episode-list');
            const eCnt = $('#ep-count');
            if (!sourceNames.length) {
                if (oRow) oRow.innerHTML = '<div class="ep-empty">无可用播放源</div>';
                if (cnt) cnt.textContent = '共 0 集';
                if (eList) eList.innerHTML = '<div class="ep-empty">无可用播放源</div>';
                if (eCnt) eCnt.innerHTML = '';
                return;
            }
            state.currentSource = sourceNames[0];
            renderSourceTabs(sourceNames);
            renderSheetSources(sourceNames);
            renderAllEpisodes();
            let startIdx = 0;
            const ek = getEpisodeKey();
            if (ek) {
                const sv = parseInt(lsGet(ek), 10);
                const total = getCurrentEpisodes().length;
                if (!isNaN(sv) && sv >= 0 && sv < total) startIdx = sv;
            }
            playIndex(startIdx); // 续播上次记忆的集数
        };

        const renderSourceTabs = names => {
            const el = $('#source-tabs');
            if (!el) return;
            const list = names.filter(n => n !== 'xiguam3u8'); // 不显示 xiguam3u8 来源按钮
            if (!list.length) { el.innerHTML = ''; return; }
            if (list.length <= 1) { el.innerHTML = ''; return; }
            el.innerHTML = list.map(name => {
                const active = name === state.currentSource ? ' active' : '';
                return `<button class="source-tab-btn${active}" data-source="${esc(name)}">${esc(name)}</button>`;
            }).join('');
        };
        const renderSheetSources = names => {
            const el = $('#sheet-source-tabs');
            if (!el) return;
            const list = names.filter(n => n !== 'xiguam3u8'); // 不显示 xiguam3u8 来源按钮
            if (!list.length) { el.innerHTML = ''; return; }
            el.innerHTML = list.map(name => {
                const active = name === state.currentSource ? ' active' : '';
                return `<button class="source-tab-btn${active}" data-source="${esc(name)}">${esc(name)}</button>`;
            }).join('');
        };

        const getCurrentEpisodes = () => state.allEpisodes[state.currentSource]?.list || [];
        const getDisplayEpsDesktop = () => {
            const eps = getCurrentEpisodes();
            const arr = eps.map((ep, i) => ({ ep, orig: i }));
            return state.epOrder === 'desc' ? arr.reverse() : arr;
        };
        const getDisplayEpsSheet = () => {
            const eps = getCurrentEpisodes();
            const arr = eps.map((ep, i) => ({ ep, orig: i }));
            return state.epSheetOrder === 'desc' ? arr.reverse() : arr;
        };

        // 桌面：渲染所有集数到 #episode-list
        const renderDesktopEpisodes = () => {
            const list = $('#episode-list');
            const cnt = $('#ep-count');
            const eps = getCurrentEpisodes();
            if (cnt) cnt.innerHTML = `共 <b>${eps.length}</b> 集`;
            if (!list) return;
            if (!eps.length) { list.innerHTML = '<div class="ep-empty">无播放源</div>'; return; }
            const display = getDisplayEpsDesktop();
            const frag = document.createDocumentFragment();
            for (const d of display) {
                const btn = document.createElement('button');
                btn.className = `ep-btn${d.orig === state.currentIndex ? ' active' : ''}`;
                btn.setAttribute('data-index', d.orig);
                btn.title = d.ep.name;
                btn.textContent = d.ep.name;
                frag.appendChild(btn);
            }
            list.innerHTML = '';
            list.appendChild(frag);
        };

        // 手机：渲染当前上下若干集到 #ep-one-row
        const renderMobileOneRow = () => {
            const oRow = $('#ep-one-row');
            const cnt = $('#ep-count-text');
            const eps = getCurrentEpisodes();
            if (!oRow) return;
            if (cnt) cnt.textContent = `共 ${eps.length} 集`;
            if (!eps.length) { oRow.innerHTML = '<div class="ep-empty">无可用播放源</div>'; return; }
            const N = eps.length;
            const cur = state.currentIndex;
            const span = 4;
            let from = Math.max(0, cur - 1);
            let to = Math.min(N - 1, from + span - 1);
            from = Math.max(0, to - span + 1);
            const frag = document.createDocumentFragment();
            for (let i = from; i <= to; i++) {
                const ep = eps[i];
                const btn = document.createElement('button');
                btn.className = 'ep-mini' + (i === cur ? ' active' : '');
                btn.setAttribute('data-index', i);
                btn.title = ep.name;
                btn.textContent = ep.name;
                frag.appendChild(btn);
            }
            oRow.innerHTML = '';
            oRow.appendChild(frag);
        };

        // 手机 sheet：完整集数网格
        const renderSheetEpisodes = () => {
            const list = $('#sheet-ep-list');
            if (!list) return;
            const eps = getCurrentEpisodes();
            if (!eps.length) { list.innerHTML = '<div class="rec-empty">无播放源</div>'; return; }
            const display = getDisplayEpsSheet();
            const frag = document.createDocumentFragment();
            for (const d of display) {
                const btn = document.createElement('button');
                btn.className = 'sheet-ep' + (d.orig === state.currentIndex ? ' active' : '');
                btn.setAttribute('data-index', d.orig);
                btn.title = d.ep.name;
                btn.textContent = d.ep.name;
                if (d.orig === state.currentIndex) {
                    const tag = document.createElement('span');
                    tag.className = 'sheet-ep-indicator';
                    tag.textContent = '在播';
                    btn.appendChild(tag);
                }
                frag.appendChild(btn);
            }
            list.innerHTML = '';
            list.appendChild(frag);
        };

        const renderAllEpisodes = () => {
            renderDesktopEpisodes();
            renderMobileOneRow();
        };

        const playIndex = index => {
            const eps = getCurrentEpisodes();
            const ep = eps[index];
            if (!ep) return;
            state.currentIndex = index;
            state.resumeTime = getSavedTime(index);
            state.resumeApplied = false;
            const ek = getEpisodeKey();
            if (ek) { try { lsSet(ek, String(index)); } catch (_) {} }
            try {
                const { id: cid, form: cform } = getPlayParams();
                if (cid) updateContinueEp(cid, cform, index);
            } catch (_) {}

            // 桌面：ep-btn 激活态
            const list = $('#episode-list');
            if (list) {
                $$('.ep-btn', list).forEach(b => b.classList.toggle('active', +b.getAttribute('data-index') === index));
                const active = list.querySelector('.ep-btn.active');
                if (active) try { active.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (_) {}
            }
            // 手机：ep-mini 激活态并滚动到视野内
            const oRow = $('#ep-one-row');
            if (oRow) {
                $$('.ep-mini', oRow).forEach(b => b.classList.toggle('active', +b.getAttribute('data-index') === index));
                const active = oRow.querySelector('.ep-mini.active');
                if (active) try { active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }); } catch (_) {}
            }
            // 手机 sheet：sheet-ep 激活态 + 在播标记
            const sheetList = $('#sheet-ep-list');
            if (sheetList) {
                $$('.sheet-ep', sheetList).forEach(b => {
                    const i = +b.getAttribute('data-index');
                    b.classList.toggle('active', i === index);
                    if (i === index && !b.querySelector('.sheet-ep-indicator')) {
                        const tag = document.createElement('span');
                        tag.className = 'sheet-ep-indicator';
                        tag.textContent = '在播';
                        b.appendChild(tag);
                    } else if (i !== index) {
                        const t = b.querySelector('.sheet-ep-indicator');
                        if (t) t.remove();
                    }
                });
            }

            const label = $('#now-ep-label');
            if (label) { label.textContent = ep.name; label.classList.add('show'); }
            const playingLabel = $('#ep-playing-label');
            if (playingLabel) {
                const total = eps.length;
                if (total > 2) { playingLabel.textContent = `正在播放 第${index + 1}集`; playingLabel.classList.add('show'); }
                else playingLabel.classList.remove('show');
            }
            const prevBtn = $('#act-prev');
            if (prevBtn) prevBtn.disabled = index <= 0;
            const nextBtn = $('#act-next');
            if (nextBtn) nextBtn.disabled = index >= eps.length - 1;

            playWhenReady(ep.url);
        };

        const switchSource = name => {
            if (name === state.currentSource) return;
            state.currentSource = name;
            state.currentIndex = 0;
            $$('.source-tab-btn').forEach(t => t.classList.toggle('active', t.getAttribute('data-source') === name));
            renderAllEpisodes();
            playIndex(0);
        };

        const makeRecCard = item => {
            const id = item.vod_id || 0;
            const name = item.vod_name || '未知';
            const api = item._api_source || '';
            const pic = item.vod_pic || '';
            const remarks = item.vod_remarks || '';
            const a = document.createElement('a');
            a.href = playHref(id, api);
            a.className = 'rec-card'; a.target = '_blank'; a.title = name;
            const poster = document.createElement('div');
            poster.className = 'rec-poster';
            const img = document.createElement('img');
            if (pic) img.setAttribute('data-src', pic);
            img.alt = name; img.loading = 'lazy';
            poster.appendChild(img);
            const loadingEl = document.createElement('div');
            loadingEl.className = 'img-loading';
            const loadingImg = document.createElement('img');
            loadingImg.src = 'file/loading.gif'; loadingImg.alt = '';
            loadingEl.appendChild(loadingImg);
            poster.appendChild(loadingEl);
            if (remarks) { const q = document.createElement('span'); q.className = 'rec-q'; q.textContent = remarks; poster.appendChild(q); }
            const nm = document.createElement('div');
            nm.className = 'rec-name'; nm.textContent = name;
            a.appendChild(poster); a.appendChild(nm);
            return a;
        };

        // 共享：填充相关推荐到所有 .rec-grid 子容器
        const buildRelated = async name => {
            const lists = $$('#related-list, #rec-list');
            if (!lists.length) return;
            lists.forEach(el => { el.innerHTML = '<div class="rec-skeleton"></div>'.repeat(6); });
            const selfId = getParam('id');
            try {
                const r = await fetch(`/api/search?key=${encodeURIComponent(name)}`);
                const data = r.ok ? await r.json() : { code: 0 };
                if (!data || data.code !== 1 || !Array.isArray(data.list) || !data.list.length) {
                    lists.forEach(el => { el.innerHTML = '<div class="rec-empty">暂无相关推荐</div>'; });
                    return;
                }
                lists.forEach(el => {
                    const frag = document.createDocumentFragment();
                    let shown = 0;
                    for (const it of data.list) {
                        if (String(it.vod_id) === selfId) continue;
                        frag.appendChild(makeRecCard(it));
                        if (++shown >= 12) break;
                    }
                    el.innerHTML = '';
                    if (!shown) el.innerHTML = '<div class="rec-empty">暂无相关推荐</div>';
                    else { el.appendChild(frag); observeRelatedImg(el); }
                });
            } catch (_) {
                lists.forEach(el => { el.innerHTML = '<div class="rec-empty">推荐加载失败</div>'; });
            }
        };

        // ── 滑动底栏 ──
        let _lockCount = 0;
        const lockScroll = () => {
            _lockCount++;
            if (_lockCount === 1) {
                const sbw = window.innerWidth - document.documentElement.clientWidth;
                document.body.style.overflow = 'hidden';
                if (sbw > 0) document.body.style.paddingRight = sbw + 'px';
            }
        };
        const unlockScroll = () => {
            _lockCount = Math.max(0, _lockCount - 1);
            if (_lockCount === 0) {
                document.body.style.overflow = '';
                document.body.style.paddingRight = '';
            }
        };
        const openSheet = (id) => {
            const sheet = document.getElementById(id);
            if (!sheet) return;
            if (id === 'ep-sheet') renderSheetEpisodes();
            sheet.classList.add('show');
            sheet.setAttribute('aria-hidden', 'false');
            lockScroll();
        };
        const closeSheet = (sheet) => {
            const el = typeof sheet === 'string' ? document.getElementById(sheet) : sheet;
            if (!el) return;
            el.classList.remove('show');
            el.setAttribute('aria-hidden', 'true');
            unlockScroll();
        };

        const showTab = name => {
            $$('.side-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
            $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
        };

        // ── 分享 ──
        const doShare = () => {
            const url = location.href;
            const rawTitle = $('#np-title')?.textContent?.trim() || $('#vod-title')?.textContent?.trim() || '免费追剧';
            const shareTitle = '免费追剧：' + rawTitle;
            window.a2a_config = window.a2a_config || {};
            window.a2a_config.link = url;
            window.a2a_config.title = shareTitle;
            if (isTouchDevice() && navigator.share) {
                navigator.share({ title: shareTitle, url }).catch(() => {});
            } else {
                openShareModal(url);
            }
        };
        const openShareModal = (url) => {
            const overlay = $('#share-overlay');
            const qrImg = $('#share-qr-img');
            const qrLoading = $('#qr-loading');
            const urlInput = $('#share-url-input');
            if (!overlay) return;
            if (urlInput) urlInput.value = url;
            const qrSize = 200;
            const qrSrc = 'https://api.qrserver.com/v1/create-qr-code/?size=' + qrSize + 'x' + qrSize + '&data=' + encodeURIComponent(url);
            if (qrImg && qrLoading) {
                qrImg.style.display = 'none';
                qrLoading.style.display = 'flex';
                qrImg.onload = () => { qrLoading.style.display = 'none'; qrImg.style.display = 'block'; };
                qrImg.onerror = () => { qrLoading.textContent = '二维码加载失败，请复制链接分享'; };
                qrImg.src = qrSrc;
            }
            const copyBtn = $('#share-copy-btn');
            if (copyBtn) {
                copyBtn.onclick = () => {
                    if (navigator.clipboard?.writeText) {
                        navigator.clipboard.writeText(url).then(() => {
                            copyBtn.textContent = '已复制';
                            setTimeout(() => { copyBtn.textContent = '复制链接'; }, 1500);
                        });
                    } else {
                        if (urlInput) { urlInput.select(); document.execCommand('copy'); }
                        copyBtn.textContent = '已复制';
                        setTimeout(() => { copyBtn.textContent = '复制链接'; }, 1500);
                    }
                };
            }
            overlay.classList.add('show');
        };
        const closeShareModal = () => $('#share-overlay')?.classList.remove('show');

        // ── 下载 ──
        const downloadCurrent = () => {
            // 下载按钮 → 打开应用中心（APP 下载页），不再跳转外部 panso.xyz
            window.open('app.html', '_blank', 'noopener');
        };
        const bindEvents = () => {
            // 简介入口 → 详情底栏
            const descTrigger = $('#desc-trigger');
            if (descTrigger) descTrigger.addEventListener('click', () => openSheet('detail-sheet'));
            const contentEl = $('#content');
            if (contentEl) {
                contentEl.addEventListener('click', e => {
                    if (e.target.closest('#vod-title') || e.target.closest('#vod-desc')) openSheet('detail-sheet');
                });
            }

            // 5 个操作按钮（手机）
            $('#act-prev')?.addEventListener('click', () => { if (state.currentIndex > 0) playIndex(state.currentIndex - 1); });
            $('#act-share')?.addEventListener('click', doShare);
            $('#act-dl')?.addEventListener('click', downloadCurrent);
            $('#act-next')?.addEventListener('click', () => { const eps = getCurrentEpisodes(); if (state.currentIndex < eps.length - 1) playIndex(state.currentIndex + 1); });
            $('#act-refresh')?.addEventListener('click', () => location.reload());

            // 倍速选择
            const speedBtn = $('#speed-btn');
            const speedMenu = $('#speed-menu');
            const speedVal = $('#speed-val');
            const syncSpeedUI = () => {
                const sp = getSavedSpeed();
                if (speedVal) speedVal.textContent = String(sp) + 'x';
                if (speedMenu) $$('.speed-menu button', speedMenu).forEach(b => b.classList.toggle('active', parseFloat(b.dataset.rate) === sp));
            };
            syncSpeedUI();
            if (speedBtn && speedMenu) {
                speedBtn.addEventListener('click', (e) => { e.stopPropagation(); speedMenu.hidden = !speedMenu.hidden; });
                $$('.speed-menu button', speedMenu).forEach(b => {
                    b.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const rate = parseFloat(b.dataset.rate) || 1;
                        try { lsSet(SPEED_KEY, String(rate)); } catch (_) {}
                        const v = getVideo();
                        if (v) try { v.playbackRate = rate; } catch (_) {}
                        if (speedVal) speedVal.textContent = String(rate) + 'x';
                        $$('.speed-menu button', speedMenu).forEach(x => x.classList.toggle('active', x === b));
                        speedMenu.hidden = true;
                    });
                });
                document.addEventListener('click', () => { speedMenu.hidden = true; });
            }

            // 离开页面 / 切到后台时保存观看进度
            const saveOnLeave = () => { const v = getVideo(); if (v) saveCurrentTime(v.currentTime); };
            window.addEventListener('beforeunload', saveOnLeave);
            document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveOnLeave(); });

            // 桌面侧栏内 np-share
            $('#np-share')?.addEventListener('click', doShare);

            // 来源 tab 点击（桌面 + sheet 共用）
            document.addEventListener('click', e => {
                const t = e.target.closest('.source-tab-btn');
                if (t) switchSource(t.getAttribute('data-source'));
            });

            // 桌面侧栏：集数 grid 点击
            const epList = $('#episode-list');
            if (epList) {
                epList.addEventListener('click', e => {
                    const b = e.target.closest('.ep-btn');
                    if (!b) return;
                    const idx = parseInt(b.getAttribute('data-index'), 10);
                    if (!isNaN(idx)) playIndex(idx);
                });
            }

            // 手机横排集数点击
            const oneRow = $('#ep-one-row');
            if (oneRow) {
                oneRow.addEventListener('click', e => {
                    const b = e.target.closest('.ep-mini');
                    if (!b) return;
                    const idx = parseInt(b.getAttribute('data-index'), 10);
                    if (!isNaN(idx)) playIndex(idx);
                });
            }

            // 手机：打开全集底栏
            $('#ep-open-all')?.addEventListener('click', () => openSheet('ep-sheet'));
            const epBlockHead = document.querySelector('.ep-block .ep-block-head');
            if (epBlockHead) {
                epBlockHead.addEventListener('click', e => {
                    if (e.target.closest('.ep-open-all')) return;
                    if (e.target.closest('.block-label')) openSheet('ep-sheet');
                });
            }

            // 选集 sheet 内点击
            const sheetList = $('#sheet-ep-list');
            if (sheetList) {
                sheetList.addEventListener('click', e => {
                    const b = e.target.closest('.sheet-ep');
                    if (!b) return;
                    const idx = parseInt(b.getAttribute('data-index'), 10);
                    if (!isNaN(idx)) { playIndex(idx); closeSheet('ep-sheet'); }
                });
            }
            $('#sheet-sort')?.addEventListener('click', e => {
                const b = e.target.closest('.sort-btn');
                if (!b) return;
                state.epSheetOrder = b.getAttribute('data-order');
                $$('#sheet-sort .sort-btn').forEach(s => s.classList.toggle('active', s === b));
                renderSheetEpisodes();
            });
            // 桌面：选集 tab 内 ep-sort
            const epSort = $('#ep-sort');
            if (epSort) {
                epSort.addEventListener('click', e => {
                    const b = e.target.closest('.sort-btn');
                    if (!b) return;
                    state.epOrder = b.getAttribute('data-order');
                    $$('#ep-sort .sort-btn').forEach(s => s.classList.toggle('active', s === b));
                    renderDesktopEpisodes();
                });
            }

            // 桌面侧栏：side-tabs 切换
            const sideTabs = $('#side-tabs');
            if (sideTabs) sideTabs.addEventListener('click', e => {
                const b = e.target.closest('.side-tab');
                if (b) showTab(b.dataset.tab);
            });

            // 桌面侧栏：简介展开/收起
            const dtb = $('#desc-toggle-btn');
            if (dtb) dtb.onclick = () => {
                const d = $('#vod-description');
                if (!d) return;
                const collapsed = d.classList.toggle('collapsed');
                d.style.webkitLineClamp = collapsed ? '3' : 'unset';
                dtb.textContent = collapsed ? '展开 ▾' : '收起 ▴';
            };

            // 底栏关闭
            document.querySelectorAll('.sheet').forEach(sheet => {
                sheet.querySelectorAll('[data-close]').forEach(el => {
                    el.addEventListener('click', () => closeSheet(sheet));
                });
            });

            $('#share-close')?.addEventListener('click', closeShareModal);
            $('#share-overlay')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeShareModal(); });
            document.addEventListener('keydown', e => {
                if (e.key === 'Escape') {
                    if ($('#share-overlay')?.classList.contains('show')) closeShareModal();
                    else document.querySelectorAll('.sheet.show').forEach(s => closeSheet(s));
                }
            });

            $('#retry-btn')?.addEventListener('click', retryLoad);

            // 键盘快捷键
            document.addEventListener('keydown', e => {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
                switch (e.key) {
                    case 'ArrowLeft':
                        // 键盘左右键：短按快退/快进，长按连续走进度（集数切换仍用屏幕按钮）
                        e.preventDefault();
                        startSeek(-1, e.repeat);
                        break;
                    case 'ArrowRight':
                        e.preventDefault();
                        startSeek(1, e.repeat);
                        break;
                    case 'f': case 'F':
                        e.preventDefault();
                        const vs = $('#video-section');
                        if (vs) {
                            if (document.fullscreenElement) document.exitFullscreen();
                            else if (vs.requestFullscreen) vs.requestFullscreen();
                            else if (vs.webkitRequestFullscreen) vs.webkitRequestFullscreen();
                        }
                        break;
                    case ' ':
                        if (state.player) {
                            e.preventDefault();
                            const v = getVideo();
                            if (v) v.paused ? v.play().catch(() => {}) : v.pause();
                        }
                        break;
                }
            });

            // 松开方快退/快进键：结束长按连续模式（短按则在此触发一次短跳）
            document.addEventListener('keyup', e => {
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') endSeek();
            });

            let resizeTimer;
            window.addEventListener('resize', () => {
                clearTimeout(resizeTimer);
                resizeTimer = setTimeout(() => { try { state.player?.resize?.(); } catch (_) {} }, 250);
            });

            window.addEventListener('beforeunload', () => { state.destroyed = true; destroyPlayer(); });
        };

        bindEvents();
        loadDetail();

        setTimeout(() => {
            const pl2 = $('#player-loading');
            if (pl2 && $('#app')?.style.display === 'none' && !pl2.classList.contains('hidden')) {
                const t = $('.player-loading-text', pl2);
                if (t) t.textContent = '数据源加载中，请耐心等待...';
            }
        }, 6000);
    })();
