/* ============================================================
 * qa.js —— 「问答」功能模块
 * 问他一个问题，他会从你给出的选项中随机替你选一个，
 * 并回你一张字卡。每次问答都会保存在本地（localStorage）历史里。
 * 入口：
 *   1. 高级功能 → 实用工具 → 「问答」（#qa-function）
 *   2. 主页收纳面板 → 「问答」快捷按钮（window.openQA）
 * ============================================================ */

(function () {
    'use strict';

    if (window.__qaModuleLoaded) return;
    window.__qaModuleLoaded = true;

    const QA_STORAGE_KEY = (typeof APP_PREFIX !== 'undefined' ? APP_PREFIX : 'CHAT_APP_V3_') + 'qa_history';
    const QA_MAX_RECORDS = 200;

    let qaModal = null;
    let qaCurrent = null; // 当前展示的记录 { question, options, chosen, card, time }
    let qaPendingPhoto = null; // 本次要随问题一起发出去的图（压缩后的 dataURL）
    let qaPhotoBusy = false;
    let qaOptions = [{ type: 'text', text: '' }, { type: 'text', text: '' }];
    let qaPickIndex = -1;
    let qaOptBusy = false;

    /* ── 小工具 ─────────────────────────────────────── */
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function readHistory() {
        try {
            const raw = localStorage.getItem(QA_STORAGE_KEY);
            const arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr : [];
        } catch (e) {
            console.warn('[QA] 读取历史失败:', e);
            return [];
        }
    }

    function writeHistory(arr) {
        let list = arr.slice(0, QA_MAX_RECORDS);
        for (let attempt = 0; attempt < 60; attempt++) {
            try {
                localStorage.setItem(QA_STORAGE_KEY, JSON.stringify(list));
                return;
            } catch (e) {
                // 存不下了：从最旧的几条开始把图丢掉，文字记录保留
                let dropped = 0;
                for (let i = list.length - 1; i >= 0 && dropped < 5; i--) {
                    const hasPhoto = list[i] && (list[i].photo || (Array.isArray(list[i].options) && list[i].options.some(o => o && o.type === 'photo' && o.photo)));
                    if (hasPhoto) {
                        const clone = Object.assign({}, list[i], { photo: null });
                        if (Array.isArray(list[i].options)) {
                            clone.options = list[i].options.map(o => (o && o.type === 'photo') ? { type: 'photo', photo: null } : o);
                        }
                        list[i] = clone;
                        dropped++;
                    }
                }
                if (!dropped) {
                    console.warn('[QA] 保存历史失败:', e);
                    return;
                }
            }
        }
    }

    function addHistoryRecord(record) {
        const arr = readHistory();
        arr.unshift(Object.assign({ id: Date.now() + '_' + Math.random().toString(36).slice(2, 8) }, record));
        writeHistory(arr);
        return arr;
    }

    // 随机抽取一张字卡 —— 复用项目现有的抽卡机制（与 core.js simulateReply 完全一致）：
    //   1) 过滤被屏蔽的字卡（localStorage.disabledReplyItems）
    //   2) 过滤被禁用的分组中的字卡（window.customReplyGroups[].disabled）
    //   3) 去空后随机抽取；自定义字卡库为空时回退到内置字卡
    function drawRandomCard() {
        let pool = [];
        try {
            if (typeof customReplies !== 'undefined' && Array.isArray(customReplies) && customReplies.length > 0) {
                const disabledItems = (typeof _getDisabledItemsSet === 'function')
                    ? _getDisabledItemsSet()
                    : (() => {
                        try {
                            const raw = localStorage.getItem('disabledReplyItems');
                            return raw ? new Set(JSON.parse(raw)) : new Set();
                        } catch (e) { return new Set(); }
                    })();
                const disabledGroupItems = new Set();
                try {
                    (window.customReplyGroups || []).forEach(g => {
                        if (g.disabled && Array.isArray(g.items)) g.items.forEach(item => disabledGroupItems.add(item));
                    });
                } catch (e) {}
                pool = customReplies
                    .filter(r => !disabledItems.has(r) && !disabledGroupItems.has(r))
                    .map(r => String(r || '').trim())
                    .filter(Boolean);
            }
        } catch (e) {}
        if (pool.length === 0) {
            try {
                if (typeof CONSTANTS !== 'undefined' && Array.isArray(CONSTANTS.REPLY_MESSAGES) && CONSTANTS.REPLY_MESSAGES.length > 0) {
                    pool = CONSTANTS.REPLY_MESSAGES.filter(t => typeof t === 'string' && t.trim());
                }
            } catch (e) {}
        }
        if (pool.length === 0) pool = ['他轻轻笑了笑 ✦'];
        return pool[Math.floor(Math.random() * pool.length)];
    }

    /* 把相片压成一张不大的 jpeg：最长边 720、控制在 160KB 以内 */
    function shrinkPhoto(file, maxSide, maxChars) {
        return new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onerror = () => reject(new Error('读取图片失败'));
            fr.onload = () => {
                const img = new Image();
                img.onerror = () => reject(new Error('图片解析失败'));
                img.onload = () => {
                    let w = img.naturalWidth || img.width;
                    let h = img.naturalHeight || img.height;
                    const m = Math.max(w, h);
                    if (m > maxSide) { const r = maxSide / m; w = Math.round(w * r); h = Math.round(h * r); }
                    const cv = document.createElement('canvas');
                    cv.width = w; cv.height = h;
                    const ctx = cv.getContext('2d');
                    ctx.drawImage(img, 0, 0, w, h);
                    let q = 0.62;
                    let out = cv.toDataURL('image/jpeg', q);
                    while (out.length > maxChars && q > 0.3) {
                        q -= 0.08;
                        out = cv.toDataURL('image/jpeg', q);
                    }
                    resolve(out);
                };
                img.src = fr.result;
            };
            fr.readAsDataURL(file);
        });
    }

    /* ── 选项：每一项独立，可以是文字，也可以是一张图 ──────── */
    function optionTag(i) { return String.fromCharCode(65 + i); }

    function normalizeOption(o) {
        if (o == null) return { type: 'text', text: '' };
        if (typeof o === 'string') return { type: 'text', text: o };
        if (o.type === 'photo') return { type: 'photo', photo: o.photo || null };
        return { type: 'text', text: String(o.text == null ? '' : o.text) };
    }

    function optionIsValid(o) {
        const n = normalizeOption(o);
        return n.type === 'photo' ? !!n.photo : String(n.text || '').trim().length > 0;
    }

    function optionLabel(o) {
        const n = normalizeOption(o);
        return n.type === 'photo' ? '[图片]' : String(n.text || '').trim();
    }

    function isChosenOption(record, o, i) {
        if (typeof record.chosenIndex === 'number') return i === record.chosenIndex;
        const chosenText = String(record.chosen || '');
        const n = normalizeOption(o);
        return n.type === 'text' && n.text === chosenText;
    }

    function renderOptionsEditor() {
        const box = document.getElementById('qa-options-editor');
        if (!box) return;

        box.innerHTML = qaOptions.map((o, i) => {
            const n = normalizeOption(o);
            const tag = '<span class="qa-opt-tag">' + optionTag(i) + '</span>';
            const typeBtn = '<button type="button" class="qa-opt-type" data-type="' + i + '" title="'
                + (n.type === 'text' ? '这一项改成发图片' : '这一项改回写字') + '">'
                + '<i class="fas ' + (n.type === 'text' ? 'fa-image' : 'fa-font') + '"></i></button>';
            let body;
            if (n.type === 'text') {
                body = '<input type="text" class="qa-input qa-opt-text" data-text="' + i
                    + '" maxlength="60" autocomplete="off" placeholder="这一项写点什么？" value="' + esc(n.text) + '">';
            } else {
                body = '<div class="qa-opt-photo">'
                    + (n.photo ? '<img src="' + n.photo + '" data-big="' + i + '" alt="选项图">'
                               : '<span class="qa-opt-photo-ph">还没选图</span>')
                    + '<button type="button" class="qa-opt-photo-btn" data-pick="' + i + '">'
                    + '<i class="fas fa-image"></i> ' + (n.photo ? '换一张' : '选一张图') + '</button>'
                    + '</div>';
            }
            const del = qaOptions.length > 2
                ? '<button type="button" class="qa-opt-del" data-del="' + i + '" title="删掉这项"><i class="fas fa-times"></i></button>'
                : '';
            return '<div class="qa-opt-row' + (n.type === 'photo' ? ' is-photo' : '') + '">'
                + tag + '<div class="qa-opt-body">' + body + '</div>' + typeBtn + del + '</div>';
        }).join('') + '<input type="file" id="qa-opt-file" accept="image/*" hidden>';

        // 文字项：边打边存，不重绘（免得丢焦点）
        box.querySelectorAll('[data-text]').forEach(el => {
            const idx = Number(el.dataset.text);
            el.addEventListener('input', () => { qaOptions[idx] = { type: 'text', text: el.value }; });
            el.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                const next = box.querySelector('[data-text="' + (idx + 1) + '"]');
                if (next) next.focus(); else handleSubmit();
            });
        });

        // 切换类型：文字 ↔ 图片
        box.querySelectorAll('[data-type]').forEach(el => el.addEventListener('click', () => {
            const idx = Number(el.dataset.type);
            const n = normalizeOption(qaOptions[idx]);
            if (n.type === 'text') {
                qaOptions[idx] = { type: 'photo', photo: null };
            } else {
                qaOptions[idx] = { type: 'text', text: '' };
            }
            renderOptionsEditor();
        }));

        // 选图 / 点开看大图
        box.querySelectorAll('[data-pick]').forEach(el => el.addEventListener('click', () => {
            if (qaOptBusy) return;
            qaPickIndex = Number(el.dataset.pick);
            const f = document.getElementById('qa-opt-file');
            if (f) f.click();
        }));
        box.querySelectorAll('[data-big]').forEach(el => el.addEventListener('click', () => {
            const n = normalizeOption(qaOptions[Number(el.dataset.big)]);
            if (n.photo) window.open(n.photo, '_blank');
        }));

        // 删掉这一项
        box.querySelectorAll('[data-del]').forEach(el => el.addEventListener('click', () => {
            if (qaOptions.length <= 2) return;
            qaOptions.splice(Number(el.dataset.del), 1);
            renderOptionsEditor();
        }));

        // 选图回调（元素每次重建，绑在新建的 input 上）
        const fileEl = document.getElementById('qa-opt-file');
        if (fileEl) fileEl.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            e.target.value = '';
            if (!file) return;
            if (!/^image\//.test(file.type || '')) {
                if (typeof showNotification === 'function') showNotification('只支持图片文件', 'warning');
                return;
            }
            qaOptBusy = true;
            try {
                const dataUrl = await shrinkPhoto(file, 480, 60000);
                qaOptions[qaPickIndex] = { type: 'photo', photo: dataUrl };
                renderOptionsEditor();
            } catch (err) {
                console.warn('[QA] 选项图片处理失败:', err);
                if (typeof showNotification === 'function') showNotification('这张图没处理成功，换一张试试', 'error');
            } finally {
                qaOptBusy = false;
            }
        });
    }

    // 字卡支持「主文字|副文字」格式（与回复库一致）
    function formatCardText(card) {
        const idx = card.indexOf('|');
        if (idx > 0) {
            return { main: card.slice(0, idx).trim(), sub: card.slice(idx + 1).trim() };
        }
        return { main: card, sub: '' };
    }

    /* ── 样式注入（只注入一次） ────────────────────────── */
    (function _injectQAStyles() {
        if (document.getElementById('qa-shared-styles')) return;
        const s = document.createElement('style');
        s.id = 'qa-shared-styles';
        s.textContent = `
            #qa-modal .qa-modal-content {
                width: 92%;
                max-width: 460px;
                max-height: 88vh;
                display: flex;
                flex-direction: column;
                padding: 20px 20px 16px;
                background: var(--secondary-bg);
                border-radius: 22px;
                box-shadow: 0 24px 60px rgba(0,0,0,0.28);
                overflow: hidden;
            }
            #qa-modal .qa-title-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
            #qa-modal .qa-history-btn {
                margin-left: auto;
                display: inline-flex;
                align-items: center;
                gap: 5px;
                padding: 6px 12px;
                border: 1.5px solid var(--border-color);
                border-radius: 20px;
                background: var(--primary-bg);
                color: var(--text-secondary);
                font-size: 12px;
                cursor: pointer;
                font-family: var(--font-family);
                transition: all 0.18s;
                flex-shrink: 0;
            }
            #qa-modal .qa-history-btn:hover { border-color: var(--accent-color); color: var(--accent-color); }
            #qa-modal .qa-view { overflow-y: auto; min-height: 0; padding: 6px 2px 2px; }
            #qa-modal .qa-field-label {
                display: flex; align-items: center; gap: 6px;
                font-size: 13px; font-weight: 600; color: var(--text-primary);
                margin: 14px 0 8px;
            }
            #qa-modal .qa-field-label i { color: var(--accent-color); font-size: 12px; }
            #qa-modal .qa-input {
                width: 100%;
                padding: 11px 13px;
                border: 1.5px solid var(--border-color);
                border-radius: 12px;
                background: var(--primary-bg);
                color: var(--text-primary);
                font-size: 14px;
                font-family: var(--font-family);
                outline: none;
                box-sizing: border-box;
                transition: border-color 0.2s;
            }
            #qa-modal .qa-input:focus { border-color: var(--accent-color); }
            #qa-modal .qa-input::placeholder { color: var(--text-secondary); opacity: 0.72; }
            #qa-modal .qa-textarea { resize: vertical; min-height: 96px; line-height: 1.6; }
            #qa-modal .qa-hint {
                font-size: 11.5px;
                color: var(--text-secondary);
                margin-top: 10px;
                letter-spacing: 0.3px;
            }
            #qa-modal .qa-btn-row { margin-top: 16px; padding-bottom: 2px; }
            #qa-modal .qa-result-head { text-align: center; margin-bottom: 4px; }
            #qa-modal .qa-result-kicker {
                font-size: 11px; color: var(--text-secondary); letter-spacing: 3px; margin-bottom: 8px;
            }
            #qa-modal .qa-result-question {
                font-size: 16px; font-weight: 700; color: var(--text-primary);
                line-height: 1.6; word-break: break-word;
                padding: 12px 14px;
                background: rgba(var(--accent-color-rgb), 0.07);
                border: 1.5px dashed rgba(var(--accent-color-rgb), 0.3);
                border-radius: 14px;
            }
            #qa-modal .qa-options-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 10px;
                margin: 14px 0 4px;
            }
            @media (max-width: 400px) {
                #qa-modal .qa-options-grid { grid-template-columns: 1fr; }
            }
            #qa-modal .qa-option {
                position: relative;
                padding: 13px 14px;
                border: 1.5px solid var(--border-color);
                border-radius: 14px;
                background: var(--primary-bg);
                color: var(--text-primary);
                font-size: 13.5px;
                line-height: 1.5;
                text-align: center;
                cursor: pointer;
                user-select: none;
                transition: all 0.18s;
                font-family: var(--font-family);
                word-break: break-word;
            }
            #qa-modal .qa-option:hover {
                border-color: var(--accent-color);
                transform: translateY(-1px);
                box-shadow: 0 4px 14px rgba(var(--accent-color-rgb), 0.12);
            }
            #qa-modal .qa-option:active { transform: scale(0.97); }
            #qa-modal .qa-option.chosen {
                border-color: var(--accent-color);
                background: linear-gradient(135deg, rgba(var(--accent-color-rgb), 0.18), rgba(var(--accent-color-rgb), 0.05));
                color: var(--accent-color);
                font-weight: 600;
                box-shadow: 0 4px 16px rgba(var(--accent-color-rgb), 0.22);
            }
            #qa-modal .qa-option.qa-picked {
                border-color: #4d96ff;
                background: rgba(77, 150, 255, 0.10);
                color: #4d96ff;
            }
            #qa-modal .qa-opt-badge {
                position: absolute;
                top: -9px;
                right: -5px;
                font-size: 10px;
                font-weight: 700;
                color: #fff;
                background: var(--accent-color);
                border-radius: 20px;
                padding: 2px 9px;
                box-shadow: 0 2px 8px rgba(var(--accent-color-rgb), 0.4);
                letter-spacing: 0.5px;
                white-space: nowrap;
            }
            #qa-modal .qa-opt-badge-you {
                background: #4d96ff;
                box-shadow: 0 2px 8px rgba(77, 150, 255, 0.4);
            }
            #qa-modal .qa-card-area { margin-top: 18px; text-align: center; }
            #qa-modal .qa-card-label {
                font-size: 12px; color: var(--text-secondary);
                letter-spacing: 2px; margin-bottom: 9px;
            }
            #qa-modal .qa-reply-card {
                display: inline-block;
                max-width: 100%;
                padding: 16px 22px;
                border-radius: 16px;
                border: 1.5px solid rgba(var(--accent-color-rgb), 0.35);
                background: linear-gradient(135deg, var(--primary-bg), rgba(var(--accent-color-rgb), 0.08));
                box-shadow: 0 8px 24px rgba(var(--accent-color-rgb), 0.14);
                animation: qaCardPop 0.4s cubic-bezier(0.34, 1.4, 0.64, 1);
            }
            @keyframes qaCardPop {
                from { opacity: 0; transform: translateY(10px) scale(0.92); }
                to   { opacity: 1; transform: translateY(0) scale(1); }
            }
            #qa-modal .qa-reply-card-main {
                font-size: 15px; font-weight: 600; color: var(--text-primary);
                letter-spacing: 0.5px; line-height: 1.6; word-break: break-word;
            }
            #qa-modal .qa-reply-card-sub {
                font-size: 12px; color: var(--text-secondary);
                margin-top: 4px; line-height: 1.5; word-break: break-word;
            }
            #qa-modal .qa-empty-list {
                text-align: center;
                color: var(--text-secondary);
                padding: 46px 10px;
                font-size: 13px;
                line-height: 2;
            }
            #qa-modal .qa-empty-list i { font-size: 30px; opacity: 0.4; display: block; margin-bottom: 8px; }
            #qa-modal .qa-history-item {
                padding: 12px 14px;
                border-radius: 14px;
                background: var(--primary-bg);
                border: 1.5px solid var(--border-color);
                margin-bottom: 10px;
                cursor: pointer;
                transition: all 0.18s;
            }
            #qa-modal .qa-history-item:hover {
                border-color: var(--accent-color);
                transform: translateY(-1px);
                box-shadow: 0 4px 14px rgba(var(--accent-color-rgb), 0.1);
            }
            #qa-modal .qa-hi-top {
                display: flex; align-items: center; justify-content: space-between;
                gap: 8px; margin-bottom: 6px; flex-wrap: wrap;
            }
            #qa-modal .qa-hi-time { font-size: 11px; color: var(--text-secondary); }
            #qa-modal .qa-hi-chosen {
                font-size: 12px; font-weight: 600; color: var(--accent-color);
                background: rgba(var(--accent-color-rgb), 0.1);
                padding: 2px 10px; border-radius: 20px;
            }
            #qa-modal .qa-hi-question {
                font-size: 13.5px; font-weight: 600; color: var(--text-primary);
                word-break: break-word; margin-bottom: 5px; line-height: 1.5;
            }
            #qa-modal .qa-hi-card {
                font-size: 12px; color: var(--text-secondary);
                word-break: break-word; line-height: 1.5;
                border-left: 3px solid rgba(var(--accent-color-rgb), 0.4);
                padding-left: 10px;
            }
            #qa-modal .qa-clear-btn {
                background: rgba(239, 68, 68, 0.1);
                color: #ef4444;
            }
            #qa-modal .qa-clear-btn:hover { background: rgba(239, 68, 68, 0.18); }
            #qa-modal .qa-photo-row { margin-top: 10px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
            #qa-modal .qa-add-photo {
                display: inline-flex; align-items: center; gap: 6px;
                padding: 8px 14px;
                border: 1.5px dashed var(--border-color);
                border-radius: 20px;
                background: var(--primary-bg);
                color: var(--text-secondary);
                font-size: 12.5px; cursor: pointer; font-family: var(--font-family);
                transition: all 0.18s;
            }
            #qa-modal .qa-add-photo:hover { border-color: var(--accent-color); color: var(--accent-color); }
            #qa-modal .qa-add-photo.busy { opacity: 0.6; pointer-events: none; }
            #qa-modal .qa-photo-preview { position: relative; display: none; }
            #qa-modal .qa-photo-preview img {
                width: 62px; height: 62px; object-fit: cover;
                border-radius: 12px; border: 1.5px solid var(--border-color); display: block;
            }
            #qa-modal .qa-photo-del {
                position: absolute; top: -6px; right: -6px;
                width: 20px; height: 20px; border-radius: 50%;
                border: none; background: rgba(239, 68, 68, 0.9); color: #fff;
                font-size: 11px; line-height: 1; cursor: pointer;
                display: flex; align-items: center; justify-content: center;
            }
            #qa-modal .qa-result-photo { margin-top: 10px; display: none; text-align: center; }
            #qa-modal .qa-result-photo img {
                max-width: 100%; max-height: 260px;
                border-radius: 14px; border: 1.5px solid var(--border-color);
                box-shadow: 0 8px 22px rgba(0,0,0,0.12);
            }
            #qa-modal .qa-hi-photo img {
                width: 44px; height: 44px; object-fit: cover;
                border-radius: 8px; border: 1px solid var(--border-color);
                vertical-align: middle; margin-right: 8px;
            }
            #qa-modal .qa-opt-editor { display: flex; flex-direction: column; gap: 9px; }
            #qa-modal .qa-opt-row {
                display: flex; align-items: center; gap: 8px;
                padding: 7px 9px;
                border: 1.5px solid var(--border-color);
                border-radius: 13px;
                background: var(--primary-bg);
            }
            #qa-modal .qa-opt-row.is-photo { border-style: dashed; }
            #qa-modal .qa-opt-tag {
                width: 22px; height: 22px; flex-shrink: 0;
                display: flex; align-items: center; justify-content: center;
                border-radius: 50%;
                background: rgba(var(--accent-color-rgb), 0.12);
                color: var(--accent-color);
                font-size: 12px; font-weight: 700;
            }
            #qa-modal .qa-opt-body { flex: 1; min-width: 0; display: flex; align-items: center; }
            #qa-modal .qa-opt-text {
                border: none !important; background: transparent !important;
                padding: 4px 2px !important; font-size: 13.5px !important;
                width: 100%;
            }
            #qa-modal .qa-opt-text:focus { border: none !important; }
            #qa-modal .qa-opt-photo { display: flex; align-items: center; gap: 8px; width: 100%; }
            #qa-modal .qa-opt-photo img {
                width: 42px; height: 42px; object-fit: cover;
                border-radius: 9px; border: 1px solid var(--border-color); cursor: zoom-in;
            }
            #qa-modal .qa-opt-photo-ph { font-size: 12px; color: var(--text-secondary); }
            #qa-modal .qa-opt-photo-btn {
                padding: 5px 11px; border-radius: 16px;
                border: 1.5px solid var(--border-color);
                background: var(--secondary-bg);
                color: var(--text-secondary);
                font-size: 11.5px; cursor: pointer; font-family: var(--font-family);
                white-space: nowrap;
            }
            #qa-modal .qa-opt-photo-btn:hover { border-color: var(--accent-color); color: var(--accent-color); }
            #qa-modal .qa-opt-type, #qa-modal .qa-opt-del {
                width: 26px; height: 26px; flex-shrink: 0;
                border: none; border-radius: 50%;
                background: transparent;
                color: var(--text-secondary);
                font-size: 12px; cursor: pointer;
                display: flex; align-items: center; justify-content: center;
            }
            #qa-modal .qa-opt-type:hover { background: rgba(var(--accent-color-rgb), 0.12); color: var(--accent-color); }
            #qa-modal .qa-opt-del:hover { background: rgba(239, 68, 68, 0.12); color: #ef4444; }
            #qa-modal .qa-add-option {
                margin-top: 9px;
                display: inline-flex; align-items: center; gap: 5px;
                padding: 7px 13px;
                border: 1.5px dashed var(--border-color);
                border-radius: 18px;
                background: transparent;
                color: var(--text-secondary);
                font-size: 12px; cursor: pointer; font-family: var(--font-family);
            }
            #qa-modal .qa-add-option:hover { border-color: var(--accent-color); color: var(--accent-color); }
            #qa-modal .qa-option-photo { padding: 6px; }
            #qa-modal .qa-opt-img { max-width: 100%; max-height: 150px; border-radius: 10px; display: block; margin: 0 auto; cursor: zoom-in; }
            #qa-modal .qa-opt-void { font-size: 12px; color: var(--text-secondary); }
        `;
        (document.head || document.documentElement).appendChild(s);
    })();

    /* ── 弹窗骨架 ─────────────────────────────────────── */
    function buildModal() {
        if (document.getElementById('qa-modal')) {
            qaModal = document.getElementById('qa-modal');
            return;
        }
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'qa-modal';
        modal.innerHTML = `
            <div class="modal-content qa-modal-content">
                <div class="modal-title qa-title-row">
                    <i class="fas fa-question-circle" style="color:var(--accent-color);"></i>
                    <span id="qa-modal-title">问答</span>
                    <button type="button" id="qa-history-btn" class="qa-history-btn" title="历史记录">
                        <i class="fas fa-history"></i><span>记录</span>
                    </button>
                </div>

                <div id="qa-view-setup" class="qa-view">
                    <div class="qa-field-label"><i class="fas fa-pen"></i> 你的问题</div>
                    <input type="text" id="qa-question-input" class="qa-input" placeholder="你想问他什么？" maxlength="200" autocomplete="off">
                    <div class="qa-photo-row">
                        <button type="button" class="qa-add-photo" id="qa-add-photo"><i class="fas fa-image"></i> 加一张图（可选）</button>
                        <div class="qa-photo-preview" id="qa-photo-preview">
                            <img id="qa-photo-img" alt="待发送的图">
                            <button type="button" class="qa-photo-del" id="qa-photo-del" title="移除这张图"><i class="fas fa-times"></i></button>
                        </div>
                        <input type="file" id="qa-photo-input" accept="image/*" hidden>
                    </div>
                    <div class="qa-field-label"><i class="fas fa-list-ul"></i> 选项</div>
                    <div id="qa-options-editor" class="qa-opt-editor"></div>
                    <button type="button" id="qa-add-option" class="qa-add-option"><i class="fas fa-plus"></i> 再加一项</button>
                    <div class="qa-hint">✧ 他会从你给出的选项里随机替你选一个，并回你一张字卡</div>
                    <div class="modal-buttons qa-btn-row">
                        <button class="modal-btn modal-btn-secondary" id="qa-cancel-btn">关闭</button>
                        <button class="modal-btn modal-btn-primary" id="qa-submit-btn"><i class="fas fa-question-circle" style="margin-right:4px;"></i>问答</button>
                    </div>
                </div>

                <div id="qa-view-result" class="qa-view" style="display:none;">
                    <div class="qa-result-head">
                        <div class="qa-result-kicker">你 问 他</div>
                        <div class="qa-result-question" id="qa-result-question"></div>
                        <div class="qa-result-photo" id="qa-result-photo"><img id="qa-result-photo-img" alt="你发的图"></div>
                    </div>
                    <div class="qa-options-grid" id="qa-result-options"></div>
                    <div class="qa-card-area">
                        <div class="qa-card-label">✦ 他回了一张字卡 ✦</div>
                        <div class="qa-reply-card" id="qa-result-card"></div>
                    </div>
                    <div class="modal-buttons qa-btn-row">
                        <button class="modal-btn modal-btn-secondary" id="qa-back-btn">继续提问</button>
                        <button class="modal-btn modal-btn-primary" id="qa-again-btn"><i class="fas fa-sync-alt" style="margin-right:4px;"></i>再来一次</button>
                    </div>
                </div>

                <div id="qa-view-history" class="qa-view" style="display:none;">
                    <div id="qa-history-list" class="qa-history-list"></div>
                    <div class="modal-buttons qa-btn-row">
                        <button class="modal-btn modal-btn-secondary" id="qa-history-back-btn">返回</button>
                        <button class="modal-btn modal-btn-primary qa-clear-btn" id="qa-history-clear-btn"><i class="fas fa-trash-alt" style="margin-right:4px;"></i>清空记录</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        qaModal = modal;

        // 点击弹窗背景关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) hideModal(modal);
        });
    }

    /* ── 视图切换 ─────────────────────────────────────── */
    function showView(name) {
        ['setup', 'result', 'history'].forEach(v => {
            const el = document.getElementById('qa-view-' + v);
            if (el) el.style.display = (v === name) ? '' : 'none';
        });
        const title = document.getElementById('qa-modal-title');
        if (title) {
            title.textContent = name === 'setup' ? '问答' : (name === 'result' ? '他的回答' : '问答记录');
        }
    }

    /* ── 结果渲染 ─────────────────────────────────────── */
    function renderResult(record) {
        const qEl = document.getElementById('qa-result-question');
        const optsEl = document.getElementById('qa-result-options');
        const cardEl = document.getElementById('qa-result-card');

        if (qEl) qEl.textContent = record.question;

        const phEl = document.getElementById('qa-result-photo');
        const phImg = document.getElementById('qa-result-photo-img');
        if (phEl && phImg) {
            if (record.photo) {
                phImg.src = record.photo;
                phEl.style.display = 'block';
            } else {
                phImg.removeAttribute('src');
                phEl.style.display = 'none';
            }
        }

        if (optsEl) {
            const opts = (record.options || []).map(normalizeOption);
            optsEl.innerHTML = opts.map((o, i) => {
                const chosen = isChosenOption(record, o, i);
                const inner = o.type === 'photo'
                    ? (o.photo ? `<img class="qa-opt-img" src="${o.photo}" alt="">` : `<span class="qa-opt-void">图片已清理</span>`)
                    : `<span>${esc(o.text)}</span>`;
                return `<div class="qa-option${chosen ? ' chosen' : ''}${o.type === 'photo' ? ' qa-option-photo' : ''}" role="button" tabindex="0">
                    ${chosen ? '<span class="qa-opt-badge">✦ 他选了</span>' : ''}
                    ${inner}
                </div>`;
            }).join('');

            // 点击选项：标记「你选了」，与他随机选中的答案区分开
            optsEl.querySelectorAll('.qa-option').forEach(el => {
                el.addEventListener('click', () => {
                    optsEl.querySelectorAll('.qa-option').forEach(o => {
                        o.classList.remove('qa-picked');
                        const b = o.querySelector('.qa-opt-badge-you');
                        if (b) b.remove();
                    });
                    el.classList.add('qa-picked');
                    const badge = document.createElement('span');
                    badge.className = 'qa-opt-badge qa-opt-badge-you';
                    badge.textContent = '你选了';
                    el.insertBefore(badge, el.firstChild);
                });
            });
            optsEl.querySelectorAll('.qa-opt-img').forEach(img => {
                img.addEventListener('click', (e) => { e.stopPropagation(); window.open(img.src, '_blank'); });
            });
        }

        if (cardEl) {
            const card = formatCardText(String(record.card || ''));
            cardEl.innerHTML = `<div class="qa-reply-card-main">${esc(card.main)}</div>`
                + (card.sub ? `<div class="qa-reply-card-sub">${esc(card.sub)}</div>` : '');
            // 重新触发一次卡片弹出动画
            cardEl.style.animation = 'none';
            void cardEl.offsetWidth;
            cardEl.style.animation = '';
        }
    }

    /* ── 历史渲染 ─────────────────────────────────────── */
    function renderHistory() {
        const list = document.getElementById('qa-history-list');
        if (!list) return;
        const arr = readHistory();
        if (arr.length === 0) {
            list.innerHTML = `<div class="qa-empty-list">
                <i class="fas fa-comment-dots"></i>
                还没有问答记录<br>完成一次问答后，会在这里留下回忆 ✦
            </div>`;
            return;
        }
        list.innerHTML = arr.map((r, i) => {
            const t = new Date(r.time).toLocaleString('zh-CN', {
                month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
            });
            const cardTxt = formatCardText(String(r.card || ''));
            return `<div class="qa-history-item" data-idx="${i}">
                <div class="qa-hi-top">
                    <span class="qa-hi-time">${t}</span>
                    <span class="qa-hi-chosen">他选了：${esc(r.chosen)}</span>
                </div>
                <div class="qa-hi-question">${r.photo ? `<span class="qa-hi-photo"><img src="${r.photo}" alt=""></span>` : ''}${esc(r.question)}</div>
                <div class="qa-hi-card">${esc(cardTxt.main)}${cardTxt.sub ? ' · ' + esc(cardTxt.sub) : ''}</div>
            </div>`;
        }).join('');

        list.querySelectorAll('.qa-history-item').forEach(el => {
            el.addEventListener('click', () => {
                const r = readHistory()[Number(el.dataset.idx)];
                if (r) {
                    qaCurrent = r;
                    renderResult(r);
                    showView('result');
                }
            });
        });
    }

    /* ── 核心逻辑 ─────────────────────────────────────── */
    function handleSubmit() {
        const q = document.getElementById('qa-question-input');
        const question = (q.value || '').trim();

        if (!question) {
            if (typeof showNotification === 'function') showNotification('先写下你想问他的问题吧 ✧', 'warning');
            if (q) q.focus();
            return;
        }
        if (qaOptions.length < 2) {
            if (typeof showNotification === 'function') showNotification('至少要两项可选', 'warning');
            return;
        }
        const bad = qaOptions.findIndex(o => !optionIsValid(o));
        if (bad !== -1) {
            const n = normalizeOption(qaOptions[bad]);
            if (typeof showNotification === 'function') {
                showNotification('第 ' + optionTag(bad) + ' 项' + (n.type === 'photo' ? '还没选图' : '还没写字'), 'warning');
            }
            const el = document.querySelector('[data-text="' + bad + '"], [data-pick="' + bad + '"]');
            if (el) el.focus();
            return;
        }

        const opts = qaOptions.map(normalizeOption);
        const chosenIndex = Math.floor(Math.random() * opts.length);
        const chosen = optionLabel(opts[chosenIndex]);
        const card = drawRandomCard();
        const record = {
            question, options: opts, chosenIndex, chosen, card,
            photo: qaPendingPhoto || null, time: Date.now()
        };
        qaCurrent = record;
        addHistoryRecord(record);
        renderResult(record);
        showView('result');
    }

    function handleAgain() {
        if (!qaCurrent || !Array.isArray(qaCurrent.options) || qaCurrent.options.length < 2) return;
        const opts = qaCurrent.options.map(normalizeOption);
        const chosenIndex = Math.floor(Math.random() * opts.length);
        const card = drawRandomCard();
        const record = {
            question: qaCurrent.question,
            options: opts,
            chosenIndex,
            chosen: optionLabel(opts[chosenIndex]),
            card,
            photo: qaCurrent.photo || null,
            time: Date.now()
        };
        qaCurrent = record;
        addHistoryRecord(record);
        renderResult(record);
    }

    function openQA() {
        buildModal();
        const q = document.getElementById('qa-question-input');
        if (q) q.value = '';
        qaOptions = [{ type: 'text', text: '' }, { type: 'text', text: '' }];
        renderOptionsEditor();
        qaPendingPhoto = null;
        const pv = document.getElementById('qa-photo-preview');
        if (pv) pv.style.display = 'none';
        const pi = document.getElementById('qa-photo-img');
        if (pi) pi.removeAttribute('src');
        showView('setup');
        showModal(qaModal);
        setTimeout(() => { if (q) q.focus(); }, 120);
    }

    /* ── 事件绑定 ─────────────────────────────────────── */
    function initQAModule() {
        // 高级功能 → 实用工具 → 「问答」
        const entryBtn = document.getElementById('qa-function');
        if (entryBtn && !entryBtn.dataset.qaBound) {
            entryBtn.dataset.qaBound = 'true';
            entryBtn.addEventListener('click', () => {
                hideModal(document.getElementById('advanced-modal'));
                openQA();
            });
        }

        // 主页收纳面板「问答」快捷按钮（走 window.openQA，由内联 onclick 触发）
        window.openQA = window.openQA || openQA;

        buildModal();
        bindModalEvents();
    }

    function bindModalEvents() {
        if (!qaModal) return;
        if (qaModal.dataset.qaBound) return;
        qaModal.dataset.qaBound = 'true';

        // 选图 / 移除图 / 看大图
        const photoBtn = document.getElementById('qa-add-photo');
        const photoInput = document.getElementById('qa-photo-input');
        const photoPreview = document.getElementById('qa-photo-preview');
        const photoImg = document.getElementById('qa-photo-img');
        const photoDel = document.getElementById('qa-photo-del');

        if (photoBtn && photoInput) {
            photoBtn.addEventListener('click', () => { if (!qaPhotoBusy) photoInput.click(); });
            photoInput.addEventListener('change', async (e) => {
                const file = e.target.files && e.target.files[0];
                e.target.value = '';
                if (!file) return;
                if (!/^image\//.test(file.type || '')) {
                    if (typeof showNotification === 'function') showNotification('只支持图片文件', 'warning');
                    return;
                }
                qaPhotoBusy = true;
                photoBtn.classList.add('busy');
                photoBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 处理中…';
                try {
                    const dataUrl = await shrinkPhoto(file, 720, 160000);
                    qaPendingPhoto = dataUrl;
                    if (photoImg) photoImg.src = dataUrl;
                    if (photoPreview) photoPreview.style.display = 'block';
                } catch (err) {
                    console.warn('[QA] 图片处理失败:', err);
                    if (typeof showNotification === 'function') showNotification('这张图没处理成功，换一张试试', 'error');
                } finally {
                    qaPhotoBusy = false;
                    photoBtn.classList.remove('busy');
                    photoBtn.innerHTML = '<i class="fas fa-image"></i> 加一张图（可选）';
                }
            });
        }
        if (photoDel) {
            photoDel.addEventListener('click', () => {
                qaPendingPhoto = null;
                if (photoImg) photoImg.removeAttribute('src');
                if (photoPreview) photoPreview.style.display = 'none';
            });
        }
        if (photoImg) {
            photoImg.addEventListener('click', () => { if (qaPendingPhoto) window.open(qaPendingPhoto, '_blank'); });
        }

        const submitBtn = document.getElementById('qa-submit-btn');
        if (submitBtn) submitBtn.addEventListener('click', handleSubmit);

        const againBtn = document.getElementById('qa-again-btn');
        if (againBtn) againBtn.addEventListener('click', handleAgain);

        const cancelBtn = document.getElementById('qa-cancel-btn');
        if (cancelBtn) cancelBtn.addEventListener('click', () => hideModal(qaModal));

        const backBtn = document.getElementById('qa-back-btn');
        if (backBtn) backBtn.addEventListener('click', () => {
            if (qaCurrent && Array.isArray(qaCurrent.options)) {
                qaOptions = qaCurrent.options.map(normalizeOption);
                renderOptionsEditor();
                qaPendingPhoto = qaCurrent.photo || null;
                const pi = document.getElementById('qa-photo-img');
                const pv = document.getElementById('qa-photo-preview');
                if (qaPendingPhoto && pi) { pi.src = qaPendingPhoto; if (pv) pv.style.display = 'block'; }
            }
            showView('setup');
        });

        const historyBtn = document.getElementById('qa-history-btn');
        if (historyBtn) historyBtn.addEventListener('click', () => {
            renderHistory();
            showView('history');
        });

        const historyBackBtn = document.getElementById('qa-history-back-btn');
        if (historyBackBtn) historyBackBtn.addEventListener('click', () => showView('setup'));

        const clearBtn = document.getElementById('qa-history-clear-btn');
        if (clearBtn) clearBtn.addEventListener('click', () => {
            if (!confirm('确定要清空全部问答记录吗？此操作无法恢复。')) return;
            writeHistory([]);
            renderHistory();
            if (typeof showNotification === 'function') showNotification('问答记录已清空', 'success');
        });

        // 再加一项
        const addOptBtn = document.getElementById('qa-add-option');
        if (addOptBtn) addOptBtn.addEventListener('click', () => {
            if (qaOptions.length >= 8) {
                if (typeof showNotification === 'function') showNotification('最多 8 项够用啦', 'warning');
                return;
            }
            qaOptions.push({ type: 'text', text: '' });
            renderOptionsEditor();
            const last = document.querySelector('[data-text="' + (qaOptions.length - 1) + '"]');
            if (last) last.focus();
        });
    }

    window.initQAModule = window.initQAModule || initQAModule;
    window.openQA = window.openQA || openQA;
})();
