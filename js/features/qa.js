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
        try {
            localStorage.setItem(QA_STORAGE_KEY, JSON.stringify(arr.slice(0, QA_MAX_RECORDS)));
        } catch (e) {
            console.warn('[QA] 保存历史失败:', e);
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
                    <div class="qa-field-label"><i class="fas fa-list-ul"></i> 选项</div>
                    <textarea id="qa-options-input" class="qa-input qa-textarea" placeholder="每行一个选项，至少2个" rows="4"></textarea>
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

        if (optsEl) {
            optsEl.innerHTML = record.options.map((opt) => {
                const chosen = opt === record.chosen;
                return `<div class="qa-option${chosen ? ' chosen' : ''}" role="button" tabindex="0">
                    ${chosen ? '<span class="qa-opt-badge">✦ 他选了</span>' : ''}
                    <span>${esc(opt)}</span>
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
                <div class="qa-hi-question">${esc(r.question)}</div>
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
        const ta = document.getElementById('qa-options-input');
        const question = (q.value || '').trim();
        const options = (ta.value || '').split(/\n+/).map(s => s.trim()).filter(Boolean);

        if (!question) {
            if (typeof showNotification === 'function') showNotification('先写下你想问他的问题吧 ✧', 'warning');
            q.focus();
            return;
        }
        if (options.length < 2) {
            if (typeof showNotification === 'function') showNotification('至少提供 2 个选项，每行一个', 'warning');
            ta.focus();
            return;
        }

        const chosen = options[Math.floor(Math.random() * options.length)];
        const card = drawRandomCard();
        const record = { question, options, chosen, card, time: Date.now() };
        qaCurrent = record;
        addHistoryRecord(record);
        renderResult(record);
        showView('result');
    }

    function handleAgain() {
        if (!qaCurrent || !Array.isArray(qaCurrent.options) || qaCurrent.options.length < 2) return;
        const chosen = qaCurrent.options[Math.floor(Math.random() * qaCurrent.options.length)];
        const card = drawRandomCard();
        const record = {
            question: qaCurrent.question,
            options: qaCurrent.options.slice(),
            chosen,
            card,
            time: Date.now()
        };
        qaCurrent = record;
        addHistoryRecord(record);
        renderResult(record);
    }

    function openQA() {
        buildModal();
        const q = document.getElementById('qa-question-input');
        const ta = document.getElementById('qa-options-input');
        if (q) q.value = '';
        if (ta) ta.value = '';
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

        const submitBtn = document.getElementById('qa-submit-btn');
        if (submitBtn) submitBtn.addEventListener('click', handleSubmit);

        const againBtn = document.getElementById('qa-again-btn');
        if (againBtn) againBtn.addEventListener('click', handleAgain);

        const cancelBtn = document.getElementById('qa-cancel-btn');
        if (cancelBtn) cancelBtn.addEventListener('click', () => hideModal(qaModal));

        const backBtn = document.getElementById('qa-back-btn');
        if (backBtn) backBtn.addEventListener('click', () => {
            const q = document.getElementById('qa-question-input');
            showView('setup');
            setTimeout(() => { if (q) q.focus(); }, 60);
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

        // 出题视图：Ctrl/Cmd + Enter 快速提交
        const ta = document.getElementById('qa-options-input');
        if (ta) ta.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                handleSubmit();
            }
        });
    }

    window.initQAModule = window.initQAModule || initQAModule;
    window.openQA = window.openQA || openQA;
})();
