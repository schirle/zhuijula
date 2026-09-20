/**
 * 微信浏览器检测 & 引导在浏览器中打开
 * 支持微信、企业微信、QQ 内置浏览器
 */
(() => {
  'use strict';

  const ua = navigator.userAgent || '';
  // 检测微信、企业微信、QQ 内置浏览器
  const isRestricted = /MicroMessenger|wxwork|QQ\/(\d+\.\d+)/i.test(ua);
  if (!isRestricted) return;

  const domain = window.location.hostname || window.location.href;

  // 注入样式（合并为单个 style 节点减少 DOM 操作）
  const style = document.createElement('style');
  style.textContent =
    'body>*:not(.wechat-guide-overlay){display:none!important}' +
    '.wechat-guide-overlay{position:fixed;inset:0;z-index:99999;background:linear-gradient(160deg,#0f0f1a 0%,#1a1a2e 40%,#16213e 100%);display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;padding:20px;text-align:center}' +
    '.wechat-guide-icon{width:80px;height:80px;background:linear-gradient(135deg,#10b981,#059669);border-radius:22px;display:flex;align-items:center;justify-content:center;font-size:40px;margin-bottom:24px;box-shadow:0 8px 32px rgba(16,185,129,0.4)}' +
    '.wechat-guide-title{font-size:22px;font-weight:700;margin-bottom:8px;letter-spacing:-0.3px}' +
    '.wechat-guide-sub{font-size:14px;color:rgba(255,255,255,0.55);margin-bottom:32px}' +
    '.wechat-guide-steps{display:flex;flex-direction:column;gap:16px;margin-bottom:32px}' +
    '.wechat-guide-step{display:flex;align-items:center;gap:12px;background:rgba(255,255,255,0.06);border-radius:12px;padding:14px 18px;text-align:left}' +
    '.wechat-guide-step-num{width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#10b981,#059669);display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;flex-shrink:0}' +
    '.wechat-guide-step-text{font-size:14px;color:rgba(255,255,255,0.85);line-height:1.5}' +
    '.wechat-guide-step-text b{color:#34d399}' +
    '.wechat-guide-tip{font-size:12px;color:rgba(255,255,255,0.35);margin-top:8px}' +
    '.wechat-guide-domain{display:inline-block;margin-top:6px;background:linear-gradient(135deg,#10b981,#34d399);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;font-weight:700;font-size:15px}';
  document.head.appendChild(style);

  // 构建引导内容（使用 createElement 替代 innerHTML 更安全）
  const createGuide = () => {
    const overlay = document.createElement('div');
    overlay.className = 'wechat-guide-overlay';

    const icon = document.createElement('div');
    icon.className = 'wechat-guide-icon';
    icon.textContent = '\uD83D\uDE80';

    const title = document.createElement('div');
    title.className = 'wechat-guide-title';
    title.textContent = '请使用浏览器打开';

    const sub = document.createElement('div');
    sub.className = 'wechat-guide-sub';
    sub.textContent = '微信内无法正常访问，请按以下步骤操作';

    const steps = document.createElement('div');
    steps.className = 'wechat-guide-steps';
    steps.innerHTML =
      '<div class="wechat-guide-step"><div class="wechat-guide-step-num">1</div><div class="wechat-guide-step-text">点击右上角 <b>···</b> 按钮</div></div>' +
      '<div class="wechat-guide-step"><div class="wechat-guide-step-num">2</div><div class="wechat-guide-step-text">选择 <b>在浏览器中打开</b></div></div>';

    const tip = document.createElement('div');
    tip.className = 'wechat-guide-tip';
    tip.textContent = '或者复制下方链接到浏览器访问';

    const domainEl = document.createElement('div');
    domainEl.className = 'wechat-guide-domain';
    domainEl.textContent = domain;

    overlay.append(icon, title, sub, steps, tip, domainEl);
    return overlay;
  };

  const insertOverlay = () => {
    if (!document.body) return;
    document.body.insertBefore(createGuide(), document.body.firstChild);
  };

  document.body
    ? insertOverlay()
    : document.addEventListener('DOMContentLoaded', insertOverlay);
})();
