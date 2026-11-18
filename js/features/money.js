/**
 * money.js — 红包 / 转账（双方互通）
 * ------------------------------------------------------------
 * 设计说明：
 * 1) 不新增消息类型，也不改 core.js。红包/转账作为一条 `type:'normal'` 的消息存进
 *    messages，额外挂一个 `money:{...}` 字段描述金额、类型、状态。
 * 2) 原站会把这行渲染成空气泡，我们在渲染完成后把气泡内容换成自己的卡片
 *    （只替换 `.message` 的 innerHTML，保留原站的头像、时间、收藏/删除按钮）。
 * 3) 原站任何一次全量重渲染（切设置、加载历史）都会让卡片退回空气泡，
 *    所以挂一个 MutationObserver，重建后自动补挂，刷新页面也不会丢。
 * 4) 钱是虚拟的，存在 getStorageKey('moneyData') 里，不涉及任何真实支付。
 */
(function () {
    'use strict';

    // ── 可调参数 ───────────────────────────────────────────────
    var START_BALANCE = 520;          // 用户初始钱包余额
    var PARTNER_START = 600;          // 梦角初始余额
    var AUTO_FIRST_HOURS = [4, 12];   // 她第一笔：4–12 小时后
    var AUTO_LOOP_HOURS = [12, 36];   // 之后：12–36 小时一笔
    var CLAIM_DELAY = [2000, 9000];   // 你发出去的红包，她多久后收（毫秒）

    var QUICK = [5.2, 8.88, 13.14, 52, 131.4];             // 快捷金额
    var PARTNER_AMOUNTS = [5.2, 8.88, 13.14, 20, 33, 52, 66.6];  // 她发来的金额池
    var PARTNER_NOTES = ['给你买点想吃的', '拿着', '上次你请我，这次我请', '零花钱', '别省着'];
    var REPLY_AFTER_RED = ['…收到了', '你自己留着用', '太多了', '谢谢', '下次别给了'];
    var REPLY_AFTER_TRANSFER = ['收到了', '不用给我转', '下次别转了', '钱够用'];

    var kind = 'redpacket';           // 当前面板选中的类型
    var state = null;                 // {balance, partner, nextAt, lastAt}
    var modalEl = null;
    var observer = null;
    var saveTimer = null;

    function rnd(a, b) { return a + Math.random() * (b - a); }
    function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
    function money(n) { return '¥' + Number(n).toFixed(2); }
    function chatBox() {
        return (window.DOMElements && DOMElements.chatContainer) || document.querySelector('#chat-container') || document.querySelector('.main-chat-area');
    }
    function partnerName() {
        try { return (typeof settings !== 'undefined' && settings.partnerName) ? settings.partnerName : '对方'; }
        catch (e) { return '对方'; }
    }

    /* ═══════════════ 一、储存（钱包 + 她的发钱节奏） ═══════════════ */

    function stateKey() { return getStorageKey('moneyData'); }

    function loadState() {
        var fallback = {
            balance: START_BALANCE,
            partner: PARTNER_START,
            nextAt: Date.now() + rnd(AUTO_FIRST_HOURS[0], AUTO_FIRST_HOURS[1]) * 3600000,
            lastAt: 0
        };
        if (!window.localforage) { state = fallback; return Promise.resolve(state); }
        return localforage.getItem(stateKey()).then(function (v) {
            if (v && typeof v === 'object' && typeof v.balance === 'number') {
                state = v;
                if (typeof state.partner !== 'number') state.partner = PARTNER_START;
            } else {
                state = fallback;
                return localforage.setItem(stateKey(), state);
            }
            return state;
        }).catch(function () { state = fallback; return state; });
    }

    function saveState() {
        if (!window.localforage || !state) return;
        // 合并短时间内的多次写入
        if (saveTimer) return;
        saveTimer = setTimeout(function () {
            saveTimer = null;
            localforage.setItem(stateKey(), state).catch(function () {});
        }, 300);
    }

    /* ═══════════════ 二、卡片长什么样 ═══════════════ */

    function cardHTML(m) {
        var mo = m.money || {};
        var claimed = mo.status === 'claimed';
        var isRed = mo.kind !== 'transfer';
        var foot;
        if (claimed) {
            foot = mo.claimedBy === 'partner' ? 'Ta 已领取' : '已存入钱包';
        } else if (m.sender === 'user') {
            foot = '等 Ta 来领';
        } else {
            foot = isRed ? '点击打开' : '点击收款';
        }
        var cover = isRed ? '恭喜发财，大吉大利' : (mo.note || '转账');
        return '' +
            '<div class="mb-card-in ' + (isRed ? 'mb-red' : 'mb-blue') + (claimed ? ' is-claimed' : '') + '">' +
            '  <div class="mb-line">' +
            '    <span class="mb-ico"><i class="fas ' + (isRed ? 'fa-gift' : 'fa-exchange-alt') + '"></i></span>' +
            '    <span class="mb-kind">' + (isRed ? '红包' : '转账') + '</span>' +
            '  </div>' +
            '  <div class="mb-amt"><small>¥</small>' + Number(mo.amount || 0).toFixed(2) + '</div>' +
            '  <div class="mb-note">' + (mo.note ? String(mo.note) : cover) + '</div>' +
            '  <div class="mb-foot"><i class="fas ' + (claimed ? 'fa-check-circle' : 'fa-hand-pointer') + '"></i>' + foot + '</div>' +
            '</div>';
    }

    /* ═══════════════ 三、把卡片挂到消息上 ═══════════════ */

    function findMsg(id) {
        var list = (typeof messages !== 'undefined' && messages) ? messages : [];
        for (var i = list.length - 1; i >= 0; i--) {
            if (String(list[i].id) === String(id)) return list[i];
        }
        return null;
    }

    function mountOne(wrapper, m) {
        var bubble = wrapper.querySelector('.message');
        if (!bubble) return;
        if (bubble.dataset.mbAmount === String(m.money.amount) && bubble.dataset.mbStatus === m.money.status) return;
        bubble.className = 'message mb-bubble';
        bubble.innerHTML = cardHTML(m);
        bubble.dataset.mbAmount = String(m.money.amount);
        bubble.dataset.mbStatus = m.money.status;
        bubble.onclick = function () { onCardClick(m.id); };
    }

    function mountAll() {
        var box = chatBox();
        if (!box) return;
        var list = (typeof messages !== 'undefined' && messages) ? messages : [];
        list.forEach(function (m) {
            if (!m || !m.money) return;
            var wrapper = box.querySelector('[data-msg-id="' + m.id + '"]');
            if (!wrapper) return;
            mountOne(wrapper, m);
        });
    }

    function mountById(id) {
        var box = chatBox();
        var m = findMsg(id);
        if (!box || !m) return;
        var wrapper = box.querySelector('[data-msg-id="' + m.id + '"]');
        if (wrapper) mountOne(wrapper, m);
    }

    /** 原站重渲染后自动补挂（节流，避免一次重建触发几十次） */
    function watchRender() {
        if (observer || !window.MutationObserver) return;
        var box = chatBox();
        if (!box) return;
        var timer = null;
        observer = new MutationObserver(function () {
            if (timer) return;
            timer = setTimeout(function () { timer = null; mountAll(); }, 60);
        });
        observer.observe(box, { childList: true, subtree: true });
    }

    /* ═══════════════ 四、点击卡片：领取 / 提示 ═══════════════ */

    function onCardClick(id) {
        var m = findMsg(id);
        if (!m || !m.money) return;
        var mo = m.money;
        if (mo.status === 'claimed') {
            toast(mo.claimedBy === 'partner' ? '这个红包已经被 Ta 领走啦' : '这笔钱已经收进钱包了');
            return;
        }
        if (m.sender === 'user') {
            toast('等 Ta 来领，别急');
            return;
        }
        // 她发来的 → 我收下
        state.balance = Number(state.balance) + Number(mo.amount);
        mo.status = 'claimed';
        mo.claimedBy = 'user';
        mo.claimedAt = Date.now();
        saveState();
        mountById(id);
        if (typeof throttledSaveData === 'function') throttledSaveData();
        showClaim(mo);
        refreshBalance();
    }

    /** 领取后的结果小窗 */
    function showClaim(mo) {
        var mask = document.createElement('div');
        mask.className = 'mb-claim-mask';
        mask.innerHTML =
            '<div class="mb-claim-card">' +
            '  <div class="mb-claim-ico"><i class="fas ' + (mo.kind === 'transfer' ? 'fa-check' : 'fa-gift') + '"></i></div>' +
            '  <div class="mb-claim-amt">' + money(mo.amount) + '</div>' +
            '  <div class="mb-claim-tip">' + (mo.kind === 'transfer' ? '已收进钱包' : '红包已拆开，收进钱包') + '</div>' +
            '  <button class="mb-claim-ok">好</button>' +
            '</div>';
        mask.addEventListener('click', function (e) {
            if (e.target === mask || (e.target.closest && e.target.closest('.mb-claim-ok'))) mask.remove();
        });
        document.body.appendChild(mask);
    }

    /* ═══════════════ 五、发出去（我 → Ta） ═══════════════ */

    function sendMoney(amount, note, k) {
        if (!(amount > 0)) { toast('金额得大于 0'); return false; }
        if (amount > Number(state.balance)) { toast('钱包不够了，只剩 ' + money(state.balance)); return false; }

        state.balance = Number(state.balance) - amount;
        saveState();

        var msg = {
            id: Date.now() + Math.random(),
            sender: 'user',
            text: '',
            timestamp: new Date(),
            status: 'sent',
            favorited: false,
            note: null,
            replyTo: null,
            type: 'normal',
            money: {
                kind: k || 'redpacket',
                amount: Number(amount),
                note: note || '',
                status: 'pending',
                claimedBy: null
            }
        };
        addMessage(msg);
        if (typeof playSound === 'function') playSound('send');
        mountById(msg.id);
        refreshBalance();
        schedulePartnerClaim(msg.id);
        return true;
    }

    /** 你发出去之后，她过几秒自己收下，并说一句话 */
    function schedulePartnerClaim(id) {
        var m0 = findMsg(id);
        if (!m0) return;
        var delay = rnd(CLAIM_DELAY[0], CLAIM_DELAY[1]);
        setTimeout(function () {
            var m = findMsg(id);
            if (!m || !m.money || m.money.status !== 'pending') return;
            m.money.status = 'claimed';
            m.money.claimedBy = 'partner';
            m.money.claimedAt = Date.now();
            if (typeof throttledSaveData === 'function') throttledSaveData();
            mountById(id);
            // 她收下之后的一句话
            var text = pick(m.money.kind === 'transfer' ? REPLY_AFTER_TRANSFER : REPLY_AFTER_RED);
            addMessage({
                id: Date.now() + Math.random(),
                sender: partnerName(),
                text: text,
                timestamp: new Date(),
                status: 'received',
                favorited: false,
                note: null,
                replyTo: null,
                type: 'normal'
            });
        }, delay);
    }

    /* ═══════════════ 六、她主动发来（Ta → 我） ═══════════════ */

    function partnerSend() {
        if (!state) return;
        var amount = pick(PARTNER_AMOUNTS);
        if (amount > state.partner) amount = Math.min(amount, state.partner);
        if (!(amount > 0)) return;
        state.partner = Number(state.partner) - amount;
        saveState();

        var k = Math.random() < 0.7 ? 'redpacket' : 'transfer';
        var msg = {
            id: Date.now() + Math.random(),
            sender: partnerName(),
            text: '',
            timestamp: new Date(),
            status: 'received',
            favorited: false,
            note: null,
            replyTo: null,
            type: 'normal',
            money: {
                kind: k,
                amount: amount,
                note: pick(PARTNER_NOTES),
                status: 'pending',
                claimedBy: null
            }
        };
        addMessage(msg);
        if (typeof playSound === 'function') playSound('message');
        mountById(msg.id);
        try {
            if (typeof window._sendPartnerNotification === 'function') {
                window._sendPartnerNotification(partnerName(), '[红包]');
            }
        } catch (e) {}
    }

    /** 按时间表决定要不要来一笔（定时器每 30 分钟跑一次） */
    function checkAuto() {
        if (!state) return;
        var now = Date.now();
        if (!state.nextAt) {
            state.nextAt = now + rnd(AUTO_FIRST_HOURS[0], AUTO_FIRST_HOURS[1]) * 3600000;
            saveState();
            return;
        }
        if (now < state.nextAt) return;
        state.nextAt = now + rnd(AUTO_LOOP_HOURS[0], AUTO_LOOP_HOURS[1]) * 3600000;
        state.lastAt = now;
        saveState();
        partnerSend();
    }

    /* ═══════════════ 七、面板（发红包 / 发转账） ═══════════════ */

    function injectStyle() {
        if (document.getElementById('money-style')) return;
        var st = document.createElement('style');
        st.id = 'money-style';
        st.innerHTML = [
            /* 卡片（嵌在消息流里） */
            '.mb-bubble{background:none!important;border:none!important;box-shadow:none!important;padding:0!important;',
            'max-width:78%;cursor:pointer;-webkit-tap-highlight-color:transparent;}',
            '.mb-card-in{width:200px;border-radius:14px;padding:10px 13px;color:#fff;box-sizing:border-box;',
            'box-shadow:0 4px 14px rgba(0,0,0,.14);transition:transform .15s;}',
            '.mb-card-in:active{transform:scale(.97);}',
            '.mb-red{background:linear-gradient(160deg,#f0653c,#e0442d);}',
            '.mb-blue{background:linear-gradient(160deg,#4a86e8,#3a6fd0);}',
            '.mb-card-in.is-claimed{opacity:.55;filter:saturate(.7);}',
            '.mb-line{display:flex;align-items:center;gap:6px;font-size:12px;opacity:.95;}',
            '.mb-ico{width:22px;height:22px;border-radius:50%;background:rgba(255,255,255,.22);display:flex;',
            'align-items:center;justify-content:center;font-size:11px;}',
            '.mb-amt{display:flex;align-items:baseline;gap:3px;font-size:24px;font-weight:800;letter-spacing:.5px;margin:7px 0 3px;line-height:1.15;}',
            '.mb-amt small{flex:none;font-size:13px;font-weight:600;opacity:.9;letter-spacing:0;}',
            '.mb-note{font-size:11px;opacity:.9;line-height:1.35;word-break:break-word;}',
            '.mb-foot{font-size:10.5px;opacity:.85;margin-top:8px;padding-top:6px;border-top:1px solid rgba(255,255,255,.25);',
            'display:flex;align-items:center;gap:4px;}',
            /* 领取结果小窗 */
            '.mb-claim-mask{position:fixed;inset:0;z-index:4000;background:rgba(0,0,0,.62);display:flex;',
            'align-items:center;justify-content:center;padding:24px;}',
            '.mb-claim-card{width:100%;max-width:260px;background:#fff;border-radius:18px;padding:22px 18px 16px;',
            'text-align:center;box-shadow:0 16px 44px rgba(0,0,0,.28);}',
            '.mb-claim-ico{width:44px;height:44px;margin:0 auto 10px;border-radius:50%;background:#f0653c;color:#fff;',
            'display:flex;align-items:center;justify-content:center;font-size:18px;}',
            '.mb-claim-amt{font-size:26px;font-weight:800;color:#e0442d;}',
            '.mb-claim-tip{font-size:12px;color:#888;margin-top:4px;}',
            '.mb-claim-ok{width:100%;margin-top:16px;padding:11px 0;border:none;border-radius:12px;',
            'background:#e0442d;color:#fff;font-size:14px;font-weight:600;cursor:pointer;}',
            /* 发送面板 */
            '#money-modal{z-index:2300;position:fixed;inset:0;display:none;align-items:center;justify-content:center;',
            'background:rgba(0,0,0,.55);padding:14px;box-sizing:border-box;}',
            '#money-modal .mb-panel{width:94%;max-width:380px;background:var(--secondary-bg,#fff);border-radius:20px;',
            'padding:0;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.24);}',
            '.mb-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px 10px;}',
            '.mb-title{font-size:14px;font-weight:700;color:var(--text-primary,#222);display:flex;align-items:center;gap:7px;}',
            '.mb-close{border:none;background:none;cursor:pointer;color:var(--text-secondary,#999);font-size:16px;padding:4px 6px;}',
            '.mb-wallet{margin:0 16px 10px;padding:9px 12px;border-radius:12px;background:var(--primary-bg,#f6f4f1);',
            'font-size:12px;color:var(--text-secondary,#777);display:flex;justify-content:space-between;}',
            '.mb-wallet b{color:#e0442d;font-size:14px;}',
            '.mb-tabs{display:flex;gap:8px;padding:0 16px 10px;}',
            '.mb-tab{flex:1;padding:9px 0;border-radius:11px;border:1px solid var(--border-color,#e8e8e8);',
            'background:var(--primary-bg,#fafafa);color:var(--text-secondary,#777);font-size:12.5px;font-weight:600;cursor:pointer;}',
            '.mb-tab.on{border-color:#e0442d;background:#e0442d;color:#fff;}',
            '.mb-amount-box{margin:0 16px;padding:12px 14px;border-radius:14px;border:1px solid var(--border-color,#eee);',
            'display:flex;align-items:center;gap:6px;}',
            '.mb-amount-box span{font-size:20px;font-weight:800;color:#e0442d;}',
            '.mb-amount-box input{flex:1;min-width:0;border:none;outline:none;background:none;font-size:26px;',
            'font-weight:800;color:var(--text-primary,#222);}',
            '.mb-quick{display:flex;gap:6px;padding:9px 16px 4px;flex-wrap:wrap;}',
            '.mb-chip{padding:6px 10px;border-radius:9px;border:1px solid var(--border-color,#e8e8e8);',
            'background:var(--primary-bg,#fafafa);color:var(--text-secondary,#777);font-size:11.5px;cursor:pointer;}',
            '.mb-note-input{margin:6px 16px 0;width:calc(100% - 32px);box-sizing:border-box;padding:10px 12px;'
                + 'border-radius:12px;border:1px solid var(--border-color,#e8e8e8);background:var(--primary-bg,#fafafa);',
            'color:var(--text-primary,#222);font-size:12px;outline:none;}',
            '.mb-actions{display:flex;gap:8px;padding:12px 16px 16px;}',
            '.mb-actions button{flex:1;padding:11px 0;border-radius:12px;border:none;font-size:13px;font-weight:600;cursor:pointer;}',
            '.mb-cancel{background:var(--primary-bg,#f2f2f2);color:var(--text-secondary,#777);border:1px solid var(--border-color,#e5e5e5)!important;}',
            '.mb-do{background:#e0442d;color:#fff;}',
            /* 输入区按钮 */
            '#money-btn{position:relative;}'
        ].join('');
        document.head.appendChild(st);
    }

    function buildPanel() {
        if (modalEl) return modalEl;
        injectStyle();
        modalEl = document.createElement('div');
        modalEl.className = 'modal';
        modalEl.id = 'money-modal';
        modalEl.innerHTML = [
            '<div class="mb-panel">',
            '  <div class="mb-head">',
            '    <div class="mb-title"><i class="fas fa-coins"></i>红包 / 转账</div>',
            '    <button class="mb-close" id="mb-close" title="关闭"><i class="fas fa-times"></i></button>',
            '  </div>',
            '  <div class="mb-wallet"><span>我的钱包</span><b id="mb-balance">¥0.00</b></div>',
            '  <div class="mb-tabs">',
            '    <button class="mb-tab on" id="mb-tab-red">红包</button>',
            '    <button class="mb-tab" id="mb-tab-transfer">转账</button>',
            '  </div>',
            '  <div class="mb-amount-box"><span>¥</span><input id="mb-amount" type="number" inputmode="decimal" step="0.01" placeholder="0.00"></div>',
            '  <div class="mb-quick" id="mb-quick"></div>',
            '  <input class="mb-note-input" id="mb-note" maxlength="18" placeholder="留句话（可不填）">',
            '  <div class="mb-actions">',
            '    <button class="mb-cancel" id="mb-cancel">取消</button>',
            '    <button class="mb-do" id="mb-do">塞进红包</button>',
            '  </div>',
            '</div>'
        ].join('');
        document.body.appendChild(modalEl);

        // 快捷金额
        var quickBox = document.getElementById('mb-quick');
        QUICK.forEach(function (v) {
            var b = document.createElement('button');
            b.className = 'mb-chip';
            b.textContent = v.toFixed(2).replace(/\.00$/, '');
            b.addEventListener('click', function () {
                document.getElementById('mb-amount').value = String(v);
            });
            quickBox.appendChild(b);
        });

        // 类型切换
        var tabRed = document.getElementById('mb-tab-red');
        var tabTr = document.getElementById('mb-tab-transfer');
        var doBtn = document.getElementById('mb-do');
        function setKind(k) {
            kind = k;
            tabRed.classList.toggle('on', k === 'redpacket');
            tabTr.classList.toggle('on', k === 'transfer');
            doBtn.textContent = k === 'redpacket' ? '塞进红包' : '转账';
        }
        tabRed.addEventListener('click', function () { setKind('redpacket'); });
        tabTr.addEventListener('click', function () { setKind('transfer'); });

        document.getElementById('mb-close').addEventListener('click', closePanel);
        document.getElementById('mb-cancel').addEventListener('click', closePanel);
        modalEl.addEventListener('click', function (e) { if (e.target === modalEl) closePanel(); });
        doBtn.addEventListener('click', function () {
            var amt = parseFloat(document.getElementById('mb-amount').value);
            var note = (document.getElementById('mb-note').value || '').trim();
            if (sendMoney(amt, note, kind)) {
                document.getElementById('mb-amount').value = '';
                document.getElementById('mb-note').value = '';
                closePanel();
            }
        });
        return modalEl;
    }

    function refreshBalance() {
        var el = document.getElementById('mb-balance');
        if (el && state) el.textContent = money(state.balance);
    }

    function openPanel() {
        buildPanel();
        refreshBalance();
        modalEl.style.display = 'flex';
        modalEl.style.animation = 'none';       // 不依赖原站弹窗动画，避免被节流卡在 opacity:0
        modalEl.style.opacity = '1';
        var p = modalEl.querySelector('.mb-panel');
        if (p) { p.style.opacity = '1'; p.style.transform = 'none'; }
        if (typeof window.showModal === 'function') window.showModal(modalEl);
        setTimeout(function () {
            var a = document.getElementById('mb-amount');
            if (a && window.innerWidth > 640) a.focus();
        }, 120);
    }

    function closePanel() {
        if (!modalEl) return;
        if (typeof window.hideModal === 'function') window.hideModal(modalEl);
        else modalEl.style.display = 'none';
    }

    /* ═══════════════ 八、入口按钮 ═══════════════ */

    function insertButton() {
        var anchor = document.getElementById('doodle-btn') || document.getElementById('attachment-btn');
        if (!anchor || document.getElementById('money-btn')) return;
        var btn = document.createElement('button');
        btn.id = 'money-btn';
        btn.className = 'attachment-btn input-btn collapse-hideable';
        btn.title = '红包 / 转账';
        btn.innerHTML = '<i class="fas fa-coins"></i>';
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            openPanel();
        });
        anchor.parentNode.insertBefore(btn, anchor.nextSibling);
    }

    /* ═══════════════ 九、小提示 ═══════════════ */

    function toast(txt) {
        if (typeof window.showNotification === 'function') { window.showNotification(txt, 'info'); return; }
        var d = document.createElement('div');
        d.style.cssText = 'position:fixed;left:50%;bottom:120px;transform:translateX(-50%);z-index:5000;' +
            'background:rgba(0,0,0,.78);color:#fff;font-size:12px;padding:8px 14px;border-radius:10px;';
        d.textContent = txt;
        document.body.appendChild(d);
        setTimeout(function () { d.remove(); }, 1600);
    }

    /* ═══════════════ 十、启动 ═══════════════ */

    function boot() {
        loadState().then(function () {
            insertButton();
            watchRender();
            mountAll();
            refreshBalance();
            setTimeout(checkAuto, 15000);                 // 启动 15 秒后先检查一次
            setInterval(checkAuto, 30 * 60 * 1000);       // 之后每半小时一次
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 800); });
    } else {
        setTimeout(boot, 800);
    }

    // 按钮可能因为输入区重建而消失，补几次
    setTimeout(insertButton, 200);
    setTimeout(insertButton, 1200);
    setTimeout(insertButton, 3000);

    window.MoneyBox = {
        open: openPanel,
        close: closePanel,
        send: sendMoney,
        partnerSend: partnerSend,       // 手动让她发一笔（测试用）
        balance: function () { return state ? state.balance : null; },
        mount: mountAll
    };
})();
