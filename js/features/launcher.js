/* ══════════════════════════════════════════════════════════════════
   launcher.js —— 首页功能页
   · 打开站点先看到 7 个入口：聊天 / 抉择 / 运势占卜 / 重要日 /
     信封投递 / 问答 / 传讯
   · 点「聊天」才进入原本的聊天界面，左下角有个小房子可以退回功能页
   · 点其它功能：暂时收起首页，走原站自己的弹窗；弹窗关掉后自动回到
     功能页
   · 被搬到首页的那几项，从「高级功能」面板里隐去（不删原代码，
     只是藏起来，功能本身照旧可用）
   ══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const MOVED = [
    'decision-function',
    'fortune-lenormand-function',
    'anniversary-function',
    'envelope-function',
    'qa-function'
  ];

  const ITEMS = [
    { key: 'chat',        name: '聊天',     desc: '和 TA 说话，发字卡',        icon: 'fa-comment-dots',      tone: 'warm' },
    { key: 'moments',     name: '朋友圈',   desc: '你和 TA 的日常，都能发',     icon: 'fa-camera-retro',      tone: 'sky' },
    { key: 'decision',    name: '抉择',     desc: '抛硬币、转盘，替你做决定',   icon: 'fa-balance-scale',     tone: 'lilac', target: 'decision-function' },
    { key: 'fortune',     name: '运势占卜', desc: '今天会怎样，让牌说话',       icon: 'fa-star-and-crescent', tone: 'gold',  target: 'fortune-lenormand-function' },
    { key: 'anniversary', name: '重要日',   desc: '纪念日和倒计时',             icon: 'fa-heart',             tone: 'rose',  target: 'anniversary-function' },
    { key: 'envelope',    name: '信封投递', desc: '给 TA 写一封信',             icon: 'fa-envelope',          tone: 'ink',   target: 'envelope-function' },
    { key: 'qa',          name: '问答',     desc: '问一句，TA 回你一张字卡',     icon: 'fa-question-circle',   tone: 'mint',  target: 'qa-function' },
    { key: 'chuan',       name: '传讯',     desc: '请传讯师接通 TA 的能量',      icon: 'fa-moon',              tone: 'night' }
  ];

  const TONES = {
    warm:  ['#c25b3f', '#f7e7e0'],
    lilac: ['#6c5476', '#efe8f1'],
    gold:  ['#9a7b2f', '#f6efdc'],
    rose:  ['#a8556a', '#f8e8ec'],
    ink:   ['#4a4f55', '#eaedf0'],
    mint:  ['#4f7a63', '#e4f1ea'],
    night: ['#5b5a86', '#e9e8f4'],
    sky:   ['#4a7089', '#e6eff4']
  };

  let homeEl = null;
  let fabEl = null;
  let mode = 'home';          // home | chat | feature
  let watched = false;
  let featureTimer = null;

  // 这些弹窗不算「功能打开着」，不参与「关了就回首页」的判断
  const IGNORE_MODALS = ['disclaimer-modal', 'cx-chuan'];

  /* ── 样式 ── */

  function injectStyle() {
    if (document.getElementById('cx-launcher-style')) return;

    const css = `
/* 高级功能里被搬到首页的那几项，藏起来 */
${MOVED.map(id => '#' + id).join(',\n')} { display: none !important; }

#cx-home {
  position: fixed; inset: 0; z-index: 1000;
  background:
    linear-gradient(180deg, rgba(255,255,255,0.62) 0%, rgba(255,255,255,0.3) 45%, rgba(255,255,255,0.42) 100%),
    url('images/cx-home-bg.jpg') 50% 0% / cover no-repeat,
    #f1f7fd;
  display: flex; align-items: center; justify-content: center;
  padding: max(22px, env(safe-area-inset-top)) 18px max(18px, env(safe-area-inset-bottom));
  overflow-y: auto; -webkit-overflow-scrolling: touch;
}
#cx-home.cx-hide { display: none; }

.cx-home-inner { width: 100%; max-width: 440px; margin: auto; }

.cx-brand { text-align: center; margin-bottom: 24px; }
.cx-mark {
  width: 54px; height: 54px; margin: 0 auto 14px; border-radius: 16px;
  background: #c25b3f; color: #fff; line-height: 54px; font-size: 25px;
  font-family: "Noto Serif SC", "Songti SC", serif;
  box-shadow: 0 10px 26px rgba(194, 91, 63, .26);
}
.cx-brand h1 {
  margin: 0; font-size: 26px; font-weight: 600; letter-spacing: 6px; text-indent: 6px;
  font-family: "Noto Serif SC", "Songti SC", serif; color: #2b2723;
}
.cx-brand p { margin: 9px 0 0; font-size: 12px; color: #8a8178; letter-spacing: .5px; }

.cx-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

.cx-card {
  display: flex; flex-direction: column; gap: 9px;
  padding: 14px 13px; border-radius: 15px;
  background: #fff; border: 1px solid #ece3d8;
  box-shadow: 0 5px 18px rgba(120, 92, 70, .09);
  text-align: left; cursor: pointer;
  transition: transform .15s ease, box-shadow .15s ease;
}
.cx-card:active { transform: scale(.975); box-shadow: 0 2px 8px rgba(120, 92, 70, .10); }
.cx-card.cx-wide { grid-column: span 2; flex-direction: row; align-items: center; gap: 12px; }

.cx-ico {
  flex: none; width: 36px; height: 36px; border-radius: 11px;
  display: flex; align-items: center; justify-content: center; font-size: 14px;
}
.cx-name { display: block; font-size: 14px; font-weight: 600; color: #2b2723; letter-spacing: .3px; }
.cx-desc { display: block; font-size: 10.5px; color: #8a8178; line-height: 1.45; margin-top: 3px; }
.cx-body { flex: 1; min-width: 0; }

.cx-foot { margin-top: 18px; text-align: center; }
.cx-gear {
  border: none; background: none; color: #8a8178; font-size: 11.5px;
  padding: 8px 12px; cursor: pointer; font-family: inherit;
}
.cx-gear i { margin-right: 5px; font-size: 10.5px; }
.cx-note { display: block; margin-top: 6px; font-size: 10px; color: #b5aa9d; }

/* 聊天页左下角的回首页小按钮 */
#cx-fab {
  position: fixed; z-index: 900;
  left: 10px; bottom: calc(92px + env(safe-area-inset-bottom));
  width: 38px; height: 38px; border-radius: 50%;
  display: none; align-items: center; justify-content: center;
  border: 1px solid rgba(0,0,0,.06);
  background: rgba(255,255,255,.82);
  color: #7b7268; font-size: 13px;
  box-shadow: 0 4px 14px rgba(90, 70, 54, .16);
  backdrop-filter: blur(8px); cursor: pointer;
}
#cx-fab:active { transform: scale(.94); }
#cx-fab.cx-on { display: flex; }
`;

    const style = document.createElement('style');
    style.id = 'cx-launcher-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ── 构建首页 ── */

  function build() {
    homeEl = document.createElement('div');
    homeEl.id = 'cx-home';

    const cards = ITEMS.map(it => {
      const [fg, bg] = TONES[it.tone] || TONES.warm;
      if (it.key === 'chat') {
        return `
        <div class="cx-card cx-wide" data-key="${it.key}">
          <span class="cx-ico" style="color:${fg};background:${bg}"><i class="fas ${it.icon}"></i></span>
          <span class="cx-body">
            <span class="cx-name">${it.name}</span>
            <span class="cx-desc">${it.desc}</span>
          </span>
          <i class="fas fa-chevron-right" style="color:#c9bfb3;font-size:13px"></i>
        </div>`;
      }
      return `
      <div class="cx-card" data-key="${it.key}">
        <span class="cx-ico" style="color:${fg};background:${bg}"><i class="fas ${it.icon}"></i></span>
        <span class="cx-body">
          <span class="cx-name">${it.name}</span>
          <span class="cx-desc">${it.desc}</span>
        </span>
      </div>`;
    }).join('');

    homeEl.innerHTML = `
      <div class="cx-home-inner">
        <div class="cx-brand">
          <div class="cx-mark">伝</div>
          <h1>传讯</h1>
          <p>选一个地方，先开口</p>
        </div>
        <div class="cx-grid">${cards}</div>
        <div class="cx-foot">
          <button class="cx-gear" id="cx-open-settings"><i class="fas fa-sliders-h"></i>设置</button>
          <span class="cx-note">仅作情感陪伴 · 数据都存在这台设备上</span>
        </div>
      </div>`;

    document.body.appendChild(homeEl);

    homeEl.querySelectorAll('.cx-card').forEach(card => {
      card.addEventListener('click', () => go(card.dataset.key));
    });

    homeEl.querySelector('#cx-open-settings').addEventListener('click', () => {
      openFeature('settings-btn');
    });

    // 回首页的小按钮
    fabEl = document.createElement('button');
    fabEl.id = 'cx-fab';
    fabEl.innerHTML = '<i class="fas fa-house"></i>';
    fabEl.title = '回到功能页';
    fabEl.addEventListener('click', showHome);
    document.body.appendChild(fabEl);
  }

  /* ── 显示 / 隐藏 ── */

  /* 功能主页背景跟聊天页用同一张（读 --chat-bg-image） */
  function paintHomeBg() {
    try {
      if (!homeEl) return;
      var raw = (getComputedStyle(document.documentElement).getPropertyValue('--chat-bg-image') || '').trim();
      if (!raw) {
        try {
          var k = (typeof getStorageKey === 'function') ? getStorageKey('chatBackground') : '';
          raw = String((k && localStorage.getItem(k)) || '').trim();
        } catch (e) {}
      }
      if (!raw) return;                        // 没设背景就保留原来的米色
      if (/^url\(/i.test(raw) || /^https?:|^data:/i.test(raw)) {
        var u = (/^url\(/i.test(raw)) ? raw : 'url("' + raw + '")';
        homeEl.style.background = '';
        homeEl.style.backgroundImage = u;
        homeEl.style.backgroundSize = 'cover';
        homeEl.style.backgroundPosition = 'center';
        homeEl.style.backgroundRepeat = 'no-repeat';
        homeEl.style.backgroundColor = '#f7f3ec';
      } else {
        homeEl.style.background = raw;
      }
    } catch (e) {}
  }

  function showHome(keepMode) {
    if (!homeEl) build();
    /* 暂时不跟聊天背景同步，保持自己的水彩底 */
    try { homeEl.style.background = ''; homeEl.style.backgroundImage = ''; homeEl.style.backgroundColor = ''; homeEl.style.backgroundSize = ''; homeEl.style.backgroundPosition = ''; homeEl.style.backgroundRepeat = ''; } catch (e) {}
    if (!keepMode) mode = 'home';
    homeEl.classList.remove('cx-hide');
    fabEl.classList.remove('cx-on');
    // 首页上不该挂着「关于 & 声明」那个弹窗
    try {
      const disc = document.getElementById('disclaimer-modal');
      if (disc && getComputedStyle(disc).display !== 'none' && typeof hideModal === 'function') hideModal(disc);
    } catch (e) {}

  }

  function hideHome() {
    if (homeEl) homeEl.classList.add('cx-hide');
  }

  /* ── 点卡片 ── */

  function go(key) {
    if (key === 'chat') {
      mode = 'chat';
      hideHome();
      if (fabEl) fabEl.classList.add('cx-on');
      return;
    }

    if (key === 'moments') {
      mode = 'feature';
      showHome(true);
      if (window.Moments && typeof window.Moments.open === 'function') {
        window.Moments.open();
      } else {
        showHome();
        toast('朋友圈模块还没加载好');
      }
      return;
    }

    if (key === 'chuan') {
      mode = 'feature';
      showHome(true);
      if (window.Chuanxun && typeof window.Chuanxun.open === 'function') {
        window.Chuanxun.open();
      } else {
        showHome();
        toast('传讯模块还没加载好');
      }
      return;
    }

    const item = ITEMS.find(x => x.key === key);
    openFeature(item && item.target);
  }

  /** 打开某个原站入口，并在它关掉之后自动回功能页 */
  function openFeature(id) {
    const target = id ? document.getElementById(id) : null;
    if (!target) { toast('这个功能还没加载好'); return; }

    mode = 'feature';
    showHome(true);
    setTimeout(() => {
      try { target.click(); } catch (e) { console.warn('[launcher]', e); showHome(); }
    }, 80);

    // 兜底：要是这个功能 6 秒内没弹出任何东西，就退回功能页，别把人晾在黑屏
    clearTimeout(featureTimer);
    featureTimer = setTimeout(() => {
      if (mode === 'feature' && !anyVisibleModal()) showHome();
    }, 6000);
  }

  /* ── 等弹窗关掉再回首页 ── */

  function anyVisibleModal() {
    const modals = document.querySelectorAll('.modal');
    for (let i = 0; i < modals.length; i++) {
      const m = modals[i];
      if (IGNORE_MODALS.indexOf(m.id) >= 0) continue;
      const d = getComputedStyle(m).display;
      if (d && d !== 'none') return true;
    }
    return false;
  }

  function watchModals() {
    if (watched) return;
    watched = true;

    document.querySelectorAll('.modal').forEach(m => {
      new MutationObserver(() => {
        if (mode !== 'feature') return;
        setTimeout(() => {
          if (mode !== 'feature') return;
          if (!anyVisibleModal()) showHome();
        }, 420);
      }).observe(m, { attributes: true, attributeFilter: ['style', 'class'] });
    });
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:4000;' +
      'padding:9px 15px;border-radius:11px;background:rgba(35,29,24,.88);color:#fff;' +
      'font-size:12px;max-width:80vw;text-align:center;';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  /* ── 启动 ── */

  function start() {
    injectStyle();
    build();
    watchModals();

    const splash = document.getElementById('splash-declaration');
    const visible = splash && getComputedStyle(splash).display !== 'none'
      && !splash.classList.contains('splash-fade-out');

    if (!visible) { showHome(); return; }

    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      const s = document.getElementById('splash-declaration');
      const gone = !s || !document.body.contains(s)
        || s.classList.contains('splash-fade-out')
        || getComputedStyle(s).display === 'none';
      if (gone) { clearInterval(timer); setTimeout(showHome, 260); }
      else if (tries > 240) { clearInterval(timer); showHome(); }
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(start, 500));
  } else {
    setTimeout(start, 500);
  }

  window.CxLauncher = { showHome, hideHome };
})();
