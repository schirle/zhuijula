// ==UserScript==
// @name         免费追剧 · 豆瓣找资源
// @namespace    zhuiju
// @version      1.1
// @description  在豆瓣电影注入“找资源”按钮，跳转到追剧站搜索
// @author       zhuiju
// @match        https://movie.douban.com/*
// @match        https://www.douban.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';
  var SITE = "https://zhuiju.pages.dev";
  function getTitle() {
    function extractChinese(raw) {
      raw = (raw || '').trim();
      var firstSpace = raw.indexOf(' ');
      if (firstSpace > 0) { var before = raw.substring(0, firstSpace).trim(); if (before) return before; }
      return raw;
    }
    var el = document.querySelector('[property="v:itemreviewed"]');
    if (el) return extractChinese(el.textContent);
    var h1 = document.querySelector('h1 span[property]');
    if (h1) return extractChinese(h1.textContent);
    var titleEl = document.querySelector('#content h1');
    if (titleEl) { var year = titleEl.querySelector('.year'); var t = titleEl.textContent || ''; if (year) t = t.replace(year.textContent, ''); return extractChinese(t); }
    return '';
  }
  function createBtn(title) {
    var btn = document.createElement('a');
    btn.innerHTML = '<i class="fas fa-magnifying-glass"></i>找资源';
    btn.href = SITE + '/?key=' + encodeURIComponent(title);
    btn.target = '_blank';
    btn.style.cssText = 'display:inline-block;margin-left:12px;padding:4px 14px;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;border-radius:20px;font-size:13px;font-weight:600;text-decoration:none;vertical-align:middle;transition:all 0.2s;box-shadow:0 2px 8px rgba(124,58,237,0.3);cursor:pointer;white-space:nowrap;';
    btn.onmouseenter = function () { this.style.transform = 'scale(1.05)'; };
    btn.onmouseleave = function () { this.style.transform = 'scale(1)'; };
    return btn;
  }
  function inject() {
    var title = getTitle();
    if (!title) return;
    var titleEl = document.querySelector('[property="v:itemreviewed"]') || document.querySelector('#content h1 span:first-child') || document.querySelector('#content h1');
    if (!titleEl) return;
    var btn = createBtn(title);
    var parent = titleEl.parentNode || titleEl;
    if (parent.querySelector('.zhuiju-btn')) return;
    btn.classList.add('zhuiju-btn');
    parent.appendChild(btn);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(inject, 800); });
  else setTimeout(inject, 800);
})();