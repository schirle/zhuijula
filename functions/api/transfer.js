// 网盘转链接口：直接调用夸克 / 百度官方 API，把第三方分享转存到「自己的账号」，
// 再生成「我的分享链接」返回给前端。
//
//   /api/transfer?type=quark|baidu&url=原链接&code=提取码
//
// 仅 quark / baidu 走转链；uc / xunlei 由前端直开，此处兜底返回原链接。
//
// 实现参考开源项目 xinyue-search（夸克 / 百度网盘转存），端点与流程与其一致：
//   - 夸克转存必须带 share_fid_token，且转存 / 分享均为异步任务，需轮询 /task 直到 status=2
//   - 百度转存改走 jjsou.com 开放接口 https://www.jjsou.com/api/open/transfer
//     （需环境变量 JJSOU_API_KEY；BAIDU_COOKIE 可选，转存到本站自身网盘时带上）。
//     原 share/wxlist + 分批转存方案已弃用（errno 105 / 200025 等风控）。
//
// 鉴权：使用你自己的网盘账号 cookie（绝不暴露到前端）
//   QUARK_COOKIE —— 夸克网盘账号 cookie（需含有效登录态）
//   BAIDU_COOKIE —— 百度网盘账号 cookie（需含 BDUSS / STOKEN）
//
// 转存目录（可选，不配则存根目录 / 默认目录）：
//   QUARK_DIR —— 夸克目标目录「目录 ID」（不是目录名）
//   BAIDU_DIR —— 百度目标目录「完整路径」，例如 /网盘搜索/zj（不存在会自动创建）
import { makeRoute, resolveEnv, CORS } from '../_shared.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS },
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const QUARK_QP = 'pr=ucpro&fr=pc&uc_param_str=';

// 带超时的 fetch：转存类请求【禁止自动重试】（重试会造成网盘重复转存），仅做超时保护
async function netFetch(url, opts = {}, timeout = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

const headerQuark = {
  'User-Agent': UA,
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://pan.quark.cn/',
};
// ---------------- 夸克 ----------------
function parseQuarkPwdId(link) {
  const m = link.match(/pan\.quark\.cn\/s\/([A-Za-z0-9]+)/i);
  return m ? m[1] : '';
}

// 统一轮询夸克异步任务；getResult 从完成的任务 data 中提取所需字段
async function quarkPoll(ck, taskId, getResult) {
  for (let i = 0; i < 40; i++) {
    await sleep(1500);
    const u = `https://drive-pc.quark.cn/1/clouddrive/task?${QUARK_QP}&task_id=${encodeURIComponent(taskId)}&retry_index=${i}`;
    const j = await netFetch(u, { headers: ck }).then((r) => r.json().catch(() => ({})));
    const data = j?.data;
    if (data?.message === 'capacity limit[{0}]') throw new Error('夸克网盘容量不足，请清理空间后重试');
    if (data && data.status === 2) return getResult(data);
  }
  return null;
}

async function quarkTransfer(link, code, cookie, dirId) {
  const pwdId = parseQuarkPwdId(link);
  if (!pwdId) throw new Error('无法解析夸克分享链接');
  const ck = { ...headerQuark, 'Cookie': cookie };

  // 1) 获取 stoken
  const t1 = await netFetch(`https://drive-pc.quark.cn/1/clouddrive/share/sharepage/token?${QUARK_QP}`, {
    method: 'POST',
    headers: { ...ck, 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode: code || '', pwd_id: pwdId }),
  });
  const j1 = await t1.json().catch(() => ({}));
  const stoken = j1?.data?.stoken || j1?.stoken;
  if (!stoken) throw new Error('夸克登录态可能已失效（获取 stoken 失败）');
  const token = stoken.replace(/ /g, '+');

  // 2) 获取分享文件列表（含 fid 与 share_fid_token）
  const detailUrl = `https://drive-pc.quark.cn/1/clouddrive/share/sharepage/detail?${QUARK_QP}&pwd_id=${pwdId}&stoken=${encodeURIComponent(token)}&pdir_fid=0&force=0&_page=1&_size=100&_fetch_banner=1&_fetch_share=1&_fetch_total=1&_sort=file_type:asc,updated_at:desc`;
  const j2 = await netFetch(detailUrl, { headers: ck }).then((r) => r.json().catch(() => ({})));
  const list = j2?.data?.list || j2?.list || [];
  const title = (j2?.data?.share?.title || j2?.share?.title || '').toString();
  if (!list.length) throw new Error('该夸克分享暂无可转存的文件');
  const fidList = list.map((f) => String(f.fid));
  const fidTokenList = list.map((f) => f.share_fid_token).filter(Boolean);

  // 3) 转存到目标目录（to_pdir_fid 为目标目录 ID，未配则根目录）
  const s = await netFetch(`https://drive-pc.quark.cn/1/clouddrive/share/sharepage/save?entry=update_share&${QUARK_QP}`, {
    method: 'POST',
    headers: { ...ck, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fid_list: fidList,
      fid_token_list: fidTokenList,
      to_pdir_fid: dirId || '0',
      pwd_id: pwdId,
      stoken: token,
      pdir_fid: '0',
      scene: 'link',
    }),
  });
  const j3 = await s.json().catch(() => ({}));
  const saveTaskId = j3?.data?.task_id || j3?.task_id;
  if (!saveTaskId) throw new Error('夸克转存请求失败（登录态可能已失效）');

  // 4) 轮询转存任务，拿到转存后的 fid 列表
  const savedFids = await quarkPoll(ck, saveTaskId, (d) => (d.save_as?.save_as_top_fids || []).map(String));
  if (!savedFids || !savedFids.length) throw new Error('夸克转存任务未完成，请稍后重试');

  // 5) 创建自己的分享（expired_type='1' 即 1 天有效）
  const sh = await netFetch(`https://drive-pc.quark.cn/1/clouddrive/share?${QUARK_QP}`, {
    method: 'POST',
    headers: { ...ck, 'Content-Type': 'application/json' },
    // expired_type=2 + expire_time=86400 即「1 天有效」；expired_type=1 为永久（旧版写法会导致永久）
    body: JSON.stringify({ fid_list: savedFids, expired_type: 2, expire_time: 86400, title: title || 'share', url_type: 1 }),
  });
  const j4 = await sh.json().catch(() => ({}));
  const shareTaskId = j4?.data?.task_id || j4?.task_id;
  if (!shareTaskId) throw new Error('夸克创建分享失败（登录态可能已失效）');

  // 6) 轮询分享任务，拿到 share_id
  const shareId = await quarkPoll(ck, shareTaskId, (d) => d.share_id);
  if (!shareId) throw new Error('夸克分享任务未完成，请稍后重试');

  // 7) 获取分享链接与提取码
  const pw = await netFetch(`https://drive-pc.quark.cn/1/clouddrive/share/password?${QUARK_QP}`, {
    method: 'POST',
    headers: { ...ck, 'Content-Type': 'application/json' },
    body: JSON.stringify({ share_id: shareId }),
  });
  const j5 = await pw.json().catch(() => ({}));
  const shareUrl = j5?.data?.share_url || j5?.share_url;
  if (!shareUrl) throw new Error('夸克获取分享链接失败（登录态可能已失效）');
  const shareCode = j5?.data?.passcode || j5?.data?.password || '';
  return { url: shareUrl, code: shareCode };
}

// ---------------- 百度 ----------------
function parseBaiduSur(link) {
  let surl = '';
  let pwd = '';
  try {
    const u = new URL(link);
    surl = u.searchParams.get('surl') || '';
    pwd = u.searchParams.get('pwd') || '';
  } catch (_) {}
  if (!surl) {
    const m = link.match(/pan\.baidu\.com\/s\/([A-Za-z0-9\-_]+)/i);
    if (m) surl = m[1];
  }
  return { surl, pwd };
}

// 百度转存改走 jjsou.com 开放接口（xinyue-search 项目 Open@transfer）：把第三方分享链接交给 jjsou，由它完成转存并返回新的分享链接。
// 请求：POST https://www.jjsou.com/api/open/transfer  JSON：{ api_key, url, code, cookie? }
//   - api_key：服务端在环境变量 JJSOU_API_KEY 配置（本站实例值为 jjsou），控制器初始化时校验
//   - url：原百度分享链接；code：原分享的提取码（百度分享密码，与响应里的 data.code 新提取码不同）
//   - cookie：可选，转存到本站自身网盘时带上
// 成功：jok("获取成功", data)，data 含 share_url（新分享链接）与 code（新提取码）。失败：{ code:500, message:"..." }。
async function baiduTransfer(link, code, cookie, apiKey) {
  const { surl, pwd } = parseBaiduSur(link);
  if (!surl) throw new Error('无法解析百度分享链接');
  if (!apiKey) throw new Error('服务端未配置 JJSOU_API_KEY（jjsou 转存接口密钥）');

  const body = { api_key: apiKey, url: link, code: code || pwd || '' };
  // 若服务端配置了百度登录态 cookie，一并带上（用于转存到本站自身网盘）
  if (cookie) body.cookie = cookie;

  const r = await netFetch('https://www.jjsou.com/api/open/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    body: JSON.stringify(body),
  }).then((res) => res.json().catch(() => ({})));

  const ok = r && (r.code === 200 || r.code === 0 || r.code === 1 || r.success === true);
  if (!ok) {
    throw new Error('jjsou 转存失败[' + (r?.code ?? 'nonjson') + ',' + (r?.message || '') + ']');
  }
  const data = r.data || r;
  const out = data.url || data.link || data.share_url || data.shorturl;
  if (!out) throw new Error('jjsou 返回数据缺少分享链接');
  const shareCode = data.pwd || data.code || data.passcode || '';
  return { url: out, code: shareCode };
}

// 进行中的转存去重：相同 (type+url+code) 并发只转一次，避免网盘产生重复副本
const _inflight = new Map();

async function handleTransfer(_request, url, context) {
  const type = (url.searchParams.get('type') || '').trim();
  const link = (url.searchParams.get('url') || '').trim();
  const code = (url.searchParams.get('code') || '').trim();
  if (!link) return json({ error: '缺少链接' }, 400);

  // UC / 迅雷 不需要转链，直接返回原链接
  if (type !== 'quark' && type !== 'baidu') return json({ url: link });

  const env = await resolveEnv(context);
  let cookie = '';
  let apiKey = '';
  if (type === 'quark') {
    cookie = (env.QUARK_COOKIE || '').toString().trim();
    if (!cookie) return json({ error: '服务端未配置夸克转存（QUARK_COOKIE，后台或环境变量）' }, 500);
  } else {
    // 百度转存改走 jjsou.com 开放接口，需要其 api_key（BAIDU_COOKIE 可选，转存到本站自身网盘时带上）
    apiKey = (env.JJSOU_API_KEY || '').toString().trim();
    cookie = (env.BAIDU_COOKIE || '').toString().trim();
    if (!apiKey) return json({ error: '服务端未配置 jjsou 转存密钥（JJSOU_API_KEY，后台或环境变量）' }, 500);
  }

  // 转存目标目录（可选，jjsou 接口暂不使用）
  const dir = (
    (type === 'quark' ? env.QUARK_DIR : env.BAIDU_DIR) || ''
  ).toString().trim();

  const key = `${type}:${link}:${code}`;
  if (_inflight.has(key)) return _inflight.get(key);

  const task = (async () => {
    try {
      const res = type === 'quark'
        ? await quarkTransfer(link, code, cookie, dir)
        : await baiduTransfer(link, code, cookie, apiKey);
      return json({ url: res.url, code: res.code || '' });
    } catch (e) {
      // 任意一步失败：回退到原链接，保证用户仍可访问
      return json({ url: link, error: '转链失败：' + (e?.message || e) });
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
