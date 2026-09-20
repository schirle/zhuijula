import { makeRoute, json, CFG, isAdminRequest, adminDenied, loadSiteConfig, saveSiteConfig } from '../../_shared.js';

export const onRequest = makeRoute(handleAdminConfig);

// 后台配置读写：GET 返回 KV 配置 + 环境变量兜底情况（布尔，不泄露值）；POST 白名单字段保存
const STR_FIELDS = [
  'ai_api_key', 'ai_model', 'ai_base_url', 'nav_links', 'pdlist', 'wp_api_host',
  'quark_cookie', 'quark_dir', 'baidu_cookie', 'baidu_dir', 'jjsou_api_key',
  'web3forms_access_key', 'tmdb_key', 'daily_api', 'zhuiju_url',
  'site_name', 'site_desc',
];
const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'src';

// 结构化列表（数组；空数组 = 清除）
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
};
// 环境变量兜底提示（仅回是否已设置，不回值）
const ENV_HINTS = {
  AI_API_KEY: 'ai_api_key', AI_MODEL: 'ai_model', AI_BASE_URL: 'ai_base_url',
  NAV_LINKS: 'nav_links', PDlist: 'pdlist', WP_API_HOST: 'wp_api_host',
  QUARK_COOKIE: 'quark_cookie', QUARK_DIR: 'quark_dir',
  BAIDU_COOKIE: 'baidu_cookie', BAIDU_DIR: 'baidu_dir',
  JJSOU_API_KEY: 'jjsou_api_key', WEB3FORMS_ACCESS_KEY: 'web3forms_access_key',
  TMDB_KEY: 'tmdb_key', DAILY_API: 'daily_api', ZUIJU_URL: 'zhuiju_url',
};

async function handleAdminConfig(request, _url, context) {
  const env = context?.env || {};
  if (!await isAdminRequest(request, env)) return adminDenied();

  if (request.method === 'GET') {
    const cfg = await loadSiteConfig(env, true);
    const env_set = {};
    for (const [k] of Object.entries(ENV_HINTS)) env_set[k] = !!(env[k] && String(env[k]).trim());
    return json({
      code: 1,
      cfg,
      env_set,
      kv_ready: !!(env.KV || env.SEARCH_KV),
      default_zhuiju_url: CFG.ZUIJU_API,
    });
  }

  if (request.method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch (_) { return json({ code: 0, msg: '请求格式错误' }, 400); }
    const cfg = await loadSiteConfig(env, true);

    // 字符串字段：string/number 直接收；空串 = 清除（回退环境变量）
    for (const k of STR_FIELDS) {
      if (!(k in body)) continue;
      const v = body[k];
      if (v == null) { delete cfg[k]; continue; }
      let s = String(v).trim();
      if (k === 'nav_links' && s) {
        // 导航链接必须是合法 JSON 数组
        try {
          const arr = JSON.parse(s);
          if (!Array.isArray(arr)) throw new Error('not array');
          s = JSON.stringify(arr);
        } catch (_) { return json({ code: 0, msg: '「导航链接」必须是合法的 JSON 数组' }, 400); }
      }
      if (k === 'zhuiju_url' && s && !/^https?:\/\//i.test(s)) {
        return json({ code: 0, msg: '「追剧数据源 URL」必须以 http(s):// 开头' }, 400);
      }
      if (s) cfg[k] = s; else delete cfg[k];
    }

    // 结构化列表：播放源 / 首页轮播
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

    // 对象型模块：网站主题 / APP页 / 播放页 / 福利页 / 其他（对象；空对象 = 清除）
    for (const key of ['theme', 'app_page', 'play_page', 'welfare_page', 'other']) {
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

    // 追剧自定义数据：对象或 JSON 字符串；空 = 清除（恢复上游）
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
        cfg.zhuiju_updated = Date.now(); // 版本号变更 → 各接口立即热加载
      } else if (data == null || data === '') {
        delete cfg.zhuiju_data; delete cfg.zhuiju_updated;
      } else if ('zhuiju_data' in body) {
        return json({ code: 0, msg: '「追剧自定义数据」必须是 JSON 对象' }, 400);
      }
    }

    const ok = await saveSiteConfig(env, cfg);
    if (!ok) return json({ code: 0, msg: 'KV 未绑定或写入失败（请绑定 KV 命名空间，变量名 KV 或 SEARCH_KV）' }, 500);
    return json({ code: 1, msg: '已保存' });
  }

  return json({ code: 0, msg: '不支持的方法' }, 405);
}
