import { makeRoute, json, isAdminRequest, adminDenied, loadSiteConfig, saveSiteConfig, buildEnvSet, slugify, getClientIP, checkRateLimit, purgeSiteCaches } from '../../_shared.js';
import { effectiveCleanupKey } from '../cron-cleanup.js';
import { BANNED_DEFAULT_TEXT } from '../../_banned-default.js';

export const onRequest = makeRoute(handleAdminConfig);

const STR_FIELDS = [
  'wp_api_host',
  'quark_cookie', 'quark_dir',
  'baidu_cookie', 'baidu_dir', 'uc_cookie', 'uc_dir',
  'search_banned',
  'web3forms_access_key', 'daily_api',
  'site_name', 'site_desc', 'site_icon', 'stats_code', 'link_reqs',
  'crx_url', 'userscript_name', 'plugin_enabled',
  'us_site', 'us_text', 'us_c1', 'us_c2', 'us_color', 'us_padding', 'us_fontsize', 'us_radius',
  'us_name', 'us_namespace', 'us_version', 'us_desc', 'us_author',
  // 搜索防刷与配额（站长在后台「搜索排行」里自己填）
  'search_daily_all', 'search_daily_ip', 'search_daily_ip_hard', 'search_rate_min', 'hot_max_per_day',
  // 清理：转存后多少分钟内不清理（0 = 每次都清空）
  'purge_skip_min',
];
const LIST_FIELDS = {
  play_sources: {
    validate(it) {
      if (!it || typeof it !== 'object') return '播放源必须是对象';
      it.name = String(it.name || '').trim();
      it.url = String(it.url || '').trim();
      if (!it.name) return '播放源名称不能为空';
      if (!/^https?:\/\//i.test(it.url)) return '播放源地址必须以 http(s):// 开头';
      it.alias = String(it.alias || '').trim() || slugify(it.name);
      return null;
    },
  },
  carousels: {
    validate(it) {
      if (!it || typeof it !== 'object') return '轮播项必须是对象';
      it.pic = String(it.pic || '').trim();
      it.link = String(it.link || '').trim();
      it.mode = it.mode === 'external' ? 'external' : 'search';
      if (!it.pic) return '轮播图片链接不能为空';
      if (!it.link) return '轮播打开链接/关键词不能为空';
      if (it.mode === 'external' && !/^https?:\/\//i.test(it.link)) return '外链必须以 http(s):// 开头';
      return null;
    },
  },
  android_apps: {
    validate(it) {
      if (!it || typeof it !== 'object') return '安卓APP项必须是对象';
      it.name = String(it.name || '').trim();
      it.image = String(it.image || '').trim();
      if (!it.name) return 'APP名称不能为空';
      if (!it.image) return 'APP图片地址不能为空';
      const allowed = ['uc', 'quark', 'baidu', 'thunder', 'other'];
      const methods = Array.isArray(it.methods)
        ? it.methods.map(m => ({ type: String(m && m.type || '').trim(), url: String(m && m.url || '').trim() })).filter(m => m.url)
        : [];
      for (const m of methods) {
        if (!allowed.includes(m.type)) return '下载方式未识别，请重新选择（UC/夸克/百度/迅雷/其他网盘）';
        if (!/^https?:\/\//i.test(m.url)) return '下载链接必须以 http(s):// 开头';
      }
      it.methods = methods;
      if (!it.methods.length) return '请至少添加一个下载链接';
      return null;
    },
  },
  ios_apps: {
    validate(it) {
      if (!it || typeof it !== 'object') return '苹果APP项必须是对象';
      it.name = String(it.name || '').trim();
      it.image = String(it.image || '').trim();
      it.link = String(it.link || '').trim();
      it.copy = String(it.copy || '').trim();
      it.text = String(it.text || '').trim();
      if (!it.name) return 'APP名称不能为空';
      if (!it.image) return 'APP图片地址不能为空';
      if (!it.link) return '商城ID不能为空';
      if (!it.copy) return '「需要复制的内容」不能为空';
      return null;
    },
  },
  nav_links: {
    validate(it) {
      if (!it || typeof it !== 'object') return '导航项必须是对象';
      it.label = String(it.label || '').trim();
      it.href = String(it.href || '').trim();
      it.icon = String(it.icon || '').trim();
      if (!it.label) return '导航显示文字不能为空';
      if (!it.href) return '导航链接不能为空';
      // 只允许站内路径或 http(s) 链接：避免把 javascript: 这类可执行协议存进导航
      if (!/^(https?:\/\/|\/)/i.test(it.href)) return '导航链接请填站内路径（如 /app）或 http(s):// 开头的完整网址';
      return null;
    },
  },
  links: {
    validate(it) {
      if (!it || typeof it !== 'object') return '友链项必须是对象';
      it.name = String(it.name || '').trim();
      it.url = String(it.url || '').trim();
      if (!it.name) return '友链站点名称不能为空';
      if (!/^https?:\/\//i.test(it.url)) return '友链地址必须以 http(s):// 开头';
      return null;
    },
  },
  vip_jx: {
    validate(it) {
      if (!it || typeof it !== 'object') return '解析接口项必须是对象';
      it.name = String(it.name || '').trim();
      it.url = String(it.url || '').trim();
      if (!it.name) return '解析接口名称不能为空';
      if (!/^https?:\/\//i.test(it.url)) return '解析地址必须以 http(s):// 开头';
      return null;
    },
  },
  plugin_steps: {
    validate(it) {
      if (!it || typeof it !== 'object') return '步骤必须是对象';
      it.title = String(it.title || '').trim();
      it.desc = String(it.desc || '').trim();
      if (!it.title) return '步骤标题不能为空';
      return null;
    },
  },
  plugin_faq: {
    validate(it) {
      if (!it || typeof it !== 'object') return '问答必须是对象';
      it.q = String(it.q || '').trim();
      it.a = String(it.a || '').trim();
      if (!it.q) return '问题不能为空';
      return null;
    },
  },
  plugin_feats: {
    validate(it) {
      if (!it || typeof it !== 'object') return '亮点必须是对象';
      it.icon = String(it.icon || '').trim().replace(/^fa[sb]?\s+/, '').slice(0, 40);
      it.title = String(it.title || '').trim();
      it.desc = String(it.desc || '').trim();
      if (!it.title) return '亮点标题不能为空';
      return null;
    },
  },
};

async function handleAdminConfig(request, url, context) {
  const env = context?.env || {};
  if (!checkRateLimit(getClientIP(request), 30, 'admincfg')) return json({ code: 0, msg: '请求过于频繁，请稍后再试' }, 429);
  if (!await isAdminRequest(request, env)) return adminDenied();

  if (request.method === 'GET') {
    const cfg = await loadSiteConfig(env, true);
    const env_set = buildEnvSet(env);
    const cronKey = await effectiveCleanupKey(env, true);
    const cronUrl = (url && url.origin ? url.origin : '')
      + '/api/cron-cleanup?key=' + encodeURIComponent(cronKey);
    return json({
      code: 1,
      cfg,
      env_set,
      crxture: String(env.CRXTURE || '').trim() === '1',
      db_ready: !!(env.DB || env.D1),
      cron_url: cronUrl,
      banned_default: BANNED_DEFAULT_TEXT,
    });
  }

  if (request.method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch (_) { return json({ code: 0, msg: '请求格式错误' }, 400); }
    const cfg = await loadSiteConfig(env, true);

    for (const k of STR_FIELDS) {
      if (!(k in body)) continue;
      const v = body[k];
      if (v == null) { delete cfg[k]; continue; }
      let s = String(v).trim();
      if (k === 'site_icon' && s && !/^(https?:\/\/|\/\/|\/|data:image\/)/i.test(s)) {
        return json({ code: 0, msg: '网站图标地址无效：请填 http(s):// 开头的图片链接（或站内路径，如 /file/logo.png）' }, 400);
      }
      if (k === 'crx_url' && s && !/^(https?:\/\/|\/)/i.test(s)) {
        return json({ code: 0, msg: 'Chrome 扩展下载地址无效：请填 http(s):// 链接或站内路径（如 /file/extension.crx）' }, 400);
      }
      if (k === 'userscript_name' && s && /[\\/]/.test(s)) {
        return json({ code: 0, msg: '文件名不能包含路径分隔符（/ 或 \\）' }, 400);
      }
      if (k === 'us_site' && s && !/^https?:\/\/[^\s"'<>]+$/i.test(s)) {
        return json({ code: 0, msg: '站点地址无效：请填 http(s):// 开头的完整地址（留空则用部署域名）' }, 400);
      }
      if ((k === 'us_c1' || k === 'us_c2' || k === 'us_color') && s && !/^#[0-9a-fA-F]{3,8}$/.test(s)) {
        return json({ code: 0, msg: '颜色格式无效：请用 #7c3aed 这样的色值' }, 400);
      }
      if ((k === 'us_fontsize' || k === 'us_radius') && s && !/^[\d.]+(px|rem|em)$/.test(s)) {
        return json({ code: 0, msg: '尺寸格式无效：请填 13px / 1rem 这类值' }, 400);
      }
      if (k === 'us_padding' && s && !/^[\d.]+(px|rem|em)( +[\d.]+(px|rem|em)){0,3}$/.test(s)) {
        return json({ code: 0, msg: '内边距格式无效：请填 4px 14px 这类值' }, 400);
      }
      if (k === 'us_version' && s && !/^[0-9A-Za-z][0-9A-Za-z._-]{0,19}$/.test(s)) {
        return json({ code: 0, msg: '脚本版本号格式无效：只能用数字 / 字母 / 点 / 横线，如 1.0.0' }, 400);
      }
      if (k === 'us_namespace' && s && !/^[A-Za-z0-9._:/-]{1,80}$/.test(s)) {
        return json({ code: 0, msg: '命名空间格式无效：只能填字母、数字与 . : / _ -（例如 your-site.com）' }, 400);
      }
      if ((k === 'us_name' || k === 'us_desc' || k === 'us_author') && /[\r\n]/.test(String(v))) {
        return json({ code: 0, msg: '这一项不能换行，请填成一行' }, 400);
      }
      // 搜索防刷 / 配额：只接受整数，并给一个合理区间（避免填成 0 把正常访客也挡了）
      if ((k === 'search_daily_all' || k === 'search_daily_ip' || k === 'search_daily_ip_hard'
        || k === 'search_rate_min' || k === 'hot_max_per_day') && s) {
        if (!/^\d{1,9}$/.test(s)) return json({ code: 0, msg: '「' + k + '」请只填数字' }, 400);
        const n = Number(s);
        const range = k === 'hot_max_per_day' ? [1, 100000]
          : (k === 'search_daily_all' ? [100, 100000000] : [1, 10000000]);
        if (n < range[0] || n > range[1]) {
          return json({ code: 0, msg: '「' + k + '」数值应在 ' + range[0] + ' ~ ' + range[1] + ' 之间' }, 400);
        }
      }
      // 清理豁免时长：允许 0（= 每次都清空），上限 12 小时
      if (k === 'purge_skip_min' && s) {
        if (!/^\d{1,4}$/.test(s)) return json({ code: 0, msg: '「转存后多少分钟内不清理」请只填数字' }, 400);
        if (Number(s) > 720) return json({ code: 0, msg: '「转存后多少分钟内不清理」最多填 720（12 小时）' }, 400);
      }

      if (s) cfg[k] = s; else delete cfg[k];
    }

    for (const key of Object.keys(LIST_FIELDS)) {
      if (!(key in body)) continue;
      let arr = body[key];
      if (typeof arr === 'string') {
        const t = arr.trim();
        arr = t ? JSON.parse(t) : [];
      }
      if (!Array.isArray(arr)) return json({ code: 0, msg: '「' + key + '」必须是数组' }, 400);
      for (let i = 0; i < arr.length; i++) {
        const err = LIST_FIELDS[key].validate(arr[i] || {});
        if (err) return json({ code: 0, msg: '「' + key + '」第 ' + (i + 1) + ' 项' + err }, 400);
      }
      if (arr.length) cfg[key] = arr; else delete cfg[key];
    }

    for (const key of ['theme', 'app_page', 'play_page', 'other', 'first_popup', 'promo_ad']) {
      if (!(key in body)) continue;
      let o = body[key];
      if (typeof o === 'string') {
        const t = o.trim();
        if (!t) { delete cfg[key]; continue; }
        try { o = JSON.parse(t); } catch (_) { return json({ code: 0, msg: '「' + key + '」不是合法 JSON 对象' }, 400); }
      }
      if (o && typeof o === 'object' && !Array.isArray(o)) {
        if (Object.keys(o).length) cfg[key] = o; else delete cfg[key];
      } else if (o == null) {
        delete cfg[key];
      } else {
        return json({ code: 0, msg: '「' + key + '」必须是对象' }, 400);
      }
    }

    if ('zhuiju_data' in body) {
      let data = body.zhuiju_data;
      if (typeof data === 'string') {
        const t = data.trim();
        if (!t) { delete cfg.zhuiju_data; delete cfg.zhuiju_updated; }
        else {
          try { data = JSON.parse(t); } catch (_) { return json({ code: 0, msg: '「追剧自定义数据」不是合法 JSON' }, 400); }
        }
      }
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        if (!Array.isArray(data['jiekou-list']) || !data['jiekou-list'].length) {
          return json({ code: 0, msg: '自定义数据缺少 jiekou-list 播放源（保存后搜索将不可用），请先「从上游导入」再改' }, 400);
        }
        cfg.zhuiju_data = data;
        cfg.zhuiju_updated = Date.now();
      } else if (data == null || data === '') {
        delete cfg.zhuiju_data; delete cfg.zhuiju_updated;
      } else if ('zhuiju_data' in body) {
        return json({ code: 0, msg: '「追剧自定义数据」必须是 JSON 对象' }, 400);
      }
    }

    const ok = await saveSiteConfig(env, cfg);
    if (!ok) return json({ code: 0, msg: 'D1 未绑定或写入失败（请在 Pages 项目设置里绑定 D1 数据库，变量名 DB）' }, 500);
    await purgeSiteCaches(new URL(request.url).origin);
    return json({ code: 1, msg: '已保存，前台缓存已刷新（最多 5 分钟内全网生效）' });
  }

  return json({ code: 0, msg: '不支持的方法' }, 405);
}
