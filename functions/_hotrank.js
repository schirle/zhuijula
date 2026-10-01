import { getKV } from './_shared.js';
export const HOT_KEY = 'hot_search';
export const TOP_N = 12;
export const DEFAULT_HOT = [
  '复仇的国产剧', '爱情电影', '权谋电视剧', '悬疑美剧', '庆余年', '狂飙',
  '甄嬛传', '琅琊榜', '三体', '流浪地球', '鬼吹灯', '隐秘的角落',
].map((w, i) => ({ word: w, count: 100 - i * 6 }));
const dayKey = (ms = Date.now()) => new Date(ms + 28800000).toISOString().slice(0, 10);
const dayStartMs = (day) => Date.parse(day + 'T00:00:00+08:00');
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
const FLUSH_MS = 2 * 60 * 1000;
const FLUSH_MAX_WORDS = 40;
const PRUNE_MS = 60 * 60 * 1000;
// 防刷：同一个词在一个落盘窗口内最多 +20，单日最多 +300（正常访客远达不到，刷子收益被压到极低）
const MAX_PER_FLUSH = 20;
const MAX_PER_DAY = 300;
// 什么样的词算"有效搜索词"：太短、纯符号、同一个字重复、数字碎片的都不算
//（被刷的榜单一水儿是「见」「。」「1」「a」「的」这类，全部命中下面的规则）
export const HOT_MIN_LEN = 2;
export const HOT_MAX_LEN = 30;
export function isValidHotWord(word) {
  const w = String(word == null ? '' : word).trim();
  if (w.length < HOT_MIN_LEN || w.length > HOT_MAX_LEN) return false;
  if (/[\u0000-\u001f]/.test(w)) return false;
  if (!/[\u4e00-\u9fff]/.test(w) && !/[a-z0-9]/i.test(w)) return false;   // 纯标点 / 纯符号
  if (new Set(w.replace(/\s+/g, '')).size < 2) return false;              // aa、111、。。。这种重复字
  if (/^\d+$/.test(w) && w.length < 4) return false;                     // 「12」「3」这类数字碎片
  return true;
}
let _buf = Object.create(null);
let _lastFlush = 0;
let _lastPrune = 0;
export async function recordHot(env, word, maxPerDay = MAX_PER_DAY) {
  word = String(word == null ? '' : word).trim();
  if (!isValidHotWord(word)) return;   // 无效词直接丢弃，根本不进榜
  const dayCap = (Number.isFinite(Number(maxPerDay)) && Number(maxPerDay) > 0) ? Number(maxPerDay) : MAX_PER_DAY;
  const now = Date.now();
  const b = _buf[word] || (_buf[word] = { d: Object.create(null), ts: 0 });
  const day = dayKey(now);
  if ((b.d[day] || 0) >= MAX_PER_FLUSH) return;   // 本窗口该词已到上限，忽略后面的
  b.d[day] = (b.d[day] || 0) + 1;
  b.ts = now;
  const due = (now - _lastFlush >= FLUSH_MS) || (Object.keys(_buf).length >= FLUSH_MAX_WORDS);
  if (!due) return;
  _lastFlush = now;
  const buf = _buf; _buf = Object.create(null);
  if (!Object.keys(buf).length) return;
  try {
    const map = await readHotMap(env);
    for (const [w, v] of Object.entries(buf)) {
      const e = (map[w] && typeof map[w] === 'object' && map[w].d) ? map[w] : { d: {}, ts: 0 };
      for (const [day, c] of Object.entries(v.d || {})) {
        e.d[day] = Math.min(dayCap, (Number(e.d[day]) || 0) + (Number(c) || 0));   // 单日封顶（后台可改）
      }
      e.ts = Math.max(Number(e.ts) || 0, Number(v.ts) || 0);
      map[w] = e;
    }
    await writeHotMap(env, map);
  } catch (_) {  }
}
const RANGE_DAYS = { day: 1, week: 7, month: 30 };
// 区间内的完整排名（内部用，前台只取前面若干条）
function rankHot(map, range = null) {
  const today = dayKey();
  const minStart = (range && RANGE_DAYS[range]) ? dayStartMs(today) - (RANGE_DAYS[range] - 1) * 864e5 : null;
  // 读取时再过滤一次：以前被刷进去的无效词（单字符等）当场就不显示了，不用等清理
  const arr = Object.entries(map || {}).filter(([word]) => isValidHotWord(word)).map(([word, v]) => {
    let count = 0;
    if (typeof v === 'number') count = v;
    else if (v && typeof v === 'object' && v.d) {
      if (!minStart) {
        for (const c of Object.values(v.d)) count += Number(c) || 0;
      } else {
        for (const [day, c] of Object.entries(v.d)) {
          if (range === 'day' ? day === today : dayStartMs(day) >= minStart) count += Number(c) || 0;
        }
      }
    }
    return { word, count };
  });
  arr.sort((a, b) => b.count - a.count);
  return arr;
}
export function topHot(map, n = TOP_N, range = null) {
  return rankHot(map, range).slice(0, n);
}
const dayCountOf = (v, day) => {
  const d = (v && typeof v === 'object' && v.d) ? v.d : null;
  return d ? (Number(d[day]) || 0) : 0;
};
// 带趋势的榜单（前台排行页用）：今天 / 昨天的次数 + 上升下降
export function topHotDetail(map, n = TOP_N, range = null) {
  const today = dayKey();
  const yesterday = dayKey(Date.now() - 864e5);
  return topHot(map, n, range).map((it) => {
    const v = map && map[it.word];
    const t = dayCountOf(v, today);
    const p = dayCountOf(v, yesterday);
    let trend = 'flat';
    if (!p && t > 0) trend = 'new';
    else if (t > p) trend = 'up';
    else if (t < p) trend = 'down';
    return { word: it.word, count: it.count, today: t, prev: p, trend };
  });
}
// 榜单整体情况（前台顶部的统计条用）
export function statsHot(map, range = null) {
  const today = dayKey();
  const all = rankHot(map, range);
  let sum = 0, todaySum = 0, todayWords = 0;
  for (const it of all) {
    sum += Number(it.count) || 0;
    const t = dayCountOf(map && map[it.word], today);
    todaySum += t;
    if (t > 0) todayWords++;
  }
  return { words: all.length, sum, todaySum, todayWords };
}
export const HOT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export async function pruneHot(env, maxAgeMs = HOT_MAX_AGE_MS, force = false) {
  const now = Date.now();
  if (!force && now - _lastPrune < PRUNE_MS) return 0;
  _lastPrune = now;
  const kv = getKV(env);
  if (!kv) return 0;
  if (force) { try { await kv.delete('hot_search_ts'); } catch (_) {} }
  const map = await readHotMap(env);
  const cutoffDay = dayKey(now - 31 * 864e5);
  let removed = 0, changed = false;
  for (const w of Object.keys(map)) {
    const v = map[w];
    if (typeof v !== 'object' || !v) { delete map[w]; removed++; changed = true; continue; }
    if (!isValidHotWord(w)) { delete map[w]; removed++; changed = true; continue; }   // 清掉被刷进去的无效词
    if (Number(v.ts) && Number(v.ts) < now - maxAgeMs) { delete map[w]; removed++; changed = true; continue; }
    if (v.d) {
      for (const day of Object.keys(v.d)) {
        if (day < cutoffDay) { delete v.d[day]; changed = true; }
      }
      if (!Object.keys(v.d).length) { delete map[w]; removed++; changed = true; }
    }
  }
  if (changed) await writeHotMap(env, map);
  return removed;
}
