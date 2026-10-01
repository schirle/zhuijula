import { makeRoute, json, resolveEnv, isAdminRequest, adminDenied, getClientIP, checkRateLimit } from '../../_shared.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PAN = 'https://pan.baidu.com';

const TYPE_LABEL = { quark: '夸克', uc: 'UC', baidu: '百度' };
const COOKIE_KEY = { quark: 'QUARK_COOKIE', uc: 'UC_COOKIE', baidu: 'BAIDU_COOKIE' };

async function getJsonOnce(url, cookie, referer) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json, text/plain, */*',
        'Referer': referer,
        ...(cookie ? { 'Cookie': cookie } : {}),
      },
      signal: ctrl.signal,
    });
    return { http: r.status, j: await r.json().catch(() => null) };
  } catch (e) {
    return { http: 0, j: null, err: String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(url, cookie, referer, apiHost) {
  let r = await getJsonOnce(url, cookie, referer);
  if (!r.err) return r;
  await new Promise(res => setTimeout(res, 800));
  r = await getJsonOnce(url, cookie, referer);
  if (r.err) {
    const raw = String(r.err);
    r.err = /aborted/i.test(raw)
      ? (apiHost || '网盘接口') + ' 连续 2 次 12 秒无响应（该域名对站点服务器限流，与 Cookie 无关）'
      : raw;
  }
  return r;
}

const apiInfo = (j) => {
  if (!j || typeof j !== 'object') return '无返回';
  const p = [];
  if (j.status != null) p.push('状态=' + j.status);
  if (j.code != null) p.push('code=' + j.code);
  if (j.errno != null) p.push('errno=' + j.errno);
  if (j.message) p.push('msg=' + j.message);
  return p.length ? p.join(' ') : '空响应';
};

const isLoginErr = (http, j) =>
  http === 401 || !!(j && (j.code === 31001 || /require login|not login|未登录/i.test(String(j.message || ''))));

async function checkDrive(name, apis, qp, referer, cookie) {
  const hosts = Array.isArray(apis) ? apis : [apis];
  let r = null;
  for (const api of hosts) {
    r = await getJson(`${api}/1/clouddrive/member?${qp}&uc_param_str=`, cookie, referer, api.replace(/^https:\/\//, ''));
    if (!r.err) break;
  }
  if (r.err) return { ok: false, msg: name + ' 检测请求失败：' + r.err };
  if (isLoginErr(r.http, r.j)) {
    return { ok: false, expired: true, msg: name + ' Cookie 已失效（' + apiInfo(r.j) + '）：请重新登录该网盘，复制新的完整 Cookie 到后台' };
  }
  const d = (r.j && r.j.data) || null;
  if (!d) return { ok: false, expired: true, msg: name + ' Cookie 疑似失效（' + apiInfo(r.j) + '）' };
  const m = d.member || d;
  const nick = m && (m.nickname || m.nick_name || m.name || m.user_name);
  return { ok: true, msg: name + ' Cookie 有效' + (nick ? '（账号：' + nick + '）' : '') };
}

async function checkBaidu(cookie) {
  const url = `${PAN}/api/gettemplatevariable?clienttype=0&app_id=38824127&web=1&fields=`
    + encodeURIComponent('["bdstoken","uk","isdocuser"]');
  const r = await getJson(url, cookie, PAN, 'pan.baidu.com');
  if (r.err) return { ok: false, msg: '百度 检测请求失败：' + r.err };
  const res = (r.j && r.j.result) || null;
  if (res && res.bdstoken) {
    return { ok: true, msg: '百度 Cookie 有效' + (res.uk ? '（uk=' + String(res.uk).slice(0, 4) + '…）' : '') };
  }
  return { ok: false, expired: true, msg: '百度 Cookie 疑似失效（' + apiInfo(r.j) + '）：请重新复制完整 Cookie（必须含 BDUSS）' };
}

async function handleCheck(request, url, context) {
  const env = await resolveEnv(context);
  if (!checkRateLimit(getClientIP(request), 30, 'ckcookie')) return json({ code: 0, msg: '请求过于频繁，请稍后再试' }, 429);
  if (!await isAdminRequest(request, env)) return adminDenied();

  const type = (url.searchParams.get('type') || '').trim();
  if (!TYPE_LABEL[type]) return json({ code: 0, msg: 'type 只支持 quark / baidu / uc' }, 400);

  const cookie = String(env[COOKIE_KEY[type]] || '').trim();
  if (!cookie) return json({ code: 1, type, ok: false, expired: true, msg: TYPE_LABEL[type] + ' Cookie 未配置' });

  const label = TYPE_LABEL[type];
  let r;
  if (type === 'baidu') {
    r = await checkBaidu(cookie);
  } else {
    const isUc = type === 'uc';
    r = await checkDrive(
      label,
      isUc ? ['https://pc-api.uc.cn', 'https://pre-api.uc.cn'] : ['https://drive-pc.quark.cn', 'https://drive.quark.cn', 'https://pan.quark.cn', 'https://drive-m.quark.cn'],
      isUc ? 'pr=UCBrowser&fr=pc' : 'pr=ucpro&fr=pc',
      isUc ? 'https://drive.uc.cn/' : 'https://pan.quark.cn/',
      cookie,
    );
  }
  return json({ code: 1, type, ok: !!r.ok, expired: !!r.expired, msg: r.msg });
}

export const onRequest = makeRoute(handleCheck);
