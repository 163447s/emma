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
    var CHANCE = 0.1; // 与原机制随机风格一致：拍一拍 3%、表情/emoji 20% 均为系统随机项；打字乱码为"梦角不在线"的偶发体验（文档：有时候是混乱的），取 10%

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
            '  <div class="settings-section-title"><i class="fas fa-keyboard"></i>12键九宫格假名键盘 · flick</div>' +
            '  <div id="typing-keyboard-view" style="padding:8px 12px;"></div>' +
            '  <div style="font-size:11px;color:var(--text-secondary);padding:2px 12px 4px;line-height:1.7;">' +
            '    日本人日常输入法：每个行键默认打 あ・か・さ…，滑动选段＝左い・上う・右え・下お（顺时针 い→う→え→お）；' +
            '    浊音/半浊音：打完假名后点「゛゜」键（清→浊→半浊→清；连点行键中央也能切）；促音 っ 在小写 * 键、撥音 ん 在わ行上滑、' +
            '    長音 ー 在空白键（空格/ー 轮流）；や行左角出小写 ゃゅょ（拗音：き + ゃ = きゃ）。' +
            '  </div>' +
            '  <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;flex-wrap:wrap;">' +
            '    <span style="font-size:12px;color:var(--text-secondary);">试打预览：</span>' +
            '    <span id="typing-preview" style="font-size:16px;font-weight:700;color:var(--accent-color);min-height:22px;">（点击上方按键拼一串）</span>' +
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
        var grid = window.TypingKeyboard.keyboardGrid;
        if (!grid) return;
        var html = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;max-width:340px;margin:0 auto;">';
        grid.forEach(function (key) {
            if (key.type === 'small' || key.type === 'space') {
                // 小写 * 键 / 空白键（传统第12键，空格/長音ー 轮流）：点击轮流追加
                var cls = key.type === 'small' ? 'small' : 'space';
                var big = key.type === 'small' ? '小写 *' : '空白';
                var sub = key.type === 'small' ? '小写假名轮流' : '空格 / 長音 ー';
                html += '<div class="typing-kb-extra typing-kb-' + cls + '" data-kana="' + key.kana + '" data-idx="0" style="' +
                    'position:relative;height:84px;border-radius:14px;background:var(--secondary-bg);border:1px solid var(--border-color);' +
                    'display:flex;align-items:center;justify-content:center;flex-direction:column;gap:2px;cursor:pointer;transition:all .15s;user-select:none;">' +
                    '<span style="font-size:15px;font-weight:700;color:var(--text-primary);">' + big + '</span>' +
                    '<span style="font-size:10px;color:var(--text-secondary);">' + sub + '</span>' +
                    '</div>';
            } else {
                // 行键：中央 a 段大字 + 四角 i/u/e/o 小字（左い・上う・右え・下お，与日本手机 flick 一致），连点切换清音/浊音/半浊音；
                // や行左角为小写 ゃゅょ（data-seg=small，点击轮流输入，拗音用）
                var leftSeg = key.small ? 'small' : 'i';
                var leftLabel = key.small || key.i;
                html += '<div class="typing-kb-key" data-mode="0" data-dakuon="' + key.dakuon + '" data-handakuon="' + key.handakuon + '" style="' +
                    'position:relative;height:84px;border-radius:14px;background:var(--secondary-bg);border:1px solid var(--border-color);' +
                    'display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .15s;user-select:none;">' +
                    '<span class="typing-kb-seg" data-seg="u" style="position:absolute;top:5px;left:50%;transform:translateX(-50%);font-size:11px;color:var(--text-secondary);cursor:pointer;">' + (key.u || '') + '</span>' +
                    '<span class="typing-kb-seg" data-seg="' + leftSeg + '" data-cycle="' + (key.small || '') + '" data-idx="0" style="position:absolute;left:7px;top:50%;transform:translateY(-50%);font-size:11px;color:' + (key.small ? 'var(--warning-color,#e6a23c)' : 'var(--text-secondary)') + ';cursor:pointer;">' + leftLabel + '</span>' +
                    '<span class="typing-kb-seg" data-seg="e" style="position:absolute;right:7px;top:50%;transform:translateY(-50%);font-size:11px;color:var(--text-secondary);cursor:pointer;">' + (key.e || '') + '</span>' +
                    '<span class="typing-kb-seg" data-seg="o" style="position:absolute;bottom:5px;left:50%;transform:translateX(-50%);font-size:11px;color:var(--text-secondary);cursor:pointer;">' + (key.o || '') + '</span>' +
                    '<span class="typing-kb-center" data-seg="a" data-a0="' + key.a + '" style="font-size:22px;font-weight:700;color:var(--accent-color);cursor:pointer;">' + key.a + '</span>' +
                    '<span class="typing-kb-mode-tip" style="position:absolute;bottom:3px;right:6px;font-size:9px;color:var(--text-secondary);opacity:.7;">' + (key.dakuon ? '゛' : '') + (key.handakuon ? '゜' : '') + '</span>' +
                    '</div>';
            }
        });
        html += '</div>';
        // ゛゜ 键（标准日式键盘的浊音/半浊音键）：点一下给上一个假名加浊音，再点变半浊/回清音
        html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;max-width:340px;margin:10px auto 0;">' +
            '<div></div>' +
            '<div class="typing-kb-dakuten" title="给上一个假名加浊音 / 半浊音" style="position:relative;height:56px;border-radius:14px;' +
            'background:var(--secondary-bg);border:1px solid var(--border-color);display:flex;align-items:center;justify-content:center;' +
            'font-size:17px;font-weight:700;color:var(--text-primary);cursor:pointer;user-select:none;transition:border-color .15s;">゛゜</div>' +
            '<div></div>' +
            '</div>';
        box.innerHTML = html;

        // 行键交互：连点中央切换 清音→浊音→半浊音；点四角直接输入对应段假名；
        // 拖拽滑动（flick）：按住往 左/上/右/下 拖再松开 → 选 i/u/e/o 段（や行向左拖出小写 ゃゅょ）
        box.querySelectorAll('.typing-kb-key').forEach(function (el) {
            var dakuon = el.getAttribute('data-dakuon') || '';
            var handakuon = el.getAttribute('data-handakuon') || '';
            var _suppress = false; // 拖拽结束后抑制本次 click，避免重复输入
            // 取当前 mode 对应的段假名
            var SEG_IDX = { a: 0, i: 1, u: 2, e: 3, o: 4 };
            function segKana(seg) {
                var mode = parseInt(el.getAttribute('data-mode') || '0', 10);
                var idx = SEG_IDX[seg] || 0;
                if (mode === 1 && dakuon) return dakuon.charAt(idx) || dakuon.charAt(0);
                if (mode === 2 && handakuon) return handakuon.charAt(idx) || handakuon.charAt(0);
                if (seg === 'a') return el.querySelector('.typing-kb-center').textContent;
                return el.querySelector('.typing-kb-seg[data-seg="' + seg + '"]').textContent;
            }
            // 拖拽方向 → 段假名（左拖且该键有小写段=や行，则轮流输入 ゃゅょ）
            function dirKana(dir) {
                var smallEl = el.querySelector('.typing-kb-seg[data-cycle]');
                var smallCycle = smallEl ? (smallEl.getAttribute('data-cycle') || '') : '';
                if (dir === 'i' && smallCycle) {
                    var idx = parseInt(smallEl.getAttribute('data-idx') || '0', 10);
                    smallEl.setAttribute('data-idx', String((idx + 1) % smallCycle.length));
                    return smallCycle.charAt(idx % smallCycle.length);
                }
                return segKana(dir);
            }
            function appendKana(ch) {
                if (!ch) return;
                var prev = document.getElementById('typing-preview');
                var cur = prev.textContent;
                if (!cur || cur.indexOf('（点击') >= 0) cur = '';
                prev.textContent = cur + ch;
            }
            // 拖拽滑动（Pointer Events 覆盖鼠标与触摸）
            var pointerState = null;
            el.addEventListener('pointerdown', function (ev) {
                // 不在按下时就捕获指针：捕获后随后的 click 目标会变成整个键，
                // 导致点中央大字/四角小字收不到 click（鼠标端表现为“点了没反应”）
                pointerState = { x: ev.clientX, y: ev.clientY, dir: null, id: ev.pointerId, captured: false };
            });
            el.addEventListener('pointermove', function (ev) {
                if (!pointerState) return;
                var dx = ev.clientX - pointerState.x;
                var dy = ev.clientY - pointerState.y;
                if (Math.abs(dx) > 12 || Math.abs(dy) > 12) {
                    pointerState.dir = Math.abs(dx) > Math.abs(dy)
                        ? (dx < 0 ? 'i' : 'e')
                        : (dy < 0 ? 'u' : 'o');
                    // 确认在拖拽后再捕获指针，保证滑出键外仍能收到 move/up
                    if (!pointerState.captured) {
                        try { el.setPointerCapture(pointerState.id); } catch (e) {}
                        pointerState.captured = true;
                    }
                }
            });
            el.addEventListener('pointerup', function (ev) {
                if (!pointerState) return;
                var dir = pointerState.dir;
                pointerState = null;
                if (dir) {
                    _suppress = true;
                    // 拖拽后浏览器会派发一次 click，短暂抑制避免重复输入；之后自动恢复
                    setTimeout(function () { _suppress = false; }, 80);
                    appendKana(dirKana(dir));
                }
            });
            // 中央：追加当前段 + 切换 mode（清→浊→半→清）
            el.querySelector('.typing-kb-center').addEventListener('click', function (ev) {
                ev.stopPropagation();
                if (_suppress) { _suppress = false; return; }
                var mode = parseInt(el.getAttribute('data-mode') || '0', 10);
                appendKana(segKana('a'));
                mode = (mode + 1) % 3;
                // 无浊音/半浊音的行：mode 不生效，中央假名保持清音
                var next = el.querySelector('.typing-kb-center');
                var a0 = next.getAttribute('data-a0') || 'あ';
                if (mode === 1 && dakuon) next.textContent = dakuon.charAt(0);
                else if (mode === 2 && handakuon) next.textContent = handakuon.charAt(0);
                else next.textContent = a0;
                el.setAttribute('data-mode', mode);
            });
            // 四角：追加对应段假名（保持当前 mode 的清音段）；小写段（や行左角 ゃゅょ）点击轮流
            el.querySelectorAll('.typing-kb-seg').forEach(function (s) {
                s.addEventListener('click', function (ev) {
                    ev.stopPropagation();
                    if (_suppress) { _suppress = false; return; }
                    var cycle = s.getAttribute('data-cycle') || '';
                    if (cycle) {
                        var idx = parseInt(s.getAttribute('data-idx') || '0', 10);
                        appendKana(cycle.charAt(idx % cycle.length));
                        s.setAttribute('data-idx', String((idx + 1) % cycle.length));
                    } else {
                        appendKana(segKana(s.getAttribute('data-seg')));
                    }
                });
            });
        });

        // 小写 * / 特殊键：点击轮流追加
        box.querySelectorAll('.typing-kb-extra').forEach(function (el) {
            el.addEventListener('click', function () {
                var kana = el.getAttribute('data-kana') || '';
                var idx = parseInt(el.getAttribute('data-idx') || '0', 10);
                var ch = kana.charAt(idx % kana.length);
                var prev = document.getElementById('typing-preview');
                var cur = prev.textContent;
                if (!cur || cur.indexOf('（点击') >= 0) cur = '';
                prev.textContent = cur + ch;
                el.setAttribute('data-idx', String((idx + 1) % kana.length));
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

        // ゛゜ 键：清 → 浊 → 半浊 → 清（标准日式键盘的浊音操作，作用于已输入的最后一个假名）
        var DAKU_TO_CLEAN = {}, CLEAN_TO_DAKU = {}, CLEAN_TO_HAN = {}, HAN_TO_CLEAN = {};
        (function () {
            var dakuPairs = [['か', 'が'], ['き', 'ぎ'], ['く', 'ぐ'], ['け', 'げ'], ['こ', 'ご'],
                             ['さ', 'ざ'], ['し', 'じ'], ['す', 'ず'], ['せ', 'ぜ'], ['そ', 'ぞ'],
                             ['た', 'だ'], ['ち', 'ぢ'], ['つ', 'づ'], ['て', 'で'], ['と', 'ど'],
                             ['は', 'ば'], ['ひ', 'び'], ['ふ', 'ぶ'], ['へ', 'べ'], ['ほ', 'ぼ'],
                             ['う', 'ゔ']];
            var hanPairs = [['は', 'ぱ'], ['ひ', 'ぴ'], ['ふ', 'ぷ'], ['へ', 'ぺ'], ['ほ', 'ぽ']];
            dakuPairs.forEach(function (p) { CLEAN_TO_DAKU[p[0]] = p[1]; DAKU_TO_CLEAN[p[1]] = p[0]; });
            hanPairs.forEach(function (p) { CLEAN_TO_HAN[p[0]] = p[1]; HAN_TO_CLEAN[p[1]] = p[0]; });
        })();
        box.querySelectorAll('.typing-kb-dakuten').forEach(function (el) {
            el.addEventListener('click', function () {
                var prev = document.getElementById('typing-preview');
                var cur = prev.textContent;
                if (!cur || cur.indexOf('（点击') >= 0) return;
                var last = cur.charAt(cur.length - 1);
                var next = null;
                if (HAN_TO_CLEAN[last]) {
                    next = HAN_TO_CLEAN[last];                 // 半浊 → 清
                } else if (DAKU_TO_CLEAN[last]) {
                    var clean = DAKU_TO_CLEAN[last];
                    next = CLEAN_TO_HAN[clean] || clean;        // 浊 → 半浊（は行）或回清音
                } else if (CLEAN_TO_DAKU[last]) {
                    next = CLEAN_TO_DAKU[last];                 // 清 → 浊
                }
                if (next) prev.textContent = cur.slice(0, -1) + next;
            });
            el.addEventListener('mouseenter', function () { el.style.borderColor = 'var(--accent-color)'; });
            el.addEventListener('mouseleave', function () { el.style.borderColor = 'var(--border-color)'; });
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
        // 与全站其他弹窗一致：使用官方 showModal（会播放 modal-content 透明度/位移动画）
        if (typeof window.showModal === 'function') {
            window.showModal(modal);
        } else {
            modal.style.display = 'flex';
        }
    }
    function hideTypingModal() {
        var modal = document.getElementById('typing-modal');
        if (!modal) return;
        if (typeof window.hideModal === 'function') {
            window.hideModal(modal);
        } else {
            modal.style.display = 'none';
        }
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
