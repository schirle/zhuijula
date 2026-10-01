import { makeRoute, resolveEnv } from '../_shared.js';

const DEF = {
  text: '找资源',
  c1: '#7c3aed',
  c2: '#6d28d9',
  color: '#ffffff',
  padding: '4px 14px',
  fontsize: '13px',
  radius: '20px',
};

const okSite = (v) => /^https?:\/\/[^\s"'<>]+$/i.test(v);
const okColor = (v) => /^#[0-9a-fA-F]{3,8}$/.test(v);
const okSize = (v) => /^[\d.]+(px|rem|em)$/.test(v);
const okPad = (v) => /^[\d.]+(px|rem|em)( +[\d.]+(px|rem|em)){0,3}$/.test(v);

function txt(v, dflt) {
  const s = String(v == null ? '' : v).replace(/[<>"'`\\\r\n]/g, '').trim();
  return s ? s.slice(0, 24) : dflt;
}

// 脚本元信息（后台可改）：去掉可能破坏 UserScript 头部的字符，并限长
function meta(v, dflt, max = 60) {
  const s = String(v == null ? '' : v)
    .replace(/[<>"'`\\\r\n]/g, ' ')
    .replace(/\/{2,}/g, ' ')      // 防止在脚本头部伪造出 `// @xxx` 这样的行
    .replace(/\s{2,}/g, ' ')
    .trim();
  return s ? s.slice(0, max) : dflt;
}
// 版本号：只允许数字 / 字母 / 点 / 横线（油猴靠它判断更新）
function ver(v, dflt) {
  const s = String(v == null ? '' : v).trim();
  return /^[0-9A-Za-z][0-9A-Za-z._-]{0,19}$/.test(s) ? s : dflt;
}
// 命名空间：站点地址或一个简短的标识（字母数字与 . : / _ -）
function nsOf(v, dflt) {
  const s = String(v == null ? '' : v).trim().replace(/[<>"'`\\\r\n\s]/g, '');
  return /^[A-Za-z0-9._:/-]{1,80}$/.test(s) ? s : dflt;
}

export function buildUserScript(cfg, origin) {
  const site = (() => {
    const v = String(cfg.us_site || '').trim();
    return okSite(v) ? v.replace(/\/+$/, '') : origin.replace(/\/+$/, '');
  })();
  const text = txt(cfg.us_text, DEF.text);
  const c1 = okColor(String(cfg.us_c1 || '').trim()) ? String(cfg.us_c1).trim() : DEF.c1;
  const c2 = okColor(String(cfg.us_c2 || '').trim()) ? String(cfg.us_c2).trim() : DEF.c2;
  const color = okColor(String(cfg.us_color || '').trim()) ? String(cfg.us_color).trim() : DEF.color;
  const padding = okPad(String(cfg.us_padding || '').trim()) ? String(cfg.us_padding).trim() : DEF.padding;
  const fontsize = okSize(String(cfg.us_fontsize || '').trim()) ? String(cfg.us_fontsize).trim() : DEF.fontsize;
  const radius = okSize(String(cfg.us_radius || '').trim()) ? String(cfg.us_radius).trim() : DEF.radius;
  const host = site.replace(/^https?:\/\//, '').split('/')[0];
  const name = String(cfg.site_name || '').trim() || host;
  // 脚本元信息：后台「插件设置」里填了就用填的，没填按站点自动生成
  const usName = meta(cfg.us_name, name + ' - 豆瓣找资源');
  const usNs = nsOf(cfg.us_namespace, site);
  const usVer = ver(cfg.us_version, '1.0.0');
  const usDesc = meta(cfg.us_desc, '在豆瓣电影页面一键跳转到 ' + name + ' 搜索资源', 120);
  const usAuthor = meta(cfg.us_author, host);

  const css = 'display:inline-block;margin-left:12px;padding:' + padding
    + ';background:linear-gradient(135deg,' + c1 + ',' + c2 + ');color:' + color
    + ';border-radius:' + radius + ';font-size:' + fontsize
    + ';font-weight:600;text-decoration:none;vertical-align:middle;transition:all .2s;'
    + 'box-shadow:0 2px 8px rgba(0,0,0,.18);cursor:pointer;white-space:nowrap;';

  return `// ==UserScript==
// @name         ${usName}
// @namespace    ${usNs}
// @version      ${usVer}
// @description  ${usDesc}
// @author       ${usAuthor}
// @match        https://movie.douban.com/subject/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
(function () {
  'use strict';
  var SITE = '${site}';
  var BTN_TEXT = '${text}';
  var BTN_CSS = '${css}';

  function inject() {
    var el = document.querySelector('#content h1 span[property="v:itemreviewed"]')
      || document.querySelector('#content h1');
    if (!el || !el.parentNode) return;
    if (document.getElementById('ftv-find-btn')) return;
    var t = (el.textContent || '').replace(/\\s*\\(\\d{4}\\)\\s*$/, '').trim();
    if (!t) return;
    var a = document.createElement('a');
    a.id = 'ftv-find-btn';
    a.textContent = BTN_TEXT;
    a.href = SITE + '/search?wd=' + encodeURIComponent(t);
    a.target = '_blank';
    a.rel = 'noopener';
    a.setAttribute('style', BTN_CSS);
    el.parentNode.insertBefore(a, el.nextSibling);
  }

  inject();
  var last = location.href;
  setInterval(function () {
    if (location.href !== last) { last = location.href; setTimeout(inject, 700); }
  }, 800);
})();
`;
}

async function handle(request, url, context) {
  const env = await resolveEnv(context);
  const cfg = (env && env._siteCfg) || {};
  return new Response(buildUserScript(cfg, url.origin), {
    headers: { 'content-type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export const onRequest = makeRoute(handle);
