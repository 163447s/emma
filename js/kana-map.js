/* kana-map.js —— 日语五十音假名数据表
 * 定位：供"打字功能"随机生成使用（typing-keyboard.js），以及纠错A的罗马音换算（roman-correction.js）
 * 依赖：无。在 core.js / auto-message.js 之前加载。
 * 暴露：window.KanaMap = { SEION, DAKUON, HANDAKUON, SPECIAL, ALL_KANA, kanaToRomaji, romajiToKana }
 */
(function () {
    'use strict';

    // ── 五十音：清音（按行） ──
    var SEION = [
        'あいうえお',
        'かきくけこ',
        'さしすせそ',
        'たちつてと',
        'なにぬねの',
        'はひふへほ',
        'まみむめも',
        'やゆよ',
        'らりるれろ',
        'わをん'
    ];
    // 浊音（が行/ざ行/だ行/ば行）
    var DAKUON = [
        'がぎぐげご',
        'ざじずぜぞ',
        'だぢづでど',
        'ばびぶべぼ'
    ];
    // 半浊音（ぱ行）
    var HANDAKUON = [
        'ぱぴぷぺぽ'
    ];
    // 拗音（33 个，两字一组，随机生成时整体出现）
    var YOON_LIST = [
        'きゃ', 'きゅ', 'きょ', 'しゃ', 'しゅ', 'しょ', 'ちゃ', 'ちゅ', 'ちょ',
        'にゃ', 'にゅ', 'にょ', 'ひゃ', 'ひゅ', 'ひょ', 'みゃ', 'みゅ', 'みょ',
        'りゃ', 'りゅ', 'りょ', 'ぎゃ', 'ぎゅ', 'ぎょ', 'じゃ', 'じゅ', 'じょ',
        'びゃ', 'びゅ', 'びょ', 'ぴゃ', 'ぴゅ', 'ぴょ'
    ];
    // 小写假名
    var SMALL_KANA = ['ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ', 'ゃ', 'ゅ', 'ょ'];
    // 特殊：促音 / 长音（ん 已在清音わ行，不重复放入）
    var SPECIAL = ['っ', 'ー'];

    // 全部假名（生成用字符池）
    function flatten(rows) {
        var out = [];
        rows.forEach(function (r) { for (var i = 0; i < r.length; i++) out.push(r[i]); });
        return out;
    }
    var ALL_KANA = flatten(SEION).concat(flatten(DAKUON)).concat(flatten(HANDAKUON))
        .concat(YOON_LIST).concat(SMALL_KANA).concat(SPECIAL);

    // ── 假名 → 标准罗马音（纠错A 编辑距离匹配用；含特殊兼容写法）──
    var KANA_ROMAN = {
        'あ': 'a', 'い': 'i', 'う': 'u', 'え': 'e', 'お': 'o',
        'か': 'ka', 'き': 'ki', 'く': 'ku', 'け': 'ke', 'こ': 'ko',
        'さ': 'sa', 'し': 'shi', 'す': 'su', 'せ': 'se', 'そ': 'so',
        'た': 'ta', 'ち': 'chi', 'つ': 'tsu', 'て': 'te', 'と': 'to',
        'な': 'na', 'に': 'ni', 'ぬ': 'nu', 'ね': 'ne', 'の': 'no',
        'は': 'ha', 'ひ': 'hi', 'ふ': 'fu', 'へ': 'he', 'ほ': 'ho',
        'ま': 'ma', 'み': 'mi', 'む': 'mu', 'め': 'me', 'も': 'mo',
        'や': 'ya', 'ゆ': 'yu', 'よ': 'yo',
        'ら': 'ra', 'り': 'ri', 'る': 'ru', 'れ': 're', 'ろ': 'ro',
        'わ': 'wa', 'を': 'wo', 'ん': 'n',
        'が': 'ga', 'ぎ': 'gi', 'ぐ': 'gu', 'げ': 'ge', 'ご': 'go',
        'ざ': 'za', 'じ': 'ji', 'ず': 'zu', 'ぜ': 'ze', 'ぞ': 'zo',
        'だ': 'da', 'ぢ': 'di', 'づ': 'du', 'で': 'de', 'ど': 'do',
        'ば': 'ba', 'び': 'bi', 'ぶ': 'bu', 'べ': 'be', 'ぼ': 'bo',
        'ぱ': 'pa', 'ぴ': 'pi', 'ぷ': 'pu', 'ぺ': 'pe', 'ぽ': 'po',
        'っ': '', 'ー': ''
    };

    // 罗马音 → 假名（纠错A 演示实时转换用；兼容写法一并收录）
    var ROMAN_KANA = {
        a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お',
        ka: 'か', ki: 'き', ku: 'く', ke: 'け', ko: 'こ',
        sa: 'さ', si: 'し', shi: 'し', su: 'す', se: 'せ', so: 'そ',
        ta: 'た', ti: 'ち', chi: 'ち', tu: 'つ', tsu: 'つ', te: 'て', to: 'と',
        na: 'な', ni: 'に', nu: 'ぬ', ne: 'ね', no: 'の',
        ha: 'は', hi: 'ひ', hu: 'ふ', fu: 'ふ', he: 'へ', ho: 'ほ',
        ma: 'ま', mi: 'み', mu: 'む', me: 'め', mo: 'も',
        ya: 'や', yu: 'ゆ', yo: 'よ',
        ra: 'ら', ri: 'り', ru: 'る', re: 'れ', ro: 'ろ',
        wa: 'わ', wo: 'を',
        ga: 'が', gi: 'ぎ', gu: 'ぐ', ge: 'げ', go: 'ご',
        za: 'ざ', zi: 'じ', ji: 'じ', zu: 'ず', ze: 'ぜ', zo: 'ぞ',
        da: 'だ', di: 'ぢ', du: 'づ', de: 'で', do: 'ど',
        ba: 'ば', bi: 'び', bu: 'ぶ', be: 'べ', bo: 'ぼ',
        pa: 'ぱ', pi: 'ぴ', pu: 'ぷ', pe: 'ぺ', po: 'ぽ',
        // 拗音（标准+日式变体）
        kya: 'きゃ', kyu: 'きゅ', kyo: 'きょ',
        sha: 'しゃ', sya: 'しゃ', shu: 'しゅ', syu: 'しゅ', sho: 'しょ', syo: 'しょ',
        cha: 'ちゃ', tya: 'ちゃ', chu: 'ちゅ', tyu: 'ちゅ', cho: 'ちょ', tyo: 'ちょ',
        nya: 'にゃ', nyu: 'にゅ', nyo: 'にょ',
        hya: 'ひゃ', hyu: 'ひゅ', hyo: 'ひょ',
        mya: 'みゃ', myu: 'みゅ', myo: 'みょ',
        rya: 'りゃ', ryu: 'りゅ', ryo: 'りょ',
        gya: 'ぎゃ', gyu: 'ぎゅ', gyo: 'ぎょ',
        ja: 'じゃ', zya: 'じゃ', ju: 'じゅ', zyu: 'じゅ', jo: 'じょ', zyo: 'じょ',
        bya: 'びゃ', byu: 'びゅ', byo: 'びょ',
        pya: 'ぴゃ', pyu: 'ぴゅ', pyo: 'ぴょ'
    };
    var ROMAN_KEYS = Object.keys(ROMAN_KANA).sort(function (a, b) { return b.length - a.length; });

    /** 简单罗马音 → 假名（纠错A 演示用；不做增量待定，直接完整转换） */
    function romajiToKana(str) {
        if (!str) return '';
        var out = '';
        var i = 0;
        var n = str.length;
        while (i < n) {
            var ch = str[i];
            if (!/[a-z]/.test(ch)) { out += ch; i++; continue; }
            var matched = false;
            for (var L = 3; L >= 1; L--) {
                if (i + L > n) continue;
                var seg = str.substr(i, L).toLowerCase();
                if (Object.prototype.hasOwnProperty.call(ROMAN_KANA, seg)) {
                    out += ROMAN_KANA[seg];
                    i += L;
                    matched = true;
                    break;
                }
            }
            if (matched) continue;
            // 促音双写
            if (ch !== 'n' && i + 1 < n && str[i + 1] === ch && /[a-z]/.test(ch)) {
                out += 'っ';
                i += 1;
                continue;
            }
            if (ch === 'n') {
                var next = i + 1 < n ? str[i + 1] : '';
                if (next && 'aiueoy'.indexOf(next) >= 0) { out += 'n'; i += 1; continue; }
                if (!next) { out += 'ん'; i += 1; continue; }
                out += 'ん'; i += 1; continue;
            }
            out += ch; i += 1;
        }
        return out;
    }

    window.KanaMap = {
        SEION: SEION,
        DAKUON: DAKUON,
        HANDAKUON: HANDAKUON,
        SPECIAL: SPECIAL,
        ALL_KANA: ALL_KANA,
        kanaToRomaji: function (kana) { return KANA_ROMAN[kana] || ''; },
        romajiToKana: romajiToKana
    };
})();
