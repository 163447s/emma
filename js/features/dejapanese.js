/**
 * dejapanese.js — 把日语收成全中文 + 把字卡归回原来的分组
 */
(function () {
    'use strict';

    var FLAG = 'cx_deja_v2';

    function hasJP(s) { return /[\u3040-\u30ff]/.test(s); }

    function zhOf(s) {
        s = String(s == null ? '' : s).trim();
        if (!s) return s;
        var m = s.match(/^([^（）()]{1,200})\s*[（(]([^（）()]{1,200})[）)]$/);
        if (m) {
            var outer = m[1].trim(), inner = m[2].trim();
            if (hasJP(outer) && !hasJP(inner)) return inner;
            if (hasJP(inner) && !hasJP(outer)) return outer;
            if (!hasJP(inner)) return inner;
            if (!hasJP(outer)) return outer;
        }
        if (hasJP(s)) {
            var zh = s.replace(/[\u3040-\u30ff]/g, ' ')
                      .replace(/[（）()]/g, ' ')
                      .replace(/\s+/g, ' ')
                      .trim();
            if (zh) return zh;
        }
        return s;
    }

    /* 只留汉字的比对键：日语(中文) 与 中文 的键相同，借此把旧分组对上 */
    function zhKey(s) {
        var t = zhOf(s).replace(/[\uff01-\uff5e\u3000-\u303f\u2018-\u201d\u2026]/g, ' ');
        var c = t.replace(/[^\u4e00-\u9fa5]/g, '');
        return c;
    }

    function groupsPool() {
        try { if (Array.isArray(window.customReplyGroups)) return window.customReplyGroups; } catch (e) {}
        return null;
    }

    function saveGroups(gs) {
        try { window.customReplyGroups = gs; } catch (e) {}
        try {
            if (typeof getStorageKey === 'function' && typeof localforage !== 'undefined') {
                var k = getStorageKey('customReplyGroups');
                if (k) localforage.setItem(k, gs);
            }
        } catch (e) {}
    }

    /* 字卡：把文本收回中文，并顺手把分组里存的旧文本改掉 */
    function runCards() {
        var changed = 0;
        var cards = (window && Array.isArray(window._customReplies)) ? window._customReplies : null;
        if (cards && cards.length) {
            for (var i = 0; i < cards.length; i++) {
                if (typeof cards[i] !== 'string') continue;
                var v = zhOf(cards[i]);
                if (v && v !== cards[i]) { cards[i] = v; changed++; }
            }
        }
        return changed;
    }

    function runGroups() {
        var gs = groupsPool();
        var cards = (window && Array.isArray(window._customReplies)) ? window._customReplies : [];
        if (!gs || !gs.length) return 0;

        var byKey = {};
        for (var i = 0; i < cards.length; i++) {
            var c = String(cards[i] == null ? '' : cards[i]).trim();
            if (!c) continue;
            var k = zhKey(c);
            if (k && !byKey[k]) byKey[k] = c;
        }

        var changed = 0;
        gs.forEach(function (g) {
            if (!g || !Array.isArray(g.items)) return;
            var before = g.items.join('\u0001');
            var out = [], seen = {};
            for (var j = 0; j < g.items.length; j++) {
                var it = String(g.items[j] == null ? '' : g.items[j]).trim();
                if (!it) continue;
                var t = zhOf(it);
                if (cards.indexOf(t) === -1) {
                    var hit = byKey[zhKey(t)];
                    if (!hit) {
                        // 再去掉标点空格比一次
                        var loose = t.replace(/[\s，,。.、！!？?…~～「」『』"'“”（）()]/g, '');
                        for (var m = 0; m < cards.length; m++) {
                            if (String(cards[m] || '').replace(/[\s，,。.、！!？?…~～「」『』"'“”（）()]/g, '') === loose) { hit = cards[m]; break; }
                        }
                    }
                    if (hit) t = hit;
                }
                if (!seen[t]) { seen[t] = 1; out.push(t); }
            }
            g.items.length = 0;
            for (var p = 0; p < out.length; p++) g.items.push(out[p]);
            if (g.items.join('\u0001') !== before) changed++;
        });

        if (changed) saveGroups(gs);
        return changed;
    }

    function runMessages() {
        var changed = 0;
        var a = (window.messages && Array.isArray(window.messages)) ? window.messages
              : ((typeof messages !== 'undefined' && Array.isArray(messages)) ? messages : null);
        if (!a || !a.length) return 0;
        a.forEach(function (msg) {
            if (!msg || typeof msg.text !== 'string' || !msg.text) return;
            var v = zhOf(msg.text);
            if (v && v !== msg.text) { msg.text = v; changed++; }
            if (typeof msg.originalText === 'string' && hasJP(msg.originalText)) {
                var o = zhOf(msg.originalText);
                if (o) msg.originalText = o;
            }
        });
        return changed;
    }

    function looseLeft() {
        var gs = groupsPool();
        var cards = (window && Array.isArray(window._customReplies)) ? window._customReplies : [];
        if (!gs || !gs.length) return cards.length;
        var inside = {};
        gs.forEach(function (g) {
            if (!g || !Array.isArray(g.items)) return;
            g.items.forEach(function (t) { inside[String(t || '').trim()] = 1; });
        });
        var n = 0;
        cards.forEach(function (c) { if (!inside[String(c || '').trim()]) n++; });
        return n;
    }

    function run() {
        var cards = runCards();
        var groups = runGroups();
        var msgs = runMessages();

        if (cards || groups || msgs) {
            try { (window.saveData || (typeof saveData === 'function' ? saveData : function () {}))(); } catch (e) {}
            setTimeout(function () { try { (window.throttledSaveData || function () {})(); } catch (e) {} }, 1200);
            try { if (typeof renderMessages === 'function') renderMessages(true); } catch (e) {}
            try { if (window.CardTrans && CardTrans.repair) setTimeout(function () { try { CardTrans.repair(); } catch (e) {} }, 300); } catch (e) {}
        }

        var left = looseLeft();
        try {
            if (typeof showNotification === 'function') {
                var txt = '已收成全中文：字卡 ' + cards + ' 条、分组 ' + groups + ' 组、聊天 ' + msgs + ' 条';
                if (left) txt += '；还有 ' + left + ' 条没归组';
                showNotification(txt, left ? 'warning' : 'success', 4000);
            }
        } catch (e) {}
        try { localStorage.setItem(FLAG, '1'); } catch (e) {}
    }

    function boot() {
        var done = false;
        try { done = localStorage.getItem(FLAG) === '1'; } catch (e) {}
        if (done) return;
        setTimeout(run, 6500);
        setTimeout(run, 20000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 300); });
    } else {
        setTimeout(boot, 300);
    }
})();
