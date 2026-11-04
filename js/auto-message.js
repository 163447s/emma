/* auto-message.js —— 打字功能：设置面板 UI + 历史发送记录 + 开关
 * 定位：
 *   - 主动触发完全复用 core.js 现有逻辑（simulateReply / autoSendTimer），本文件不重复实现触发
 *   - 提供打字功能设置入口（高级功能 → 打字功能）、日语键盘展示、纠错A 试打演示、历史发送记录（只读）
 * 依赖：kana-map.js / typing-keyboard.js / roman-correction.js / kana-correction.js（均需先加载）
 * 暴露：window.AutoMessage = { isEnabled, getChance, record, getHistory, clearHistory }
 */
(function () {
    'use strict';

    var ENABLED_KEY = 'typingEnabled';
    var HISTORY_KEY = 'typingHistory';
    var HISTORY_MAX = 100;
    var CHANCE = 0.2; // 与字卡并列发送时的打字占比（固定，不暴露配置）

    // ── 开关 / 历史记录 ──
    function isEnabled() {
        try { return localStorage.getItem(ENABLED_KEY) !== '0'; } catch (e) { return true; }
    }
    function setEnabled(v) {
        try { localStorage.setItem(ENABLED_KEY, v ? '1' : '0'); } catch (e) {}
    }
    function getChance() { return CHANCE; }

    function getHistory() {
        try {
            var arr = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
            return Array.isArray(arr) ? arr : [];
        } catch (e) { return []; }
    }
    /** 记录一条打字消息（只记录，MJ 不从历史里选消息发送） */
    function record(text) {
        if (!text) return;
        var arr = getHistory();
        arr.unshift({ text: String(text), time: Date.now(), lang: 'ja' });
        if (arr.length > HISTORY_MAX) arr = arr.slice(0, HISTORY_MAX);
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(arr)); } catch (e) {}
    }
    function clearHistory() {
        try { localStorage.removeItem(HISTORY_KEY); } catch (e) {}
    }

    // ── 设置面板 UI ──
    var _modalCreated = false;

    function ensureEntry() {
        var anchor = document.getElementById('custom-replies-function');
        if (!anchor) return;
        var existing = document.getElementById('typing-function');
        if (existing) return;
        anchor.insertAdjacentHTML('afterend',
            '<div class="settings-item" id="typing-function">' +
            '<i class="fas fa-keyboard"></i><span>打字功能</span>' +
            '<span style="margin-left:auto;font-size:11px;color:var(--text-secondary);' +
            (isEnabled() ? '' : 'opacity:.5') + '">' + (isEnabled() ? '已启用' : '已关闭') + '</span></div>'
        );
        document.getElementById('typing-function').addEventListener('click', function () {
            ensureModal();
            showTypingModal();
        });
    }

    function ensureModal() {
        if (_modalCreated) return;
        _modalCreated = true;

        var modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'typing-modal';
        modal.style.display = 'none';
        modal.innerHTML =
            '<div class="modal-content" style="max-width:680px;">' +
            '<div class="modal-title"><i class="fas fa-keyboard"></i><span>打字功能</span>' +
            '<button class="modal-close-btn" id="typing-modal-close" style="margin-left:auto;background:none;border:none;font-size:20px;cursor:pointer;color:var(--text-secondary);line-height:1;">×</button></div>' +
            '<div class="settings-section">' +
            '  <div class="settings-section-title"><i class="fas fa-sliders-h"></i>设置</div>' +
            '  <div class="settings-item">' +
            '    <i class="fas fa-toggle-on"></i><span>启用打字功能</span>' +
            '    <div id="typing-enable-toggle" style="margin-left:auto;width:44px;height:24px;border-radius:12px;background:var(--border-color);position:relative;cursor:pointer;transition:background .2s;">' +
            '      <div style="position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:#fff;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.3);"></div>' +
            '    </div>' +
            '  </div>' +
            '  <div style="font-size:11px;color:var(--text-secondary);padding:4px 0 0 26px;line-height:1.6;">' +
            '    MJ 主动发消息时，有一定概率改用日语键盘随机组合五十音假名打字发给你（与字卡并列）。' +
            '    消息可能无意义、不连贯，这是正常的——梦角不是每时每刻都在线。' +
            '  </div>' +
            '</div>' +
            '<div class="settings-section">' +
            '  <div class="settings-section-title"><i class="fas fa-keyboard"></i>标准日语键盘 · 五十音</div>' +
            '  <div id="typing-keyboard-view" style="padding:8px 12px;"></div>' +
            '  <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;flex-wrap:wrap;">' +
            '    <span style="font-size:12px;color:var(--text-secondary);">试打预览：</span>' +
            '    <span id="typing-preview" style="font-size:16px;font-weight:700;color:var(--accent-color);min-height:22px;">（点击上方假名拼一串）</span>' +
            '    <button id="typing-random-btn" style="margin-left:auto;border:none;background:var(--accent-color);color:#fff;font-size:12px;font-weight:700;padding:4px 14px;border-radius:10px;cursor:pointer;">随机生成一条</button>' +
            '  </div>' +
            '</div>' +
            '<div class="settings-section">' +
            '  <div class="settings-section-title"><i class="fas fa-pen"></i>纠错提示（试打罗马音）</div>' +
            '  <div style="padding:8px 12px;">' +
            '    <input id="typing-roman-input" placeholder="输入罗马音试试，如 konnichiwa / des / gakou / kitte…" style="width:100%;padding:8px 12px;border-radius:10px;border:1px solid var(--border-color);background:var(--secondary-bg);color:var(--text-primary);font-size:13px;box-sizing:border-box;" />' +
            '    <div style="font-size:12px;color:var(--text-secondary);margin-top:6px;">转换：<span id="typing-roman-kana" style="color:var(--accent-color);font-weight:700;">—</span></div>' +
            '    <div id="typing-correction-tip" style="font-size:12px;margin-top:4px;color:var(--warning-color,#e6a23c);min-height:18px;">拼写/助词纠错提示会显示在这里（只提示，不改动输入）</div>' +
            '  </div>' +
            '</div>' +
            '<div class="settings-section">' +
            '  <div class="settings-section-title"><i class="fas fa-history"></i>历史发送记录 <span style="font-size:11px;color:var(--text-secondary);font-weight:400;">（只记录，MJ 不从历史里选消息）</span></div>' +
            '  <div id="typing-history-list" style="max-height:240px;overflow-y:auto;padding:4px 12px 8px;"></div>' +
            '  <div style="padding:0 12px 8px;"><button id="typing-history-clear" style="border:1px solid var(--border-color);background:none;color:var(--text-secondary);font-size:12px;padding:3px 10px;border-radius:8px;cursor:pointer;">清空记录</button></div>' +
            '</div>' +
            '</div>';

        document.body.appendChild(modal);

        document.getElementById('typing-modal-close').addEventListener('click', function () { hideTypingModal(); });
        modal.addEventListener('click', function (e) { if (e.target === modal) hideTypingModal(); });

        // 开关
        var toggle = document.getElementById('typing-enable-toggle');
        var knob = toggle.firstElementChild;
        function paintToggle() {
            var on = isEnabled();
            toggle.style.background = on ? 'var(--accent-color)' : 'var(--border-color)';
            knob.style.left = on ? '22px' : '2px';
        }
        paintToggle();
        toggle.addEventListener('click', function () { setEnabled(!isEnabled()); paintToggle(); });

        // 键盘
        renderKeyboard();
        // 随机生成
        document.getElementById('typing-random-btn').addEventListener('click', function () {
            var text = window.TypingKeyboard.generateTypingMessage();
            document.getElementById('typing-preview').textContent = text;
        });
        // 试打输入（纠错A）
        var input = document.getElementById('typing-roman-input');
        input.addEventListener('input', function () {
            var v = input.value.trim();
            var kanaEl = document.getElementById('typing-roman-kana');
            var tipEl = document.getElementById('typing-correction-tip');
            if (!v) { kanaEl.textContent = '—'; tipEl.textContent = '拼写/助词纠错提示会显示在这里（只提示，不改动输入）'; tipEl.style.color = 'var(--warning-color,#e6a23c)'; return; }
            var kana = window.KanaMap.romajiToKana(v);
            kanaEl.textContent = kana;
            var hint = '';
            // 拼写纠错（最后一段罗马音）
            var segs = v.split(/[^a-z'’]+/i).filter(function (s) { return /[a-z]/i.test(s); });
            var last = segs.length ? segs[segs.length - 1] : '';
            if (last && last.length >= 2 && window.RomanCorrection) {
                var rs = window.RomanCorrection.suggest(last, 1);
                if (rs) hint = '你是不是想打 ' + rs.to + '？（' + rs.kana + '）';
            }
            // 助词纠错
            if (!hint && window.KanaCorrection) {
                var ks = window.KanaCorrection.suggest(kana);
                if (ks && ks.msg) hint = ks.msg;
            }
            tipEl.textContent = hint || '✓ 没有发现可提示的问题';
            tipEl.style.color = hint ? 'var(--warning-color,#e6a23c)' : '#52c41a';
        });

        // 历史
        renderHistory();
        document.getElementById('typing-history-clear').addEventListener('click', function () { clearHistory(); renderHistory(); });
    }

    function renderKeyboard() {
        var box = document.getElementById('typing-keyboard-view');
        if (!box) return;
        var html = '';
        window.TypingKeyboard.keyboardRows.forEach(function (row) {
            html += '<div style="display:flex;align-items:center;margin-bottom:6px;flex-wrap:wrap;">' +
                '<span style="width:56px;font-size:11px;color:var(--text-secondary);flex-shrink:0;">' + row.label + '</span>';
            for (var i = 0; i < row.kana.length; i++) {
                var ch = row.kana[i];
                html += '<span data-kana="' + ch + '" style="' +
                    'display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;' +
                    'margin:2px;border-radius:8px;background:var(--secondary-bg);border:1px solid var(--border-color);' +
                    'font-size:14px;cursor:pointer;transition:all .15s;user-select:none;">' + ch + '</span>';
            }
            html += '</div>';
        });
        box.innerHTML = html;
        box.querySelectorAll('[data-kana]').forEach(function (el) {
            el.addEventListener('click', function () {
                var prev = document.getElementById('typing-preview');
                var cur = prev.textContent;
                if (!cur || cur.indexOf('（点击') >= 0) cur = '';
                prev.textContent = cur + el.getAttribute('data-kana');
            });
            el.addEventListener('mouseenter', function () {
                el.style.background = 'rgba(var(--accent-color-rgb),0.15)';
                el.style.borderColor = 'var(--accent-color)';
            });
            el.addEventListener('mouseleave', function () {
                el.style.background = 'var(--secondary-bg)';
                el.style.borderColor = 'var(--border-color)';
            });
        });
    }

    function renderHistory() {
        var list = document.getElementById('typing-history-list');
        if (!list) return;
        var arr = getHistory();
        if (!arr.length) {
            list.innerHTML = '<div style="padding:12px 0;text-align:center;font-size:12px;color:var(--text-secondary);">还没有打字记录——MJ 主动打字发消息后会自动记录在这里</div>';
            return;
        }
        var html = '';
        arr.forEach(function (item) {
            var d = new Date(item.time);
            var pad = function (x) { return x < 10 ? '0' + x : x; };
            var timeStr = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
            html += '<div style="display:flex;gap:8px;padding:7px 10px;margin-bottom:6px;border-radius:10px;background:var(--secondary-bg);border:1px solid var(--border-color);align-items:baseline;">' +
                '<span style="font-size:14px;color:var(--text-primary);word-break:break-all;flex:1;">' + escapeHtml(item.text) + '</span>' +
                '<span style="font-size:10px;color:var(--text-secondary);flex-shrink:0;">' + timeStr + ' · 日語</span>' +
                '</div>';
        });
        list.innerHTML = html;
    }

    function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function showTypingModal() {
        var modal = document.getElementById('typing-modal');
        if (!modal) return;
        renderHistory();
        modal.style.display = 'flex';
    }
    function hideTypingModal() {
        var modal = document.getElementById('typing-modal');
        if (modal) modal.style.display = 'none';
    }

    // 入口随页面就绪挂载
    function init() {
        ensureEntry();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.AutoMessage = {
        isEnabled: isEnabled,
        getChance: getChance,
        record: record,
        getHistory: getHistory,
        clearHistory: clearHistory
    };
})();
