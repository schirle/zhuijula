import { makeRoute, json, resolveEnv, isAdminRequest, adminDenied, getClientIP, checkRateLimit, getKV } from '../../_shared.js';
import { purgeTrashDirs, trashLoad, trashPending, AUTO_CLEAN } from '../transfer.js';

async function handleCleanup(request, url, context) {
  const env = await resolveEnv(context);
  if (!checkRateLimit(getClientIP(request), 10, 'cleanup')) return json({ code: 0, msg: '请求过于频繁，请稍后再试' }, 429);
  if (!await isAdminRequest(request, env)) return adminDenied();

  const peek = url.searchParams.get('peek') === '1';
  const skipMin = Number(env.PURGE_SKIP_MIN || 0) || 0;

  let r = { done: 0, failed: 0, why: [], skipped: [] };
  let lastMin = -1;
  let pausedText = AUTO_CLEAN ? '' : ' · ⏸ 自动清理已暂停';
  try {
    const last = Number(await getKV(env).get('transfer_trash_last')) || 0;
    if (last) lastMin = Math.round((Date.now() - last) / 60000);
  } catch (_) {  }
  const cronText = lastMin < 0 ? '定时器未触发' : ('定时器 ' + lastMin + ' 分钟前 ✓');

  // 点「立即清理」= 把转存目录里的东西全部删掉（不看存了多久）
  if (!peek) r = await purgeTrashDirs(env, skipMin);

  const total = (await trashLoad(env)).length;
  const pending = await trashPending(env, 5);
  const skipped = (r.skipped || []).slice(0, 6);

  const msg = peek
    ? '队列 ' + total + ' 条 · ' + cronText + pausedText
    : (r.done || r.failed
      ? '已清扫 ' + r.done + ' 项' + (r.failed ? '（失败 ' + r.failed + '）' : '') + ' · 队列剩 ' + total + ' 条 · ' + cronText
      : '没有可删的文件 · 队列剩 ' + total + ' 条 · ' + cronText);

  return json({
    code: 1,
    deleted: r.done,
    failed: r.failed,
    remain: total,
    reasons: (r.why || []).slice(0, 8),
    skipped,
    peek,
    auto_clean: AUTO_CLEAN,
    skip_min: skipMin,
    last_cron_min_ago: lastMin,
    pending,
    msg,
  });
}

export const onRequest = makeRoute(handleCleanup);
