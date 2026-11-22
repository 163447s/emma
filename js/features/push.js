/**
 * push.js — 消息推送
 * 1) 系统通知：他在聊天里说话，而页面已经退到后台 / 锁屏时，弹手机通知栏
 * 2) 微信推送：接 PushPlus，同样是「页面不在前台」时才推，避免你正聊着被刷屏
 *    入口在「设置 → 高级功能 → 消息推送」，token 只存在本机 localStorage
 */
(function () {
    'use strict';

    var TOKEN_KEY = 'cx_push_token';
    var ON_KEY = 'cx_push_on';
    var lastText = '', lastTime = 0;

    function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
    function isOn() { try { return localStorage.getItem(ON_KEY) !== '0'; } catch (e) { return true; } }

    function partnerName() {
        try { return (typeof settings !== 'undefined' && settings.partnerName) || '他'; } catch (e) { return '他'; }
    }

    /* ── 系统通知 ── */
    function sysNotify(title, body) {
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        var opts = {
            body: body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
            tag: 'cx-chat', renotify: true, silent: false
        };
        try {
            if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
                navigator.serviceWorker.getRegistration().then(function (reg) {
                    if (reg && reg.showNotification) reg.showNotification(title, opts);
                    else new Notification(title, opts);
                }).catch(function () { try { new Notification(title, opts); } catch (e) {} });
            } else {
                new Notification(title, opts);
            }
        } catch (e) {}
    }

    /* ── 微信推送（PushPlus，免后端；GET 即可，no-cors 不让浏览器拦）── */
    function wxPush(title, body) {
        var t = getToken();
        if (!t) return;
        var url = 'https://www.pushplus.plus/send?token=' + encodeURIComponent(t) +
            '&title=' + encodeURIComponent(title) +
            '&content=' + encodeURIComponent(body) +
            '&template=txt';
        try {
            fetch(url, { mode: 'no-cors', cache: 'no-store', credentials: 'omit' });
        } catch (e) {
            try { var im = new Image(); im.src = url; } catch (e2) {}
        }
    }

    /* ── 统一出口：只有页面不在前台才提醒 ── */
    function notify(text) {
        text = (text || '').replace(/\s+/g, ' ').trim();
        if (!text) return;
        if (text.slice(0, 60) === lastText && Date.now() - lastTime < 60000) return;
        lastText = text.slice(0, 60); lastTime = Date.now();

        if (!document.hidden) return;          // 她正看着，页内有气泡就够了
        var who = partnerName();
        sysNotify(who, text.length > 80 ? text.slice(0, 80) + '…' : text);
        if (isOn()) wxPush(who, text);
    }

    /* ── 监听聊天里新出现的「他那侧」气泡 ── */
    function startWatch() {
        var box = document.getElementById('chat-container') ||
            document.querySelector('.chat-container') || document.body;
        var ready = false;
        setTimeout(function () { ready = true; }, 4000);   // 忽略启动时渲染的历史消息

        var obs = new MutationObserver(function (list) {
            if (!ready) return;
            list.forEach(function (m) {
                Array.prototype.forEach.call(m.addedNodes || [], function (n) {
                    if (n.nodeType !== 1 || typeof n.className !== 'string') return;
                    if (!/(^|\s)message(\s|$)/.test(n.className)) return;
                    if (/(^|\s)message-sent(\s|$)/.test(n.className)) return;
                    if (n.querySelector('.typing-indicator')) return;
                    var txtEl = n.querySelector('.msg-txt');
                    var txt = txtEl ? (txtEl.textContent || '').trim() : '';
                    if (!txt && n.querySelector('img, .msg-image')) txt = '发来一张图片';
                    if (txt) notify(txt);
                });
            });
        });
        obs.observe(box, { childList: true, subtree: true });
    }

    /* ── 设置面板 ── */
    var STYLE_ID = 'cx-push-style';
    function injectStyle() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = `
.cxpush-mask { position: fixed; inset: 0; z-index: 4200; background: rgba(18,26,36,.5);
  display: flex; align-items: center; justify-content: center; padding: 18px;
  -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); }
.cxpush-box { width: 100%; max-width: 360px; border-radius: 20px; overflow: hidden;
  background: rgba(252,254,255,.96); box-shadow: 0 18px 50px rgba(30,55,80,.24); }
.cxpush-hd { padding: 16px 18px 12px; border-bottom: 1px solid rgba(140,170,195,.18);
  display: flex; align-items: center; justify-content: space-between; }
.cxpush-hd b { font-size: 15px; color: #40607a; font-weight: 600; letter-spacing: .5px; }
.cxpush-x { border: none; background: none; color: #9fb3c4; font-size: 18px; cursor: pointer; line-height: 1; }
.cxpush-bd { padding: 14px 18px 4px; font-size: 12.5px; color: #6a8199; line-height: 1.7; }
.cxpush-bd a { color: #4a86b8; text-decoration: none; }
.cxpush-row { display: flex; align-items: center; gap: 9px; margin-top: 12px; }
.cxpush-row input[type=text] { flex: 1; min-width: 0; padding: 9px 11px; border-radius: 10px;
  border: 1px solid rgba(140,170,195,.32); background: #fff; font-size: 12.5px; color: #34506a; outline: none; }
.cxpush-row input[type=text]:focus { border-color: rgba(90,150,200,.6); }
.cxpush-btn { border: none; border-radius: 10px; padding: 9px 14px; font-size: 12.5px; cursor: pointer;
  background: #6f9ec2; color: #fff; font-family: inherit; }
.cxpush-btn.ghost { background: rgba(120,160,195,.14); color: #4d7392; }
.cxpush-btn:active { transform: scale(.97); }
.cxpush-sw { display: flex; align-items: center; justify-content: space-between; margin-top: 14px; }
.cxpush-sw span { font-size: 12.5px; color: #55708a; }
.cxpush-toggle { width: 42px; height: 24px; border-radius: 12px; border: none; position: relative;
  background: rgba(140,170,195,.35); cursor: pointer; transition: background .18s; }
.cxpush-toggle.on { background: #6f9ec2; }
.cxpush-toggle::after { content: ''; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px;
  border-radius: 50%; background: #fff; transition: transform .18s; }
.cxpush-toggle.on::after { transform: translateX(18px); }
.cxpush-ft { padding: 12px 18px 16px; display: flex; gap: 9px; justify-content: flex-end; }
.cxpush-tip { margin-top: 10px; font-size: 11.5px; color: #93a8ba; line-height: 1.65; }
`;
        document.head.appendChild(st);
    }

    function toast(txt, type) {
        if (typeof window.showNotification === 'function') { window.showNotification(txt, type || 'info'); return; }
        var d = document.createElement('div');
        d.style.cssText = 'position:fixed;left:50%;bottom:120px;transform:translateX(-50%);z-index:5000;' +
            'background:rgba(0,0,0,.78);color:#fff;font-size:12px;padding:8px 14px;border-radius:10px;max-width:80%;';
        d.textContent = txt;
        document.body.appendChild(d);
        setTimeout(function () { d.remove(); }, 1800);
    }

    function openPanel() {
        injectStyle();
        if (document.querySelector('.cxpush-mask')) return;

        var mask = document.createElement('div');
        mask.className = 'cxpush-mask';
        mask.innerHTML = `
<div class="cxpush-box">
  <div class="cxpush-hd"><b>消息推送</b><button class="cxpush-x">×</button></div>
  <div class="cxpush-bd">
    他在聊天里说话、而这个页面已经不在前台（切走了 / 锁屏了）时提醒你。<br>
    微信推送要 PushPlus：在 <a href="https://www.pushplus.plus" target="_blank">pushplus.plus</a>
    用微信扫码登录，复制页面上的 token 填在下面。
    <div class="cxpush-row">
      <input type="text" id="cxpush-token" placeholder="粘贴 PushPlus token">
    </div>
    <div class="cxpush-sw">
      <span>切到后台时推送到微信</span>
      <button class="cxpush-toggle" id="cxpush-toggle"></button>
    </div>
    <div class="cxpush-tip">系统通知需要允许一次权限；token 只保存在这台设备上，不会上传。</div>
  </div>
  <div class="cxpush-ft">
    <button class="cxpush-btn ghost" id="cxpush-test">发送测试</button>
    <button class="cxpush-btn" id="cxpush-save">保存</button>
  </div>
</div>`;
        document.body.appendChild(mask);

        var input = mask.querySelector('#cxpush-token');
        var toggle = mask.querySelector('#cxpush-toggle');
        input.value = getToken();
        toggle.classList.toggle('on', isOn());

        mask.querySelector('.cxpush-x').addEventListener('click', function () { mask.remove(); });
        mask.addEventListener('click', function (e) { if (e.target === mask) mask.remove(); });

        toggle.addEventListener('click', function () {
            var on = !toggle.classList.contains('on');
            toggle.classList.toggle('on', on);
            try { localStorage.setItem(ON_KEY, on ? '1' : '0'); } catch (e) {}
            toast(on ? '已开启微信推送' : '已关闭微信推送', 'success');
        });

        mask.querySelector('#cxpush-save').addEventListener('click', function () {
            try { localStorage.setItem(TOKEN_KEY, input.value.trim()); } catch (e) {}
            toast(input.value.trim() ? '已保存，切到后台就会推微信' : '已清空 token', 'success');
        });

        mask.querySelector('#cxpush-test').addEventListener('click', function () {
            var t = input.value.trim();
            try { localStorage.setItem(TOKEN_KEY, t); } catch (e) {}
            if (!t) { toast('先填 PushPlus token', 'warning'); return; }
            var who = partnerName();
            wxPush(who, '这是测试推送，收到了就说明通道通了。');
            sysNotify(who, '这是测试通知');
            if ('Notification' in window && Notification.permission === 'default') {
                Notification.requestPermission();
            }
            toast('已发测试，几秒后去微信看下', 'info');
        });
    }

    /* ── 在「高级功能」里挂一条入口 ── */
    function ensureEntry() {
        var box = document.getElementById('advanced-modal');
        var list = box ? box.querySelector('.settings-item-list') : null;
        if (!list || document.getElementById('cxpush-entry')) return;

        var item = document.createElement('div');
        item.className = 'settings-item';
        item.id = 'cxpush-entry';
        item.innerHTML = '<i class="fas fa-bell"></i><span>消息推送</span>';
        item.addEventListener('click', function () {
            if (typeof window.hideModal === 'function') {
                try { window.hideModal(document.getElementById('advanced-modal')); } catch (e) {}
            }
            openPanel();
        });
        list.appendChild(item);
    }

    function boot() {
        injectStyle();
        startWatch();
        window.CxPush = {
            notify: notify,
            sys: sysNotify,
            wx: wxPush,
            panel: openPanel,
            token: getToken,
            on: isOn
        };
        setTimeout(ensureEntry, 400);
        setTimeout(ensureEntry, 1500);
        setTimeout(ensureEntry, 3500);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 600); });
    } else {
        setTimeout(boot, 600);
    }
})();
