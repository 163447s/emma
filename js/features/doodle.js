/* ============================================================================
 * js/features/doodle.js —— 涂鸦板（纯前端扩展，不改动字卡库与发送逻辑）
 * ----------------------------------------------------------------------------
 * 依赖（均由原站 core.js / 全局提供，直接调用即可）：
 *   addMessage(msg)      —— 往消息流插入一条消息（内部会持久化 + 滚动到底）
 *   playSound(name)      —— 'send' 发送音 / 'message' 收到音
 *   showModal(el) hideModal(el) showNotification(msg, type)
 *   settings             —— { partnerName, replyDelayMin, replyDelayMax, ... }
 *   simulateReply()      —— 原站"对方回复"入口
 *   getStorageKey(key) + localforage —— 原站存储封装（梦角自动涂鸦计时用）
 *
 * 功能：
 *   1) 输入框左侧插入「涂鸦板」按钮 → 打开画布
 *   2) 画笔（6 色 / 3 档粗细）、橡皮、撤销、清空、写字
 *   3) 画完导出 PNG（Base64）→ 复用原站 addMessage({image}) 发到聊天
 *   4) 梦角会按低频随机（首封 6-18 小时，之后 10-30 小时）自动画一张发过来
 * ========================================================================== */
(function () {
    'use strict';

    /* ── 常量 ───────────────────────────────────────────────────────────── */
    var W = 720;                       // 画布真实像素（正方），导出清晰、体积可控
    var COLORS = ['#171717', '#e04b3c', '#2d7fe0', '#3aa45f', '#e3ab26', '#9a5bd6'];
    var WIDTHS = [2.5, 5.5, 9];         // 细 / 中 / 粗
    var AUTO_KEY = 'doodleAutoState';   // 梦角自动涂鸦的计时存储键
    var AUTO_FIRST_HOURS = [6, 18];     // 第一张：6-18 小时后
    var AUTO_LOOP_HOURS = [10, 30];     // 之后：10-30 小时一张

    /* ── 运行时状态 ─────────────────────────────────────────────────────── */
    var strokes = [];                   // 所有笔画记录（撤销靠它重绘，内存占用小）
    var curStroke = null;               // 当前正在画的这一笔
    var drawing = false;
    var tool = { color: COLORS[0], width: WIDTHS[1], erase: false };
    var canvas = null, ctx = null, modalEl = null;
    var autoChecking = false;

    /* ══════════════════ 一、画布与笔触 ══════════════════ */

    function setupCanvas(c) {
        c.width = W;
        c.height = W;
    }

    /** 白底：所有导出都是白纸，橡皮只要画白色就等于擦掉 */
    function fillPaper(c) {
        c.fillStyle = '#ffffff';
        c.fillRect(0, 0, W, W);
    }

    /** 按笔画记录重绘整张纸（撤销 / 清空 / 首帧都走这里） */
    function redraw() {
        fillPaper(ctx);
        for (var i = 0; i < strokes.length; i++) paintStroke(strokes[i], ctx);
    }

    /** 画一条笔画（path=线条，text=写的字），可指定目标画布 */
    function paintStroke(s, c) {
        c = c || ctx;
        c.save();

        if (s.type === 'text') {
            c.translate(s.x, s.y);
            c.rotate(s.rot || 0);
            c.font = '700 ' + s.size + 'px "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", ' +
                '"Meiryo", "Noto Sans JP", "Noto Sans CJK JP", "MS Gothic", "Kaiti SC", "KaiTi", cursive, sans-serif';
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillStyle = s.color;
            c.fillText(s.text, 0, 0);
            // 再叠一次淡墨，模拟笔尖墨迹不均的手写感
            c.globalAlpha = 0.35;
            c.fillText(s.text, 1.4, -1.0);
            c.restore();
            return;
        }

        var color = s.erase ? '#ffffff' : s.color;
        var pts = s.points || [];
        c.lineCap = 'round';
        c.lineJoin = 'round';
        c.strokeStyle = color;
        c.fillStyle = color;
        c.lineWidth = s.width;

        if (pts.length === 1) {
            // 只点了一下 → 画个圆点
            c.beginPath();
            c.arc(pts[0].x, pts[0].y, Math.max(1, s.width / 2), 0, Math.PI * 2);
            c.fill();
            c.restore();
            return;
        }

        // 用二次贝塞尔把折线抹平，笔迹更像手画
        c.beginPath();
        c.moveTo(pts[0].x, pts[0].y);
        for (var i = 1; i < pts.length - 1; i++) {
            var midX = (pts[i].x + pts[i + 1].x) / 2;
            var midY = (pts[i].y + pts[i + 1].y) / 2;
            c.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
        }
        c.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        c.stroke();
        c.restore();
    }

    /** 实时落笔：直接补最后一段，避免每帧全量重绘导致卡顿 */
    function paintLive() {
        if (!curStroke || curStroke.points.length < 2) return;
        var pts = curStroke.points;
        var color = curStroke.erase ? '#ffffff' : curStroke.color;
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = color;
        ctx.lineWidth = curStroke.width;
        ctx.beginPath();
        ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y);
        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        ctx.stroke();
        ctx.restore();
    }

    /** 屏幕坐标 → 画布坐标（处理 CSS 缩放与页面滚动） */
    function posOf(ev) {
        var r = canvas.getBoundingClientRect();
        return {
            x: (ev.clientX - r.left) / r.width * W,
            y: (ev.clientY - r.top) / r.height * W
        };
    }

    /* ══════════════════ 二、指针事件（鼠标 / 触摸 / 触控笔统一） ══════════════════ */

    function onPointerDown(ev) {
        // 鼠标只认左键；触摸/笔不受此限
        if (ev.pointerType === 'mouse' && ev.button !== 0) return;

        ev.preventDefault();                 // 防止触摸时页面滚动 / 双击放大
        try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}

        drawing = true;
        var p = posOf(ev);
        curStroke = {
            type: 'path',
            color: tool.color,
            width: tool.width,
            erase: tool.erase,
            points: [{ x: p.x, y: p.y }]
        };
        strokes.push(curStroke);

        // 按下即落一个点，轻点也有痕迹
        ctx.save();
        ctx.lineCap = 'round';
        ctx.fillStyle = curStroke.erase ? '#ffffff' : curStroke.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, curStroke.width / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function onPointerMove(ev) {
        if (!drawing || !curStroke) return;
        ev.preventDefault();

        var p = posOf(ev);
        var last = curStroke.points[curStroke.points.length - 1];
        // 位移太小的点直接丢弃，减少抖动与数据量
        if (Math.abs(p.x - last.x) + Math.abs(p.y - last.y) < 1.5) return;

        curStroke.points.push(p);
        paintLive();
    }

    function onPointerUp(ev) {
        if (!drawing) return;
        drawing = false;
        curStroke = null;
        try { canvas.releasePointerCapture(ev.pointerId); } catch (e) {}
        redraw();                            // 收笔时统一平滑一次
    }

    /* ══════════════════ 三、弹窗 UI ══════════════════ */

    function injectStyle() {
        if (document.getElementById('doodle-style')) return;
        var st = document.createElement('style');
        st.id = 'doodle-style';
        st.innerHTML = [
            '#doodle-modal{z-index:2300;position:fixed;inset:0;display:none;align-items:center;justify-content:center;',
            'background:rgba(0,0,0,.6);padding:12px;box-sizing:border-box;}',
            '#doodle-modal .dd-card{background:var(--secondary-bg,#fff);border-radius:20px;width:94%;max-width:440px;',
            'padding:0;overflow-x:hidden;overflow-y:auto;-webkit-overflow-scrolling:touch;box-shadow:0 12px 40px rgba(0,0,0,.22);display:flex;flex-direction:column;',
            'max-height:94vh;}',
            '.dd-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px 10px;}',
            '.dd-head .dd-title{font-size:14px;font-weight:700;color:var(--text-primary,#222);letter-spacing:1px;',
            'display:flex;align-items:center;gap:7px;}',
            '.dd-close{border:none;background:none;cursor:pointer;color:var(--text-secondary,#999);font-size:16px;padding:4px 6px;}',
            '.dd-colors{display:flex;gap:8px;padding:0 16px 8px;align-items:center;}',
            '.dd-dot{width:26px;height:26px;border-radius:50%;border:2px solid transparent;cursor:pointer;flex-shrink:0;',
            'transition:transform .15s,border-color .15s;}',
            '.dd-dot.on{border-color:var(--accent-color,#3fa45b);transform:scale(1.12);}',
            '.dd-row{display:flex;gap:6px;padding:0 14px 8px;flex-wrap:wrap;align-items:center;}',
            '.dd-tool{border:1px solid var(--border-color,#e5e5e5);background:var(--primary-bg,#fafafa);color:var(--text-secondary,#777);',
            'font-size:12px;padding:5px 10px;border-radius:9px;cursor:pointer;display:flex;align-items:center;gap:4px;}',
            '.dd-tool.on{background:var(--accent-color,#3fa45b);border-color:var(--accent-color,#3fa45b);color:#fff;}',
            '.dd-stage{padding:0 12px;}',
            '#doodle-canvas{width:100%;height:auto;max-width:min(100%,28vh);margin:0 auto;display:block;background:#fff;border-radius:14px;',
            'border:1px solid var(--border-color,#e8e8e8);touch-action:none;-webkit-user-select:none;user-select:none;}',
            '.dd-keys{display:grid;grid-template-columns:repeat(7,1fr);gap:5px;padding:8px 12px 0;}',
            '.dd-key{border:1px solid var(--border-color,#e5e5e5);background:var(--primary-bg,#fafafa);',
            'color:var(--text-primary,#333);font-size:13px;font-weight:600;height:28px;border-radius:8px;cursor:pointer;',
            'display:flex;align-items:center;justify-content:center;padding:0;line-height:1;}',
            '.dd-key:active{background:var(--accent-color,#3fa45b);border-color:var(--accent-color,#3fa45b);color:#fff;}',
            '.dd-textrow{display:flex;gap:6px;padding:8px 12px 0;}',
            '.dd-textrow input{flex:1;min-width:0;padding:8px 11px;border-radius:10px;border:1px solid var(--border-color,#e5e5e5);',
            'background:var(--primary-bg,#fafafa);color:var(--text-primary,#222);font-size:12px;outline:none;}',
            '.dd-actions{display:flex;gap:8px;padding:10px 12px 14px;}',
            '.dd-actions button{flex:1;padding:11px 0;border-radius:12px;border:none;font-size:13px;font-weight:600;cursor:pointer;}',
            '.dd-cancel{background:var(--primary-bg,#f2f2f2);color:var(--text-secondary,#777);border:1px solid var(--border-color,#e5e5e5)!important;}',
            '.dd-send{background:var(--accent-color,#3fa45b);color:#fff;}'
        ].join('');
        document.head.appendChild(st);
    }

    function buildModal() {
        if (modalEl) return;
        injectStyle();

        modalEl = document.createElement('div');
        modalEl.className = 'modal';
        modalEl.id = 'doodle-modal';
        modalEl.innerHTML = [
            '<div class="dd-card">',
            '  <div class="dd-head">',
            '    <div class="dd-title"><i class="fas fa-paint-brush"></i>涂鸦板</div>',
            '    <button class="dd-close" id="dd-close" title="关闭"><i class="fas fa-times"></i></button>',
            '  </div>',
            '  <div class="dd-colors" id="dd-colors"></div>',
            '  <div class="dd-row" id="dd-sizes"></div>',
            '  <div class="dd-row">',
            '    <button class="dd-tool" id="dd-eraser"><i class="fas fa-eraser"></i>橡皮</button>',
            '    <button class="dd-tool" id="dd-undo"><i class="fas fa-undo"></i>撤销</button>',
            '    <button class="dd-tool" id="dd-clear"><i class="fas fa-trash-alt"></i>清空</button>',
            '  </div>',
            '  <div class="dd-stage"><canvas id="doodle-canvas"></canvas></div>',
            '  <div class="dd-keys" id="dd-keys"></div>',
            '  <div class="dd-textrow">',
            '    <input id="dd-text" maxlength="20" placeholder="写句话上去（中/英文都行）">',
            '    <button class="dd-tool" id="dd-text-add">写上</button>',
            '  </div>',
            '  <div class="dd-actions">',
            '    <button class="dd-cancel" id="dd-cancel">取消</button>',
            '    <button class="dd-send" id="dd-send">涂鸦到聊天</button>',
            '  </div>',
            '</div>'
        ].join('');
        document.body.appendChild(modalEl);

        canvas = document.getElementById('doodle-canvas');
        setupCanvas(canvas);
        ctx = canvas.getContext('2d');

        // 颜色球
        var colorBox = document.getElementById('dd-colors');
        COLORS.forEach(function (col, i) {
            var dot = document.createElement('div');
            dot.className = 'dd-dot' + (i === 0 ? ' on' : '');
            dot.style.background = col;
            dot.dataset.color = col;
            dot.addEventListener('click', function () {
                tool.color = col;
                tool.erase = false;
                refreshUi();
            });
            colorBox.appendChild(dot);
        });

        // 粗细
        var sizeBox = document.getElementById('dd-sizes');
        WIDTHS.forEach(function (wd, i) {
            var b = document.createElement('button');
            b.className = 'dd-tool' + (i === 1 ? ' on' : '');
            b.dataset.width = String(wd);
            b.innerHTML = '<span style="display:inline-block;border-radius:50%;background:currentColor;width:' +
                (4 + i * 3) + 'px;height:' + (4 + i * 3) + 'px;"></span>' + ['细', '中', '粗'][i];
            b.addEventListener('click', function () {
                tool.width = wd;
                refreshUi();
            });
            sizeBox.appendChild(b);
        });

        // 工具按钮
        document.getElementById('dd-eraser').addEventListener('click', function () {
            tool.erase = !tool.erase;
            refreshUi();
        });
        document.getElementById('dd-undo').addEventListener('click', function () {
            if (!strokes.length) return;
            strokes.pop();
            redraw();
        });
        document.getElementById('dd-clear').addEventListener('click', function () {
            strokes = [];
            redraw();
        });
        // A–Z 字母键盘：点一下就落到画布上（和参考站一样，字母是随手打上去的）
        var keysBox = document.getElementById('dd-keys');
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(function (ch) {
            var k = document.createElement('button');
            k.className = 'dd-key';
            k.type = 'button';
            k.textContent = ch;
            k.addEventListener('click', function () { addLetter(ch); });
            keysBox.appendChild(k);
        });

        document.getElementById('dd-text-add').addEventListener('click', addTextFromInput);
        document.getElementById('dd-text').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); addTextFromInput(); }
        });
        document.getElementById('dd-send').addEventListener('click', sendDoodle);
        document.getElementById('dd-cancel').addEventListener('click', closeBoard);
        document.getElementById('dd-close').addEventListener('click', closeBoard);
        modalEl.addEventListener('click', function (e) { if (e.target === modalEl) closeBoard(); });

        // 指针事件（鼠标/触摸/笔统一走 pointer，避免触摸端失效）
        canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
        canvas.addEventListener('pointermove', onPointerMove, { passive: false });
        canvas.addEventListener('pointerup', onPointerUp);
        canvas.addEventListener('pointercancel', onPointerUp);
        canvas.addEventListener('pointerleave', function (ev) {
            if (drawing) onPointerUp(ev);
        });
    }

    function refreshUi() {
        document.querySelectorAll('#dd-colors .dd-dot').forEach(function (d) {
            d.classList.toggle('on', !tool.erase && d.dataset.color === tool.color);
        });
        document.querySelectorAll('#dd-sizes .dd-tool').forEach(function (b) {
            b.classList.toggle('on', !tool.erase && Number(b.dataset.width) === tool.width);
        });
        var er = document.getElementById('dd-eraser');
        if (er) er.classList.toggle('on', tool.erase);
    }

    /** 点字母键：随手落在画布上，位置和字号都带点随机，像真人打的 */
    function addLetter(ch) {
        var x = W / 2 + rnd(-W * 0.22, W * 0.22);
        var y = W / 2 + rnd(-W * 0.26, W * 0.26);
        strokes.push({
            type: 'text',
            text: ch,
            x: x,
            y: y,
            size: rnd(58, 92),
            color: tool.erase ? COLORS[0] : tool.color,
            rot: rnd(-0.22, 0.22)
        });
        redraw();
    }

    /** 写字：落点从画布中心开始，已有文字就依次往下排，超出再回到顶部 */
    function addTextFromInput() {
        var input = document.getElementById('dd-text');
        var text = (input.value || '').trim();
        if (!text) return;
        var textCount = strokes.filter(function (s) { return s.type === 'text'; }).length;
        var y = W / 2 + ((textCount % 3) - 1) * 120;
        strokes.push({
            type: 'text',
            text: text.slice(0, 20),
            x: W / 2,
            y: y,
            size: 62,
            color: tool.erase ? COLORS[0] : tool.color,
            rot: (Math.random() - 0.5) * 0.09
        });
        input.value = '';
        redraw();
    }

    function openBoard() {
        buildModal();
        redraw();                 // 每次打开都按笔画记录重画（保证撤销/清空后状态一致）
        refreshUi();
        // 原站有多个 showModal 包装，部分版本不会给 .modal-content 置 opacity，
        // 这里显式把卡片设为可见，再交给 showModal 处理动画/其他逻辑
        modalEl.style.display = 'flex';
        modalEl.style.animation = 'none';          // 不走原站弹窗动画，避免动画被节流时卡在 opacity:0
        var card = modalEl.querySelector('.dd-card');
        if (card) {
            card.style.opacity = '1';
            card.style.transform = 'translateY(0) scale(1)';
        }
        if (typeof window.showModal === 'function') window.showModal(modalEl);
    }

    function closeBoard() {
        if (!modalEl) return;
        if (typeof window.hideModal === 'function') window.hideModal(modalEl);
        else modalEl.style.display = 'none';
    }

    /* ══════════════════ 四、发送到聊天（复用原站 addMessage） ══════════════════ */

    function sendDoodle() {
        if (!strokes.length) {
            if (typeof window.showNotification === 'function') window.showNotification('先画点什么再发吧', 'warning');
            return;
        }

        var dataUrl = canvas.toDataURL('image/png');
        closeBoard();

        // 与原站表情/图片走同一条消息结构：text 为空、image 放 Base64
        addMessage({
            id: Date.now(),
            sender: 'user',
            text: '',
            image: dataUrl,
            timestamp: new Date(),
            status: 'sent',
            favorited: false,
            note: null,
            replyTo: null,
            type: 'normal'
        });
        if (typeof playSound === 'function') playSound('send');

        // 复用原站的延迟回复机制，让 Ta 对涂鸦有反应
        try {
            var st = (typeof settings !== 'undefined' && settings) ? settings : {};
            var min = typeof st.replyDelayMin === 'number' ? st.replyDelayMin : 3000;
            var max = typeof st.replyDelayMax === 'number' ? st.replyDelayMax : 6000;
            var delay = min + Math.random() * Math.max(0, max - min);
            if (window._pendingReplyTimer) clearTimeout(window._pendingReplyTimer);
            window._pendingReplyTimer = setTimeout(function () {
                window._pendingReplyTimer = null;
                if (typeof simulateReply === 'function') simulateReply();
            }, delay);
        } catch (e) { /* 回复失败不影响消息已发出 */ }

        // 画完就清空，下次打开是张新纸
        strokes = [];
    }

    /* ══════════════════ 五、梦角主动画涂鸦 ══════════════════ */

    function rnd(a, b) { return a + Math.random() * (b - a); }
    function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

    function inkColor() {
        var r = Math.random();
        if (r < 0.62) return COLORS[0];
        if (r < 0.82) return COLORS[1];
        return COLORS[2];
    }

    /** 给点加一点抖动，让机器画的线像手画 */
    function wobble(pts, amp) {
        return pts.map(function (p) {
            return { x: p.x + rnd(-amp, amp), y: p.y + rnd(-amp, amp) };
        });
    }

    /** 心形 */
    function genHeart(scale) {
        var col = pick([COLORS[1], COLORS[1], COLORS[0]]);
        var s = scale || rnd(16, 22), cx = W / 2, cy = W / 2 + 10, pts = [];
        for (var t = 0; t <= Math.PI * 2 + 0.01; t += 0.10) {
            var x = 16 * Math.pow(Math.sin(t), 3);
            var y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
            pts.push({ x: cx + x * s, y: cy - y * s });
        }
        return [{ type: 'path', color: col, width: 9, points: wobble(pts, 3) }];
    }

    /** 夹在区间内，防止曲线跑出画布 */
    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

    /** 随手一笔：乱起乱收 + 中间弯一下，像手指在屏幕上划过去的 */
    function genFreeLine() {
        var sx = rnd(W * 0.14, W * 0.86), sy = rnd(W * 0.14, W * 0.86);
        var ex = rnd(W * 0.14, W * 0.86), ey = rnd(W * 0.14, W * 0.86);
        var cx = clamp((sx + ex) / 2 + rnd(-W * 0.2, W * 0.2), 30, W - 30);
        var cy = clamp((sy + ey) / 2 + rnd(-W * 0.2, W * 0.2), 30, W - 30);
        var pts = [];
        for (var i = 0; i <= 10; i++) {
            var t = i / 10;
            pts.push({
                x: (1 - t) * (1 - t) * sx + 2 * (1 - t) * t * cx + t * t * ex,
                y: (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * cy + t * t * ey
            });
        }
        return { type: 'path', color: inkColor(), width: rnd(4, 6.5), points: wobble(pts, 7) };
    }

    /** 绕圈：随手打一两个圈，半径和歪斜都随机 */
    function genLoop() {
        var cx = W / 2 + rnd(-80, 80), cy = W / 2 + rnd(-80, 80);
        var rr = rnd(70, 145), pts = [];
        var turns = Math.PI * 2 * rnd(1.1, 2.3);
        for (var a = 0; a <= turns; a += 0.16) {
            pts.push({
                x: cx + Math.cos(a) * rr + rnd(-7, 7),
                y: cy + Math.sin(a) * rr * 0.88 + rnd(-7, 7)
            });
        }
        return { type: 'path', color: inkColor(), width: rnd(4, 6.5), points: pts };
    }

    /** 乱写几个字：字母或假名，位置散着落 */
    function genScrawls() {
        var chars = ('abcdefghijklmnopqrstuvwxyz' + 'あいうえおかきくけこさしすせそたちつてとなにぬねの').split('');
        var out = [], n = 2 + Math.floor(Math.random() * 4);
        for (var i = 0; i < n; i++) {
            out.push({
                type: 'text',
                text: pick(chars),
                x: W / 2 + rnd(-W * 0.3, W * 0.3),
                y: W / 2 + rnd(-W * 0.3, W * 0.3),
                size: rnd(48, 84),
                color: inkColor(),
                rot: rnd(-0.35, 0.35)
            });
        }
        return out;
    }

    function buildPartnerStrokes() {
        var r = Math.random();
        // 大多数就是随手几笔，偶尔绕个圈、写几个字、画个小心心
        if (r < 0.52) {
            var out = [], n = 1 + Math.floor(Math.random() * 3);
            for (var i = 0; i < n; i++) out.push(genFreeLine());
            return out;
        }
        if (r < 0.68) return [genLoop()];
        if (r < 0.84) return genScrawls();
        if (r < 0.92) return genHeart(rnd(12, 18));
        return [genFreeLine(), genLoop()].concat(genScrawls().slice(0, 1));
    }

    /** 生成一张梦角涂鸦的 Base64 */
    function makePartnerDoodle() {
        var c = document.createElement('canvas');
        c.width = W;
        c.height = W;
        var g = c.getContext('2d');
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, W, W);
        buildPartnerStrokes().forEach(function (s) { paintStroke(s, g); });
        return c.toDataURL('image/png');
    }

    function sendPartnerDoodle() {
        var dataUrl = makePartnerDoodle();
        addMessage({
            id: Date.now(),
            sender: (typeof settings !== 'undefined' && settings.partnerName) ? settings.partnerName : '对方',
            text: '',
            image: dataUrl,
            timestamp: new Date(),
            status: 'received',
            favorited: false,
            note: null,
            replyTo: null,
            type: 'normal'
        });
        if (typeof playSound === 'function') playSound('message');
        try {
            if (typeof window._sendPartnerNotification === 'function') {
                window._sendPartnerNotification(
                    (typeof settings !== 'undefined' && settings.partnerName) ? settings.partnerName : '对方',
                    '[涂鸦]'
                );
            }
        } catch (e) {}
    }

    /** 低频检查：到点了就画一张发过来 */
    function checkAutoDoodle() {
        if (autoChecking) return;
        autoChecking = true;
        (function () {
            var key = null;
            try { key = getStorageKey(AUTO_KEY); } catch (e) { autoChecking = false; return; }
            localforage.getItem(key).then(function (st) {
                var now = Date.now();
                if (!st || typeof st.nextAt !== 'number') {
                    return localforage.setItem(key, { nextAt: now + rnd(AUTO_FIRST_HOURS[0], AUTO_FIRST_HOURS[1]) * 3600000, lastAt: 0 });
                }
                if (now < st.nextAt) return null;
                sendPartnerDoodle();
                return localforage.setItem(key, { nextAt: now + rnd(AUTO_LOOP_HOURS[0], AUTO_LOOP_HOURS[1]) * 3600000, lastAt: now });
            }).catch(function () {}).then(function () { autoChecking = false; });
        })();
    }

    /* ══════════════════ 六、入口按钮与启动 ══════════════════ */

    function ensureButton() {
        if (document.getElementById('doodle-btn')) return;
        var anchor = document.getElementById('attachment-btn');
        if (!anchor || !anchor.parentNode) return;
        var btn = document.createElement('button');
        btn.className = 'attachment-btn input-btn collapse-hideable';
        btn.id = 'doodle-btn';
        btn.title = '涂鸦板';
        btn.innerHTML = '<i class="fas fa-paint-brush"></i>';
        btn.addEventListener('click', openBoard);
        anchor.parentNode.insertBefore(btn, anchor.nextSibling);
    }

    function boot() {
        ensureButton();
        // 页面结构可能被其它模块重建，轻量重试几次
        [200, 800, 2400].forEach(function (ms) { setTimeout(ensureButton, ms); });

        setTimeout(checkAutoDoodle, 10000);
        setInterval(checkAutoDoodle, 30 * 60 * 1000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    // 便于调试 / 其它模块调用
    window.DoodleBoard = {
        open: openBoard,
        close: closeBoard,
        partnerDoodle: makePartnerDoodle,
        sendPartnerDoodle: sendPartnerDoodle
    };
})();
