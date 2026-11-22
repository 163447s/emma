/**
 * cardtrans.js — 字卡自动补日语翻译
 * ------------------------------------------------------------
 * 规则：主字卡统一存成「中文（日语译文）」。
 *   - 输入中文 → 后面自动加（日语翻译）
 *   - 偶尔输入日语 → 前面补中文，变成「中文（日语原文）」
 * 已有的字卡：启动后自动扫一遍补齐；之后每 45 秒检查一次，
 * 任何入口新加的字卡（含被偷走的那句）都会在几秒内补上。
 * 只改文字本身：不删、不挪、不重排，字卡所属的分组也原样保留
 * （分组里存的那份文本会同步改掉，免得字卡掉出分组）。
 * 不动原站逻辑，只改字卡数组里的文本。
 */
(function () {
    'use strict';

    /* 有道（youdao demo 接口）：无需 key，允许跨域，逐条翻 */
    var YOUDAO = 'https://aidemo.youdao.com/trans';
    /* 有道挂了再退回 DeepSeek 批量 */
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
        /* 统一格式：日语在前、中文原文在括号里 */
        return composeJp(orig, tr);
    }

    /* ── 有道：一条一句，串行 ── */
    function youdaoOne(t) {
        var jp = isJP(t);
        var u = YOUDAO
            + '?q=' + encodeURIComponent(t)
            + '&from=' + (jp ? 'ja' : 'zh-CHS')
            + '&to=' + (jp ? 'zh-CHS' : 'ja');
        return fetch(u).then(function (r) { return r.json(); }).then(function (j) {
            if (!j || (j.errorCode != null && String(j.errorCode) !== '0')) {
                throw new Error('youdao:' + (j && j.errorCode));
            }
            var v = Array.isArray(j.translation) ? j.translation.join('') : String(j.translation || '');
            v = String(v).replace(/\s+/g, ' ').trim();
            if (!v) throw new Error('empty');
            return v;
        });
    }

    function translateYoudao(texts) {
        return new Promise(function (resolve, reject) {
            var out = new Array(texts.length);
            var i = 0;
            function next() {
                if (i >= texts.length) { resolve(out); return; }
                var k = i;
                youdaoOne(texts[k]).then(function (v) {
                    out[k] = v;
                    i++;
                    setTimeout(next, 240);
                }).catch(reject);
            }
            next();
        });
    }

    /* ── DeepSeek：批量兜底 ── */
    function translateAI(texts) {
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

    function translate(texts) {
        return translateYoudao(texts).catch(function () { return translateAI(texts); });
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

    /* ── 聊天新格式：日语在前、中文原文在括号里（方便他阅读）── */
    function composeJp(orig, tr) {
        orig = String(orig == null ? '' : orig).trim();
        tr = String(tr == null ? '' : tr).trim();
        if (!tr) return orig;
        if (!/[。！？!?…]$/.test(orig)) tr = tr.replace(/[。.]$/, '');
        if (isJP(orig)) return orig + '（' + tr + '）';   // 本来就是日语 → 日语（中文）
        return tr + '（' + orig + '）';                   // 中文 → 日语译文（中文原文）
    }

    /* 已是「X（Y）」的，把日语挪到前面；日语本来就在前面就返回 null 表示不用动 */
    function jpFirst(s) {
        var t = String(s == null ? '' : s).trim();
        var m = t.match(/^([^（）()]*?)\s*[（(]([^（）()]{1,120})[）)]$/);
        if (!m) return null;
        var outer = m[1].trim(), inner = m[2].trim();
        if (!outer || !inner) return null;
        if (isJP(outer)) return null;
        if (!isJP(inner)) return null;
        return inner + '（' + outer + '）';
    }

    function fillJp(text) {
        var t = String(text == null ? '' : text).trim();
        if (!t || isTarot(t)) return Promise.resolve(t);
        var swapped = jpFirst(t);
        if (swapped) return Promise.resolve(swapped);
        if (hasPair(t)) return Promise.resolve(t);
        return translate([t]).then(function (a) {
            return composeJp(t, a && a[0]);
        }).catch(function () { return t; });
    }

    /* 旧消息里「中文（日语）」的，换成「日语（中文）」。幂等，每轮都能再查一遍。 */
    function migrateChat() {
        try {
            var a = (typeof messages !== 'undefined' && Array.isArray(messages)) ? messages : null;
            if (!a || !a.length) return 0;
            var n = 0;
            a.forEach(function (m) {
                if (!m || m.sender !== 'user' || typeof m.text !== 'string') return;
                var v = jpFirst(m.text);
                if (v) { m.text = v; n++; }
            });
            if (n) {
                try { if (typeof saveData === 'function') saveData(); } catch (e) {}
                try { if (typeof renderMessages === 'function') renderMessages(true); } catch (e) {}
            }
            return n;
        } catch (e) { return 0; }
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

    function groupsPool() {
        try {
            if (typeof customReplyGroups !== 'undefined' && Array.isArray(customReplyGroups)) return customReplyGroups;
        } catch (e) {}
        try {
            if (Array.isArray(window.customReplyGroups)) return window.customReplyGroups;
        } catch (e) {}
        return null;
    }

    /* 改文本时，分组里存的那份也一起换掉，别让字卡掉出原来的分组 */
    function syncGroups(oldT, newT) {
        var gs = groupsPool();
        if (!gs) return;
        gs.forEach(function (g) {
            if (!g || !Array.isArray(g.items)) return;
            for (var i = 0; i < g.items.length; i++) {
                if (String(g.items[i] == null ? '' : g.items[i]).trim() === oldT) g.items[i] = newT;
            }
        });
    }

    /* 去掉结尾的括号译文，拿到原句 */
    function bareText(s) {
        return String(s == null ? '' : s).replace(/[（(][^（）()]{1,120}[）)]\s*$/, '').trim();
    }

    /* 更宽松的比较键：去掉空格与常见标点 */
    function looseKey(s) {
        return bareText(s).replace(/[\s，,。.、！!？?…~～「」『』"'“”（）()]/g, '');
    }

    /* 分组修复：当初翻译时分组里存的还是原句，现在对不上就全变「未分组」了。
       这里按「原句 → 现在的正式文本」把分组条目改回来，各回各家，不动顺序。 */
    function repairGroups() {
        var gs = groupsPool();
        var cards = pool();
        if (!gs || !gs.length || !cards || !cards.length) return 0;

        var exact = {}, byBare = {}, byLoose = {};
        for (var i = 0; i < cards.length; i++) {
            var c = String(cards[i] == null ? '' : cards[i]).trim();
            if (!c) continue;
            exact[c] = c;
            var b = bareText(c);
            if (b && !byBare[b]) byBare[b] = c;
            var l = looseKey(c);
            if (l && !byLoose[l]) byLoose[l] = c;
        }

        var fixed = 0;
        gs.forEach(function (g) {
            if (!g || !Array.isArray(g.items)) return;

            var out = [];
            var seen = {};
            for (var j = 0; j < g.items.length; j++) {
                var it = String(g.items[j] == null ? '' : g.items[j]).trim();
                if (!it) continue;

                var full = exact[it];
                if (!full) full = byBare[it] || byLoose[looseKey(it)] || byBare[bareText(it)];

                if (full && full !== it) { fixed++; }
                if (!full) full = it;          // 实在对不上就原样留着

                if (!seen[full]) { seen[full] = 1; out.push(full); }
            }

            if (out.length !== g.items.length) fixed++;
            g.items.length = 0;
            for (var k = 0; k < out.length; k++) g.items.push(out[k]);
        });

        if (fixed) {
            try { if (typeof customReplyGroups !== 'undefined' && Array.isArray(customReplyGroups)) customReplyGroups = gs; } catch (e) {}
            try { window.customReplyGroups = gs; } catch (e) {}
            try {
                var k2 = getStorageKey('customReplyGroups');
                if (k2) localforage.setItem(k2, gs);
            } catch (e) {}
            try { if (typeof throttledSaveData === 'function') throttledSaveData(); } catch (e) {}
            refreshList();
            try {
                if (typeof showNotification === 'function') showNotification('✓ 已把 ' + fixed + ' 条字卡放回原来的分组', 'success', 3000);
            } catch (e) {}
        }
        return fixed;
    }

    /* 字卡库统一成「日语（中文原文）」：只翻面，不删不挪，分组同步改。
       幂等 + 不设一次性开关 —— 卡库加载晚、或之后又进了旧格式的卡，都能再翻一次。 */
    function migrateCards() {
        try {
            var list = pool();
            if (!list || !list.length) return 0;
            var n = 0;
            for (var i = 0; i < list.length; i++) {
                var old = String(list[i] == null ? '' : list[i]).trim();
                if (!old) continue;
                var v = jpFirst(old);
                if (!v || v === old) continue;
                list[i] = v;
                syncGroups(old, v);
                n++;
            }
            if (n) {
                persist(list); refreshList(); repairGroups();
                try {
                    if (typeof showNotification === 'function') showNotification('✓ 已把 ' + n + ' 条字卡改成「日语（中文）」', 'success', 3000);
                } catch (e) {}
            }
            return n;
        } catch (e) { return 0; }
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
                    if (f && f !== cur[i]) {
                        cur[i] = f;            // 原地替换，不删不挪，顺序不变
                        syncGroups(now, f);
                        changed = true; fixed++;
                    }
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
            var p = pool();
            if (p) persist(p);
            repairGroups();                       // 每轮补完顺手把分组归位
            if (fixed) {
                try {
                    if (typeof showNotification === 'function') showNotification('✓ 已给 ' + fixed + ' 条字卡补上日语翻译', 'success', 3000);
                } catch (e) {}
            }
        }

        loop();
    }

    function boot() {
        setTimeout(function () { repairGroups(); migrateCards(); scan(); migrateChat(); }, 2500);   // 打开先归组、换格式、补翻译
        setInterval(function () { repairGroups(); migrateCards(); scan(); migrateChat(); }, 45 * 1000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    window.CardTrans = { fill: fill, fillJp: fillJp, scan: scan, compose: compose, repair: repairGroups, migrate: migrateChat, migrateCards: migrateCards };
})();
