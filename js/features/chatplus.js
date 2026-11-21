/**
 * chatplus.js — 主聊天上的两个小功能（不动 core.js）
 * ------------------------------------------------------------
 * 1) 偷走这句：点自己发的消息，旁边冒出「✂ 偷走这句」，点了就进字卡库（customReplies）
 * 2) 查岗：输入区加一个铃铛，点了他就发一条「查岗」，你选文字报备 / 拍照报备 / 拒绝报备
 *    他的话仍然是站里原来的字卡回复，这里不生成任何台词
 * 3) 自动查岗：你每发一条消息，25 秒后掷一次 3%，一小时内最多一次
 */
(function () {
    'use strict';

    var REPORT_KEY = 'cx_report_last';
    var REPORT_CHANCE = 0.03;
    var REPORT_COOLDOWN = 60 * 60 * 1000;

    function partnerName() {
        try { return (typeof settings !== 'undefined' && settings.partnerName) || '对方'; }
        catch (e) { return '对方'; }
    }

    function esc(t) {
        return String(t == null ? '' : t)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function toast(msg) {
        try {
            if (typeof showNotification === 'function') { showNotification(msg, 'success', 2600); return; }
        } catch (e) {}
    }

    function cardPick() {
        try {
            var arr = window._customReplies;
            if (Array.isArray(arr)) {
                var list = arr.map(function (x) { return String(x == null ? '' : x).trim(); })
                    .filter(function (x) { return x && x.indexOf('__TAROT__') !== 0; });
                if (list.length) return list[Math.floor(Math.random() * list.length)];
            }
        } catch (e) {}
        return '';
    }

    /* ═══════════════ 一、样式 ═══════════════ */

    function injectStyle() {
        if (document.getElementById('cxplus-style')) return;
        var st = document.createElement('style');
        st.id = 'cxplus-style';
        st.textContent = [
            '.cx-steal-btn{position:fixed;z-index:10001;padding:5px 10px;border-radius:999px;border:1px solid #ecdcc8;',
            'background:#fffdf9;color:#9a7a58;font-size:12px;line-height:1;cursor:pointer;',
            'box-shadow:0 4px 14px rgba(120,90,60,.16);font-family:inherit;}',
            '.cx-steal-btn:active{transform:scale(.97);}',
            '.cx-report-overlay{position:fixed;inset:0;z-index:10050;display:flex;align-items:center;justify-content:center;',
            'background:rgba(54,42,32,.34);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);}',
            '.cx-report-card{width:min(84vw,330px);background:#fff;border-radius:20px;padding:24px 18px 18px;',
            'display:flex;flex-direction:column;align-items:center;box-shadow:0 18px 48px rgba(60,40,20,.24);}',
            '.cx-report-av{width:58px;height:58px;border-radius:50%;overflow:hidden;background:#f2e9dd;',
            'display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 3px 10px rgba(90,64,40,.14);}',
            '.cx-report-av img{width:100%;height:100%;object-fit:cover;}',
            '.cx-report-av i{color:#c9b6a0;font-size:22px;}',
            '.cx-report-from{margin-top:9px;font-size:11.5px;color:#9a9086;}',
            '.cx-report-from b{color:#4878c8;font-weight:500;}',
            '.cx-report-title{margin:13px 0 20px;font-size:27px;font-weight:700;color:#1e1b18;letter-spacing:3px;}',
            '.cx-rep-btn{width:100%;height:46px;border-radius:12px;border:none;background:#f4f3f5;color:#1e1b18;',
            'font-size:15px;font-weight:600;margin-top:10px;cursor:pointer;font-family:inherit;}',
            '.cx-rep-btn:active{transform:scale(.98);}',
            '.cx-rep-btn.red{background:#d15348;color:#fff;margin-top:16px;}',
            '#cx-bell-btn{position:relative;}'
        ].join('');
        document.head.appendChild(st);
    }

    /* ═══════════════ 二、偷走这句 ═══════════════ */

    var stealBtn = null;
    var stealBar = null;

    function hideSteal() {
        if (stealBar && stealBar.parentNode) stealBar.parentNode.removeChild(stealBar);
        if (stealBtn && stealBtn.parentNode) stealBtn.parentNode.removeChild(stealBtn);
        stealBar = null;
        stealBtn = null;
    }

    function saveCards() {
        try {
            if (typeof throttledSaveData === 'function') { throttledSaveData(); return; }
        } catch (e) {}
        try {
            if (typeof saveData === 'function') { saveData(); return; }
        } catch (e) {}
        try {
            var pre = window.APP_PREFIX || 'CHAT_APP_V3_';
            localforage.getItem(pre + 'lastSessionId').then(function (sid) {
                if (sid) localforage.setItem(pre + sid + '_customReplies', window._customReplies || []);
            });
        } catch (e) {}
    }

    function doSteal(text, btn) {
        var arr = window._customReplies;
        if (!Array.isArray(arr)) { arr = []; window._customReplies = arr; }
        if (arr.some(function (x) { return String(x == null ? '' : x).trim() === text; })) {
            if (btn) btn.textContent = '已经在字卡里了';
            setTimeout(hideSteal, 1300);
            return;
        }
        arr.push(text);
        saveCards();
        if (btn) btn.textContent = '偷走了，进字卡了';
        toast('偷走了你的「' + (text.length > 12 ? text.slice(0, 12) + '…' : text) + '」');
        setTimeout(hideSteal, 1600);
    }

    function msgText(el) {
        var out = '';
        try {
            var tx = el.querySelector('.msg-txt');
            if (tx) out = tx.textContent || '';
        } catch (e) {}
        out = out.replace(/\s+/g, ' ').trim();
        if (!out) {
            try {
                for (var i = 0; i < el.childNodes.length; i++) {
                    var n = el.childNodes[i];
                    if (n.nodeType === 3) out += n.nodeValue;
                }
            } catch (e) {}
            out = out.replace(/\s+/g, ' ').trim();
        }
        if (!out) out = (el.innerText || '').replace(/\s+/g, ' ').trim();
        return out;
    }

    function showSteal(el, text) {
        hideSteal();
        var t = el;
        if (!t || !document.contains(t) || !t.getBoundingClientRect().width) {
            var list = document.querySelectorAll('.message.message-sent');
            for (var i = list.length - 1; i >= 0; i--) {
                if (list[i].getBoundingClientRect().width) { t = list[i]; break; }
            }
        }
        if (!t) return;
        var r = t.getBoundingClientRect();
        if (!r.width) return;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cx-steal-btn';
        btn.textContent = '✂ 偷走这句';
        var top = r.top - 34;
        if (top < 8) top = r.bottom + 24;
        btn.style.top = top + 'px';
        btn.style.left = Math.max(6, Math.min(window.innerWidth - 110, r.right - 96)) + 'px';
        document.body.appendChild(btn);
        stealBtn = btn;
        btn.addEventListener('click', function (ev) {
            ev.stopPropagation();
            doSteal(text, btn);
        });
        setTimeout(function () { if (stealBtn === btn) hideSteal(); }, 6500);
    }

    /* ═══════════════ 三、查岗 ═══════════════ */

    var overlay = null;

    function lastAt() {
        try { return parseInt(localStorage.getItem(REPORT_KEY) || '0', 10) || 0; } catch (e) { return 0; }
    }
    function stamp() {
        try { localStorage.setItem(REPORT_KEY, String(Date.now())); } catch (e) {}
    }

    function closeReport() {
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        overlay = null;
    }

    function addPartnerMessage(text) {
        try {
            addMessage({
                id: Date.now() + Math.random(),
                sender: partnerName(),
                text: text,
                timestamp: new Date(),
                status: 'received',
                favorited: false,
                note: null,
                replyTo: null,
                type: 'normal'
            });
            if (typeof playSound === 'function') playSound('message');
        } catch (e) {}
    }

    function openReport() {
        if (overlay) return;
        hideSteal();
        var av = document.querySelector('#partner-avatar img');
        overlay = document.createElement('div');
        overlay.className = 'cx-report-overlay';
        overlay.innerHTML = [
            '<div class="cx-report-card">',
            '  <div class="cx-report-av">' + (av ? '<img src="' + av.src + '" alt="">' : '<i class="fas fa-user"></i>') + '</div>',
            '  <div class="cx-report-from">来自 <b>' + esc(partnerName()) + '</b></div>',
            '  <div class="cx-report-title">查岗</div>',
            '  <button class="cx-rep-btn" data-k="text">文字报备</button>',
            '  <button class="cx-rep-btn" data-k="photo">拍照报备</button>',
            '  <button class="cx-rep-btn red" data-k="no">拒绝报备</button>',
            '</div>'
        ].join('');
        document.body.appendChild(overlay);
        stamp();

        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) { closeReport(); return; }
            var b = e.target && e.target.closest ? e.target.closest('.cx-rep-btn') : null;
            if (!b) return;
            var k = b.getAttribute('data-k');
            closeReport();
            addPartnerMessage('查岗');
            setTimeout(function () {
                if (k === 'text') {
                    var i = document.getElementById('message-input');
                    if (i) { i.focus(); }
                } else if (k === 'photo') {
                    var a = document.getElementById('attachment-btn');
                    if (a) a.click();
                } else {
                    try { if (typeof sendMessage === 'function') sendMessage('不想报备'); } catch (er) {}
                }
            }, 350);
        });
    }

    function maybeReport() {
        if (overlay) return;
        if (Date.now() - lastAt() < REPORT_COOLDOWN) return;
        var n = 0;
        try { n = (typeof messages !== 'undefined' && messages) ? messages.length : 0; } catch (e) { n = 0; }
        if (n < 6) return;
        if (Math.random() >= REPORT_CHANCE) return;
        openReport();
    }

    function addBell() {
        if (document.getElementById('cx-bell-btn')) return true;
        var anchor = document.getElementById('attachment-btn');
        if (!anchor || !anchor.parentNode) return false;
        var b = document.createElement('button');
        b.id = 'cx-bell-btn';
        b.className = 'input-btn';
        b.title = '让他来查岗';
        b.type = 'button';
        b.innerHTML = '<i class="fas fa-bell"></i>';
        b.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            openReport();
        });
        anchor.parentNode.insertBefore(b, anchor);
        return true;
    }

    /* ═══════════════ 四、绑定 ═══════════════ */

    function bind() {
        document.addEventListener('click', function (e) {
            var t = e.target;
            if (!t || !t.closest) return;
            if (t.closest('.cx-steal-btn') || t.closest('.cx-report-overlay')) return;

            // 他自己的消息旁边不弹
            var m = t.closest('.message.message-sent');
            if (m) {
                var text = msgText(m);
                if (text && text.length <= 200) { showSteal(m, text); return; }
            }
            hideSteal();
        }, true);

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey && e.target && e.target.id === 'message-input') {
                setTimeout(maybeReport, 2500);
            }
        });

        document.addEventListener('click', function (e) {
            var t = e.target;
            if (!t || !t.closest) return;
            if (t.closest('#send-btn')) setTimeout(maybeReport, 2500);
        }, true);

        window.addEventListener('resize', hideSteal);
    }

    /* ═══════════════ 五、启动 ═══════════════ */

    function boot() {
        injectStyle();
        bind();
        if (!addBell()) {
            setTimeout(addBell, 1500);
            setTimeout(addBell, 4000);
        }
        try {
            var mo = new MutationObserver(function () {
                if (!document.getElementById('cx-bell-btn')) addBell();
            });
            mo.observe(document.body, { childList: true, subtree: true });
        } catch (e) {}
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 900); });
    } else {
        setTimeout(boot, 900);
    }

    window.ChatPlus = {
        steal: function (t) { if (t) doSteal(String(t)); },
        report: openReport,
        pick: cardPick
    };
})();
