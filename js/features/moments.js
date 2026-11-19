/* ════════════════════════════════════════════════
   朋友圈（Moments）· 微信朋友圈样式
   - 顶部封面：跟聊天页背景是同一份（改这边聊天页也变，反之亦然）
   - 头像 / 名字：直接用聊天页那一份，点一下就能改
   - 你：文字 + 最多 3 张图；梦角：字卡为主，偶尔 AI 现写一句
   - 纯前端扩展，不动原站任何逻辑
   ════════════════════════════════════════════════ */
(function () {
  'use strict';

  var KEY = 'cx_moments_v1';       // 全部动态
  var MAX_KEEP = 120;              // 最多留 120 条
  var MAX_IMG = 3;                 // 一条最多 3 张图
  var IMG_MAX_W = 720;             // 动态图片最长边
  var BG_MAX_W = 1600;             // 背景图最长边
  var IMG_Q = 0.62;

  var el = { root: null, list: null, scroller: null, feed: null, cover: null,
             input: null, imgs: null, overlay: null, bgSheet: null, bgInput: null };
  var built = false;
  var picked = [];
  var busy = false;

  /* ── 名字 / 头像：跟聊天页共用同一份 ── */
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

  function avatarOf(who) {
    var node = document.getElementById(who === 'mj' ? 'partner-avatar' : 'my-avatar');
    var img = node && node.querySelector('img');
    return img ? img.src : null;
  }

  function openEditor(what, who) {
    var id = what === 'ava'
      ? (who === 'mj' ? 'partner-avatar' : 'my-avatar')
      : (who === 'mj' ? 'partner-name' : 'my-name');
    var node = document.getElementById(id);
    if (!node) { toast('聊天那边还没准备好，先回聊天页一次'); return; }
    try { node.click(); } catch (e) { toast('打不开设置'); return; }
    watchEditor();
  }

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

  /* ── 背景：就是聊天页那张（CSS 变量 --chat-bg-image） ── */
  function currentBg() {
    try {
      return (getComputedStyle(document.documentElement).getPropertyValue('--chat-bg-image') || '').trim();
    } catch (e) { return ''; }
  }

  /* 拼聊天背景的存储键（原站 getStorageKey 在闭包里拿不到，按同样规则拼） */
  function bgKey() {
    try {
      if (typeof APP_PREFIX !== 'undefined' && typeof SESSION_ID !== 'undefined' && SESSION_ID) {
        return APP_PREFIX + SESSION_ID + '_chatBackground';
      }
    } catch (e) {}
    return null;
  }

  /* 写背景 → 聊天页和朋友圈同时生效 */
  function setChatBg(value) {
    var root = document.documentElement;
    var k = bgKey();

    if (!value) {
      root.style.removeProperty('--chat-bg-image');
      document.body.classList.remove('with-background');
      if (k) {
        try { localStorage.removeItem(k); } catch (e) {}
        try { localforage.removeItem(k); } catch (e) {}
      }
      renderCover();
      return;
    }

    var isColor = /^(#|rgb|hsl)/.test(value);
    var css = isColor ? value : (/^url\(/.test(value) ? value : 'url(' + value + ')');
    root.style.setProperty('--chat-bg-image', css);
    document.body.classList.add('with-background');

    if (k) {
      try { localStorage.setItem(k, value); } catch (e) {}
      try { localforage.setItem(k, value); } catch (e) {}
    }
    renderCover();
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
  function compress(file, maxW, quality) {
    maxW = maxW || IMG_MAX_W;
    quality = quality || IMG_Q;
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        var img = new Image();
        img.onload = function () {
          var w = img.width || 1, h = img.height || 1;
          var max = Math.max(w, h);
          if (max > maxW) {
            var r = maxW / max;
            w = Math.round(w * r);
            h = Math.round(h * r);
          }
          var c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          try { resolve(c.toDataURL('image/jpeg', quality)); }
          catch (e) { reject(e); }
        };
        img.onerror = reject;
        img.src = fr.result;
      };
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  /* ── 渲染：封面 ── */
  function renderCover() {
    if (!el.cover) return;
    var n = names();
    var bg = currentBg();

    el.cover.style.background = '';
    el.cover.style.backgroundImage = '';
    el.cover.classList.remove('cxm-cover-default');

    if (!bg) {
      el.cover.classList.add('cxm-cover-default');
    } else if (/^(#|rgb|hsl)/.test(bg)) {
      el.cover.style.background = bg;
    } else {
      el.cover.style.backgroundImage = bg;
      el.cover.style.backgroundSize = 'cover';
      el.cover.style.backgroundPosition = 'center';
      el.cover.style.backgroundRepeat = 'no-repeat';
    }

    var nameEl = el.cover.querySelector('.cxm-me-name');
    if (nameEl) nameEl.textContent = n.me;

    var avaEl = el.cover.querySelector('.cxm-me-ava');
    if (avaEl) {
      var src = avatarOf('me');
      avaEl.innerHTML = src ? '<img src="' + src + '" alt="">' : esc(n.me.slice(0, 1));
    }
  }

  /* 重画前把正在写的评论存一下，重画后放回去 */
  function snapInputs() {
    var open = {}, vals = {};
    Array.prototype.forEach.call(document.querySelectorAll('.cxm-cinput'), function (inp) {
      var id = inp.getAttribute('data-cid');
      if (!id) return;
      vals[id] = inp.value;
      var wrap = inp.closest('.cxm-cwrap');
      if (wrap && wrap.classList.contains('on')) open[id] = 1;
    });
    return { open: open, vals: vals };
  }

  function restoreInputs(snap) {
    if (!snap) return;
    Array.prototype.forEach.call(document.querySelectorAll('.cxm-cinput'), function (inp) {
      var id = inp.getAttribute('data-cid');
      if (!id) return;
      if (snap.vals[id]) inp.value = snap.vals[id];
      var wrap = inp.closest('.cxm-cwrap');
      if (snap.open[id] && wrap) { wrap.classList.add('on'); }
    });
  }

  /* ── 渲染：动态列表 ── */
  function render() {
    var snap = snapInputs();
    renderCover();
    if (!el.feed) return;

    var n = names();
    var list = load();

    if (!list.length) {
      el.feed.innerHTML = '<div class="cxm-empty"><i class="far fa-image"></i><p>还没有动态</p><span>发第一条，等 TA 看见</span></div>';
      return;
    }

    var html = list.map(function (p) {
      var isMJ = p.who === 'mj';
      var name = isMJ ? n.mj : n.me;
      var avaSrc = avatarOf(p.who);
      var pics = '';
      if (p.imgs && p.imgs.length) {
        pics = '<div class="cxm-pics' + (p.imgs.length === 1 ? ' one' : '') + '">' +
          p.imgs.map(function (src) { return '<img src="' + src + '" alt="">'; }).join('') +
        '</div>';
      }
      var body = '';
      if (p.card) {
        body = '<div class="cxm-card"><span class="cxm-card-mark">“</span><p>' + esc(p.text) + '</p><span class="cxm-card-seal">伝</span></div>';
      } else if (p.text) {
        body = '<div class="cxm-text">' + esc(p.text) + '</div>';
      }
      // 点赞的人（兼容只有 liked/likes 的旧数据）
      var likedBy = p.likedBy || (p.liked ? ['me'] : []);
      var liked = likedBy.indexOf('me') > -1;
      var likesRow = likedBy.length
        ? '<div class="cxm-likes"><i class="fas fa-heart"></i>' + likedBy.map(function (w) {
            var nm3 = (w === 'mj') ? n.mj : n.me;
            var src3 = avatarOf(w);
            return '<span class="cxm-liker">' +
              (src3 ? '<img src="' + src3 + '" alt="">' : '<span class="cxm-liker-t">' + esc(nm3.slice(0, 1)) + '</span>') +
              esc(nm3) + '</span>';
          }).join('') + '</div>'
        : '';

      // 评论
      var comments = (p.comments || []).map(function (c) {
        var cn = (c.who === 'mj') ? n.mj : n.me;
        return '<div class="cxm-cmt"><span class="cxm-cname">' + esc(cn) + '</span>：' + esc(c.text) + '</div>';
      }).join('');
      var cmtBlock = comments ? '<div class="cxm-cmts">' + comments + '</div>' : '';

      return '' +
        '<article class="cxm-item" data-id="' + p.id + '">' +
          '<span class="cxm-ava" data-edit="ava" data-who="' + (isMJ ? 'mj' : 'me') + '">' +
            (avaSrc ? '<img src="' + avaSrc + '" alt="">' : esc(name.slice(0, 1))) +
          '</span>' +
          '<div class="cxm-main">' +
            '<span class="cxm-name" data-edit="name" data-who="' + (isMJ ? 'mj' : 'me') + '">' + esc(name) + '</span>' +
            body + pics +
            '<div class="cxm-row">' +
              '<span class="cxm-time">' + ago(p.ts) + '</span>' +
              '<button class="cxm-del" data-del="1" title="删除"><i class="fas fa-times"></i></button>' +
              '<button class="cxm-cbtn" data-comment="1">评论</button>' +
              '<button class="cxm-like' + (liked ? ' on' : '') + '" data-like="1">' +
                '<i class="' + (liked ? 'fas fa-heart' : 'far fa-heart') + '"></i>' +
              '</button>' +
            '</div>' +
            likesRow + cmtBlock +
            '<div class="cxm-cwrap" data-cwrap="1">' +
              '<input class="cxm-cinput" data-cid="' + p.id + '" placeholder="说点什么…">' +
              '<button class="cxm-csend" data-csend="1">发送</button>' +
            '</div>' +
          '</div>' +
        '</article>';
    }).join('');

    el.feed.innerHTML = html;
    restoreInputs(snap);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/\n/g, '<br>');
  }

  /* ── 点击：改头像/名字、换封面、点赞、删除 ── */
  function onListClick(e) {
    var editEl = e.target.closest ? e.target.closest('[data-edit]') : null;
    if (editEl) {
      openEditor(editEl.getAttribute('data-edit'), editEl.getAttribute('data-who'));
      return;
    }

    // 点封面空白处 → 换背景
    if (e.target.closest && e.target.closest('[data-cover]')) {
      openBg();
      return;
    }

    var likeBtn = e.target.closest ? e.target.closest('[data-like]') : null;
    if (likeBtn) {
      var post = likeBtn.closest('.cxm-item');
      var id = post && post.getAttribute('data-id');
      var list = load();
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) {
          var who = list[i].likedBy || (list[i].liked ? ['me'] : []);
          var at = who.indexOf('me');
          if (at > -1) who.splice(at, 1);
          else who.push('me');
          list[i].likedBy = who;
          list[i].liked = who.indexOf('me') > -1;
          list[i].likes = who.length;
          break;
        }
      }
      save(list);
      render();
      return;
    }

    // 打开评论输入
    var cbtn = e.target.closest ? e.target.closest('[data-comment]') : null;
    if (cbtn) {
      var art = cbtn.closest('.cxm-item');
      var wrap = art && art.querySelector('.cxm-cwrap');
      if (wrap) {
        wrap.classList.add('on');
        var inp = wrap.querySelector('.cxm-cinput');
        if (inp) { inp.value = ''; inp.focus(); }
      }
      return;
    }

    // 发评论
    var sendBtn = e.target.closest ? e.target.closest('[data-csend]') : null;
    if (sendBtn) {
      var art2 = sendBtn.closest('.cxm-item');
      var idc = art2 && art2.getAttribute('data-id');
      var inp2 = art2 && art2.querySelector('.cxm-cinput');
      var txt = (inp2 && inp2.value || '').trim();
      if (!txt) return;
      // 发完收起输入行
      if (inp2) inp2.value = '';
      var wrap2 = art2.querySelector('.cxm-cwrap');
      if (wrap2) wrap2.classList.remove('on');
      addComment(idc, 'me', txt);
      // 如果评的是梦角的动态，TA 有一半几率回一句
      var tgt = load().filter(function (x) { return x.id === idc; })[0];
      if (tgt && tgt.who === 'mj' && Math.random() < 0.5) {
        setTimeout(function () { mjComment(idc); }, 1600 + Math.random() * 2200);
      }
      return;
    }

    var delBtn = e.target.closest ? e.target.closest('[data-del]') : null;
    if (delBtn) {
      var p2 = delBtn.closest('.cxm-item');
      var id2 = p2 && p2.getAttribute('data-id');
      if (!id2) return;
      if (!confirm('删掉这条动态？')) return;
      save(load().filter(function (x) { return x.id !== id2; }));
      render();
      return;
    }

    if (e.target && e.target.tagName === 'IMG' && e.target.closest('.cxm-pics')) {
      var v = document.getElementById('cxm-viewer');
      if (v) { v.querySelector('img').src = e.target.src; v.classList.add('on'); }
    }
  }

  /* ── 评论 ── */
  function addComment(postId, who, text) {
    if (!postId || !text) return;
    var list = load();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === postId) {
        if (!list[i].comments) list[i].comments = [];
        list[i].comments.push({ who: who, text: String(text).slice(0, 120), ts: Date.now() });
        break;
      }
    }
    save(list);
    render();
  }

  var MJ_REPLY = [
    '嗯。', '看到了。', '在。', '挺好的。', '别忘了吃饭。',
    '我记住了。', '下次一起。', '别熬夜。', '这个时候还醒着？',
    '谢谢你。', '我一直都在。'
  ];

  /* 梦角在动态下面回一句 */
  function mjComment(postId) {
    var pick = MJ_REPLY[Math.floor(Math.random() * MJ_REPLY.length)];
    addComment(postId, 'mj', pick);
  }

  /* ── 发布 ── */
  function publish() {
    if (busy) return;
    var text = (el.input && el.input.value || '').trim();
    if (!text && !picked.length) { toast('写点什么，或者加张图'); return; }

    busy = true;
    var list = load();
    list.unshift({
      id: uid(), who: 'me', text: text, imgs: picked.slice(),
      ts: Date.now(), likes: 0, liked: false
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

  function reactAfterPublish() {
    setTimeout(function () {
      if (Math.random() < 0.5) mjLikeMine();
    }, 2000 + Math.random() * 2000);

    setTimeout(function () {
      if (Math.random() < 0.38) mjPost(Math.random() < 0.45 ? 'ai' : 'card');
    }, 4200 + Math.random() * 4000);

    // 梦角偶尔来评论一句
    setTimeout(function () {
      var list = load();
      var mine = list.filter(function (x) { return x.who === 'me'; })[0];
      if (mine && Math.random() < 0.55) mjComment(mine.id);
    }, 6000 + Math.random() * 5000);
  }

  function mjLikeMine() {
    var list = load();
    for (var i = 0; i < list.length; i++) {
      if (list[i].who === 'me') {
        var w = list[i].likedBy || (list[i].liked ? ['me'] : []);
        if (w.indexOf('mj') < 0) w.push('mj');
        list[i].likedBy = w;
        list[i].likes = w.length;
        save(list);
        render();
        return;
      }
    }
  }

  function cardPost() {
    var pool = cardsPool();
    var pick = pool[Math.floor(Math.random() * pool.length)] || '';
    return { text: String(pick).slice(0, 160), card: true };
  }

  function pushMJ(data) {
    if (!data || !data.text) return;
    var list = load();
    list.unshift({
      id: uid(), who: 'mj', text: data.text, card: !!data.card,
      imgs: [], ts: Date.now(), likes: 0, liked: false
    });
    save(list);
    render();
  }

  /* kind = 'card'（抽字卡）| 'ai'（现场写一句，失败退回字卡） */
  function mjPost(kind) {
    if (kind !== 'ai') { pushMJ(cardPost()); return; }
    aiMoment().then(function (text) {
      pushMJ(text ? { text: text, card: false } : cardPost());
    });
  }

  /* ── AI ── */
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
    Promise.all(arr.map(function (f) { return compress(f, IMG_MAX_W, IMG_Q); })).then(function (b64s) {
      picked = picked.concat(b64s);
      renderPicked();
      if (files.length > room) toast('一条最多 ' + MAX_IMG + ' 张图');
    }).catch(function () {
      toast('这张图读不出来，换一张试试');
    });
  }

  /* ── 换背景面板 ── */
  function openBg() {
    if (!el.bgSheet) return;
    el.bgSheet.classList.remove('cxm-off');
    if (el.bgInput) { el.bgInput.value = ''; el.bgInput.style.display = 'none'; }
    var pv = document.getElementById('cxm-bg-preview');
    if (pv) {
      var bg = currentBg();
      pv.style.background = bg || 'linear-gradient(160deg,#e7ded2 0%,#cbb9a6 100%)';
      pv.style.backgroundSize = 'cover';
      pv.style.backgroundPosition = 'center';
    }
  }

  function closeBg() {
    if (el.bgSheet) el.bgSheet.classList.add('cxm-off');
  }

  function applyBgFile(file) {
    if (!file) return;
    toast('正在处理背景…');
    compress(file, BG_MAX_W, 0.78).then(function (b64) {
      setChatBg(b64);
      closeBg();
      toast('背景换好了，聊天那边也同步了');
    }).catch(function () { toast('这张图用不了，换一张'); });
  }

  function applyBgUrl() {
    var v = (el.bgInput && el.bgInput.value || '').trim();
    if (!v) { toast('先贴个图片地址'); return; }
    if (!/^(https?:|data:image)/.test(v)) { toast('地址要 http(s) 开头'); return; }
    var img = new Image();
    img.onload = function () {
      setChatBg(v);
      closeBg();
      toast('背景换好了，聊天那边也同步了');
    };
    img.onerror = function () { toast('这个地址加载不出图，检查一下'); };
    img.src = v;
  }

  /* ── 样式 ── */
  function injectStyle() {
    if (document.getElementById('cxm-style')) return;

    var css = [
      '#cx-moments {',
      '  position: fixed; inset: 0; z-index: 1900;',
      '  background: #fff;',
      '  display: flex; flex-direction: column;',
      '  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;',
      '}',
      '#cx-moments.cxm-off { display: none; }',

      /* 顶栏 */
      '.cxm-head { flex: 0 0 auto; display: flex; align-items: center; gap: 8px;',
      '  padding: max(10px, env(safe-area-inset-top)) 14px 10px; background: #fff;',
      '  border-bottom: 1px solid #f0f0f0; }',
      '.cxm-back { width: 34px; height: 34px; border: none; background: transparent; color: #4a4a4a; font-size: 17px; cursor: pointer; flex: 0 0 auto; }',
      '.cxm-title { flex: 1 1 auto; font-size: 16px; font-weight: 600; color: #1a1a1a; letter-spacing: .3px; }',
      '.cxm-new { border: none; background: transparent; color: #576b95; font-size: 13px; font-weight: 500;',
      '  padding: 6px 10px; cursor: pointer; display: flex; align-items: center; gap: 5px; }',
      '.cxm-new:active { opacity: .6; }',

      '.cxm-list { flex: 1 1 auto; overflow-y: auto; -webkit-overflow-scrolling: touch; background: #fff; }',
      '.cxm-scroll { width: 100%; max-width: 640px; margin: 0 auto; padding-bottom: 40px; }',

      /* 封面 */
      '.cxm-cover { position: relative; height: clamp(210px, 34vh, 330px);',
      '  background-size: cover; background-position: center; background-repeat: no-repeat;',
      '  cursor: pointer; }',
      '.cxm-cover.cxm-cover-default { background: linear-gradient(150deg, #ded2c3 0%, #c0ab97 55%, #8e7b6b 100%); }',
      '.cxm-cover-shade { position: absolute; inset: 0; pointer-events: none;',
      '  background: linear-gradient(180deg, rgba(0,0,0,.10) 0%, rgba(0,0,0,0) 35%, rgba(0,0,0,.40) 100%); }',
      '.cxm-cam { position: absolute; right: 12px; top: 12px; z-index: 3; width: 32px; height: 32px; border-radius: 50%;',
      '  border: none; background: rgba(0,0,0,.30); color: #fff; font-size: 13px; cursor: pointer;',
      '  display: flex; align-items: center; justify-content: center; backdrop-filter: blur(6px); }',
      '.cxm-cam:active { background: rgba(0,0,0,.5); }',
      '.cxm-me { position: absolute; right: 16px; bottom: 14px; z-index: 3; display: flex; align-items: center; gap: 10px; }',
      '.cxm-me-name { color: #fff; font-size: 16px; font-weight: 600; letter-spacing: .5px;',
      '  text-shadow: 0 1px 8px rgba(0,0,0,.55); cursor: pointer; padding-bottom: 0; max-width: 46vw;',
      '  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.cxm-me-ava { width: 64px; height: 64px; border-radius: 9px; overflow: hidden; flex: 0 0 auto;',
      '  background: #c25b3f; border: 3px solid rgba(255,255,255,.94); box-shadow: 0 2px 10px rgba(0,0,0,.28);',
      '  display: flex; align-items: center; justify-content: center; color: #fff; font-size: 20px;',
      '  font-weight: 700; cursor: pointer; }',
      '.cxm-me-ava img { width: 100%; height: 100%; object-fit: cover; display: block; }',
      '.cxm-me-tip { position: absolute; left: 16px; bottom: 18px; z-index: 3; color: rgba(255,255,255,.72);',
      '  font-size: 11px; text-shadow: 0 1px 4px rgba(0,0,0,.4); pointer-events: none; }',

      /* 动态条目 */
      '.cxm-feed { background: #fff; }',
      '.cxm-item { display: flex; gap: 10px; padding: 16px 16px 13px; border-bottom: 1px solid #f2f2f2; }',
      '.cxm-ava { width: 40px; height: 40px; border-radius: 5px; flex: 0 0 auto; overflow: hidden;',
      '  display: flex; align-items: center; justify-content: center; color: #fff; font-size: 15px;',
      '  font-weight: 700; background: #c25b3f; cursor: pointer; }',
      '.cxm-ava.mj { background: #5b5a86; }',
      '.cxm-ava img { width: 100%; height: 100%; object-fit: cover; display: block; }',
      '.cxm-ava:active, .cxm-name:active, .cxm-me-ava:active, .cxm-me-name:active { opacity: .75; }',

      '.cxm-main { flex: 1 1 auto; min-width: 0; }',
      '.cxm-name { display: inline-block; font-size: 14.5px; font-weight: 700; color: #576b95; cursor: pointer;',
      '  max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: top; }',
      '.cxm-text { font-size: 15px; line-height: 1.62; color: #232323; margin-top: 6px; word-break: break-word; }',

      '.cxm-card { margin-top: 8px; padding: 26px 22px 30px; border-radius: 8px; position: relative;',
      '  background: linear-gradient(180deg, #fffdf9 0%, #f8f1e6 100%); border: 1px solid #ece0cf; }',
      '.cxm-card p { margin: 0; font-size: 15px; line-height: 1.95; color: #3a3129; text-align: center;',
      '  font-family: "Songti SC", "STSong", "SimSun", serif; letter-spacing: .8px; word-break: break-word; }',
      '.cxm-card-mark { position: absolute; left: 12px; top: 4px; font-size: 26px; line-height: 1;',
      '  color: #dfcdb4; font-family: Georgia, "Times New Roman", serif; }',
      '.cxm-card-seal { position: absolute; right: 10px; bottom: 8px; width: 20px; height: 20px;',
      '  border: 1px solid rgba(194,91,63,.65); border-radius: 3px; display: flex; align-items: center;',
      '  justify-content: center; font-size: 9px; color: rgba(194,91,63,.8); }',

      '.cxm-pics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; margin-top: 8px; }',
      '.cxm-pics.one { grid-template-columns: 1fr; }',
      '.cxm-pics img { width: 100%; object-fit: cover; display: block; border-radius: 4px; cursor: pointer; }',
      '.cxm-pics img { aspect-ratio: 1 / 1; }',
      '.cxm-pics.one img { aspect-ratio: 4 / 3; max-width: 74%; }',

      '.cxm-row { display: flex; align-items: center; gap: 6px; margin-top: 9px; }',
      '.cxm-time { font-size: 12.5px; color: #a6a6a6; }',
      '.cxm-del { margin-left: auto; border: none; background: transparent; color: #d0d0d0; font-size: 11px;',
      '  padding: 4px 6px; cursor: pointer; }',
      '.cxm-del:active { color: #b04e33; }',
      '.cxm-like { border: none; background: transparent; color: #9b9b9b; font-size: 12.5px;',
      '  display: flex; align-items: center; gap: 4px; cursor: pointer; padding: 4px 2px; }',
      '.cxm-like.on { color: #c25b3f; }',
      '.cxm-cbtn { border: none; background: transparent; color: #9b9b9b; font-size: 12.5px; padding: 4px 8px; cursor: pointer; }',
      '.cxm-cbtn:active { color: #576b95; }',

      /* 点赞头像列表 */
      '.cxm-likes { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 8px;',
      '  padding: 6px 8px; background: #f7f7f7; border-radius: 4px; font-size: 12.5px; color: #576b95; }',
      '.cxm-likes i { color: #c25b3f; font-size: 11px; }',
      '.cxm-liker { display: flex; align-items: center; gap: 4px; }',
      '.cxm-liker img { width: 18px; height: 18px; border-radius: 3px; object-fit: cover; display: block; }',
      '.cxm-liker-t { width: 18px; height: 18px; border-radius: 3px; background: #c25b3f; color: #fff;',
      '  font-size: 10px; display: flex; align-items: center; justify-content: center; }',

      /* 评论 */
      '.cxm-cmts { margin-top: 7px; }',
      '.cxm-cmt { font-size: 13.5px; line-height: 1.6; color: #232323; padding: 2px 0; word-break: break-word; }',
      '.cxm-cname { color: #576b95; font-weight: 500; cursor: pointer; }',
      '.cxm-cwrap { display: none; gap: 8px; margin-top: 8px; }',
      '.cxm-cwrap.on { display: flex; }',
      '.cxm-cinput { flex: 1 1 auto; min-width: 0; border: 1px solid #ededed; border-radius: 6px;',
      '  padding: 7px 10px; font-size: 13.5px; outline: none; background: #fafafa; color: #232323; }',
      '.cxm-cinput:focus { border-color: #d6d6d6; background: #fff; }',
      '.cxm-csend { flex: 0 0 auto; border: none; background: #07c160; color: #fff; border-radius: 6px;',
      '  padding: 7px 13px; font-size: 13px; cursor: pointer; }',

      '.cxm-empty { text-align: center; padding: 70px 20px; color: #a9a9a9; }',
      '.cxm-empty i { font-size: 32px; color: #d8d8d8; display: block; margin-bottom: 12px; }',
      '.cxm-empty p { font-size: 14px; margin: 0 0 6px; }',
      '.cxm-empty span { font-size: 12px; color: #bfbfbf; }',

      /* 底部面板（发布 / 换背景共用） */
      '.cxm-sheet { position: fixed; inset: 0; z-index: 3400; background: rgba(0,0,0,.42);',
      '  display: flex; align-items: flex-end; justify-content: center; }',
      '.cxm-sheet.cxm-off { display: none; }',
      '.cxm-sheet-body { width: 100%; max-width: 620px; background: #fff; border-radius: 14px 14px 0 0;',
      '  padding: 16px 16px calc(16px + env(safe-area-inset-bottom)); max-height: 84vh; display: flex; flex-direction: column; }',
      '.cxm-sheet-t { font-size: 15px; font-weight: 600; color: #1a1a1a; margin-bottom: 12px; }',
      '.cxm-ta { width: 100%; min-height: 96px; max-height: 38vh; border: none; border-radius: 8px;',
      '  padding: 10px 12px; font-size: 15px; line-height: 1.7; color: #232323; resize: none; outline: none;',
      '  background: #f7f7f7; }',
      '.cxm-thumbs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 10px; }',
      '.cxm-thumb { position: relative; }',
      '.cxm-thumb img { width: 100%; aspect-ratio: 1 / 1; object-fit: cover; border-radius: 6px; display: block; }',
      '.cxm-thumb button { position: absolute; top: 4px; right: 4px; width: 20px; height: 20px; border-radius: 50%;',
      '  border: none; background: rgba(0,0,0,.45); color: #fff; font-size: 10px; cursor: pointer; }',
      '.cxm-tools { display: flex; align-items: center; gap: 10px; margin-top: 12px; }',
      '.cxm-pick { border: none; background: #f2f2f2; color: #3d3d3d; border-radius: 8px;',
      '  padding: 8px 13px; font-size: 13px; cursor: pointer; display: flex; align-items: center; gap: 6px; }',
      '.cxm-pick:active { background: #e8e8e8; }',
      '.cxm-hint { font-size: 11.5px; color: #b0b0b0; margin-left: auto; }',
      '.cxm-actions { display: flex; gap: 10px; margin-top: 14px; }',
      '.cxm-cancel { flex: 0 0 96px; padding: 12px 0; border-radius: 8px; border: none; background: #f2f2f2;',
      '  color: #4a4a4a; font-size: 14px; cursor: pointer; }',
      '.cxm-post-btn { flex: 1 1 auto; padding: 12px 0; border-radius: 8px; border: none; background: #07c160;',
      '  color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; }',
      '.cxm-post-btn:disabled { opacity: .5; }',

      /* 换背景面板 */
      '.cxm-bg-preview { height: 150px; border-radius: 10px; background: #f2f2f2; background-size: cover;',
      '  background-position: center; margin-bottom: 12px; border: 1px solid #eee; }',
      '.cxm-bg-url { width: 100%; margin-top: 10px; border: 1px solid #e5e5e5; border-radius: 8px;',
      '  padding: 10px 12px; font-size: 13px; outline: none; color: #333; }',
      '.cxm-bg-url:focus { border-color: #c9c9c9; }',
      '.cxm-bg-note { font-size: 11.5px; color: #9a9a9a; margin-top: 10px; line-height: 1.6; }',

      '.cxm-toast { position: fixed; left: 50%; bottom: 90px; transform: translateX(-50%); z-index: 3600;',
      '  background: rgba(30,30,30,.88); color: #fff; font-size: 12.5px; padding: 9px 15px; border-radius: 6px;',
      '  transition: opacity .4s; max-width: 80vw; text-align: center; }',
      '.cxm-toast.cxm-toast-out { opacity: 0; }',

      /* 大图预览 */
      '.cxm-viewer { position: fixed; inset: 0; z-index: 3700; background: rgba(0,0,0,.94);',
      '  display: none; align-items: center; justify-content: center; padding: 20px; }',
      '.cxm-viewer.on { display: flex; }',
      '.cxm-viewer img { max-width: 100%; max-height: 100%; }'
    ].join('\n');

    var s = document.createElement('style');
    s.id = 'cxm-style';
    s.textContent = css;
    document.head.appendChild(s);
  }

  /* ── 构建 ── */
  function build() {
    injectStyle();

    var root = document.createElement('div');
    root.id = 'cx-moments';
    root.className = 'cxm-off';

    root.innerHTML = '' +
      '<div class="cxm-head">' +
        '<button class="cxm-back" id="cxm-close"><i class="fas fa-chevron-left"></i></button>' +
        '<span class="cxm-title">朋友圈</span>' +
        '<button class="cxm-new" id="cxm-open"><i class="fas fa-camera"></i>发一条</button>' +
      '</div>' +
      '<div class="cxm-list" id="cxm-list">' +
        '<div class="cxm-scroll">' +
          '<div class="cxm-cover" id="cxm-cover" data-cover="1">' +
            '<div class="cxm-cover-shade"></div>' +
            '<button class="cxm-cam" id="cxm-cam" title="换背景"><i class="fas fa-camera"></i></button>' +
            '<span class="cxm-me-tip">点封面换背景</span>' +
            '<div class="cxm-me">' +
              '<span class="cxm-me-name" data-edit="name" data-who="me"></span>' +
              '<span class="cxm-me-ava" data-edit="ava" data-who="me"></span>' +
            '</div>' +
          '</div>' +
          '<div class="cxm-feed" id="cxm-feed"></div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(root);
    el.root = root;
    el.scroller = document.getElementById('cxm-list');
    el.list = document.getElementById('cxm-list');
    el.cover = document.getElementById('cxm-cover');
    el.feed = document.getElementById('cxm-feed');

    // 点封面：头像/名字走编辑，其他地方换背景
    el.list.addEventListener('click', onListClick);

    // 评论框里按回车直接发
    el.list.addEventListener('keydown', function (e) {
      if (!e.target || !e.target.classList || !e.target.classList.contains('cxm-cinput')) return;
      if (e.key === 'Enter' || e.keyCode === 13) {
        e.preventDefault();
        var wrap = e.target.closest('.cxm-cwrap');
        var btn = wrap && wrap.querySelector('[data-csend]');
        if (btn) btn.click();
      }
    });

    // 图片全屏看
    var viewer = document.createElement('div');
    viewer.className = 'cxm-viewer';
    viewer.id = 'cxm-viewer';
    viewer.innerHTML = '<img alt="">';
    document.body.appendChild(viewer);
    viewer.addEventListener('click', function () { viewer.classList.remove('on'); });

    // 发布面板
    var sheet = document.createElement('div');
    sheet.className = 'cxm-sheet cxm-off';
    sheet.innerHTML = '' +
      '<div class="cxm-sheet-body">' +
        '<div class="cxm-sheet-t">发一条动态</div>' +
        '<textarea class="cxm-ta" id="cxm-ta" placeholder="这一刻的想法…"></textarea>' +
        '<div class="cxm-thumbs" id="cxm-thumbs" style="display:none"></div>' +
        '<div class="cxm-tools">' +
          '<button class="cxm-pick" id="cxm-pick"><i class="far fa-image"></i>图片</button>' +
          '<span class="cxm-hint">最多 3 张</span>' +
        '</div>' +
        '<div class="cxm-actions">' +
          '<button class="cxm-cancel" id="cxm-cancel">取消</button>' +
          '<button class="cxm-post-btn" id="cxm-do-post">发表</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(sheet);
    el.overlay = sheet;
    el.input = sheet.querySelector('#cxm-ta');
    el.imgs = sheet.querySelector('#cxm-thumbs');

    // 换背景面板
    var bgSheet = document.createElement('div');
    bgSheet.className = 'cxm-sheet cxm-off';
    bgSheet.innerHTML = '' +
      '<div class="cxm-sheet-body">' +
        '<div class="cxm-sheet-t">朋友圈背景</div>' +
        '<div class="cxm-bg-preview" id="cxm-bg-preview"></div>' +
        '<div class="cxm-tools">' +
          '<button class="cxm-pick" id="cxm-bg-file"><i class="far fa-image"></i>选图片</button>' +
          '<button class="cxm-pick" id="cxm-bg-urlbtn"><i class="fas fa-link"></i>用链接</button>' +
        '</div>' +
        '<input class="cxm-bg-url" id="cxm-bg-url" type="url" placeholder="粘贴图片地址 https://…" style="display:none">' +
        '<div class="cxm-bg-note">换了之后聊天页背景也会变（两边是同一份）。不想要背景就点「恢复默认」。</div>' +
        '<div class="cxm-actions">' +
          '<button class="cxm-cancel" id="cxm-bg-reset">恢复默认</button>' +
          '<button class="cxm-post-btn" id="cxm-bg-save">用这个</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(bgSheet);
    el.bgSheet = bgSheet;
    el.bgInput = bgSheet.querySelector('#cxm-bg-url');

    // 隐藏的文件选择器（动态图片）
    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.multiple = true;
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    // 隐藏的文件选择器（背景）
    var bgFile = document.createElement('input');
    bgFile.type = 'file';
    bgFile.accept = 'image/*';
    bgFile.style.display = 'none';
    document.body.appendChild(bgFile);

    // 事件
    document.getElementById('cxm-close').addEventListener('click', hide);
    document.getElementById('cxm-open').addEventListener('click', openComposer);
    document.getElementById('cxm-cancel').addEventListener('click', closeComposer);
    document.getElementById('cxm-do-post').addEventListener('click', publish);
    document.getElementById('cxm-cam').addEventListener('click', function (e) {
      e.stopPropagation();
      openBg();
    });

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

    sheet.addEventListener('click', function (e) {
      if (e.target === sheet) closeComposer();
    });

    // 背景面板事件
    bgSheet.addEventListener('click', function (e) {
      if (e.target === bgSheet) closeBg();
    });

    document.getElementById('cxm-bg-file').addEventListener('click', function () {
      bgFile.value = '';
      bgFile.click();
    });

    bgFile.addEventListener('change', function () { applyBgFile(bgFile.files && bgFile.files[0]); });

    document.getElementById('cxm-bg-urlbtn').addEventListener('click', function () {
      var inp = el.bgInput;
      inp.style.display = 'block';
      inp.focus();
    });

    document.getElementById('cxm-bg-save').addEventListener('click', applyBgUrl);

    document.getElementById('cxm-bg-reset').addEventListener('click', function () {
      setChatBg('');
      closeBg();
      toast('背景已恢复默认');
    });

    built = true;
  }

  /* ── 打开 / 关闭 ── */
  function open() {
    if (!built) build();
    el.root.classList.remove('cxm-off');
    if (el.scroller) el.scroller.scrollTop = 0;
    render();
    maybeOnOpen();
  }

  function hide() {
    if (el.root) el.root.classList.add('cxm-off');
    closeComposer();
    closeBg();
  }

  window.Moments = { open: open, close: hide };
})();
