(function(){
  'use strict';

  const API_LIST = [
    {v:'https://jiexi.789jiexi.com/?url=',t:'789解析【爱优腾】'},
    {v:'https://jx.2s0.cn/player/?url=',t:'极速解析【爱腾哔】'},
    {v:'https://bd.jx.cn/?url=',t:'冰豆解析【爱优腾果】'},
    {v:'https://jx.nnxv.cn/tv.php?url=',t:'七哥解析【爱优腾果哔】'},
    {v:'https://jx.hls.one/?url=',t:'HLS解析【有广告】'},
    {v:'https://www.8090g.cn/?url=',t:'8090解析【有广告】'},
    {v:'https://www.playm3u8.cn/jiexi.php?url=',t:'PlayM3U8【有广告】'},
    {v:'https://jx.xmflv.cc/?url=',t:'XMFLV【有广告】'},
    {v:'https://www.ckplayer.vip/jiexi/?url=',t:'CkPlayer【有广告】'}
  ];

  const STORAGE_KEY = 'videoHistory';

  document.addEventListener('DOMContentLoaded', function() {
    const dom = {
      apiSelect:   $('#api-select'),
      videoUrl:    $('#video-url'),
      parseBtn:    $('#parse-btn'),
      player:      $('#video-player'),
      historyList: $('#history-list'),
      clearBtn:    $('#clear-history'),
      toast:       $('#toast'),
      toastMsg:    $('#toast-message'),
      lastUpdated: $('#last-updated'),
      histCount:   $('#history-count'),
      status:      $('#player-status'),
      fullBtn:     $('#fullscreen-btn'),
      refreshBtn:  $('#refresh-btn'),
      toastIcon:   $('#toast i'),
      tabNav:      $('.tab-nav')
    };

    

    dom.apiSelect.innerHTML = API_LIST.map(function(a){
      return '<option value="'+esc(a.v)+'">'+esc(a.t)+'</option>';
    }).join('');

    const savedApi = lsGet('PLAY_VIP_API');
    if(savedApi && API_LIST.some(function(a){ return a.v===savedApi; })) dom.apiSelect.value = savedApi;

    let history = lsGetJson(STORAGE_KEY);

    

    const extractTitle = url => {
      try{
        const paths = new URL(url).pathname.split('/').filter(Boolean);
        const last = paths[paths.length-1] || '';
        return last.replace(/\.[^.]+$/,'') || new URL(url).hostname;
      }catch(_){ return url; }
    };

    const normalizeUrl = raw => {
      raw = (raw||'').trim();
      return raw && !/^https?:\/\//i.test(raw) ? 'https://' + raw : raw;
    };

    const renderHistory = () => {
      dom.historyList.innerHTML = '';
      if(!history.length){
        dom.historyList.innerHTML = '<li class="history-empty"><i class="far fa-folder-open"></i> 暂无播放历史</li>';
        dom.histCount.textContent = '0';
        return;
      }
      dom.histCount.textContent = history.length;

      const frag = document.createDocumentFragment();
      history.forEach(function(item, idx){
        const li = document.createElement('li');
        li.setAttribute('data-idx', idx);

        const span = document.createElement('span');
        span.className = 'url-text';
        span.title = item.url || '';
        span.textContent = item.dramaName || item.url;

        const btn = document.createElement('button');
        btn.className = 'act-icon';
        btn.title = '播放此视频';
        btn.innerHTML = '<i class="fas fa-play"></i>';

        li.appendChild(span); li.appendChild(btn);
        frag.appendChild(li);
      });
      dom.historyList.appendChild(frag);
    };

    const showToast = (msg, type) => {
      dom.toastMsg.textContent = msg;
      dom.toast.className = 'toast '+(type||'success')+' show';
      dom.toastIcon.className = type==='error' ? 'fas fa-exclamation-circle' : 'fas fa-check-circle';
      clearTimeout(dom.toast._t);
      dom.toast._t = setTimeout(function(){ dom.toast.classList.remove('show'); }, 2800);
    };

    const updateTime = () => {
      const n = new Date();
      dom.lastUpdated.textContent = ('0'+n.getHours()).slice(-2)+':'+('0'+n.getMinutes()).slice(-2);
    };

    

    const parseVideo = url => {
      url = normalizeUrl(url);
      if(!url){ showToast('请输入视频链接','error'); return; }
      dom.player.src = dom.apiSelect.value + encodeURIComponent(url) + '&autoplay=1';
      dom.status.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> 加载中...';
      saveToHistory(url);
      showToast('开始解析，请稍候...');
    };

    const saveToHistory = url => {
      const name = extractTitle(url);
      const dup = history.findIndex(function(h){ return h.url===url; });
      if(dup !== -1){
        const item = history.splice(dup,1)[0];
        item.lastPlayed = new Date().toISOString();
        item.apiUrl = dom.apiSelect.value;
        history.unshift(item);
      } else {
        history.unshift({ url, dramaName:name, apiUrl:dom.apiSelect.value, lastPlayed:new Date().toISOString() });
      }
      if(history.length > 20) history.pop();
      lsSetJson(STORAGE_KEY, history);
      renderHistory();
      updateTime();
    };

    

    dom.player.addEventListener('load', function(){
      dom.status.innerHTML = '<i class="fas fa-play-circle"></i> 视频播放中';
      showToast('解析成功！开始播放');
    });

    dom.player.addEventListener('error', function(){
      dom.status.innerHTML = '<i class="fas fa-exclamation-circle"></i> 加载失败，请尝试其他接口';
      showToast('加载失败，请切换解析接口重试', 'error');
    });

    dom.fullBtn.addEventListener('click', function(){
      const fn = dom.player.requestFullscreen || dom.player.mozRequestFullScreen
            || dom.player.webkitRequestFullscreen || dom.player.msRequestFullscreen;
      if(fn) fn.call(dom.player).catch(function(){});
    });

    dom.apiSelect.addEventListener('change', function(){
      lsSet('PLAY_VIP_API', dom.apiSelect.value || '');
    });

    dom.refreshBtn.addEventListener('click', function(){
      const src = dom.player.src;
      if(!src){ showToast('请先解析视频','error'); return; }
      dom.player.src = '';
      requestAnimationFrame(function(){ dom.player.src = src; showToast('播放器已刷新'); });
    });

    dom.parseBtn.addEventListener('click', function(){ parseVideo(dom.videoUrl.value); });

    dom.videoUrl.addEventListener('keydown', function(e){
      if(e.key==='Enter'){ e.preventDefault(); parseVideo(this.value); }
    });

    
    dom.tabNav.addEventListener('click', function(e){
      const btn = e.target.closest('.tab-btn');
      if(!btn) return;
      const target = btn.getAttribute('data-tab');
      $$('.tab-btn').forEach(function(b){ b.classList.remove('active'); });
      $$('.tab-panel').forEach(function(p){ p.classList.remove('active'); });
      btn.classList.add('active');
      $('#'+target+'-panel').classList.add('active');
    });

    
    dom.historyList.addEventListener('click', function(e){
      const btn = e.target.closest('.act-icon');
      if(!btn) return;
      const idx = +btn.closest('li').getAttribute('data-idx');
      const item = history[idx];
      if(!item) return;
      dom.videoUrl.value = item.url;
      if(item.apiUrl) dom.apiSelect.value = item.apiUrl;
      parseVideo(item.url);
    });

    dom.clearBtn.addEventListener('click', function(){
      if(!confirm('确定要清除所有历史记录吗？')) return;
      history = [];
      lsSetJson(STORAGE_KEY, []);
      renderHistory();
      showToast('历史记录已清除');
    });

    
    renderHistory();
    updateTime();

    if(history.length){
      dom.videoUrl.value = history[0].url;
      if(history[0].apiUrl && API_LIST.some(function(a){ return a.v===history[0].apiUrl; })){
        dom.apiSelect.value = history[0].apiUrl;
      }
    }
  });
})();


