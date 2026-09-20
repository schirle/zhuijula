(() => {
        'use strict';



        const siLink = document.getElementById('si-link');
        if (siLink) { siLink.textContent = location.origin + '/'; siLink.href = location.origin + '/'; }

        function loadFriendLinks(cb) {
            const CACHE = 'ftv_cache_friends';
            const cached = lsGetJson(CACHE);
            if (cached && cached.ts && Date.now() - cached.ts < 7200000) { cb(cached.list); return; }
            fetch('/api/friend-list').then(r => r.json()).then(data => {
                const list = (data && data.code === 1 && Array.isArray(data.list)) ? data.list : [];
                lsSetJson(CACHE, { ts: Date.now(), list });
                cb(list);
            }).catch(() => cb([]));
        }

        const renderFriendLinks = list => {
            const section = $('#friend-links'), el = $('#friend-list'), count = $('#fl-count');
            if (!section || !el) return;
            const arr = Array.isArray(list) ? list : [];
            if (!arr.length) { section.style.display = 'none'; return; }
            el.innerHTML = '';
            const linkSvg = '<i class="fas fa-arrow-up-right-from-square"></i>';
            const frag = document.createDocumentFragment();
            for (const item of arr) {
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
            if (!frag.childNodes.length) { section.style.display = 'none'; return; }
            el.appendChild(frag);
            if (count) count.textContent = `共收录 ${arr.length} 个友情站点`;
            section.style.display = '';
        };

        const listEl = $('#friend-list');
        if (listEl) listEl.innerHTML = '<span class="fl-loading">友链加载中…</span>';
        loadFriendLinks(renderFriendLinks);

        const form = document.getElementById('apply-form');
        if (form) {
            const gv = id => (document.getElementById(id).value || '').trim();
            const setErr = (id, msg) => { const e = document.getElementById(id); if (e) e.textContent = msg || ''; };
            const isUrl = v => /^https?:\/\/.+/i.test(v);

            form.addEventListener('submit', async e => {
                e.preventDefault();
                let ok = true;
                const name = gv('f-name');
                const url = gv('f-url');
                const email = gv('f-email');
                const linkback = gv('f-linkback');
                setErr('e-name', ''); setErr('e-url', ''); setErr('e-email', ''); setErr('e-linkback', '');

                if (!name) { setErr('e-name', '请填写站点名称'); ok = false; }
                if (!url) { setErr('e-url', '请填写站点地址'); ok = false; }
                else if (!isUrl(url)) { setErr('e-url', '地址格式不正确（需以 http:// 或 https:// 开头）'); ok = false; }
                if (!email) { setErr('e-email', '请填写联系邮箱'); ok = false; }
                else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setErr('e-email', '邮箱格式不正确'); ok = false; }
                if (!linkback) { setErr('e-linkback', '请填写贵站已添加本站的友链地址'); ok = false; }
                else if (!isUrl(linkback)) { setErr('e-linkback', '地址格式不正确'); ok = false; }

                const c1 = document.getElementById('c1');
                const c2 = document.getElementById('c2');
                if (c1 && !c1.checked) { showToast('请先确认已在贵站添加本站友链', 'error'); ok = false; }
                if (c2 && !c2.checked) { showToast('请确认已知悉友链申请要求', 'error'); ok = false; }
                if (!ok) return;

                const type = document.getElementById('f-type').value;
                const remark = gv('f-remark');

                const btn = form.querySelector('button[type="submit"]');
                const tip = document.querySelector('.apply-tip');
                if (btn) { btn.disabled = true; btn.textContent = '提交中…'; }
                try {
                  const resp = await fetch('/api/friend-apply', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify({
                      subject: `【友链申请】${name}`,
                      from_name: '免费追剧-友链申请',
                      replyto: email,
                      '站点名称': name,
                      '站点地址': url,
                      '联系邮箱': email,
                      '站点类型': type,
                      '贵站友链地址': linkback,
                      '申请说明': remark || '（无）',
                    }),
                  });
                  const data = await resp.json().catch(() => ({}));
                  if (data && data.success) {
                    showToast('申请已提交，请等待站长审核');
                    form.reset();
                  } else {
                    showToast((data && data.message) ? data.message : '提交失败，请稍后再试', 'error');
                  }
                } catch (e) {
                  showToast('网络错误，请稍后再试', 'error');
                } finally {
                  if (btn) { btn.disabled = false; btn.textContent = '提交申请'; }
                  if (tip) tip.style.display = 'none';
                }
            });
        }
    })();


