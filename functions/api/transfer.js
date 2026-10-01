import { makeRoute, resolveEnv, CORS, getClientIP, checkRateLimit, getKV, isAdminRequest } from '../_shared.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const CODE_VER = 'ftv';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS },
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function netFetch(url, opts = {}, timeout = 12000, retries = 0) {
  let lastErr = null;
  for (let a = 0; a <= retries; a++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      return await fetch(url, { ...opts, signal: ctrl.signal });
    } catch (e) {
      lastErr = e;
      if (a < retries) await sleep(700);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

const DRIVES = {
  quark: {
    name: '夸克',
    api: 'https://drive-pc.quark.cn',
    referer: 'https://pan.quark.cn/',
    qp: 'pr=ucpro&fr=pc&uc_param_str=',
    stokenPath: '/1/clouddrive/share/sharepage/token',
    stokenOf: (j) => (j && ((j.data && j.data.stoken) || j.stoken)) || '',
    re: /pan\.quark\.cn\/s\/([A-Za-z0-9]+)/i,
  },
  uc: {
    name: 'UC',
    api: 'https://pc-api.uc.cn',
    referer: 'https://drive.uc.cn/',
    qp: 'pr=UCBrowser&fr=pc',
    stokenPath: '/1/clouddrive/share/sharepage/v2/detail',
    stokenOf: (j) => (j && j.data && ((j.data.token_info && j.data.token_info.stoken) || j.data.stoken)) || '',
    extraTokenPath: '/1/clouddrive/share/sharepage/token',
    queryStoken: true,
    writeOrigin: true,
    re: /(?:drive|fast|share)\.uc\.cn\/s\/([A-Za-z0-9_-]+)/i,
  },
};
const driveOf = (type) => DRIVES[type] || DRIVES.quark;
const apiInfo = (j) => {
  if (!j || typeof j !== 'object') return '无返回';
  const parts = [];
  if (j.status != null) parts.push('状态=' + j.status);
  if (j.code != null) parts.push('code=' + j.code);
  if (j.message) parts.push('msg=' + j.message);
  return parts.length ? parts.join(' ') : '空响应';
};
const cookieHint = (cookie) => {
  const s = String(cookie || '');
  return 'cookie长度=' + s.length + ' 含__puus=' + (/__puus=/i.test(s) ? '是' : '否');
};
const tokenHint = (t) => {
  const s = String(t || '');
  return '长度=' + s.length + ' 含%=' + (/%/.test(s) ? '是' : '否') + ' 含空格=' + (/\s/.test(s) ? '是' : '否') + ' 含+=' + (/\+/.test(s) ? '是' : '否');
};
function cleanCookie(cookie) {
  return String(cookie || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/^\s*["']|["']\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
const driveHeaders = (d, cookie) => ({
  'User-Agent': UA,
  'Accept': 'application/json, text/plain, */*',
  'Referer': d.referer,
  'Cookie': cookie,
});

async function drivePoll(d, ck, taskId, getResult, host) {
  for (let i = 0; i < 40; i++) {
    await sleep(1500);
    const u = `${host || d.api}/1/clouddrive/task?${d.qp}&task_id=${encodeURIComponent(taskId)}&retry_index=${i}`;
    const j = await netFetch(u, { headers: ck }).then((r) => r.json().catch(() => ({})));
    const data = j?.data;
    if (data?.message === 'capacity limit[{0}]') throw new Error(d.name + '网盘容量不足，请清理空间后重试');
    if (data && data.status === 2) return getResult(data);
  }
  return null;
}

const TRANSFER_TTL_MIN = 10;          // 中转副本存活分钟数 = 访客保存链接的时间窗（想改时长改这里）
const TRASH_KEY = 'transfer_trash';
const TRASH_MAX = 600;
const TRASH_RETRY_MIN = 5;
const TRASH_MAX_TRIES = 5;

async function trashLoad(env) {
  try {
    const raw = await getKV(env).get(TRASH_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => x && x.exp) : [];
  } catch (_) { return []; }
}

const trashSave = async (env, arr) => {
  try { await getKV(env).put(TRASH_KEY, JSON.stringify(arr.slice(-TRASH_MAX))); } catch (_) {  }
};

async function trashEnqueueMany(env, entries) {
  const list = (entries || []).filter((e) => e && e.item);
  if (!list.length) return;
  const q = await trashLoad(env);
  const now = Date.now();
  list.forEach((e) => q.push({ ...e.item, exp: now + (e.delayMs || 0) }));
  await trashSave(env, q);
}

const trashEnqueue = (env, item) => trashEnqueueMany(env, [{ item, delayMs: TRANSFER_TTL_MIN * 60 * 1000 }]);

const DRIVE_API_HOSTS = {
  quark: ['https://drive-pc.quark.cn', 'https://drive.quark.cn', 'https://pan.quark.cn', 'https://drive-m.quark.cn'],
  uc: ['https://pc-api.uc.cn', 'https://pre-api.uc.cn'],
};
const driveHostKey = (type) => 'drive_api_host_' + type;
async function driveHosts(env, type) {
  const all = DRIVE_API_HOSTS[type] || [DRIVES[type].api];
  try {
    const saved = String(await getKV(env).get(driveHostKey(type)) || '');
    if (saved && all.includes(saved)) return [saved, ...all.filter((h) => h !== saved)];
  } catch (_) {  }
  return all;
}
async function saveDriveHost(env, type, host) {
  if (/^https:\/\/pre-/.test(String(host || ''))) return;
  try { await getKV(env).put(driveHostKey(type), host, { expirationTtl: 3600 }); } catch (_) {  }
}

async function driveListDir(type, cookie, dirId, hosts) {
  const d = driveOf(type);
  const list = (hosts && hosts.length) ? hosts : (DRIVE_API_HOSTS[type] || [d.api]);
  // 并发向所有候选域名发请求，取第一个拿到的有效结果（原来顺序试，3 个域名要 24 秒）
  const got = await Promise.all(list.map((h) => netFetch(
    `${h}/1/clouddrive/file/sort?${d.qp}&pdir_fid=${encodeURIComponent(dirId || '0')}&_page=1&_size=200&_fetch_total=1&_sort=file_type:asc,updated_at:desc`,
    { headers: driveHeaders(d, cookie) }, 8000, 1,
  ).then((r) => r.json().catch(() => ({}))).then((j) => ({ h, j })).catch(() => ({ h, j: {} }))));
  const ok = got.find((x) => x.j && Array.isArray(x.j?.data?.list));
  if (ok) return { ok: true, list: ok.j.data.list, host: ok.h };
  return { ok: false, list: [], host: list[0] || d.api };
}

const DEL_PATH = '/1/clouddrive/file/delete';
function driveDeleteVariants(target, want, dirFid) {
  const out = [
    { tag: '标准filelist=fid', body: { action_type: 2, filelist: target, exclude_fids: [] } },
  ];
  if (want && want.length) out.push({ tag: 'filelist=文件名', body: { action_type: 2, filelist: want, exclude_fids: [] } });
  out.push(
    { tag: '带current_dir_fid', body: { action_type: 2, current_dir_fid: dirFid, filelist: target, exclude_fids: [] } },
    { tag: '参数挂query', body: { action_type: 2, filelist: target, exclude_fids: [] }, query: '&current_dir_fid=' + encodeURIComponent(dirFid) + '&filelist=' + encodeURIComponent(JSON.stringify(target)) },
    { tag: 'filelist为JSON串', body: { action_type: 2, filelist: JSON.stringify(target), exclude_fids: [] } },
    { tag: '老写法fid_list', body: { fid_list: target, exclude_fids: [] } },
    { tag: '表单编码', body: null, form: 'action_type=2&filelist=' + encodeURIComponent(JSON.stringify(target)) + '&exclude_fids=' + encodeURIComponent('[]') },
  );
  return out;
}

function sendDriveDelete(d, ck, v, host) {
  const headers = v.form
    ? { ...ck, 'Content-Type': 'application/x-www-form-urlencoded' }
    : { ...ck, 'Content-Type': 'application/json' };
  return netFetch(`${host || d.api}${DEL_PATH}?${d.qp}${v.query || ''}`, {
    method: 'POST',
    headers,
    body: v.form || JSON.stringify(v.body),
  }, 20000).then((r) => r.json().catch(() => ({})));
}

const delPrefKey = (type) => 'del_variant_' + type;
const getDelPref = async (env, type) => {
  try { return String(await getKV(env).get(delPrefKey(type)) || ''); } catch (_) { return ''; }
};
const setDelPref = async (env, type, tag) => {
  try { await getKV(env).put(delPrefKey(type), String(tag || '')); } catch (_) {  }
};

async function driveDelete(type, cookie, fids, names, dirId, pref = '', altDirs = [], hosts) {
  if (!cookie) return { ok: false, why: '未配置 Cookie' };
  const d = driveOf(type);
  const ck = driveHeaders(d, cookie);
  const want = (names || []).map((n) => String(n)).filter(Boolean);
  let target = (fids || []).map(String).filter(Boolean);

  const dirs = [...new Set([dirId || '0', ...altDirs.filter(Boolean)])];
  let listed = null;
  let apiHost = d.api;
  for (const dir of dirs) {
    const r = await driveListDir(type, cookie, dir, hosts);
    if (r.host) apiHost = r.host;
    if (!r.ok) continue;
    const fidSet = new Set(r.list.map((f) => String(f.fid)));
    const byName = r.list
      .filter((f) => want.includes(String(f.file_name || f.filename || '')))
      .map((f) => String(f.fid));
    const here = [...new Set([...target.filter((id) => fidSet.has(id)), ...byName])];
    if (!here.length) continue;
    listed = r.list;
    dirId = dir;
    target = here;
    break;
  }
  if (!listed) {
    return { ok: true, why: '', gone: true, note: d.name + '：网盘里已找不到这些临时文件（可能已清理，按已完成处理）' };
  }
  if (!target.length) return { ok: false, why: '没有找到需要清理的文件' };
  const dirFid = dirId;

  const variants = driveDeleteVariants(target, want, dirFid);
  if (pref) variants.sort((a, b) => (a.tag === pref ? -1 : 0) - (b.tag === pref ? -1 : 0));
  const stillThere = async () => {
    const chk = await driveListDir(type, cookie, dirFid, [apiHost]);
    if (!chk.ok) return false;
    const ids = new Set(chk.list.map((f) => String(f.fid)));
    return target.some((id) => ids.has(id));
  };
  const log = [];
  for (const v of variants) {
    let j = {};
    try {
      j = await sendDriveDelete(d, ck, v, apiHost);
    } catch (e) { log.push(v.tag + '=网络异常'); continue; }
    if (!(j && (j.code === 0 || j.status === 200))) { log.push(v.tag + '=' + apiInfo(j)); continue; }
    const taskId = (j && j.data && j.data.task_id) || (j && j.task_id) || '';
    if (taskId) {
      try {
        for (let t = 0; t < 6; t++) {
          await sleep(800);
          const pj = await netFetch(`${apiHost}/1/clouddrive/task?${d.qp}&task_id=${encodeURIComponent(taskId)}&retry_index=${t}`, { headers: ck }).then((r) => r.json().catch(() => ({})));
          if (pj && pj.data && pj.data.status === 2) break;
        }
      } catch (_) {  }
    }
    if (!(await stillThere())) return { ok: true, why: '', variant: v.tag };
    log.push(v.tag + '=返回成功但文件仍在');
  }
  await sleep(1500);
  if (!(await stillThere())) {
    const okTag = (log.find((s) => s.indexOf('标准filelist=fid=') === 0) || log[0] || '').split('=')[0];
    return { ok: true, why: '', variant: okTag || '' };
  }
  // 失败明细只写进服务器日志（排查用），页面上给一句看得懂的说明 ——
  // 后台是对外展示的界面，不该出现参数名之类的技术细节。
  try { console.warn('[cleanup] ' + type + ' 删除未成功：' + log.join('；')); } catch (_) { /* 日志失败不影响结果 */ }
  return { ok: false, why: '文件暂时没删掉（已自动重试多种方式），稍后会继续重试' };
}

async function baiduDelete(cookie, paths, hdr0, token0) {
  if (!paths || !paths.length) return { ok: false, why: '没有路径' };
  const hdr = hdr0 || bdHeaders(cookie || '');
  const bdstoken = token0 || await bdToken(hdr, cookie || '');
  if (!bdstoken) return { ok: false, why: '取 bdstoken 失败（BDUSS 可能已失效）' };

  const byDir = new Map();
  for (const raw of paths) {
    const p = String(raw || '').trim();
    if (!p.startsWith('/')) continue;
    const dir = p.replace(/\/[^/]+$/, '') || '/';
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(p);
  }
  const exist = [];
  let goneCount = 0;
  for (const [dir, list] of byDir) {
    const { items, why } = await bdListDir(hdr, bdstoken, dir);
    if (why) return { ok: false, why: '读取百度网盘目录失败，请检查网盘登录状态是否有效' };
    const names = new Set(items.map((f) => String(f.server_filename)));
    for (const p of list) {
      const name = p.slice(dir.replace(/\/$/, '').length + 1);
      if (names.has(name)) exist.push(p); else goneCount++;   // 不在目录里 = 已经删掉了
    }
  }
  if (!exist.length) return { ok: true, why: '', gone: goneCount };

  const doDel = (chunk, token, appId, headers) => netFetch(
    `${BAIDU}/api/filemanager?opera=delete&async=2&onnest=fail&bdstoken=${encodeURIComponent(token)}&channel=chunlei&web=1&app_id=${appId}&clienttype=0`,
    { method: 'POST', headers: bdForm(headers), body: 'filelist=' + encodeURIComponent(JSON.stringify(chunk)) },
  ).then((r) => r.json().catch(() => ({})));
  const isOk = (j) => !!(j && (j.errno === 0 || (Array.isArray(j.info) && j.info.length)));

  for (let i = 0; i < exist.length; i += 40) {
    const chunk = exist.slice(i, i + 40);
    let del = await doDel(chunk, bdstoken, BAIDU_APP_ID, hdr);
    if (!isOk(del) && Number(del && del.errno) === 132) {
      try {
        const ck0 = String(cookie || '');
        const t2 = await bdToken(bdHeaders(ck0), ck0, '250528');
        if (t2 && t2 !== bdstoken) {
          const h2 = { ...bdHeaders(ck0), 'Referer': BAIDU + '/disk/main' };
          const del2 = await doDel(chunk, t2, '250528', h2);
          if (isOk(del2)) return { ok: true, why: '', gone: goneCount };
          del = del2;
        }
      } catch (_) {  }
    }
    if (!isOk(del)) {
      const e = Number(del && del.errno);
      const hint = e === 132 ? '（百度要求「删除文件需要验证您的身份」，属服务端风控，需人工在百度网盘里验证后才能自动删）' : '';
      return { ok: false, why: 'errno=' + (del && del.errno) + hint + '（' + chunk.length + '项）' };
    }
  }
  return { ok: true, why: '', gone: goneCount };
}

const TRASH_CHUNK_ITEMS = 40;

let _flushChain = Promise.resolve();
let _lastFlushAt = 0;
const FLUSH_DEDUPE_MS = 10000;

// 自动清理总开关（定时器 / 页面访问触发的清理是否真的执行）。
// true = 到期自动删除（正常状态）；false = 暂停自动清理，只有后台点「立即清理」才删。
// ⚠️ 曾经是 false，导致"定时器在跑但一条都没删"——已改回 true。
export const AUTO_CLEAN = true;

function flushTrash(env, force = false, all = false) {
  if (!force && !AUTO_CLEAN) {
    return Promise.resolve({ total: -1, due: 0, done: 0, failed: 0, remain: -1, why: [], skipped: true, paused: true });
  }
  const run = () => {
    if (!force && Date.now() - _lastFlushAt < FLUSH_DEDUPE_MS) {
      return Promise.resolve({ total: -1, due: 0, done: 0, failed: 0, remain: -1, why: [], skipped: true });
    }
    _lastFlushAt = Date.now();
    return flushTrashInner(env, all, force);
  };
  _flushChain = _flushChain.then(run, run);
  return _flushChain;
}

export async function trashPending(env, limit = 10) {
  const q = await trashLoad(env);
  const now = Date.now();
  return q.slice(-limit).map((it) => {
    const inMin = Math.max(0, Math.round((it.exp - now) / 60000));
    if (it.t === 'bdscan') return { t: it.t, what: '遗留目录复查 ' + (it.dir || '/'), inMin };
    if (it.t === 'baidu') return { t: it.t, what: '百度 ' + ((it.paths || []).join('、') || '（无路径）'), inMin };
    const label = it.t === 'uc' ? 'UC' : (it.t === 'quark' ? '夸克' : it.t);
    return { t: it.t, what: label + ' ' + ((it.names || it.fids || []).length) + ' 个文件', inMin };
  });
}

const COOL_KEY = 'transfer_trash_cool';

async function flushTrashInner(env, all = false, force = false) {
  const q = await trashLoad(env);
  const now = Date.now();
  const due = all ? q.slice() : q.filter((x) => x.exp <= now);
  const report = { total: q.length, due: due.length, done: 0, failed: 0, removedDirs: 0, skippedBaidu: 0, remain: q.length, why: [], all };
  if (!due.length) return report;
  // 失败冷却：连续一轮"只失败零成功"就暂停自动清理 15 分钟。
  // 否则定时器每分钟都会对着无响应的网盘接口反复发请求，容易把限流越养越死（症状：转存/检测全部超时）。
  if (!force) {
    try {
      const c = JSON.parse((await getKV(env).get(COOL_KEY)) || 'null');
      if (c && c.until && now < c.until) {
        report.why.push('清理暂停中（上一轮全部失败，' + Math.ceil((c.until - now) / 60000) + ' 分钟后自动重试）');
        return report;
      }
    } catch (_) {  }
  }
  const rest = all ? [] : q.filter((x) => x.exp > now);
  const handled = new Set();

  const tagOf = (t) => (t === 'bdscan' ? '百度目录复查' : t === 'baidu' ? '百度' : t === 'uc' ? 'UC' : '夸克');
  const defer = (it, why) => {
    handled.add(it);
    const tries = Number(it.tries || 0) + 1;
    const tag = tagOf(it.t) + '：';
    if (report.why.length < 5 && !report.why.some((w) => w.startsWith(tag))) {
      report.why.push(tag + (tries >= TRASH_MAX_TRIES ? '放弃（已重试 ' + tries + ' 次）：' : '重试 ' + tries + '/' + TRASH_MAX_TRIES + '：') + why);
    }
    if (tries >= TRASH_MAX_TRIES) return;
    rest.push({ ...it, tries, exp: now + TRASH_RETRY_MIN * 60 * 1000 });
  };

  try {
    due.filter((x) => x.t === 'bdscan').forEach((it) => handled.add(it));
    const bdItems = due.filter((x) => x.t === 'baidu');
    if (bdItems.length && !force) bdItems.forEach((it) => handled.add(it));
    report.skippedBaidu = due.filter((x) => x.t === 'bdscan').length + (force ? 0 : bdItems.length);

    const work = force ? due.filter((x) => x.t !== 'bdscan') : due.filter((x) => x.t !== 'baidu' && x.t !== 'bdscan');
    const dirOf = (it, type) => String(it.dir || (type === 'uc' ? env.UC_DIR : env.QUARK_DIR) || '0');
    const groups = new Map();
    for (const it of work) {
      const key = it.t === 'baidu' ? 'baidu' : it.t + '|' + dirOf(it, it.t);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(it);
    }

    const pref = {};
    for (const key of groups.keys()) {
      const t = key.split('|')[0];
      if (t === 'quark' || t === 'uc') pref[t] = await getDelPref(env, t);
    }
    for (const [key, items] of groups) {
      const type = key.split('|')[0];
      for (let i = 0; i < items.length; i += TRASH_CHUNK_ITEMS) {
        const part = items.slice(i, i + TRASH_CHUNK_ITEMS);
        const payload = part.flatMap((it) => (type === 'baidu' ? (it.paths || []) : (it.fids || []))).filter(Boolean);
        const names = part.flatMap((it) => it.names || []);
        const dirId = dirOf(items[0], type);
        const cfgDir = String((type === 'uc' ? env.UC_DIR : env.QUARK_DIR) || '0');
        if (!payload.length && !names.length) { report.done += part.length; part.forEach((it) => handled.add(it)); continue; }
        let r;
        try {
          r = type === 'baidu'
            ? await baiduDelete(env.BAIDU_COOKIE || '', payload)
            : await driveDelete(type, (type === 'uc' ? env.UC_COOKIE : env.QUARK_COOKIE) || '', payload, names, dirId, pref[type], [cfgDir, '0'], await driveHosts(env, type));
        } catch (e) { r = { ok: false, why: (e && e.message) || String(e) }; }
        if (r.ok) {
          report.done += part.length;
          part.forEach((it) => handled.add(it));
          if (r.variant && r.variant !== pref[type]) await setDelPref(env, type, r.variant);
          if (r.note && report.why.length < 5) report.why.push(r.note);
        } else {
          report.failed += part.length;
          part.forEach((it) => defer(it, r.why));
        }
      }
    }
  } catch (e) {
    if (report.why.length < 4) report.why.push('清理异常：' + ((e && e.message) || e));
  } finally {
    due.forEach((it) => { if (!handled.has(it)) rest.push(it); });
    await trashSave(env, rest);
  }
  report.remain = rest.length;
  // 本轮全部失败 → 进入冷却；有成功 → 解除冷却
  try {
    const kv = getKV(env);
    if (report.failed > 0 && report.done === 0) {
      await kv.put(COOL_KEY, JSON.stringify({ until: Date.now() + 15 * 60 * 1000 }), { expirationTtl: 1800 });
    } else if (report.done > 0) {
      await kv.delete(COOL_KEY);
    }
  } catch (_) {  }
  return report;
}

async function driveTransfer(type, link, code, cookie, dirId, env) {
  const d = driveOf(type);
  const m = String(link).match(d.re);
  const pwdId = m ? m[1] : '';
  if (!pwdId) throw new Error('无法解析' + d.name + '分享链接');
  const ck = driveHeaders(d, cookie);
  const hosts = await driveHosts(env || {}, type);
  let API = hosts[0];

  const stokenCands = [];
  const pushTok = (v) => {
    const s = String(v == null ? '' : v).trim();
    if (s && !stokenCands.includes(s)) stokenCands.push(s);
  };
  const tokenCall = (host, path) => netFetch(`${host}${path}?${d.qp}`, {
    method: 'POST',
    headers: { ...ck, 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode: code || '', pwd_id: pwdId }),
  }, 9000, 1).then((r) => r.json().catch(() => ({})));
  // 并发向每个候选域名发一次，谁先回有效结果就用谁（顺序试的话 3 个域名要 27 秒）
  let j1 = {};
  const got = await Promise.all(hosts.map((h) => tokenCall(h, d.stokenPath)
    .then((j) => ({ h, j })).catch(() => ({ h, j: {} }))));
  const ok = got.find((x) => x.j && (x.j.data || x.j.code === 0 || x.j.status === 200));
  if (ok) {
    j1 = ok.j;
    API = ok.h;
    await saveDriveHost(env || {}, type, ok.h);
  } else {
    j1 = (got.find((x) => x.j && Object.keys(x.j).length) || { j: {} }).j;
  }
  pushTok(d.stokenOf(j1));
  if (d.extraTokenPath) {
    try { pushTok(DRIVES.quark.stokenOf(await tokenCall(API, d.extraTokenPath))); } catch (_) {  }
  }
  if (!stokenCands.length) {
    // 详细原因只进服务器日志；页面上给访客一句能看懂的提示
    try { console.warn('[transfer] ' + type + ' 取分享信息失败：' + apiInfo(j1) + '；' + cookieHint(cookie)); } catch (_) { /* 忽略 */ }
    throw new Error(d.name + '资源暂时读取失败，请稍后重试或换一个资源');
  }

  let list = [], title = '', j2 = {};
  for (const tk of stokenCands) {
    const detailUrl = `${API}/1/clouddrive/share/sharepage/detail?${d.qp}&pwd_id=${pwdId}&stoken=${encodeURIComponent(tk.replace(/ /g, '+'))}&pdir_fid=0&force=0&_page=1&_size=100&_fetch_banner=1&_fetch_share=1&_fetch_total=1&_sort=file_type:asc,updated_at:desc`;
    j2 = await netFetch(detailUrl, { headers: ck }).then((r) => r.json().catch(() => ({})));
    const l = j2?.data?.list || j2?.list || [];
    if (l.length) { list = l; title = (j2?.data?.share?.title || j2?.share?.title || '').toString(); break; }
  }
  if (!list.length) throw new Error('该' + d.name + '资源暂无可播放的文件，请换一个资源再试');
  const fidList = list.map((f) => String(f.fid));
  const fidTokenList = list.map((f) => f.share_fid_token).filter(Boolean);
  const itemNames = list.map((f) => String(f.file_name || f.filename || '')).filter(Boolean);

  const saveForms = (tk) => {
    const out = [];
    const add = (v) => { const s = String(v == null ? '' : v).trim(); if (s && !out.includes(s)) out.push(s); };
    add(tk.replace(/ /g, '+'));
    add(tk);
    try { add(decodeURIComponent(tk)); } catch (_) {  }
    return out;
  };
  let j3 = {}, saveTaskId = '';
  for (const tk of stokenCands) {
    for (const form of saveForms(tk)) {
      const saveUrl = `${API}/1/clouddrive/share/sharepage/save?entry=update_share&${d.qp}`
        + (d.queryStoken ? '&stoken=' + encodeURIComponent(form) : '');
      const s = await netFetch(saveUrl, {
        method: 'POST',
        headers: {
          ...ck,
          'Content-Type': 'application/json',
          ...(d.writeOrigin ? { 'Origin': d.referer.replace(/\/$/, '') } : {}),
        },
        body: JSON.stringify({
          fid_list: fidList,
          fid_token_list: fidTokenList,
          to_pdir_fid: dirId || '0',
          pwd_id: pwdId,
          stoken: form,
          pdir_fid: '0',
          scene: 'link',
        }),
      });
      j3 = await s.json().catch(() => ({}));
      saveTaskId = j3?.data?.task_id || j3?.task_id;
      if (saveTaskId) break;
    }
    if (saveTaskId) break;
  }
  if (!saveTaskId) {
    try {
      console.warn('[transfer] ' + type + ' 转存失败：' + apiInfo(j3)
        + '；code=' + ((j3 && j3.code) != null ? j3.code : '-')
        + '；token' + tokenHint(stokenCands[0]) + '；' + cookieHint(cookie));
    } catch (_) { /* 忽略 */ }
    // 31001 = 账号登录状态失效：这一条要让站长自己去后台更新账号
    if (j3 && j3.code === 31001) throw new Error(d.name + '网盘登录状态已失效，请站长到后台「网盘设置」重新填写');
    throw new Error(d.name + '转存失败，请稍后重试或换一个资源');
  }

  const savedFids = await drivePoll(d, ck, saveTaskId, (x) => (x.save_as?.save_as_top_fids || []).map(String), API);
  if (!savedFids || !savedFids.length) throw new Error(d.name + '转存任务未完成，请稍后重试');

  const sh = await netFetch(`${API}/1/clouddrive/share?${d.qp}`, {
    method: 'POST',
    headers: { ...ck, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fid_list: savedFids, expired_type: 2, expire_time: 86400, title: title || 'share', url_type: 1 }),
  });
  const j4 = await sh.json().catch(() => ({}));
  const shareTaskId = j4?.data?.task_id || j4?.task_id;
  if (!shareTaskId) {
    try { console.warn('[transfer] ' + type + ' 创建分享失败：' + apiInfo(j4)); } catch (_) { /* 忽略 */ }
    throw new Error(d.name + '生成播放链接失败，请稍后重试');
  }

  const shareId = await drivePoll(d, ck, shareTaskId, (x) => x.share_id, API);
  if (!shareId) throw new Error(d.name + '生成播放链接超时，请稍后重试');

  const pw = await netFetch(`${API}/1/clouddrive/share/password?${d.qp}`, {
    method: 'POST',
    headers: { ...ck, 'Content-Type': 'application/json' },
    body: JSON.stringify({ share_id: shareId }),
  });
  const j5 = await pw.json().catch(() => ({}));
  const shareUrl = j5?.data?.share_url || j5?.share_url;
  if (!shareUrl) {
    try { console.warn('[transfer] ' + type + ' 取分享链接失败：' + apiInfo(j5)); } catch (_) { /* 忽略 */ }
    throw new Error(d.name + '生成播放链接失败，请稍后重试');
  }
  const shareCode = j5?.data?.passcode || j5?.data?.password || '';
  return { url: shareUrl, code: shareCode, cleanup: { t: type, fids: savedFids, names: itemNames, dir: dirId || '0' } };
}

const BAIDU = 'https://pan.baidu.com';
const BAIDU_APP_ID = '38824127';
const BAIDU_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36';
const BAIDU_ERR = {
  '-4': '无效登录，请重新获取 Cookie', '-6': '请用无痕模式重新获取 Cookie',
  '-7': '转存目录名含非法字符（不能含 < > | * ? \\ :）', '-8': '目录中已有同名文件',
  '-9': '链接不存在或提取码错误', '-10': '容量不足', '-12': '提取码错误',
  '-62': '链接访问次数过多，请稍后再试', '2': '目标目录不存在', '4': '目录中存在同名文件',
  '12': '转存文件数超过限制', '20': '容量不足', '105': '链接错误（页面不存在）', '115': '该文件禁止分享',
};
const bdErr = (n) => BAIDU_ERR[String(n)] || '';

function parseBaiduShare(link) {
  let surl = '', pwd = '';
  try {
    const u = new URL(link);
    pwd = u.searchParams.get('pwd') || u.searchParams.get('code') || '';
    const m = u.pathname.match(/\/s\/([A-Za-z0-9_-]+)/);
    if (m) surl = m[1];
    if (!surl) surl = u.searchParams.get('surl') || '';
    if (!pwd && u.hash) { const hm = u.hash.match(/pwd=([A-Za-z0-9]+)/); if (hm) pwd = hm[1]; }
  } catch (_) {
    const m = String(link).match(/pan\.baidu\.com\/s\/([A-Za-z0-9_-]+)/i);
    if (m) surl = m[1];
  }
  if (!pwd) { const m = String(link).match(/[?&#]pwd=([A-Za-z0-9]{4})/); if (m) pwd = m[1]; }
  return { surl, pwd };
}

function bdHeaders(cookie) {
  return {
    'User-Agent': BAIDU_UA,
    'Referer': BAIDU,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Cookie': cookie,
  };
}
const bdForm = (hdr) => ({ ...hdr, 'Content-Type': 'application/x-www-form-urlencoded' });

let _bdTokCache = {};
async function bdToken(hdr, cookie, appId = BAIDU_APP_ID) {
  const c = _bdTokCache[appId];
  const key = String(cookie || '');
  if (c && c.exp > Date.now() && (!key || c.ck === key)) return c.v;
  const bj = await netFetch(`${BAIDU}/api/gettemplatevariable?clienttype=0&app_id=${appId}&web=1&fields=` + encodeURIComponent('["bdstoken"]'), { headers: hdr }).then((r) => r.json().catch(() => ({})));
  const token = (bj && bj.result && bj.result.bdstoken) || '';
  if (token) _bdTokCache[appId] = { v: token, exp: Date.now() + 120000, ck: key };
  return token;
}

function bdWithBdclnd(cookie, randsk) {
  const parts = String(cookie || '')
    .split(';').map((s) => s.trim()).filter(Boolean)
    .filter((p) => !/^BDCLND=/i.test(p));
  parts.push('BDCLND=' + randsk);
  return parts.join('; ');
}

function bdParseSharePage(html) {
  const h = String(html || '');
  const one = (strict, loose) => {
    const m = h.match(strict) || h.match(loose);
    const v = m ? String(m[1]) : '';
    return /^\d{5,}$/.test(v) ? v : '';
  };
  const all = (re) => Array.from(h.matchAll(re), (m) => String(m[1])).filter((v) => /^\d{5,}$/.test(v));
  return {
    shareid: one(/"shareid":(\d+?),"/, /"shareid":"?(\d{5,})"?/),
    shareUk: one(/"share_uk":"(\d+?)"/, /"share_uk":"?(\d{5,})"?/),
    fsIds: [...new Set(all(/"fs_id":(\d+?),"/g))],
    names: [...new Set(Array.from(h.matchAll(/"server_filename":"(.+?)",/g), (m) => m[1]))],
  };
}

async function baiduTransfer(link, code, cookie, dir, env) {
  const { surl, pwd } = parseBaiduShare(link);
  if (!surl) throw new Error('无法解析百度分享链接');
  if (!cookie) throw new Error('未配置百度网盘 Cookie（需含 BDUSS）');

  const shareUrl = `${BAIDU}/s/${surl}`;
  let hdr = bdHeaders(cookie);

  const bj = await netFetch(`${BAIDU}/api/gettemplatevariable?clienttype=0&app_id=${BAIDU_APP_ID}&web=1&fields=` + encodeURIComponent('["bdstoken","token","uk","isdocuser","servertime"]'), { headers: hdr }).then((r) => r.json().catch(() => ({})));
  const bdstoken = (bj && bj.result && bj.result.bdstoken) || '';
  if (!bdstoken) throw new Error('百度网盘登录状态已失效，请站长到后台「网盘设置」重新填写');

  const usePwd = String(code || pwd || '').trim();
  if (usePwd) {
    const short = surl.startsWith('1') ? surl.slice(1) : surl;
    const vj = await netFetch(`${BAIDU}/share/verify?surl=${short}&bdstoken=${encodeURIComponent(bdstoken)}&t=${Date.now()}&channel=chunlei&web=1&clienttype=0`, {
      method: 'POST',
      headers: bdForm(hdr),
      body: 'pwd=' + encodeURIComponent(usePwd) + '&vcode=&vcode_str=',
    }).then((r) => r.json().catch(() => ({})));
    if (vj.errno !== 0) {
      try { console.warn('[transfer] 百度提取码校验失败：errno=' + vj.errno + ' ' + (bdErr(vj.errno) || '')); } catch (_) { /* 忽略 */ }
      throw new Error('提取码不正确，或该分享已失效');
    }
    const randsk = (vj && vj.randsk) || '';
    if (!randsk) throw new Error('该分享无法访问，请换一个资源再试');
    hdr = bdHeaders(bdWithBdclnd(cookie, randsk));
  }

  let page = bdParseSharePage(await netFetch(shareUrl, { headers: hdr }).then((r) => r.text()));
  if ((!page.shareid || !page.shareUk || !page.fsIds.length) && usePwd) {
    page = bdParseSharePage(await netFetch(`${shareUrl}?pwd=${encodeURIComponent(usePwd)}`, { headers: hdr }).then((r) => r.text()));
  }
  if (!page.shareid || !page.shareUk || !page.fsIds.length) {
    try {
      console.warn('[transfer] 百度分享页解析失败：shareid=' + (page.shareid || '无')
        + '，uk=' + (page.shareUk || '无') + '，文件数=' + page.fsIds.length);
    } catch (_) { /* 忽略 */ }
    throw new Error('该分享无法读取，请换一个资源再试');
  }

  const folder = String(dir || '').trim().replace(/^\/+|\/+$/g, '');
  const dirPath = '/' + folder;
  if (folder) {
    let cur = '';
    for (const part of folder.split('/').filter(Boolean)) {
      const parent = cur || '/';
      cur += '/' + part;
      const { items, why } = await bdListDir(hdr, bdstoken, parent);
      if (why) break;
      if (items.some((f) => String(f.server_filename) === part)) continue;
      await netFetch(`${BAIDU}/api/create?a=commit&bdstoken=${encodeURIComponent(bdstoken)}`, {
        method: 'POST',
        headers: bdForm(hdr),
        body: `path=${encodeURIComponent(cur)}&isdir=1&block_list=%5B%5D`,
      }).catch(() => null);
    }
  }

  const doTransfer = (ondup) => netFetch(`${BAIDU}/share/transfer?shareid=${page.shareid}&from=${page.shareUk}&bdstoken=${encodeURIComponent(bdstoken)}&channel=chunlei&web=1&clienttype=0&ondup=${ondup}`, {
    method: 'POST',
    headers: bdForm(hdr),
    body: 'fsidlist=' + encodeURIComponent('[' + page.fsIds.join(',') + ']') + '&path=' + encodeURIComponent(dirPath),
  }).then((r) => r.json().catch(() => ({})));
  const ondupTry = [];
  let tj = await doTransfer('overwrite');
  ondupTry.push('overwrite=' + tj.errno);
  if (tj.errno !== 0) { tj = await doTransfer('skip'); ondupTry.push('skip=' + tj.errno); }
  if (tj.errno !== 0) { tj = await doTransfer('newcopy'); ondupTry.push('newcopy=' + tj.errno); }
  if (tj.errno !== 0) {
    try { console.warn('[transfer] 百度转存失败：errno=' + tj.errno + ' ' + (bdErr(tj.errno) || '') + '｜' + ondupTry.join(',')); } catch (_) { /* 忽略 */ }
    throw new Error('转存失败，请稍后重试或换一个资源');
  }

  const myFids = await bdFindFids(hdr, bdstoken, dirPath, page.names);
  if (!myFids.length) throw new Error('转存失败，请稍后重试或换一个资源');

  const sharePwd = String(Math.floor(1000 + Math.random() * 9000));
  const sj = await netFetch(`${BAIDU}/share/set?channel=chunlei&bdstoken=${encodeURIComponent(bdstoken)}&clienttype=0&app_id=250528&web=1`, {
    method: 'POST',
    headers: bdForm(hdr),
    body: 'period=0&pwd=' + sharePwd + '&eflag_disable=true&channel_list=%5B%5D&schannel=4&fid_list=' + encodeURIComponent('[' + myFids.join(',') + ']'),
  }).then((r) => r.json().catch(() => ({})));
  if (sj.errno !== 0) {
    try { console.warn('[transfer] 百度生成分享链接失败：errno=' + sj.errno + ' ' + (bdErr(sj.errno) || '')); } catch (_) { /* 忽略 */ }
    throw new Error('生成播放链接失败，请稍后重试');
  }
  const newLink = sj.link || sj.shorturl || '';
  if (!newLink) throw new Error('生成分享链接失败：接口未返回链接');

  return {
    url: newLink + '?pwd=' + sharePwd,
    code: sharePwd,
    note: 'ondup=' + ondupTry.join(',')
      + '；目标目录=' + dirPath + '（文件' + page.names.length + '个）'
      + '；百度网盘的临时文件需在网盘内手动清理',
  };
}

async function bdFindFids(hdr, bdstoken, dirPath, names) {
  const want = new Set((names || []).map((n) => String(n).trim()).filter(Boolean));
  for (let i = 0; i < 4; i++) {
    if (i) await sleep(900);
    const lj = await netFetch(`${BAIDU}/api/list?order=time&desc=1&showempty=0&web=1&page=1&num=1000&dir=${encodeURIComponent(dirPath)}&bdstoken=${encodeURIComponent(bdstoken)}`, { headers: hdr }).then((r) => r.json().catch(() => ({})));
    const list = Array.isArray(lj.list) ? lj.list : [];
    const fids = list.filter((f) => want.has(String(f.server_filename))).map((f) => String(f.fs_id));
    if (fids.length) return fids;
  }
  return [];
}

async function bdListDir(hdr, bdstoken, dir) {
  const lj = await netFetch(`${BAIDU}/api/list?order=time&desc=1&showempty=0&web=1&page=1&num=1000&dir=${encodeURIComponent(dir)}&bdstoken=${encodeURIComponent(bdstoken)}`, { headers: hdr }).then((r) => r.json().catch(() => ({})));
  if (lj && lj.errno && lj.errno !== 0) return { items: [], why: '读取网盘目录失败' };
  return { items: Array.isArray(lj.list) ? lj.list : [], why: '' };
}

const TRANSFER_IMPL = 'native';

const JJSOU_TYPES = ['baidu', 'uc'];

function transferEndpoint(host) {
  const h = String(host || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!h) return null;
  return {
    host: h,
    url: /\/api\/open\/transfer$/i.test(h) ? 'https://' + h : 'https://' + h + '/api/open/transfer',
  };
}

function linkLooksValid(type, link) {
  if (type === 'baidu') return !!parseBaiduShare(link).surl;
  if (type === 'uc') return /uc\.cn/i.test(link);
  return /^https?:\/\//i.test(link);
}

async function jjsouTransfer(type, link, code, cookie, apiKey, host, dir) {
  if (!linkLooksValid(type, link)) throw new Error('无法解析分享链接（' + type + '）');
  if (!apiKey) throw new Error('服务端未配置转存服务密钥（后台「网盘设置」填一下）');

  const ep = transferEndpoint(host);
  if (!ep) throw new Error('未配置转存服务地址');
  const pwdInLink = parseBaiduShare(link).pwd;
  const body = { api_key: apiKey, url: link, code: (code || pwdInLink || '').trim() };
  if (cookie) body.cookie = cookie;
  if (dir && dir !== '/') body.dir = dir;

  const resp = await netFetch(ep.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    body: JSON.stringify(body),
  });
  const r = await resp.json().catch(() => null);
  if (!r) {
    // 具体返回只进服务器日志，页面上不暴露服务地址 / 错误码
    try { console.warn('[transfer] 转存服务异常：HTTP ' + resp.status + '｜' + ep.host); } catch (_) { /* 忽略 */ }
    throw new Error('转存服务暂时不可用，请稍后重试');
  }

  const ok = r.code === 200 || r.code === 0 || r.code === 1 || r.success === true;
  if (!ok) {
    try { console.warn('[transfer] 转存服务返回失败：code=' + ((r.code != null) ? r.code : '-') + ' ' + (r.message || '') + '｜' + ep.host); } catch (_) { /* 忽略 */ }
    throw new Error('转存失败，请稍后重试或换一个资源');
  }
  const data = r.data || r;
  const out = data.url || data.link || data.share_url || data.shorturl;
  if (!out) throw new Error('转存失败，请稍后重试或换一个资源');
  const shareCode = data.pwd || data.code || data.passcode || '';
  return { url: out, code: shareCode };
}

function withPwd(link, code) {
  const c = String(code || '').trim();
  if (!c) return link;
  if (/[?&]pwd=/i.test(link)) return link;
  return link + (link.includes('?') ? '&' : '?') + 'pwd=' + encodeURIComponent(c);
}

function linkHostOf(link) {
  try { return new URL(link).host || '未知'; } catch (_) { return '解析失败'; }
}

const isServerSideError = (msg) =>
  /Cookie|登录态|未登录|require login|31001|未配置|过于频繁|转存服务|检测请求失败|无响应|aborted|aborted/i.test(String(msg || ''));

const _inflight = new Map();

async function handleTransfer(_request, url, context) {
  const type = (url.searchParams.get('type') || '').trim();
  const link = (url.searchParams.get('url') || '').trim();
  const code = (url.searchParams.get('code') || '').trim();
  if (!link) return json({ error: '缺少链接' }, 400);

  if (!checkRateLimit(getClientIP(_request), 20, 'transfer')) {
    return json({ error: '请求过于频繁，请稍后再试' }, 429);
  }

  if (type !== 'quark' && !JJSOU_TYPES.includes(type)) return json({ url: link, origin: true });

  const env = await resolveEnv(context);

  const cleaning = flushTrash(env).catch(() => 0);
  if (context && typeof context.waitUntil === 'function') context.waitUntil(cleaning);
  else cleaning.catch(() => 0);

  const useService = TRANSFER_IMPL === 'service' && JJSOU_TYPES.includes(type);
  const transferHost = (env.TRANSFER_API_HOST || '').toString().trim();
  if (useService && !transferHost) return json({ url: withPwd(link, code), origin: true });

  let cookie = '';
  let apiKey = '';
  if (useService) {
    apiKey = (env.JJSOU_API_KEY || '').toString().trim();
    cookie = cleanCookie(type === 'uc' ? env.UC_COOKIE : env.BAIDU_COOKIE);
    if (!apiKey) return json({ error: '已配置转存服务地址，但缺少转存服务密钥（去后台「网盘设置」填一下）' }, 500);
  } else if (type === 'quark') {
    cookie = cleanCookie(env.QUARK_COOKIE);
    if (!cookie) return json({ error: '未配置夸克网盘 Cookie（去后台「网盘设置」填一下）' }, 500);
  } else if (type === 'uc') {
    cookie = cleanCookie(env.UC_COOKIE);
    if (!cookie) return json({ error: '未配置 UC 网盘 Cookie（去后台「网盘设置」填一下）' }, 500);
  } else {
    cookie = cleanCookie(env.BAIDU_COOKIE);
    if (!cookie) return json({ error: '未配置百度网盘 Cookie（去后台「网盘设置」填一下）' }, 500);
  }

  const dir = (
    (type === 'quark' ? env.QUARK_DIR : (type === 'uc' ? env.UC_DIR : env.BAIDU_DIR)) || ''
  ).toString().trim();
  if ((type === 'quark' || type === 'uc') && dir.includes('/')) {
    return json({ error: (type === 'uc' ? 'UC' : '夸克') + '目标目录请填「目录 ID」（不是文件夹路径）；不确定就留空，会存到根目录' }, 400);
  }

  const key = `${type}:${link}:${code}`;
  if (_inflight.has(key)) return _inflight.get(key);

  const task = (async () => {
    try {
      let res;
      if (useService) res = await jjsouTransfer(type, link, code, cookie, apiKey, transferHost, dir);
      else if (type === 'quark' || type === 'uc') res = await driveTransfer(type, link, code, cookie, dir, env);
      else res = await baiduTransfer(link, code, cookie, dir, env);
      if (res.cleanup) await trashEnqueue(env, res.cleanup);
      // ?debug=1 里的内容（目标目录、文件数、清理队列长度）属于内部信息，
      // 只对已登录的后台开放，避免任何人拿它当"站点探测"用。
      // 注意：这里的形参名是 _request（原来误写成 request，导致带 ?debug=1 时直接抛 ReferenceError）
      const dbg = url.searchParams.get('debug') === '1' && await isAdminRequest(_request, env);
      let note = dbg ? (res.note || '') : '';
      if (dbg) {
        try { note += '；清理队列=' + (await trashLoad(env)).length + ' 条'; } catch (_) {  }
      }
      return json({
        url: res.url,
        code: res.code || '',
        ttl: res.cleanup ? TRANSFER_TTL_MIN : 0,
        note,
      });
    } catch (e) {
      const raw = String(e?.message || e);
      // 排查线索（网盘类型、来源域名、代码版本）只写服务器日志，不返回给前端 ——
      // 页面上给访客的是一句看得懂的通用提示。
      try {
        console.warn('[transfer] 转存失败：' + raw + '｜' + type + '@' + linkHostOf(link)
          + (code ? '｜带提取码' : '｜无提取码') + '｜代码版本 ' + CODE_VER);
      } catch (_) { /* 忽略 */ }
      const msg = /aborted/i.test(raw)
        ? '网盘响应较慢或暂时限流，请稍等 10-20 分钟后再试'
        : raw;
      const srv = isServerSideError(msg);
      return type === 'baidu' ? json({ url: withPwd(link, code), error: msg, srv }) : json({ error: msg, srv });
    }
  })();
  _inflight.set(key, task);
  try {
    return await task;
  } finally {
    _inflight.delete(key);
  }
}

export const onRequest = makeRoute(handleTransfer);

export { flushTrash, trashLoad, TRANSFER_TTL_MIN };

// ============ 后台「网盘文件管理」：直接列目录 / 删指定项目 ============
// 和自动清理不同：这里不依赖"访客播过资源"的记录，
// 而是把网盘目录里的内容原样列出来，让站长自己勾选删除（只会删勾中的，不动其它文件）。
const panLabel = (type) => (type === 'uc' ? 'UC' : (type === 'baidu' ? '百度' : '夸克'));
const panCookieOf = (env, type) => cleanCookie(type === 'uc' ? env.UC_COOKIE : (type === 'baidu' ? env.BAIDU_COOKIE : env.QUARK_COOKIE));
const panDirOf = (env, type, dir) => {
  const d = String(dir || '').trim();
  if (d) return d;
  const def = type === 'uc' ? env.UC_DIR : (type === 'baidu' ? env.BAIDU_DIR : env.QUARK_DIR);
  return String(def || '').trim();
};

// ===== 清扫：把「转存目录」整个清空 =====
// 语义和上面的队列不同：不看文件存了多久，
// 定时器每跑一次 / 后台点一次「立即清理」，就直接列出转存目录里的内容并全部删除。
// 安全护栏（不能少）：
//   ① 必须设置了「专用的转存目录」才执行 —— 没设置（= 根目录）时跳过，
//      否则会把站长网盘根目录里的所有私人文件全删掉；
//   ② skipMin > 0 时，保留"最近 skipMin 分钟内新增"的文件（避免打断正在播放的访客）。
export async function purgeTrashDirs(env, skipMin) {
  const out = { done: 0, failed: 0, why: [], skipped: [], purged: [] };
  if (!env) { out.why.push('服务未就绪'); return out; }
  const skip = Number(skipMin) > 0 ? Number(skipMin) : 0;
  const cutoff = skip ? (Date.now() - skip * 60000) : 0;

  for (const type of ['quark', 'uc']) {
    const label = panLabel(type);
    const dir = panDirOf(env, type, '');
    if (!dir || dir === '0' || dir === '/' || dir === '//') {
      out.skipped.push(label + '：未设置专用转存目录，已跳过（避免把整个网盘根目录清空）');
      continue;
    }
    let l;
    try { l = await panList(env, type, dir); }
    catch (e) { l = { ok: false, why: '读取目录异常：' + ((e && e.message) || e) }; }
    if (!l.ok) {
      out.skipped.push(label + '：' + (l.why || '读取目录失败'));
      continue;
    }
    const items = Array.isArray(l.items) ? l.items : [];
    if (!items.length) { out.skipped.push(label + '：目录已经是空的'); continue; }

    const del = cutoff ? items.filter((it) => (Number(it.mtime) || 0) < cutoff) : items.slice();
    const kept = items.length - del.length;
    if (!del.length) {
      out.skipped.push(label + '：暂缓 ' + kept + ' 项（转存后 ' + skip + ' 分钟内不清理）');
      continue;
    }
    let r;
    try { r = await panDelete(env, type, dir, del.map((it) => it.id)); }
    catch (e) { r = { ok: false, msg: ((e && e.message) || e) }; }
    if (r.ok) {
      out.done += del.length;
      out.purged.push(type);
      out.why.push(label + '：已删除 ' + del.length + ' 项' + (kept ? '（暂缓 ' + kept + ' 项）' : ''));
    } else {
      out.failed += del.length;
      out.why.push(label + '：删除失败（' + (r.msg || '网盘没有响应') + '）');
    }
  }

  // 目录已经清空了，队列里这些记录就没意义了，一并丢掉（跳过的网盘保留）
  if (out.purged.length) {
    try {
      const q = await trashLoad(env);
      const rest = q.filter((it) => !out.purged.includes(it.t));
      await trashSave(env, rest);
      out.remain = rest.length;
    } catch (_) { /* 队列清理失败不影响结果 */ }
  }
  // 百度不支持自动清理：接口删除会被风控拦截（要求验证身份），提醒站长手动删
  if (String(env.BAIDU_COOKIE || '').trim()) {
    out.skipped.push('百度：不支持自动清理，转存到百度的文件请到百度网盘里手动删除');
  }
  return out;
}

export async function panList(env, type, dir) {
  if (!env) return { ok: false, why: '服务未就绪', items: [] };
  if (type === 'baidu') {
    const cookie = panCookieOf(env, 'baidu');
    if (!cookie) return { ok: false, why: '未配置百度网盘 Cookie（先在下面填好并保存）', items: [] };
    const hdr = bdHeaders(cookie);
    const bdstoken = await bdToken(hdr, cookie);
    if (!bdstoken) return { ok: false, why: '百度网盘登录状态已失效，请重新填写 Cookie', items: [] };
    const raw = panDirOf(env, 'baidu', dir) || '';
    const path = '/' + raw.replace(/^\/+|\/+$/g, '');
    const { items, why } = await bdListDir(hdr, bdstoken, path);
    if (why) return { ok: false, why: '读取目录失败：' + why, items: [] };
    return {
      ok: true,
      dir: path,
      items: items.map((f) => ({
        id: String(f.path || (path === '/' ? '/' + f.server_filename : path + '/' + f.server_filename)),
        name: String(f.server_filename || ''),
        dir: !!f.isdir,
        size: Number(f.size) || 0,
        mtime: (Number(f.server_mtime) || 0) * 1000,
      })).filter((x) => x.name),
    };
  }
  const cookie = panCookieOf(env, type);
  if (!cookie) return { ok: false, why: '未配置「' + panLabel(type) + '」网盘 Cookie（先在下面填好并保存）', items: [] };
  const dirId = panDirOf(env, type, dir) || '0';
  let r;
  try { r = await driveListDir(type, cookie, dirId, await driveHosts(env, type)); }
  catch (e) { r = { ok: false, list: [] }; }
  if (!r.ok) return { ok: false, why: '读取目录失败：Cookie 可能已失效，或网盘接口暂时无响应', items: [] };
  return {
    ok: true,
    dir: dirId,
    items: (r.list || []).map((f) => ({
      id: String(f.fid != null ? f.fid : (f.fid_str || '')),
      name: String(f.file_name || f.fileName || f.name || ''),
      dir: !!(f.dir === true || f.file_type === 0),
      size: Number(f.size) || 0,
      mtime: Number(f.updated_at || f.created_at || 0),
    })).filter((x) => x.id && x.name),
  };
}

export async function panDelete(env, type, dir, ids) {
  const list = (ids || []).map(String).filter(Boolean);
  if (!list.length) return { ok: false, msg: '没有选中要删除的项目' };
  try {
    if (type === 'baidu') {
      const cookie = panCookieOf(env, 'baidu');
      if (!cookie) return { ok: false, msg: '未配置百度网盘 Cookie' };
      const r = await baiduDelete(cookie, list);   // 百度按「路径」删除
      return { ok: !!r.ok, msg: r.ok ? ('已删除 ' + list.length + ' 项') : ('删除失败：' + (r.why || '网盘没有响应')) };
    }
    const cookie = panCookieOf(env, type);
    if (!cookie) return { ok: false, msg: '未配置' + panLabel(type) + '网盘 Cookie' };
    const dirId = panDirOf(env, type, dir) || '0';
    const pref = await getDelPref(env, type);
    const r = await driveDelete(type, cookie, list, [], dirId, pref,
      [panDirOf(env, type, '') || '0', '0'], await driveHosts(env, type));
    if (r.ok && r.variant) await setDelPref(env, type, r.variant);
    return { ok: !!r.ok, msg: r.ok ? ('已删除 ' + list.length + ' 项') : ('删除失败：' + (r.why || '网盘没有响应，稍后再试')) };
  } catch (e) {
    return { ok: false, msg: '删除失败：' + ((e && e.message) || e) };
  }
}
