/* kana-correction.js —— 助词纠错（纠错A）
 * 定位：设置页"打字功能"入口中编辑/试打日语相关内容时，对假名文本做助词轻提示
 * 依赖：无
 * 暴露：window.KanaCorrection = { suggest }
 * 规则：
 *   - は/わ 混淆：句中位置的「わ」→ 提示改「は」
 *   - へ/え 混淆：句中表示方向的「え」→ 提示改「へ」
 *   - を/お 混淆：句中宾语助词的「お」→ 提示改「を」
 *   - 助词遗漏：较长句子完全不含 は/を/に → 轻提示建议补上
 * 说明：只提示不自动改，不阻断输入
 */
(function () {
    'use strict';

    var HIRA = /[\u3041-\u3096]/g;

    function kanaOnly(s) {
        if (!s) return '';
        var m = String(s).match(HIRA);
        return m ? m.join('') : '';
    }

    var POSITIONAL = [
        { char: 'わ', to: 'は', msg: '这里是不是助词「は」？' },
        { char: 'え', to: 'へ', msg: '这里是不是方向助词「へ」？' },
        { char: 'お', to: 'を', msg: '这里是不是宾语助词「を」？' }
    ];

    /**
     * 助词纠错建议
     * @param {string} kanaText 假名文本（可混有汉字/标点）
     * @returns {object|null} { index, from, to, msg } 或 { miss: true, msg }
     */
    function suggest(kanaText) {
        if (!kanaText) return null;
        var t = String(kanaText);
        var k = kanaOnly(t);
        if (k.length < 2) return null;

        for (var i = 0; i < k.length; i++) {
            var ch = k[i];
            for (var p = 0; p < POSITIONAL.length; p++) {
                var rule = POSITIONAL[p];
                if (ch !== rule.char) continue;
                var before = k.slice(0, i);
                var after = k.slice(i + 1);
                // 句首的 わ/え/お 多为语气（わっ/えっ/おっ），不提示
                var isMid = before.length > 0 && after.length > 0;
                var prev = before.charAt(before.length - 1);
                var prevIsParticle = 'はをにがでとへも'.indexOf(prev) >= 0;
                if (isMid && !prevIsParticle) {
                    var idx = t.indexOf(ch, Math.max(0, i - 2));
                    return { index: idx, from: ch, to: rule.to, msg: rule.msg };
                }
            }
        }

        var ends = /(ます|です|ました|でした|たい|ない|た|いる|て)$/;
        var hasParticle = /[はをに]/.test(k);
        if (k.length >= 5 && !hasParticle && ends.test(k)) {
            return { miss: true, msg: '这句话好像缺个助词（は/を/に），要不要补一下？' };
        }
        return null;
    }

    window.KanaCorrection = {
        suggest: suggest
    };
})();
