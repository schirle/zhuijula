// 搜索排行榜核心（前台 /api/search-rank 与后台 /api/admin/rank 共用）
// 存储：KV 单键 hot_search = { "搜索词": 次数, ... }；未绑定 KV 时只返回兜底词，不报错
import { getKV } from './_shared.js';

export const HOT_KEY = 'hot_search';
export const HOT_TS_KEY = 'hot_search_ts';
export const TOP_N = 12;

// 首次部署 KV 为空时的兜底热词（仅展示，不写计数）
export const DEFAULT_HOT = [
  '复仇的国产剧', '爱情电影', '权谋电视剧', '悬疑美剧', '庆余年', '狂飙',
  '甄嬛传', '琅琊榜', '三体', '流浪地球', '鬼吹灯', '隐秘的角落',
].map((w, i) => ({ word: w, count: 100 - i * 6 }));

export async function readHotMap(env) {
  const kv = getKV(env);
  if (!kv) return {};
  try { const t = await kv.get(HOT_KEY); return t ? (JSON.parse(t) || {}) : {}; } catch { return {}; }
}

export async function writeHotMap(env, map) {
  const kv = getKV(env);
  if (!kv) return false;
  try { await kv.put(HOT_KEY, JSON.stringify(map || {})); return true; } catch { return false; }
}

// 时间戳映射（用于日/周/月榜按时间窗口筛选），与计数 map 分开存储以保持兼容
export async function readHotTs(env) {
  const kv = getKV(env);
  if (!kv) return {};
  try { const t = await kv.get(HOT_TS_KEY); return t ? (JSON.parse(t) || {}) : {}; } catch { return {}; }
}
export async function writeHotTs(env, map) {
  const kv = getKV(env);
  if (!kv) return false;
  try { await kv.put(HOT_TS_KEY, JSON.stringify(map || {})); return true; } catch { return false; }
}

export async function recordHot(env, word) {
  word = (word || '').trim();
  if (!word || word.length > 60) return;
  const kv = getKV(env);
  if (!kv) return;
  const map = await readHotMap(env);
  map[word] = (Number(map[word]) || 0) + 1;
  await writeHotMap(env, map);
  const ts = await readHotTs(env);
  ts[word] = Date.now();
  await writeHotTs(env, ts);
}

const RANGE_MS = { day: 864e5, week: 7 * 864e5, month: 30 * 864e5 };
export function topHot(map, n = TOP_N, range = null, tsMap = null) {
  let arr = Object.entries(map || {}).map(([word, count]) => ({ word, count: Number(count) || 0 }));
  if (range && RANGE_MS[range] && tsMap) {
    const cutoff = Date.now() - RANGE_MS[range];
    arr = arr.filter(it => { const ts = tsMap[it.word]; return ts != null && Number(ts) >= cutoff; });
  }
  arr.sort((a, b) => b.count - a.count);
  return arr.slice(0, n);
}
