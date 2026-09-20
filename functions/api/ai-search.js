import { makeRoute, ensureSources, doSearch, isAIConfigured, callAI, json, jsonErr, getClientIP, checkRateLimit, resolveEnv } from '../_shared.js';

export const onRequest = makeRoute(handleAiSearch);

// AI 语义搜索：自然语言 → LLM 解析意图 → 转关键词 → 复用现有检索
// 关键：解析出的「类型/地区」约束会真正用于硬过滤结果（电影/海外剧不再混入电视剧搜索）
// 未配置 AI 时降级为「增强版关键词搜索」（去停用词 + 识别类型/地区），保证功能不中断
async function handleAiSearch(request, url, context) {
  const ip = getClientIP(request);
  if (!checkRateLimit(ip, undefined, 'ai')) return jsonErr('请求过于频繁，请稍后再试', 429);

  const q = (url.searchParams.get('q') || '').trim();
  if (!q) return jsonErr('请输入搜索内容', 400);
  if (q.length > 200) return jsonErr('内容过长', 400);

  const env = await resolveEnv(context);
  let intent = null;
  if (isAIConfigured(env)) {
    intent = await callAI([
      { role: 'system', content: '你是影视推荐助手。用户用自然语言描述想看的影视（如“我想看关于复仇的国产电视剧”“想看爱情题材的电影”）。解析为 JSON：{"type":"电影"|"电视剧"|"动漫"|"综艺"|"短剧"|"不限","tags":[题材关键词数组],"region":"地区：国产/香港/台湾/美国/韩国/日本/泰国/英国/印度等，没提到则留空字符串","year":"年代或空字符串","keyword":"用于检索的最佳简短关键词，2-6个字，例如：复仇、权谋、霸总、校园爱情"}。例：「我想看关于复仇的国产电视剧」→ type=电视剧, region=国产, tags=[复仇], keyword=复仇。只输出 JSON，不要解释。' },
      { role: 'user', content: q },
    ], env);
  }
  if (!intent || !intent.keyword) intent = fallbackParse(q);
  intent.region = normalizeRegion(intent.region);

  const keyword = String(intent.keyword || q).trim() || q;
  if (!await ensureSources()) return jsonErr('数据源未就绪', 503);

  const result = await doSearch(keyword);
  const all = Array.isArray(result.list) ? result.list : [];

  // 按意图硬过滤；全部被过滤掉时逐级放宽（先放宽地区，再放宽类型约束）
  let list = filterByIntent(all, intent);
  if (!list.length && intent.region) list = filterByIntent(all, { ...intent, region: '' });
  if (!list.length) list = all;
  const filtered = list.length < all.length;
  if (list.length) { result.list = list; result.total = list.length; }

  result.intent = {
    raw: q,
    type: intent.type || '不限',
    tags: Array.isArray(intent.tags) ? intent.tags.slice(0, 6) : [],
    region: intent.region || '',
    year: intent.year || '',
    keyword,
    matched: list.length,
    total: all.length,
    filtered,
    ai: isAIConfigured(env),
  };
  return json(result);
}

// ── 意图过滤 ──
// 非中国大陆地区标记（国产 = 中国大陆，港台不属国产）
const FOREIGN_AREA = /美国|美剧|欧美|海外|韩国|韩剧|日本|日剧|泰国|泰剧|英国|英剧|印度|法国|德国|俄罗斯|加拿大|土耳其|西班牙|意大利|澳大利亚|新加坡|马来西亚|墨西哥|巴西|阿根廷|尼日利亚/;
// 港台标记：搜「国产」时同样剔除
const HKTW_AREA = /香港|港剧|台湾|台剧/;
const REGION_HINT = [
  ['香港', /香港|港剧/], ['台湾', /台湾|台剧/], ['美国', /美国|美剧|欧美/],
  ['韩国', /韩国|韩剧/], ['日本', /日本|日剧/], ['泰国', /泰国|泰剧/], ['英国', /英国|英剧/], ['印度', /印度/],
];

// 拼接条目可用于判断的元数据（类别/地区等，个别源搜索接口不返回则为空串）
function itemMeta(it) {
  return [it.vod_class, it.type_name, it.vod_area, it.vod_pubdate].filter(Boolean).join(' ');
}

// 从元数据判断条目类型：电影/电视剧/动漫/综艺/预告；无元数据返回 ''
function detectKind(meta) {
  if (!meta) return '';
  if (/预告|花絮|片花/.test(meta)) return '预告';
  if (/片/.test(meta) && !/剧/.test(meta)) return '电影'; // 动作片/喜剧片/剧情片…都是电影
  if (/动漫|动画/.test(meta)) return '动漫';
  if (/综艺|真人秀/.test(meta)) return '综艺';
  if (/剧|连续/.test(meta)) return '电视剧';
  return '';
}

// 地区词归一化（兼容 LLM 输出「韩剧/中国大陆」等各种写法）
function normalizeRegion(r) {
  const s = String(r || '').trim();
  if (!s) return '';
  if (/国产|大陆|内地|华语|中国/.test(s)) return '国产';
  if (/香港|港剧/.test(s)) return '香港';
  if (/台湾|台剧/.test(s)) return '台湾';
  if (/美国|美剧|欧美|海外/.test(s)) return '美国';
  if (/韩国|韩剧/.test(s)) return '韩国';
  if (/日本|日剧/.test(s)) return '日本';
  if (/泰国|泰剧/.test(s)) return '泰国';
  if (/英国|英剧/.test(s)) return '英国';
  if (/印度/.test(s)) return '印度';
  return s;
}

function filterByIntent(list, intent) {
  const type = intent.type && intent.type !== '不限' ? intent.type : '';
  const region = normalizeRegion(intent.region);
  const hit = REGION_HINT.find(([r]) => r === region);
  const regionRe = hit ? hit[1] : null;
  return list.filter(it => {
    const meta = itemMeta(it);
    const kind = detectKind(meta);
    if (kind === '预告') return false; // 预告片/花絮一律剔除
    if (type && kind && kind !== type) return false; // 类型硬过滤（无元数据的条目保留）
    if (region === '国产') {
      if (FOREIGN_AREA.test(meta) || HKTW_AREA.test(meta)) return false;
    } else if (regionRe && meta) {
      // 指定了具体地区：元数据明确指向其他地区的剔除
      const other = REGION_HINT.some(([, r2]) => r2 !== regionRe && r2.test(meta));
      if (!regionRe.test(meta) && (other || /国产|大陆|内地/.test(meta))) return false;
    }
    return true;
  });
}

// 无 AI 时的兜底解析：识别类型/地区 + 去停用词
function fallbackParse(q) {
  const type = /电影/.test(q) ? '电影'
    : /动漫|动画/.test(q) ? '动漫'
    : /综艺/.test(q) ? '综艺'
    : /电视剧|剧集|连续剧|短剧/.test(q) ? '电视剧' : '不限';
  const regionM = q.match(/国产|大陆|内地|香港|港剧|台湾|台剧|美国|美剧|韩国|韩剧|日本|日剧|泰国|泰剧|英国|英剧|印度|欧美/);
  const cleaned = q
    .replace(/(我想看|想看|有没有|推荐|关于|找|一些|好看的|适合|比较|类似|风格|的)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { type, tags: [], region: normalizeRegion(regionM ? regionM[0] : ''), year: '', keyword: cleaned || q };
}
