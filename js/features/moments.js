/* ════════════════════════════════════════════════
   朋友圈（Moments）
   你和梦角都能发，数据只存在本机浏览器。
   - 你：文字 + 最多 3 张图（自动压到 720px，存 base64）
   - 梦角：自己随机发（日语原句 + 一行小字中文），也会给你点赞
   - 不依赖原站任何函数，纯前端扩展
   ════════════════════════════════════════════════ */
(function () {
  'use strict';

  var KEY = 'cx_moments_v1';       // 全部动态
  var MAX_KEEP = 120;              // 最多留 120 条，超了丢最旧的
  var MAX_IMG = 3;                 // 一条最多 3 张图
  var IMG_MAX_W = 720;             // 图片最长边
  var IMG_Q = 0.62;                // JPEG 质量

  var el = { root: null, list: null, scroller: null, input: null, imgs: null, overlay: null };
  var built = false;
  var picked = [];                 // 待发布的图片（base64 数组）
  var busy = false;

  /* ── 名字 ── */
  function names() {
    var s = {};
    try { if (typeof settings !== 'undefined' && settings) s = settings; } catch (e) {}
    var dmy = document.getElementById('my-name');
    var dpt = document.getElementById('partner-name');
    return {
      me: s.myName || (dmy && dmy.textContent.trim()) || '我',
      mj: s.partnerName || (dpt && dpt.textContent.trim()) || '梦角'
    };
  }

  /* 头像直接用聊天页那个（同一份数据，改一边两边都变） */
  function avatarOf(who) {
    var el = document.getElementById(who === 'mj' ? 'partner-avatar' : 'my-avatar');
    var img = el && el.querySelector('img');
    return img ? img.src : null;
  }

  /* 点头像 / 名字 → 打开原站自己的编辑弹窗（改完自动同步） */
  function openEditor(what, who) {
    var id = what === 'ava'
      ? (who === 'mj' ? 'partner-avatar' : 'my-avatar')
      : (who === 'mj' ? 'partner-name' : 'my-name');
    var el = document.getElementById(id);
    if (!el) { toast('聊天那边还没准备好，先回聊天页一次'); return; }
    try { el.click(); } catch (e) { toast('打不开设置'); return; }
    watchEditor();
  }

  /* 等编辑弹窗关掉，再把朋友圈重画一遍（名字/头像就跟着变了） */
  function watchEditor() {
    var opened = false, t0 = Date.now();
    var timer = setInterval(function () {
      var vis = Array.prototype.some.call(document.querySelectorAll('.modal'), function (m) {
        if (m.id === 'disclaimer-modal' || m.id === 'cx-chuan') return false;
        var d = getComputedStyle(m).display;
        return d && d !== 'none';
      });
      if (vis) opened = true;
      if (opened && !vis) { clearInterval(timer); render(); }
      if (!opened && Date.now() - t0 > 3000) { clearInterval(timer); render(); }
    }, 300);
  }

  /* ── 存取 ── */
  function load() {
    try {
      var a = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }

  function save(list) {
    if (list.length > MAX_KEEP) list = list.slice(0, MAX_KEEP);
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      // 存不下了（多半是图太多）：砍掉后面一半再试一次
      var half = list.slice(0, Math.max(10, Math.floor(list.length / 2)));
      try { localStorage.setItem(KEY, JSON.stringify(half)); } catch (e2) {}
      toast('本地空间不够，旧的几条先清掉了');
      return false;
    }
  }

  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'cxm-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('cxm-toast-out'); }, 1800);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2400);
  }

  /* ── 时间 ── */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function ago(ts) {
    var d = Date.now() - ts;
    if (d < 60e3) return '刚刚';
    if (d < 3600e3) return Math.floor(d / 60e3) + ' 分钟前';
    var dt = new Date(ts);
    var now = new Date();
    if (dt.toDateString() === now.toDateString()) return '今天 ' + pad(dt.getHours()) + ':' + pad(dt.getMinutes());
    var y = new Date(now.getTime() - 864e5);
    if (dt.toDateString() === y.toDateString()) return '昨天 ' + pad(dt.getHours()) + ':' + pad(dt.getMinutes());
    return (dt.getMonth() + 1) + '月' + dt.getDate() + '日 ' + pad(dt.getHours()) + ':' + pad(dt.getMinutes());
  }

  function uid() { return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  /* ── 兜底句池（你自己的字卡库为空时才用） ── */
  var CN_POOL = [
    '今天很安静，适合什么都不做。',
    '窗外的光很好，坐了一会儿。',
    '睡了很久，醒来还是想睡。',
    '热水洗过手，才觉得冷。',
    '路上没几个人，风从后面来。',
    '吃饭的时候，想起你还没吃。',
    '今天没什么事，就是普通的今天。',
    '房间很暗，只留了一盏灯。',
    '有点困，但还不想睡。',
    '下午下了很久的雨，没出门。',
    '把该做的做完了，剩下的明天。',
    '就这样过着，也挺好。'
  ];

  /* ── 字卡库：优先用「自定义回复」里你囤的那些 ── */
  function cardsPool() {
    try {
      var arr = window._customReplies;
      if (Array.isArray(arr)) {
        var list = arr.map(function (x) { return String(x == null ? '' : x).trim(); }).filter(Boolean);
        if (list.length) return list;
      }
    } catch (e) {}
    return CN_POOL;
  }

  /* ── 图片压缩 ── */
  function compress(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        var img = new Image();
        img.onload = function () {
          var w = img.width || 1, h = img.height || 1;
          var max = Math.max(w, h);
          if (max > IMG_MAX_W) {
            var r = IMG_MAX_W / max;
            w = Math.round(w * r);
            h = Math.round(h * r);
          }
          var c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          try { resolve(c.toDataURL('image/jpeg', IMG_Q)); }
          catch (e) { reject(e); }
        };
        img.onerror = reject;
        img.src = fr.result;
      };
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  /* ── 渲染 ── */
  function render() {
    var n = names();
    var list = load();

    if (!list.length) {
      el.list.innerHTML = '<div class="cxm-empty"><i class="far fa-image"></i><p>还没有动态</p><span>发第一条，等 TA 看见</span></div>';
      return;
    }

    var html = list.map(function (p) {
      var isMJ = p.who === 'mj';
      var name = isMJ ? n.mj : n.me;
      var initial = (name || '?').slice(0, 1);
      var imgs = (p.imgs && p.imgs.length)
        ? '<div class="cxm-pics">' + p.imgs.map(function (src) {
            return '<img src="' + src + '" data-full="1" alt="">';
          }).join('') + '</div>'
        : '';
      var body = '';
      if (p.card) {
        body = '<div class="cxm-card"><span class="cxm-card-mark">“</span><p>' + esc(p.text) + '</p><span class="cxm-card-seal">伝</span></div>';
      } else if (p.text) {
        body = '<div class="cxm-text">' + esc(p.text) + '</div>';
      }
      var likeCls = p.liked ? 'cxm-like on' : 'cxm-like';
      var heart = p.liked ? 'fas fa-heart' : 'far fa-heart';
      var likes = p.likes ? p.likes : 0;

      return '' +
        '<article class="cxm-post" data-id="' + p.id + '">' +
          '<div class="cxm-headrow">' +
            '<span class="cxm-ava' + (isMJ ? ' mj' : '') + '" data-edit="ava" data-who="' + (isMJ ? 'mj' : 'me') + '">' +
              (avatarOf(p.who) ? '<img src="' + avatarOf(p.who) + '" alt="">' : esc(initial)) +
            '</span>' +
            '<span class="cxm-who">' +
              '<span class="cxm-name" data-edit="name" data-who="' + (isMJ ? 'mj' : 'me') + '">' + esc(name) + '</span>' +
              '<span class="cxm-time">' + ago(p.ts) + '</span>' +
            '</span>' +
            '<button class="cxm-del" data-del="1" title="删除"><i class="fas fa-times"></i></button>' +
          '</div>' +
          body +
          imgs +
          '<div class="cxm-foot">' +
            '<button class="' + likeCls + '" data-like="1">' +
              '<i class="' + heart + '"></i><span>' + (likes ? likes : '') + '</span>' +
            '</button>' +
          '</div>' +
        '</article>';
    }).join('');

    el.list.innerHTML = html;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/\n/g, '<br>');
  }

  /* ── 点赞 / 删除 ── */
  function onListClick(e) {
    var editEl = e.target.closest ? e.target.closest('[data-edit]') : null;
    if (editEl) {
      openEditor(editEl.getAttribute('data-edit'), editEl.getAttribute('data-who'));
      return;
    }

    var likeBtn = e.target.closest ? e.target.closest('[data-like]') : null;
    var delBtn = e.target.closest ? e.target.closest('[data-del]') : null;

    if (likeBtn) {
      var post = likeBtn.closest('.cxm-post');
      var id = post && post.getAttribute('data-id');
      var list = load();
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) {
          list[i].liked = !list[i].liked;
          list[i].likes = Math.max(0, (list[i].likes || 0) + (list[i].liked ? 1 : -1));
          break;
        }
      }
      save(list);
      render();
      return;
    }

    if (delBtn) {
      var p2 = delBtn.closest('.cxm-post');
      var id2 = p2 && p2.getAttribute('data-id');
      if (!id2) return;
      if (!confirm('删掉这条动态？')) return;
      var l2 = load().filter(function (x) { return x.id !== id2; });
      save(l2);
      render();
    }
  }

  /* ── 发布 ── */
  function publish() {
    if (busy) return;
    var text = (el.input && el.input.value || '').trim();
    if (!text && !picked.length) { toast('写点什么，或者加张图'); return; }

    busy = true;
    var list = load();
    list.unshift({
      id: uid(),
      who: 'me',
      text: text,
      imgs: picked.slice(),
      ts: Date.now(),
      likes: 0,
      liked: false
    });
    save(list);

    el.input.value = '';
    picked = [];
    renderPicked();
    closeComposer();
    render();
    busy = false;
    if (el.scroller) el.scroller.scrollTop = 0;

    reactAfterPublish();
  }

  /* 你发完，TA 的反应：点赞 / 自己也发一条 */
  function reactAfterPublish() {
    setTimeout(function () {
      if (Math.random() < 0.5) mjLikeMine();
    }, 2000 + Math.random() * 2000);

    setTimeout(function () {
      if (Math.random() < 0.38) mjPost(Math.random() < 0.45 ? 'ai' : 'card');
    }, 4200 + Math.random() * 4000);
  }

  function mjLikeMine() {
    var list = load();
    for (var i = 0; i < list.length; i++) {
      if (list[i].who === 'me') {
        list[i].likes = (list[i].likes || 0) + 1;
        save(list);
        render();
        return;
      }
    }
  }

  /* 抽一张字卡当动态 */
  function cardPost() {
    var pool = cardsPool();
    var pick = pool[Math.floor(Math.random() * pool.length)] || '';
    return { text: String(pick).slice(0, 160), card: true };
  }

  function pushMJ(data) {
    if (!data || !data.text) return;
    var list = load();
    list.unshift({
      id: uid(),
      who: 'mj',
      text: data.text,
      card: !!data.card,
      imgs: [],
      ts: Date.now(),
      likes: 0,
      liked: false
    });
    save(list);
    render();
  }

  /* 让 TA 发一条：kind = 'card'（抽字卡）| 'ai'（现场写一句，失败就退回字卡） */
  function mjPost(kind) {
    if (kind !== 'ai') { pushMJ(cardPost()); return; }
    aiMoment().then(function (text) {
      pushMJ(text ? { text: text, card: false } : cardPost());
    });
  }

  /* ── AI：接着最近的动态写一句 ── */

  function aiCfg() {
    try {
      var c = JSON.parse(localStorage.getItem('cx_chuan_cfg') || '{}') || {};
      if (!c || !c.key) return null;
      return {
        url: c.url || 'https://api.deepseek.com/chat/completions',
        key: c.key,
        model: c.model || 'deepseek-chat'
      };
    } catch (e) { return null; }
  }

  function recentLines(n) {
    var list = load().slice(0, n);
    var nm = names();
    return list.map(function (p) {
      var t = String(p.text || '').replace(/\n/g, ' ').slice(0, 60);
      return (p.who === 'mj' ? nm.mj : nm.me) + '：' + t;
    }).join('\n');
  }

  function aiMoment() {
    var cfg = aiCfg();
    if (!cfg) return Promise.resolve(null);

    var nm = names();
    var sys = '你在替一个人写他自己朋友圈里的动态。用第一人称，写他自己这一天的某个具体细节。'
            + '要求：中文；一句话；25 字以内；口吻安静、克制、话少；不用感叹号，不用表情符号，不加引号；'
            + '不要称呼任何人，不要出现别人的名字，不要对着谁说话；不要腻，不要空泛抒情；只输出这句话本身。';
    var user = '这个人叫：' + nm.mj +
               '\n最近发生的事（可以参考，也可以写别的）：\n' + (recentLines(5) || '（还没有）') +
               '\n\n写一条新的。';

    return fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
        temperature: 1.0,
        max_tokens: 90
      })
    }).then(function (r) { return r.json(); }).then(function (j) {
      var t = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (!t) return null;
      t = String(t).replace(/^[\s"'“”「」]+|[\s"'“”「」]+$/g, '').split('\n')[0].trim();
      return t ? t.slice(0, 44) : null;
    }).catch(function () { return null; });
  }

  /* 打开时，如果 TA 很久没发过，可能冒一条 */
  function maybeOnOpen() {
    var list = load();
    var lastMJ = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].who === 'mj') { lastMJ = list[i]; break; }
    }
    if (lastMJ && Date.now() - lastMJ.ts < 90 * 60 * 1000) return;
    if (Math.random() > 0.55) return;
    setTimeout(function () { mjPost(Math.random() < 0.2 ? 'ai' : 'card'); }, 900 + Math.random() * 900);
  }

  /* ── 发布面板 ── */
  function openComposer() {
    if (!el.overlay) return;
    el.overlay.classList.remove('cxm-off');
    setTimeout(function () { if (el.input) el.input.focus(); }, 200);
  }

  function closeComposer() {
    if (el.overlay) el.overlay.classList.add('cxm-off');
  }

  function renderPicked() {
    if (!el.imgs) return;
    el.imgs.innerHTML = picked.map(function (src, i) {
      return '<div class="cxm-thumb"><img src="' + src + '" alt=""><button data-pick-del="' + i + '"><i class="fas fa-times"></i></button></div>';
    }).join('');
    el.imgs.style.display = picked.length ? 'grid' : 'none';
  }

  function pickFiles(files) {
    var room = MAX_IMG - picked.length;
    if (room <= 0) { toast('一条最多 ' + MAX_IMG + ' 张图'); return; }
    var arr = Array.prototype.slice.call(files || []).slice(0, room);
    if (!arr.length) return;
    Promise.all(arr.map(compress)).then(function (b64s) {
      picked = picked.concat(b64s);
      renderPicked();
      if (files.length > room) toast('一条最多 ' + MAX_IMG + ' 张图');
    }).catch(function () {
      toast('这张图读不出来，换一张试试');
    });
  }

  /* ── 样式 ── */
  function injectStyle() {
    if (document.getElementById('cxm-style')) return;

    var css = [
      '#cx-moments {',
      '  position: fixed; inset: 0; z-index: 1900;',
      '  background: linear-gradient(180deg, #fdf9f4 0%, #f8f1e8 100%);',
      '  display: flex; flex-direction: column;',
      '  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;',
      '}',
      '#cx-moments.cxm-off { display: none; }',

      '.cxm-head { flex: 0 0 auto; display: flex; align-items: center; gap: 10px;',
      '  padding: max(12px, env(safe-area-inset-top)) 16px 12px; background: rgba(253,249,244,.92);',
      '  border-bottom: 1px solid #efe5d8; backdrop-filter: blur(8px); }',
      '.cxm-back { width: 32px; height: 32px; border: none; background: transparent; color: #8a7a68; font-size: 16px; cursor: pointer; flex: 0 0 auto; }',
      '.cxm-title { flex: 1 1 auto; font-size: 15px; font-weight: 700; color: #3f362d; letter-spacing: .5px; }',
      '.cxm-new { border: 1px solid #e0cbb6; background: #fff; color: #b04e33; border-radius: 999px;',
      '  padding: 6px 13px; font-size: 12px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 5px; }',
      '.cxm-new:active { background: #faf3ea; }',

      '.cxm-list { flex: 1 1 auto; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 14px 14px 40px; }',
      '.cxm-scroll { width: 100%; max-width: 620px; margin: 0 auto; }',

      '.cxm-post { background: #fff; border: 1px solid #f0e6d9; border-radius: 16px; padding: 14px 14px 8px; margin-bottom: 12px;',
      '  box-shadow: 0 2px 10px rgba(140,110,85,.05); }',
      '.cxm-headrow { display: flex; align-items: flex-start; gap: 9px; }',
      '.cxm-ava { width: 34px; height: 34px; border-radius: 50%; flex: 0 0 auto; display: flex; align-items: center; justify-content: center;',
      '  font-size: 14px; font-weight: 700; color: #fff; background: #c25b3f; }',
      '.cxm-ava.mj { background: #5b5a86; }',
      '.cxm-ava img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; display: block; }',
      '.cxm-ava, .cxm-name { cursor: pointer; }',
      '.cxm-ava:active, .cxm-name:active { opacity: .7; }',
      '.cxm-who { display: flex; flex-direction: column; min-width: 0; }',
      '.cxm-name { font-size: 13px; font-weight: 700; color: #3f362d; }',
      '.cxm-time { display: block; font-size: 11px; color: #a2937f; margin-top: 2px; }',
      '.cxm-del { margin-left: auto; border: none; background: transparent; color: #cfc2b1; font-size: 11px; padding: 4px; cursor: pointer; }',
      '.cxm-del:active { color: #b04e33; }',

      '.cxm-text { font-size: 14px; line-height: 1.75; color: #332b24; margin: 10px 2px 0; word-break: break-word; white-space: normal; }',
      '.cxm-tr { font-size: 11.5px; line-height: 1.7; color: #b3a390; margin: 6px 2px 0; }',
      '.cxm-card { margin-top: 10px; padding: 30px 26px 34px; border-radius: 12px; position: relative;',
      '  background: linear-gradient(180deg, #fffdf8 0%, #f9f2e6 100%); border: 1px solid #eee1cf;',
      '  box-shadow: inset 0 0 0 1px rgba(255,255,255,.65); }',
      '.cxm-card p { margin: 0; font-size: 15px; line-height: 2.05; color: #3a3129; text-align: center;',
      '  font-family: "Songti SC", "STSong", "SimSun", serif; letter-spacing: .8px; word-break: break-word; }',
      '.cxm-card-mark { position: absolute; left: 14px; top: 6px; font-size: 30px; line-height: 1;',
      '  color: #dfcdb4; font-family: Georgia, "Times New Roman", serif; }',
      '.cxm-card-seal { position: absolute; right: 12px; bottom: 10px; width: 22px; height: 22px;',
      '  border: 1px solid rgba(194,91,63,.65); border-radius: 3px; display: flex; align-items: center;',
      '  justify-content: center; font-size: 10px; color: rgba(194,91,63,.8); }',
      '.cxm-pics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 10px; }',
      '.cxm-pics img { width: 100%; aspect-ratio: 1 / 1; object-fit: cover; border-radius: 10px; display: block; }',
      '.cxm-foot { display: flex; justify-content: flex-end; padding: 6px 0 2px; }',
      '.cxm-like { border: none; background: transparent; color: #a2937f; font-size: 12px; display: flex; align-items: center; gap: 5px; cursor: pointer; padding: 4px 6px; }',
      '.cxm-like.on { color: #c25b3f; }',
      '.cxm-like span { min-width: 8px; }',

      '.cxm-empty { text-align: center; padding: 80px 20px; color: #a2937f; }',
      '.cxm-empty i { font-size: 34px; color: #d9cbbb; display: block; margin-bottom: 14px; }',
      '.cxm-empty p { font-size: 14px; margin: 0 0 6px; }',
      '.cxm-empty span { font-size: 12px; color: #bcae9b; }',

      /* 发布面板 */
      '.cxm-sheet { position: fixed; inset: 0; z-index: 3400; background: rgba(38,30,24,.42);',
      '  display: flex; align-items: flex-end; justify-content: center; }',
      '.cxm-sheet.cxm-off { display: none; }',
      '.cxm-sheet-body { width: 100%; max-width: 620px; background: #fffdfa; border-radius: 18px 18px 0 0;',
      '  padding: 16px 16px calc(16px + env(safe-area-inset-bottom)); max-height: 82vh; display: flex; flex-direction: column; }',
      '.cxm-sheet-t { font-size: 14px; font-weight: 700; color: #3f362d; margin-bottom: 12px; }',
      '.cxm-ta { width: 100%; min-height: 96px; max-height: 38vh; border: 1px solid #eee2d3; border-radius: 12px;',
      '  padding: 10px 12px; font-size: 14px; line-height: 1.7; color: #332b24; resize: none; outline: none; background: #fdfaf6; }',
      '.cxm-ta:focus { border-color: #e2c7ae; }',
      '.cxm-thumbs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 10px; }',
      '.cxm-thumb { position: relative; }',
      '.cxm-thumb img { width: 100%; aspect-ratio: 1 / 1; object-fit: cover; border-radius: 10px; display: block; }',
      '.cxm-thumb button { position: absolute; top: 4px; right: 4px; width: 20px; height: 20px; border-radius: 50%;',
      '  border: none; background: rgba(0,0,0,.45); color: #fff; font-size: 10px; cursor: pointer; }',
      '.cxm-tools { display: flex; align-items: center; gap: 10px; margin-top: 12px; }',
      '.cxm-pick { border: 1px dashed #e0cfba; background: #fdf7f0; color: #9a8368; border-radius: 10px;',
      '  padding: 8px 12px; font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 6px; }',
      '.cxm-hint { font-size: 11px; color: #b3a390; margin-left: auto; }',
      '.cxm-actions { display: flex; gap: 10px; margin-top: 14px; }',
      '.cxm-cancel { flex: 0 0 96px; padding: 12px 0; border-radius: 12px; border: 1px solid #eee2d3; background: #fff; color: #8a7a68; font-size: 13px; cursor: pointer; }',
      '.cxm-post-btn { flex: 1 1 auto; padding: 12px 0; border-radius: 12px; border: none; background: #c25b3f; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer; }',
      '.cxm-post-btn:disabled { opacity: .5; }',

      '.cxm-toast { position: fixed; left: 50%; bottom: 90px; transform: translateX(-50%); z-index: 3600;',
      '  background: rgba(48,38,30,.9); color: #fff; font-size: 12px; padding: 9px 15px; border-radius: 999px;',
      '  transition: opacity .4s; max-width: 80vw; text-align: center; }',
      '.cxm-toast.cxm-toast-out { opacity: 0; }',

      /* 大图预览 */
      '.cxm-viewer { position: fixed; inset: 0; z-index: 3700; background: rgba(18,14,11,.94);',
      '  display: none; align-items: center; justify-content: center; padding: 20px; }',
      '.cxm-viewer.on { display: flex; }',
      '.cxm-viewer img { max-width: 100%; max-height: 100%; border-radius: 8px; }'
    ].join('\n');

    var s = document.createElement('style');
    s.id = 'cxm-style';
    s.textContent = css;
    document.head.appendChild(s);
  }

  /* ── 构建界面 ── */
  function build() {
    injectStyle();

    var root = document.createElement('div');
    root.id = 'cx-moments';
    root.className = 'cxm-off';

    root.innerHTML = '' +
      '<div class="cxm-head">' +
        '<button class="cxm-back" id="cxm-close"><i class="fas fa-chevron-left"></i></button>' +
        '<span class="cxm-title">朋友圈</span>' +
        '<button class="cxm-new" id="cxm-open"><i class="fas fa-pen"></i>发一条</button>' +
      '</div>' +
      '<div class="cxm-list" id="cxm-list"><div class="cxm-scroll" id="cxm-scroll"></div></div>';

    document.body.appendChild(root);
    el.root = root;
    el.scroller = document.getElementById('cxm-list');
    el.list = document.getElementById('cxm-scroll');
    el.list.addEventListener('click', onListClick);

    // 图片全屏看
    var viewer = document.createElement('div');
    viewer.className = 'cxm-viewer';
    viewer.id = 'cxm-viewer';
    viewer.innerHTML = '<img alt="">';
    document.body.appendChild(viewer);
    viewer.addEventListener('click', function () { viewer.classList.remove('on'); });

    el.list.addEventListener('click', function (e) {
      if (e.target && e.target.tagName === 'IMG' && e.target.closest('.cxm-pics')) {
        var v = document.getElementById('cxm-viewer');
        v.querySelector('img').src = e.target.src;
        v.classList.add('on');
      }
    });

    // 发布面板
    var sheet = document.createElement('div');
    sheet.className = 'cxm-sheet cxm-off';
    sheet.innerHTML = '' +
      '<div class="cxm-sheet-body">' +
        '<div class="cxm-sheet-t">发一条动态</div>' +
        '<textarea class="cxm-ta" id="cxm-ta" placeholder="今天想留下的一句话…"></textarea>' +
        '<div class="cxm-thumbs" id="cxm-thumbs" style="display:none"></div>' +
        '<div class="cxm-tools">' +
          '<button class="cxm-pick" id="cxm-pick"><i class="far fa-image"></i>加图片</button>' +
          '<span class="cxm-hint" id="cxm-hint">最多 3 张</span>' +
        '</div>' +
        '<div class="cxm-actions">' +
          '<button class="cxm-cancel" id="cxm-cancel">取消</button>' +
          '<button class="cxm-post-btn" id="cxm-do-post">发布</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(sheet);
    el.overlay = sheet;
    el.input = sheet.querySelector('#cxm-ta');
    el.imgs = sheet.querySelector('#cxm-thumbs');

    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.multiple = true;
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    // 事件
    document.getElementById('cxm-close').addEventListener('click', hide);
    document.getElementById('cxm-open').addEventListener('click', openComposer);
    document.getElementById('cxm-cancel').addEventListener('click', closeComposer);
    document.getElementById('cxm-do-post').addEventListener('click', publish);

    document.getElementById('cxm-pick').addEventListener('click', function () {
      fileInput.value = '';
      fileInput.click();
    });

    fileInput.addEventListener('change', function () { pickFiles(fileInput.files); });

    el.imgs.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-pick-del]') : null;
      if (!btn) return;
      picked.splice(parseInt(btn.getAttribute('data-pick-del'), 10), 1);
      renderPicked();
    });

    // 点遮罩关掉发布面板
    sheet.addEventListener('click', function (e) {
      if (e.target === sheet) closeComposer();
    });

    built = true;
  }

  /* ── 打开 / 关闭 ── */
  function open() {
    if (!built) build();
    el.root.classList.remove('cxm-off');
    el.scroller.scrollTop = 0;
    render();
    maybeOnOpen();
  }

  function hide() {
    if (el.root) el.root.classList.add('cxm-off');
    closeComposer();
  }

  /* ── 对外 ── */
  window.Moments = { open: open, close: hide };

  // 站点可能还没到 DOM 完，等一等再什么都不做（build 在第一次 open 时才跑）
})();
