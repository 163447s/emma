/**
 * cardtrans.js — 字卡自动补日语翻译
 * ------------------------------------------------------------
 * 规则：主字卡统一存成「中文（日语译文）」。
 *   - 输入中文 → 后面自动加（日语翻译）
 *   - 偶尔输入日语 → 前面补中文，变成「中文（日语原文）」
 * 已有的字卡：启动后自动扫一遍补齐；之后每 45 秒检查一次，
 * 任何入口新加的字卡（含被偷走的那句）都会在几秒内补上。
 * 不动原站逻辑，只改字卡数组里的文本。
 */
(function () {
    'use strict';

    var API = 'https://api.deepseek.com/chat/completions';
    var MODEL = 'deepseek-chat';
    var FALLBACK_KEY = 'sk-d2844d399fb54e539f8d14527ab4ba58';
    var BATCH = 8;

    var running = false;

    function getKey() {
        try {
            var c = JSON.parse(localStorage.getItem('cx_chuan_cfg') || '{}') || {};
            if (c.key) return c.key;
        } catch (e) {}
        return FALLBACK_KEY;
    }

    function pool() {
        try {
            if (typeof customReplies !== 'undefined' && Array.isArray(customReplies)) return customReplies;
        } catch (e) {}
        try {
            if (Array.isArray(window._customReplies)) return window._customReplies;
        } catch (e) {}
        return null;
    }

    function isJP(s) { return /[\u3040-\u30ff]/.test(s); }

    /* 已经带括号翻译的不再处理 */
    function hasPair(s) {
        return /[（(][^（）()]{1,100}[）)]\s*$/.test(s);
    }

    function isTarot(s) { return s.indexOf('__TAROT__') === 0; }

    function compose(orig, tr) {
        orig = String(orig == null ? '' : orig).trim();
        tr = String(tr == null ? '' : tr).trim();
        if (!tr) return orig;
        if (isJP(orig)) return tr + '（' + orig + '）';
        return orig + '（' + tr + '）';
    }

    function translate(texts) {
        var k = getKey();
        if (!k) return Promise.reject(new Error('no key'));
        var sys = '你是翻译引擎。把用户给出的每条句子翻译成日语；如果某条本身已经是日语，就翻译成简体中文。'
                + '保持原来的语气、口吻和长度，不加引号，不加解释，不要合并或拆分句子。'
                + '只输出一个 JSON 字符串数组，元素数量必须与输入完全一致。';
        return fetch(API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + k },
            body: JSON.stringify({
                model: MODEL,
                messages: [
                    { role: 'system', content: sys },
                    { role: 'user', content: JSON.stringify(texts) }
                ],
                temperature: 0.2,
                max_tokens: 1200
            })
        }).then(function (r) { return r.json(); }).then(function (j) {
            var c = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
            if (!c) throw new Error('empty');
            var m = String(c).match(/\[[\s\S]*\]/);
            var a = JSON.parse(m ? m[0] : c);
            if (!Array.isArray(a)) throw new Error('bad');
            return a.map(function (x) { return String(x == null ? '' : x).trim(); });
        });
    }

    function persist(list) {
        try { if (Array.isArray(window._customReplies) && window._customReplies !== list) window._customReplies = list; } catch (e) {}
        try { if (typeof throttledSaveData === 'function') { throttledSaveData(); return; } } catch (e) {}
        try { if (typeof saveData === 'function') saveData(); } catch (e) {}
    }

    function refreshList() {
        try {
            if (typeof renderReplyLibrary === 'function' && document.getElementById('custom-replies-list')) renderReplyLibrary();
        } catch (e) {}
    }

    /* 单条：给新加的字卡现翻现拼 */
    function fill(text) {
        var t = String(text == null ? '' : text).trim();
        if (!t || hasPair(t) || isTarot(t)) return Promise.resolve(t);
        return translate([t]).then(function (a) {
            return compose(t, a && a[0]);
        }).catch(function () { return t; });
    }

    function countNeed(list) {
        var n = 0;
        for (var i = 0; i < list.length; i++) {
            var s = String(list[i] == null ? '' : list[i]).trim();
            if (!s || hasPair(s) || isTarot(s)) continue;
            n++;
        }
        return n;
    }

    /* 批量补齐 */
    function scan() {
        if (running) return;
        var list = pool();
        if (!list || !list.length) return;
        if (!countNeed(list)) return;

        running = true;
        var fixed = 0;
        var fails = 0;
        var rounds = 0;

        function loop() {
            if (rounds++ > 60) { finish(); return; }
            var cur = pool();
            if (!cur) { running = false; return; }

            var idx = [];
            for (var i = 0; i < cur.length && idx.length < BATCH; i++) {
                var s = String(cur[i] == null ? '' : cur[i]).trim();
                if (!s || hasPair(s) || isTarot(s)) continue;
                idx.push(i);
            }
            if (!idx.length) { finish(); return; }

            var texts = idx.map(function (i) { return String(cur[i]).trim(); });
            translate(texts).then(function (trs) {
                fails = 0;
                var changed = false;
                idx.forEach(function (i, k) {
                    var now = String(cur[i] == null ? '' : cur[i]).trim();
                    var tr = String(trs[k] == null ? '' : trs[k]).trim();
                    if (!tr || hasPair(now)) return;
                    var f = compose(now, tr);
                    if (f && f !== cur[i]) { cur[i] = f; changed = true; fixed++; }
                });
                if (changed) { persist(cur); refreshList(); }
                setTimeout(loop, 700);
            }).catch(function () {
                if (++fails >= 2) { finish(); return; }
                setTimeout(loop, 1400);
            });
        }

        function finish() {
            running = false;
            persist(pool() || []);
            if (fixed) {
                try {
                    if (typeof showNotification === 'function') showNotification('✓ 已给 ' + fixed + ' 条字卡补上日语翻译', 'success', 3000);
                } catch (e) {}
            }
        }

        loop();
    }

    function boot() {
        setTimeout(scan, 2500);          // 打开页面先补一遍老字卡
        setInterval(scan, 45 * 1000);    // 之后新加的字卡自动跟上
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    window.CardTrans = { fill: fill, scan: scan, compose: compose };
})();
