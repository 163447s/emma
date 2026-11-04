/* typing-keyboard.js —— 日语键盘打字：随机生成假名消息 + 输出端轻纠错（纠错B）
 * 定位：MJ 主动打字功能的消息生成器。触发机制由 core.js 现有逻辑负责。
 * 依赖：kana-map.js（window.KanaMap）
 * 暴露：window.TypingKeyboard = { generateTypingMessage, keyboardRows }
 * 说明：
 *   - 直接从标准五十音键盘（清音/浊音/半浊音/促音/长音/拨音）随机组合假名，允许无意义组合
 *   - 纠错B 仅兜底极端垃圾输出：连续重复>3 去重、长度异常重生成、纯标点重生成；其余混乱原样保留
 */
(function () {
    'use strict';

    // 标准日语键盘布局（行分组，供设置页展示与生成参考）
    var keyboardRows = [
        { label: 'あ行', kana: 'あいうえお' },
        { label: 'か行', kana: 'かきくけこ' },
        { label: 'さ行', kana: 'さしすせそ' },
        { label: 'た行', kana: 'たちつてと' },
        { label: 'な行', kana: 'なにぬねの' },
        { label: 'は行', kana: 'はひふへほ' },
        { label: 'ま行', kana: 'まみむめも' },
        { label: 'や行', kana: 'やゆよ' },
        { label: 'ら行', kana: 'らりるれろ' },
        { label: 'わ行', kana: 'わをん' },
        { label: '浊音', kana: 'がぎぐげござじずぜぞだぢづでどばびぶべぼ' },
        { label: '半浊音', kana: 'ぱぴぷぺぽ' },
        { label: '特殊', kana: 'っーん' }
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
        keyboardRows: keyboardRows
    };
})();
