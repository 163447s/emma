/* roman-correction.js —— 拼写纠错（纠错A）
 * 定位：设置页"打字功能"入口中编辑/试打日语相关内容时，与五十音标准罗马音做编辑距离匹配（≤1）轻提示
 * 依赖：kana-map.js（window.KanaMap 提供假名换算）
 * 暴露：window.RomanCorrection = { suggest, levenshtein }
 * 说明：只提示不自动改，不阻断输入
 */
(function () {
    'use strict';

    function levenshtein(a, b) {
        if (a === b) return 0;
        var m = a.length, n = b.length;
        if (!m) return n;
        if (!n) return m;
        var dp = new Array(m + 1);
        for (var i = 0; i <= m; i++) dp[i] = new Array(n + 1);
        for (i = 0; i <= m; i++) dp[i][0] = i;
        for (var j = 0; j <= n; j++) dp[0][j] = j;
        for (i = 1; i <= m; i++) {
            for (j = 1; j <= n; j++) {
                var cost = a[i - 1] === b[j - 1] ? 0 : 1;
                dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
            }
        }
        return dp[m][n];
    }

    // 常用词表（覆盖常见错误示例：漏字母、辅音漏双写、拗音拼错）
    var COMMON_WORDS = [
        'desu', 'konnichiwa', 'gakkou', 'kitte',
        'arigatou', 'sayounara', 'sumimasen', 'otsukaresama', 'ohayou', 'konbanwa',
        'ganbatte', 'mata', 'ashita', 'kyou', 'kinou', 'otanjoubi', 'omedetou',
        'suki', 'daisuki', 'kawaii', 'ureshii', 'sabishii', 'tanoshii', 'yabai', 'sugoi',
        'watashi', 'anata', 'kimi', 'senpai', 'kouhai', 'sensei', 'tomodachi', 'kareshi', 'kanojo',
        'benkyou', 'shigoto', 'issho', 'chotto', 'mada', 'mou', 'koko', 'soko', 'doko',
        'nani', 'dare', 'kono', 'sono', 'ano', 'hashiru', 'taberu', 'nomu', 'miru', 'kiku',
        'hanasu', 'omou', 'wakaru', 'ryokou', 'byouin', 'shashin', 'shokudou', 'jikan',
        'kyoumi', 'chousa', 'nyuusu', 'hyouji', 'zasshi', 'jisho', 'denwa', 'daijoubu'
    ];
    var WORD_SET = [];
    COMMON_WORDS.forEach(function (w) { if (WORD_SET.indexOf(w) < 0) WORD_SET.push(w); });

    // 拗音音节（syu→shu 这类；kiya→kya 属于编辑距离>1 不在纠错A 范围，但保留匹配）
    var YOON = ['kya', 'kyu', 'kyo', 'sha', 'shu', 'sho', 'cha', 'chu', 'cho',
        'nya', 'nyu', 'nyo', 'hya', 'hyu', 'hyo', 'mya', 'myu', 'myo',
        'rya', 'ryu', 'ryo', 'gya', 'gyu', 'gyo', 'ja', 'ju', 'jo',
        'bya', 'byu', 'byo', 'pya', 'pyu', 'pyo'];
    // 日式罗马音变体 → 标准拼写（syu→shu 等，直接命中优先）
    var YOON_VARIANTS = {
        'syu': 'shu', 'sya': 'sha', 'syo': 'sho', 'si': 'shi',
        'tyu': 'chu', 'tya': 'cha', 'tyo': 'cho', 'ti': 'chi',
        'zyu': 'ju', 'zya': 'ja', 'zyo': 'jo', 'zi': 'ji',
        'tu': 'tsu', 'hu': 'fu'
    };

    /**
     * 拼写纠错建议
     * @param {string} raw 输入的最后一段罗马音
     * @param {number} maxDist 最大编辑距离（默认 1）
     * @returns {object|null} { from, to, kana, kind } kind: 'word' | 'yoon'
     */
    function suggest(raw, maxDist) {
        if (!raw) return null;
        var s = String(raw).replace(/['’]/g, '').toLowerCase();
        if (s.length < 2) return null;
        var d = typeof maxDist === 'number' ? maxDist : 1;

        // 1) 整词匹配（漏字母 des→desu、漏双写 gakou→gakkou、kite→kitte 等）
        var best = null;
        for (var i = 0; i < WORD_SET.length; i++) {
            var w = WORD_SET[i];
            var dist = levenshtein(s, w);
            if (dist <= d && dist > 0 && (s.length >= 3 || dist === 1)) {
                if (!best || dist < best.dist) best = { dist: dist, w: w };
            }
        }
        if (best) {
            return {
                from: raw,
                to: best.w,
                kana: window.KanaMap ? window.KanaMap.romajiToKana(best.w) : '',
                kind: 'word'
            };
        }

        // 1.5) 日式罗马音变体直接命中（syu→shu 等：变体写法提示成标准拼写）
        if (Object.prototype.hasOwnProperty.call(YOON_VARIANTS, s) && s !== YOON_VARIANTS[s] && window.KanaMap) {
            var vt = YOON_VARIANTS[s];
            return { from: raw, to: vt, kana: window.KanaMap.romajiToKana(vt), kind: 'yoon' };
        }

        // 2) 拗音音节匹配（编辑距离 ≤1）
        if (s.length >= 3 && s.length <= 4) {
            var bestY = null;
            for (var j = 0; j < YOON.length; j++) {
                var y = YOON[j];
                var dy = levenshtein(s, y);
                if (dy <= d && (!bestY || dy < bestY.dist)) bestY = { dist: dy, y: y };
            }
            if (bestY && window.KanaMap) {
                var cur = window.KanaMap.romajiToKana(s);
                var alt = window.KanaMap.romajiToKana(bestY.y);
                if (cur !== alt) {
                    return { from: raw, to: bestY.y, kana: alt, kind: 'yoon' };
                }
            }
        }
        return null;
    }

    window.RomanCorrection = {
        suggest: suggest,
        levenshtein: levenshtein
    };
})();
