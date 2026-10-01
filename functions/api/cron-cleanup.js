import { makeRoute, json, resolveEnv, getClientIP, checkRateLimit, getKV } from '../_shared.js';
import { purgeTrashDirs, trashLoad, TRANSFER_TTL_MIN } from './transfer.js';
const LAST_KEY = 'transfer_trash_last';
const CRON_KEY_STORE = 'cron_key';
let _memCronKey = '';
export async function effectiveCleanupKey(env, create = false) {
  const envKey = String((env && env.CLEANUP_KEY) || '').trim();
  if (envKey) return envKey;
  if (_memCronKey) return _memCronKey;
  try {
    const kv = getKV(env);
    let k = await kv.get(CRON_KEY_STORE);
    if (!k && create) {
      k = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
      await kv.put(CRON_KEY_STORE, k);
    }
    if (k) _memCronKey = k;
    return k || '';
  } catch (_) { return ''; }
}
const LAST_WRITE_MS = 5 * 60 * 1000;
const DEDUPE_MS = 10000;            // 10 秒内的重复触发不算失败（定时器每分钟跑，不受影响）
let _lastWriteAt = 0;
let _lastFlushAt = 0;
async function handleCron(request, url, context) {
  if (!checkRateLimit(getClientIP(request), 30, 'cronclean')) return json({ code: 0, msg: '请求过于频繁，请稍后再试' }, 429);
  const env = await resolveEnv(context);
  const key = await effectiveCleanupKey(env, false);
  if (!key) return json({ code: 0, msg: '尚未配置清理密钥：请先打开后台「网盘设置」获取定时地址（密钥会自动生成）' }, 403);
  if ((url.searchParams.get('key') || '') !== key) return json({ code: 0, msg: 'key 不正确' }, 403);

  // 心跳：后台据此显示「定时器 X 分钟前 ✓」
  if (Date.now() - _lastWriteAt > LAST_WRITE_MS) {
    _lastWriteAt = Date.now();
    try { await getKV(env).put(LAST_KEY, String(Date.now())); } catch (_) {  }
  }

  if (Date.now() - _lastFlushAt < DEDUPE_MS) {
    return json({ code: 1, skipped: true, msg: '10 秒内刚清扫过，本次跳过（不算失败）' });
  }
  _lastFlushAt = Date.now();

  // 每次运行 = 把转存目录里的东西全部删掉（不看存了多久）
  const skipMin = Number(env.PURGE_SKIP_MIN || 0) || 0;
  const r = await purgeTrashDirs(env, skipMin);
  let remain = 0;
  try { remain = (await trashLoad(env)).length; } catch (_) { remain = r.remain || 0; }

  const skipped = (r.skipped || []).slice(0, 6);
  return json({
    code: 1,
    done: r.done,
    failed: r.failed,
    remain,
    skip_min: skipMin,
    reasons: (r.why || []).slice(0, 8),
    skipped,
    msg: (r.done || r.failed)
      ? ('已清扫 ' + r.done + ' 项（失败 ' + r.failed + '）' + (skipMin ? ' · 保留最近 ' + skipMin + ' 分钟内新增的' : ''))
      : ('本次没有可删的文件' + (skipMin ? '（最近 ' + skipMin + ' 分钟内新增的先保留）' : '')),
  });
}
export const onRequest = makeRoute(handleCron);
export { TRANSFER_TTL_MIN };
