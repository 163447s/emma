/**
 * dejapanese.js — 把日语收成全中文（跑一次就够）
 * - 字卡：`日语（中文）` → 中文
 * - 聊天记录：同一套规则，把人那侧/你这侧双语的都收回中文
 */
(function () {
    'use strict';

    var FLAG = 'cx_deja_v1';

    function hasJP(s) { return /[\u3040-\u30ff]/.test(s); }

    function zhOf(s) {
        s = String(s == null ? '' : s).trim();
        if (!s) return s;

        // 「A（B）」：日语那半舍掉，留中文那半
        var m = s.match(/^([^（）()]{1,200})\s*[（(]([^（）()]{1,200})[）)]$/);
        if (m) {
            var outer = m[1].trim(), inner = m[2].trim();
            if (hasJP(outer) && !hasJP(inner)) return inner;   // 日语（中文）
            if (hasJP(inner) && !hasJP(outer)) return outer;   // 中文（日语）
            if (!hasJP(inner)) return inner;
            if (!hasJP(outer)) return outer;
        }

        // 含假名但没有成对括号：把假名抠掉，剩下的中文留下
        if (hasJP(s)) {
            var zh = s.replace(/[\u3040-\u30ff]/g, ' ')
                      .replace(/[（）()]/g, ' ')
                      .replace(/\s+/g, ' ')
                      .trim();
            if (zh) return zh;
        }
        return s;
    }

    function run() {
        var changedCards = 0, changedMsgs = 0;

        // 1) 字卡
        try {
            var list = (window && Array.isArray(window._customReplies)) ? window._customReplies : null;
            if (list && list.length) {
                for (var i = 0; i < list.length; i++) {
                    if (typeof list[i] !== 'string') continue;
                    var v = zhOf(list[i]);
                    if (v && v !== list[i]) { list[i] = v; changedCards++; }
                }
            }
        } catch (e) {}

        // 2) 聊天记录
        try {
            var a = (window.messages && Array.isArray(window.messages)) ? window.messages : ((typeof messages !== 'undefined' && Array.isArray(messages)) ? messages : null);
            if (a && a.length) {
                a.forEach(function (msg) {
                    if (!msg || typeof msg.text !== 'string' || !msg.text) return;
                    var v = zhOf(msg.text);
                    if (v && v !== msg.text) { msg.text = v; changedMsgs++; }
                    if (typeof msg.originalText === 'string' && hasJP(msg.originalText)) {
                        var o = zhOf(msg.originalText);
                        if (o) msg.originalText = o;
                    }
                });
            }
        } catch (e) {}

        if (!changedCards && !changedMsgs) return;

        try { (window.saveData || (typeof saveData === 'function' ? saveData : null) || function(){})(); } catch (e) {}
        setTimeout(function () { try { (window.throttledSaveData || function(){})(); } catch (e) {} }, 1200);
        try { if (typeof renderMessages === 'function') renderMessages(true); } catch (e) {}

        try {
            if (typeof showNotification === 'function') {
                showNotification('已收成全中文：字卡 ' + changedCards + ' 条、聊天 ' + changedMsgs + ' 条', 'success', 3200);
            }
        } catch (e) {}
        try { localStorage.setItem(FLAG, '1'); } catch (e) {}
    }

    function boot() {
        var done = false;
        try { done = localStorage.getItem(FLAG) === '1'; } catch (e) {}
        if (done) return;
        // 等本地数据、字卡库都加载完再动
        setTimeout(run, 6500);
        setTimeout(run, 20000);      // 万一第一次没赶上
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 300); });
    } else {
        setTimeout(boot, 300);
    }
})();
