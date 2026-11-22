/**
 * chatplus.js — 主聊天上的两个小功能（不动 core.js）
 * ------------------------------------------------------------
 * 1) 偷走这句：他那侧自动来偷 —— 你发完消息，他有 3% 几率把你刚说的那句收进字卡库，
 *    聊天里只浮一行小字「梦角 偷走了你的「…」」。你这边没有任何按钮，不怕误触就入卡
 * 2) 查岗：入口在「高级功能」面板里的「查岗」，点了弹白卡，你选文字报备 / 拍照报备 / 拒绝报备
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
            '.cx-steal-note{position:fixed;left:50%;transform:translateX(-50%);bottom:96px;z-index:10002;',
            'max-width:78vw;text-align:center;padding:7px 13px;border-radius:999px;',
            'background:rgba(255,253,249,.96);border:1px solid #ecdcc8;color:#9a7a58;',
            'font-size:12px;line-height:1.45;opacity:0;transition:opacity .45s;font-family:inherit;}',
            '.cx-steal-note.on{opacity:1;}',
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

    /* ═══════════════ 二、偷走这句（他那侧自动来偷） ═══════════════ */

    var STEAL_KEY = 'cx_steal_last';
    var STEAL_CHANCE = 0.03;
    var STEAL_COOLDOWN = 60 * 60 * 1000;
    var stealBtn = null;

    function hideSteal() {
        if (stealBtn && stealBtn.parentNode) stealBtn.parentNode.removeChild(stealBtn);
        stealBtn = null;
    }

    function stealLastAt() {
        try { return parseInt(localStorage.getItem(STEAL_KEY) || '0', 10) || 0; } catch (e) { return 0; }
    }
    function stampSteal() {
        try { localStorage.setItem(STEAL_KEY, String(Date.now())); } catch (e) {}
    }

    function note(msg) {
        try {
            var n = document.createElement('div');
            n.className = 'cx-steal-note';
            n.textContent = msg;
            document.body.appendChild(n);
            setTimeout(function () { n.classList.add('on'); }, 60);
            setTimeout(function () { n.classList.remove('on'); }, 5200);
            setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 5900);
        } catch (e) {}
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

    function mineText() {
        try {
            var a = (typeof messages !== 'undefined' && messages) ? messages : [];
            for (var i = a.length - 1; i >= 0; i--) {
                if (a[i] && a[i].sender === 'user') {
                    var t = String(a[i].text || '').replace(/\s+/g, ' ').trim();
                    if (t && t.length <= 80) return t;
                }
            }
        } catch (e) {}
        return '';
    }

    /* ═══ 偷来的卡：自动归到「偷来的」分组，方便单独整理 ═══ */
    var STEAL_GROUP_NAME = '偷来的';
    var STEAL_GROUP_COLOR = '#a08c7a';

    function fileIntoStealGroup(text) {
        try {
            if (!Array.isArray(window.customReplyGroups)) window.customReplyGroups = [];
            var gs = window.customReplyGroups;
            var g = null;
            for (var i = 0; i < gs.length; i++) {
                if (gs[i] && String(gs[i].name || '') === STEAL_GROUP_NAME) { g = gs[i]; break; }
            }
            if (!g) {
                g = { id: Date.now(), name: STEAL_GROUP_NAME, color: STEAL_GROUP_COLOR, disabled: false, items: [] };
                gs.push(g);                       // 新组排在最后，原来分组的顺序不动
            }
            if (!Array.isArray(g.items)) g.items = [];

            /* 同一句只留一份：若它本来在别的组，从那儿摘走 */
            gs.forEach(function (x) {
                if (!x || x === g || !Array.isArray(x.items)) return;
                for (var j = x.items.length - 1; j >= 0; j--) {
                    if (String(x.items[j] == null ? '' : x.items[j]).trim() === text) x.items.splice(j, 1);
                }
            });
            if (g.items.indexOf(text) === -1) g.items.push(text);

            try {
                var key = getStorageKey('customReplyGroups');
                if (key && typeof localforage !== 'undefined') localforage.setItem(key, gs);
            } catch (e) {}
            try { if (typeof throttledSaveData === 'function') throttledSaveData(); } catch (e) {}
            try {
                if (typeof renderReplyLibrary === 'function' && document.getElementById('custom-replies-list')) renderReplyLibrary();
            } catch (e) {}
            return true;
        } catch (e) { return false; }
    }

    function autoSteal() {
        if (Date.now() - stealLastAt() < STEAL_COOLDOWN) return;
        var t = mineText();
        if (!t) return;
        var arr = window._customReplies;
        if (!Array.isArray(arr)) { arr = []; window._customReplies = arr; }
        if (arr.some(function (x) { return String(x == null ? '' : x).trim() === t; })) return;
        if (Math.random() >= STEAL_CHANCE) return;

        function finish(val) {
            var list = window._customReplies;
            if (!Array.isArray(list)) { list = []; window._customReplies = list; }
            if (list.some(function (x) { return String(x == null ? '' : x).trim() === val; })) return;
            list.push(val);
            fileIntoStealGroup(val);      // 偷来的卡单独归组
            saveCards();
            stampSteal();
            note(partnerName() + ' 偷走了你的「' + (val.length > 14 ? val.slice(0, 14) + '…' : val) + '」');
        }

        /* 入库前补成「中文（日语）」，跟字卡库的格式保持一致 */
        if (window.CardTrans && (window.CardTrans.fillJp || window.CardTrans.fill)) {
            var _f = window.CardTrans.fillJp || window.CardTrans.fill;
            _f(t).then(function (v) { finish(v || t); }).catch(function () { finish(t); });
        } else {
            finish(t);
        }
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
            openReportForm(k);
        });
    }


    /* 选完报备方式之后，顺势弹一个对应的填写框 */
    var reportForm = null;

    function closeReportForm() {
        if (reportForm && reportForm.parentNode) reportForm.parentNode.removeChild(reportForm);
        reportForm = null;
        var tmp = document.getElementById('cx-rep-file');
        if (tmp && tmp.parentNode) tmp.parentNode.removeChild(tmp);
    }

    function ensureFormStyle() {
        if (document.getElementById('cx-rep-form-style')) return;
        var st = document.createElement('style');
        st.id = 'cx-rep-form-style';
        st.textContent = [
            '.cx-report-form{text-align:left}',
            '.cx-form-tip{font-size:12px;color:#7b93a8;line-height:1.6;margin:2px 0 8px}',
            '#cx-rep-text{width:100%;min-height:84px;box-sizing:border-box;border:1px solid rgba(140,170,195,.35);',
            'border-radius:12px;padding:10px 12px;font-size:13px;color:#324a60;background:#fff;outline:none;',
            'font-family:inherit;resize:none;line-height:1.6}',
            '#cx-rep-text:focus{border-color:rgba(90,150,200,.65)}',
            '.cx-form-actions{display:flex;gap:10px;margin-top:10px}',
            '.cx-form-actions .cx-rep-btn{flex:1;margin-top:0}',
            '.cx-rep-preview{text-align:center;margin:6px 0 2px;display:none}',
            '.cx-rep-preview img{max-width:100%;max-height:170px;border-radius:12px;border:1px solid rgba(140,170,195,.3)}'
        ].join('');
        document.head.appendChild(st);
    }

    function openReportForm(kind) {
        ensureFormStyle();
        closeReportForm();
        var isText = kind === 'text';
        var isPhoto = kind === 'photo';
        var title = isText ? '文字报备' : (isPhoto ? '图片报备' : '拒绝报备');
        var tip = isText ? '写一句你现在在做什么，发给他。'
                : (isPhoto ? '从相册选一张照片，让他看看你现在在哪。'
                          : '说一句为什么不想报备，可以留空。');
        var ph = isText ? '正在做什么…' : '不想报备的理由（可留空）';

        reportForm = document.createElement('div');
        reportForm.className = 'cx-report-overlay';
        reportForm.innerHTML = [
            '<div class="cx-report-card cx-report-form">',
            '  <div class="cx-report-title">' + title + '</div>',
            '  <div class="cx-form-tip">' + tip + '</div>',
            isPhoto
                ? '  <button class="cx-rep-btn" id="cx-rep-pick">从相册选一张</button>' +
                  '  <div class="cx-rep-preview" id="cx-rep-preview"><img alt=""></div>'
                : '  <textarea id="cx-rep-text" placeholder="' + ph + '"></textarea>',
            '  <div class="cx-form-actions">',
            '    <button class="cx-rep-btn" id="cx-rep-cancel" style="background:rgba(120,150,175,.16);color:#56718a;">取消</button>',
            '    <button class="cx-rep-btn" id="cx-rep-send">发送</button>',
            '  </div>',
            '</div>'
        ].join('');
        document.body.appendChild(reportForm);

        reportForm.addEventListener('click', function (e) {
            if (e.target === reportForm) closeReportForm();
        });
        reportForm.querySelector('#cx-rep-cancel').addEventListener('click', closeReportForm);

        var picked = null;
        var fileInput = null;

        if (isPhoto) {
            fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = 'image/*';
            fileInput.id = 'cx-rep-file';
            fileInput.style.display = 'none';
            fileInput.addEventListener('change', function () {
                var f = fileInput.files && fileInput.files[0];
                fileInput.value = '';
                if (!f) return;
                if (f.size > 30 * 1024 * 1024) {
                    showNotification('图片太大了（超过30MB）', 'error');
                    return;
                }
                showNotification('正在优化图片…', 'info', 1300);
                optimizeImage(f, 1080, 0.82).then(function (data) {
                    if (!data) throw new Error('empty');
                    picked = data;
                    var pv = reportForm.querySelector('#cx-rep-preview');
                    pv.style.display = 'block';
                    pv.querySelector('img').src = data;
                }).catch(function () {
                    showNotification('图片处理失败，换一张试试', 'error');
                });
            });
            document.body.appendChild(fileInput);
            reportForm.querySelector('#cx-rep-pick').addEventListener('click', function () {
                fileInput.click();
            });
            setTimeout(function () { try { fileInput.click(); } catch (e) {} }, 120);
        } else {
            var ta = reportForm.querySelector('#cx-rep-text');
            setTimeout(function () { try { ta.focus(); } catch (e) {} }, 160);
        }

        reportForm.querySelector('#cx-rep-send').addEventListener('click', function () {
            if (isPhoto) {
                if (!picked) { showNotification('先选一张照片', 'error'); return; }
                closeReportForm();
                try {
                    addMessage({
                        id: Date.now(), sender: 'user', text: '', timestamp: new Date(),
                        image: picked, status: 'sent', favorited: false, note: null, replyTo: null, type: 'normal'
                    });
                    if (typeof playSound === 'function') playSound('send');
                } catch (e) {}
                try { if (window.simulateReply) setTimeout(window.simulateReply, 1200 + Math.random() * 1200); } catch (e) {}
                showNotification('✓ 照片已发送', 'success', 1500);
                return;
            }
            var input = reportForm.querySelector('#cx-rep-text');
            var v = (input && input.value || '').trim();
            if (isText && !v) { showNotification('写一句再发', 'error'); return; }
            if (!isText && !v) v = '不想报备';
            closeReportForm();
            try {
                if (typeof sendMessage === 'function') sendMessage(v);
                else addMessage({ id: Date.now(), sender: 'user', text: v, timestamp: new Date(), status: 'sent', type: 'normal' });
            } catch (e) {}
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

    function ensureEntry() {
        var legacy = document.getElementById('cx-bell-btn');
        if (legacy && legacy.parentNode) legacy.parentNode.removeChild(legacy);

        var box = document.getElementById('advanced-modal');
        var list = box ? box.querySelector('.settings-item-list') : null;
        if (list) {
            if (!document.getElementById('cx-report-entry')) {
                var item = document.createElement('div');
                item.className = 'settings-item';
                item.id = 'cx-report-entry';
                item.innerHTML = '<i class="fas fa-bell"></i><span>查岗</span>';
                item.addEventListener('click', function () {
                    if (typeof window.hideModal === 'function') window.hideModal(box);
                    setTimeout(openReport, 200);
                });
                list.appendChild(item);
            }
            return true;
        }

        if (!document.getElementById('cx-bell-btn')) {
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
        }
        return true;
    }

    /* ═══════════════ 四、绑定 ═══════════════ */

    function bind() {
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey && e.target && e.target.id === 'message-input') {
                setTimeout(maybeReport, 2500);
                setTimeout(autoSteal, 2800);
            }
        });

        document.addEventListener('click', function (e) {
            var t = e.target;
            if (!t || !t.closest) return;
            if (t.closest('#send-btn')) {
                setTimeout(maybeReport, 2500);
                setTimeout(autoSteal, 2800);
            }
        }, true);
    }

    /* ═══════════════ 五、启动 ═══════════════ */

    function boot() {
        injectStyle();
        bind();
        if (!ensureEntry()) {
            setTimeout(ensureEntry, 1500);
            setTimeout(ensureEntry, 4000);
        }
        try {
            var mo = new MutationObserver(function () {
                if (!document.getElementById('cx-report-entry') && !document.getElementById('cx-bell-btn')) ensureEntry();
            });
            mo.observe(document.body, { childList: true, subtree: true });
        } catch (e) {}
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 900); });
    } else {
        setTimeout(boot, 900);
    }

    /* 拍照/相机功能已撤除（不调用摄像头、不申请拍照权限） */

    window.ChatPlus = {
        steal: autoSteal,
        report: openReport,
        pick: cardPick,
        file: fileIntoStealGroup
    };
})();
