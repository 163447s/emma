/* typing-keyboard.js —— 日语键盘打字：随机生成假名消息 + 输出端轻纠错（纠错B）
 * 定位：MJ 主动打字功能的消息生成器。触发机制由 core.js 现有逻辑负责。
 * 依赖：kana-map.js（window.KanaMap）
 * 暴露：window.TypingKeyboard = { generateTypingMessage, keyboardGrid }
 * 说明：
 *   - 键盘采用日本人日常使用的 12 键九宫格假名布局（flick 式）：あかさたなはまやらわ
 *     十个行键 + 小写 * 键 + 特殊键（っーん）；每键默认 a 段，滑动选 i/u/e/o，
 *     浊音点两下、半浊音点三下、小写用 * 键变换。布局仅用于设置页展示与试拼，
 *     随机生成仍从五十音假名池组合（允许无意义组合）。
 *   - 纠错B 仅兜底极端垃圾输出：连续重复>3 去重、长度异常重生成、纯标点重生成；其余混乱原样保留
 */
(function () {
    'use strict';

    // ── 12键九宫格假名键盘布局（flick 式）──
    // 每个行键：label=行名；a/i/u/e/o=该行五段（缺段留空）；dakuon=浊音段；handakuon=半浊音段
    // 滑动方向（日本手机惯例）：上=い、左=う、右=え、下=お
    var keyboardGrid = [
        { label: 'あ', a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お', dakuon: '', handakuon: '' },
        { label: 'か', a: 'か', i: 'き', u: 'く', e: 'け', o: 'こ', dakuon: 'がぎぐげご', handakuon: '' },
        { label: 'さ', a: 'さ', i: 'し', u: 'す', e: 'せ', o: 'そ', dakuon: 'ざじずぜぞ', handakuon: '' },
        { label: 'た', a: 'た', i: 'ち', u: 'つ', e: 'て', o: 'と', dakuon: 'だぢづでど', handakuon: '' },
        { label: 'な', a: 'な', i: 'に', u: 'ぬ', e: 'ね', o: 'の', dakuon: '', handakuon: '' },
        { label: 'は', a: 'は', i: 'ひ', u: 'ふ', e: 'へ', o: 'ほ', dakuon: 'ばびぶべぼ', handakuon: 'ぱぴぷぺぽ' },
        { label: 'ま', a: 'ま', i: 'み', u: 'む', e: 'め', o: 'も', dakuon: '', handakuon: '' },
        { label: 'や', a: 'や', i: 'ゆ', u: '', e: '', o: 'よ', small: 'ゃゅょ', dakuon: '', handakuon: '' },
        { label: 'ら', a: 'ら', i: 'り', u: 'る', e: 'れ', o: 'ろ', dakuon: '', handakuon: '' },
        { label: 'わ', a: 'わ', i: 'ん', u: '', e: '', o: 'を', dakuon: '', handakuon: '' },
        { type: 'small', label: '小写 *', kana: 'っゃゅょぁぃぅぇぉ' },
        { type: 'special', label: 'っ・ー・ん', kana: 'っーん' }
    ];

    var PUNCT = ['…', '！', '？'];

    function randomOf(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    // 生成一段原始假名串（长度 2~13，含 15% 概率带语气标点）
    function rawGenerate() {
        var len = 2 + Math.floor(Math.random() * 12);
        var out = '';
        for (var i = 0; i < len; i++) {
            var ch = randomOf(window.KanaMap.ALL_KANA);
            // 特殊字符（っ/ー/ん）与普通假名一样随机出现，维持真实打字感
            out += ch;
        }
        if (Math.random() < 0.15) out += randomOf(PUNCT);
        return out;
    }

    // ── 纠错B：轻量兜底 ──
    function cleanExtreme(s) {
        // 1) 同一假名连续重复超过 3 次 → 压缩保留 2~3 个
        var chars = s.split('');
        var out = '';
        var last = '';
        var run = 0;
        for (var i = 0; i < chars.length; i++) {
            if (chars[i] === last) {
                run++;
                if (run <= 3) out += chars[i];
            } else {
                last = chars[i];
                run = 1;
                out += chars[i];
            }
        }
        return out;
    }

    function hasRealKana(s) {
        return /[\u3041-\u3096]/.test(s);
    }

    /**
     * 生成一条可发送的打字消息
     * @returns {string} 假名消息；失败返回 ''
     */
    function generateTypingMessage() {
        var maxTries = 5;
        for (var t = 0; t < maxTries; t++) {
            var raw = rawGenerate();
            var cleaned = cleanExtreme(raw);
            // 2) 长度异常（<2 个假名 或 >20 个假名）→ 重新生成
            var kanaCount = (cleaned.match(/[\u3041-\u3096]/g) || []).length;
            if (kanaCount < 2 || kanaCount > 20) continue;
            // 3) 纯标点无假名 → 重新生成
            if (!hasRealKana(cleaned)) continue;
            return cleaned;
        }
        // 兜底：返回一个简单结果，避免死循环
        return 'あい';
    }

    window.TypingKeyboard = {
        generateTypingMessage: generateTypingMessage,
        keyboardGrid: keyboardGrid
    };
})();
