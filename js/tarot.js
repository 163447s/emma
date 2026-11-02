/* ============================================================
 * MJ 塔罗模块
 * 功能：
 *   1. MJ 回复时按概率随机发塔罗牌（而非普通字卡）
 *   2. 塔罗牌消息以卡牌样式渲染，标注牌名与正逆位
 *   3. 点击卡牌弹出解读面板：
 *      - 牌面图片（images/tarot/00.png ~ 77.png，RWS 78 张）
 *      - AI 解读（DeepSeek，经 Cloudflare Worker 代理，密钥在服务端）
 *      - 未配置 Worker 时回退本地预设解读，保证可用
 *   4. 设置入口：设置 → 高级功能 → MJ 塔罗（开关 / 触发概率 / Worker 地址）
 * 依赖：无；建议在 core.js 之前加载（core.js 在运行时调用 window.Tarot）
 * ============================================================ */
(function () {
    'use strict';

    // ── 常量 ──────────────────────────────────────────────
    const SETTINGS_KEY = 'tarotSettings';
    const IMG_DIR = 'images/tarot/';
    const READING_CACHE_KEY = 'tarotReadingCache';

    // ── 78 张牌： [中文名, 英文名, 正位一句话, 逆位一句话] ──
    // 0-21 大阿卡纳，22-35 权杖，36-49 圣杯，50-63 宝剑，64-77 星币
    const RAW_CARDS = [
        ['愚者','The Fool','新的开始，大胆迈出第一步，别怕未知。','犹豫不决，冲动冒险，先停下来想清楚。'],
        ['魔术师','The Magician','能力与资源齐备，主动出击就能成事。','空有想法不落实，小心纸上谈兵。'],
        ['女祭司','The High Priestess','听从直觉，静观其变，答案在心里。','忽视内心声音，信息被隐藏。'],
        ['皇后','The Empress','丰盛与滋养，感情细腻，被爱包围。','付出失衡，忽略自己的感受。'],
        ['皇帝','The Emperor','稳定与掌控，规则清晰，靠谱担当。','固执强势，控制欲过强。'],
        ['教皇','The Hierophant','遵循传统，寻求指引，稳定发展。','打破教条，走自己的路。'],
        ['恋人','The Lovers','心意相通，重要的选择，因爱而联结。','关系失衡，价值观冲突，摇摆不定。'],
        ['战车','The Chariot','目标明确，勇往直前，掌控局面。','方向失控，横冲直撞。'],
        ['力量','Strength','温柔而坚定，用耐心化解冲突。','内心软弱，情绪失控。'],
        ['隐士','The Hermit','独处思考，寻找内在答案。','过度封闭，拒绝帮助。'],
        ['命运之轮','Wheel of Fortune','时来运转，机会到来，顺势而为。','意外转折，循环反复，保持弹性。'],
        ['正义','Justice','公平公正，因果分明，做正确的决定。','偏颇失衡，逃避责任。'],
        ['倒吊人','The Hanged Man','换位思考，暂停一下，新的视角。','无谓牺牲，拖延卡住。'],
        ['死神','Death','结束与蜕变，放下旧的，迎来新生。','抗拒改变，原地挣扎。'],
        ['节制','Temperance','平衡调和，慢慢来，节奏刚好。','失衡急躁，过度或不足。'],
        ['恶魔','The Devil','看清执念与诱惑，挣脱束缚。','沉溺成瘾，自我设限。'],
        ['高塔','The Tower','突如其来的变动，打破虚假的安稳。','危机余震，重建需要时间。'],
        ['星星','The Star','希望与疗愈，相信未来会好起来。','信心受挫，别放弃那点光。'],
        ['月亮','The Moon','情绪朦胧，直觉很准，真相未明。','迷雾散去，焦虑解除。'],
        ['太阳','The Sun','明朗快乐，成功与活力，一切都好。','延迟的快乐，别被小事遮住光。'],
        ['审判','Judgement','觉醒与重生，做出关键决定。','自我怀疑，旧事重提。'],
        ['世界','The World','圆满达成，完成一个阶段，开启新篇。','差一步完成，别急着收尾。'],
        ['权杖王牌','Ace of Wands','灵感与热情点燃，新的行动开始。','热情消退，方向未明。'],
        ['权杖二','Two of Wands','放眼未来，做出选择，准备出发。','畏缩不前，计划迟迟不落地。'],
        ['权杖三','Three of Wands','进展顺利，机会正在靠近，展望远方。','延误受阻，目光放得太近。'],
        ['权杖四','Four of Wands','庆祝与安稳，小确幸，关系稳定。','缺少归属感，热闹下的不安。'],
        ['权杖五','Five of Wands','竞争与摩擦，各执一词。','冲突平息，找到共识。'],
        ['权杖六','Six of Wands','赢得认可，被看见，胜利的姿态。','掌声未至，自信受挫。'],
        ['权杖七','Seven of Wands','守住立场，坚持己见，顶住压力。','防线松动，疲于应对。'],
        ['权杖八','Eight of Wands','进展飞快，消息传来，箭在弦上。','节奏被打乱，沟通延迟。'],
        ['权杖九','Nine of Wands','坚持到最后，经验是底气。','疲惫戒备，消耗太多。'],
        ['权杖十','Ten of Wands','担子很重，责任压身，快超载了。','学会放下，分摊压力。'],
        ['权杖侍从','Page of Wands','新鲜热情，跃跃欲试的新消息。','三分钟热度，空有冲动。'],
        ['权杖骑士','Knight of Wands','行动派，热情直冲，说走就走。','冲动鲁莽，虎头蛇尾。'],
        ['权杖王后','Queen of Wands','自信有魅力，热情又坚定。','患得患失，热情耗损。'],
        ['权杖国王','King of Wands','有远见有魄力，领导力在线。','专断自负，掌控欲强。'],
        ['圣杯王牌','Ace of Cups','新的情感流动，心动，温柔开启。','情感压抑，心门半闭。'],
        ['圣杯二','Two of Cups','相互吸引，默契与联结。','关系失衡，沟通不畅。'],
        ['圣杯三','Three of Cups','朋友相聚，快乐分享，被善意包围。','被冷落，聚会变味。'],
        ['圣杯四','Four of Cups','意兴阑珊，想要更多却忽略了眼前。','重新看见，走出麻木。'],
        ['圣杯五','Five of Cups','为失去难过，但身后还有余地。','释怀放下，重新出发。'],
        ['圣杯六','Six of Cups','回忆与纯真，旧人旧事带来温暖。','困在回忆里，走不出来。'],
        ['圣杯七','Seven of Cups','选择太多，别被幻想迷了眼。','理清头绪，抓住重点。'],
        ['圣杯八','Eight of Cups','离开熟悉，追寻更深的意义。','放不下，走了又回。'],
        ['圣杯九','Nine of Cups','心愿达成，满足感满满。','表面满足，内心空虚。'],
        ['圣杯十','Ten of Cups','幸福安稳，家和心暖，圆满。','理想与现实有落差。'],
        ['圣杯侍从','Page of Cups','温柔的消息，细腻的心意。','情感幼稚，表达不清。'],
        ['圣杯骑士','Knight of Cups','浪漫邀约，温柔靠近。','情绪化，承诺含糊。'],
        ['圣杯王后','Queen of Cups','温柔包容，共情力强。','情绪泛滥，边界模糊。'],
        ['圣杯国王','King of Cups','情绪稳定，温柔有力量。','情感压抑，表面平静。'],
        ['宝剑王牌','Ace of Swords','清晰果断，真相浮现，一击即中。','思路混乱，判断失准。'],
        ['宝剑二','Two of Swords','两难抉择，蒙住眼睛逃避。','终于睁眼，做出决定。'],
        ['宝剑三','Three of Swords','心碎与清醒，痛但真实。','伤口愈合，慢慢释怀。'],
        ['宝剑四','Four of Swords','暂停休整，给自己充电。','休息不够，强撑着。'],
        ['宝剑五','Five of Swords','赢了场面，输了关系。','反思和解，停止内耗。'],
        ['宝剑六','Six of Swords','离开纷扰，走向平静。','走不出旧事，行李太重。'],
        ['宝剑七','Seven of Swords','留个心眼，别太轻信。','坦白面对，放下戒备。'],
        ['宝剑八','Eight of Swords','自我设限，其实门没锁。','挣脱束缚，想通就自由。'],
        ['宝剑九','Nine of Swords','焦虑失眠，担忧被放大。','放下担忧，天会亮。'],
        ['宝剑十','Ten of Swords','跌到谷底，但也是转折点。','缓慢恢复，别急着振作。'],
        ['宝剑侍从','Page of Swords','好奇观察，消息灵通。','八卦误人，话多伤人。'],
        ['宝剑骑士','Knight of Swords','快准狠，直冲目标。','鲁莽急躁，口不择言。'],
        ['宝剑王后','Queen of Swords','清醒独立，理性通透。','冷硬刻薄，拒人千里。'],
        ['宝剑国王','King of Swords','公正理性，明辨是非。','冷酷独断，用道理伤人。'],
        ['星币王牌','Ace of Pentacles','新的机会落地，稳扎稳打。','机会溜走，行动迟缓。'],
        ['星币二','Two of Pentacles','平衡多线任务，灵活应对。','顾此失彼，手忙脚乱。'],
        ['星币三','Three of Pentacles','合作出成果，专业被认可。','配合不顺，标准不一。'],
        ['星币四','Four of Pentacles','守住拥有，安全感优先。','攥得太紧，反而失去。'],
        ['星币五','Five of Pentacles','暂时困顿，别独自硬扛。','困境松动，援助将至。'],
        ['星币六','Six of Pentacles','给予与接受，善意流动。','施舍失衡，计较得失。'],
        ['星币七','Seven of Pentacles','等待收获，付出需要时间。','付出无果，调整方向。'],
        ['星币八','Eight of Pentacles','专注打磨，熟能生巧。','敷衍了事，急于求成。'],
        ['星币九','Nine of Pentacles','独立自在，享受自己的成果。','依赖他人，底气不足。'],
        ['星币十','Ten of Pentacles','家业稳固，长久富足。','家族负担，价值观冲突。'],
        ['星币侍从','Page of Pentacles','认真学习，脚踏实地。','拖延分心，计划搁浅。'],
        ['星币骑士','Knight of Pentacles','稳扎稳打，说到做到。','停滞不前，过于保守。'],
        ['星币王后','Queen of Pentacles','务实温柔，把生活照顾好。','本末倒置，忽略自我。'],
        ['星币国王','King of Pentacles','丰盛可靠，懂得创造与积累。','守财过度，吝于付出。']
    ];

    const CARDS = RAW_CARDS.map(function (c, i) {
        return { i: i, name: c[0], en: c[1], u: c[2], r: c[3] };
    });

    // ── 工具 ──────────────────────────────────────────────
    function lsGet(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            if (raw === null || raw === undefined) return fallback;
            return JSON.parse(raw);
        } catch (e) { return fallback; }
    }
    function lsSet(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
    }
    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // ── 设置 ──────────────────────────────────────────────
    function getSettings() {
        const o = lsGet(SETTINGS_KEY, null) || {};
        return {
            enabled: o.enabled !== false,                 // 默认开启
            probability: Math.max(0, Math.min(1, Number(o.probability) || 0.1)), // 默认 10%
            workerUrl: String(o.workerUrl || '').trim()
        };
    }
    function saveSettings(s) {
        lsSet(SETTINGS_KEY, {
            enabled: !!s.enabled,
            probability: Math.max(0, Math.min(1, Number(s.probability) || 0.1)),
            workerUrl: String(s.workerUrl || '').trim()
        });
    }
    function isEnabled() { return getSettings().enabled; }
    function getProbability() { return getSettings().probability; }

    // ── 抽牌 ──────────────────────────────────────────────
    function drawCard() {
        const card = CARDS[Math.floor(Math.random() * CARDS.length)];
        return {
            i: card.i,
            name: card.name,
            en: card.en,
            upright: Math.random() < 0.5,
            u: card.u,
            r: card.r
        };
    }
    function cardImageSrc(card) {
        if (!card || card.i === undefined || card.i === null) return '';
        const idx = String(Number(card.i)).padStart(2, '0');
        return IMG_DIR + idx + '.png';
    }

    // ── 卡牌渲染（core.js createMessageFragment 调用）──────
    function renderCardInner(card) {
        if (!card) return '';
        const pos = card.upright ? '正位' : '逆位';
        const name = escapeHtml(card.name || '');
        const img = cardImageSrc(card);
        const art = img
            ? '<img src="' + img + '" alt="' + name + '" loading="lazy" onerror="window._tarotImgFallback&&window._tarotImgFallback(this)">'
            : '<div class="tarot-card-fallback"><i class="fas fa-moon"></i></div>';
        return '<div class="tarot-card-inner">'
            + '<div class="tarot-card-art">' + art + '</div>'
            + '<div class="tarot-card-info">'
            + '<span class="tarot-card-name">' + name + '</span>'
            + '<span class="tarot-card-pos ' + (card.upright ? 'pos-up' : 'pos-rev') + '">' + pos + '</span>'
            + '</div>'
            + '<div class="tarot-card-hint"><i class="fas fa-crystal-ball"></i> 点击解读</div>'
            + '</div>';
    }

    window._tarotImgFallback = function (img) {
        if (!img || !img.parentNode) return;
        const name = img.getAttribute('alt') || '';
        const div = document.createElement('div');
        div.className = 'tarot-card-fallback';
        div.innerHTML = '<i class="fas fa-moon"></i>';
        img.parentNode.replaceChild(div, img);
        // 记录缺图，避免反复请求
        try {
            const miss = lsGet('tarotMissingImages', {});
            miss[img.getAttribute('src')] = 1;
            lsSet('tarotMissingImages', miss);
        } catch (e) {}
    };

    // ── AI 解读（DeepSeek，经 Worker 代理）────────────────
    async function fetchReading(card, question) {
        const s = getSettings();
        if (!s.workerUrl || !/^https?:\/\//.test(s.workerUrl)) return null;
        try {
            const res = await fetch(s.workerUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    cardName: card.name,
                    upright: !!card.upright,
                    question: String(question || '').slice(0, 300)
                })
            });
            if (!res.ok) return null;
            const data = await res.json();
            if (data && data.ok && data.text && String(data.text).trim()) {
                return String(data.text).trim();
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    // ── 解读弹窗 ──────────────────────────────────────────
    let _readingModal = null;
    function buildReadingModal() {
        if (_readingModal) return _readingModal;
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'tarot-reading-modal';
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:460px;width:92%;">
                <div class="modal-title" id="tarot-reading-title">
                    <i class="fas fa-crystal-ball"></i><span>塔罗解读</span>
                </div>
                <div id="tarot-reading-body" style="display:flex;gap:16px;align-items:flex-start;">
                    <div id="tarot-reading-art" style="flex-shrink:0;width:130px;"></div>
                    <div style="flex:1;min-width:0;">
                        <div id="tarot-reading-name" style="font-size:17px;font-weight:700;color:var(--text-primary);"></div>
                        <div id="tarot-reading-pos" style="display:inline-block;font-size:11px;font-weight:600;padding:2px 10px;border-radius:12px;margin:6px 0 10px;"></div>
                        <div id="tarot-reading-question" style="font-size:11.5px;color:var(--text-secondary);line-height:1.7;margin-bottom:8px;display:none;"></div>
                        <div id="tarot-reading-meaning" style="font-size:12.5px;color:var(--text-secondary);line-height:1.8;white-space:pre-wrap;word-break:break-word;margin-bottom:12px;display:none;"></div>
                        <div id="tarot-reading-mj" style="display:none;">
                            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                                <div id="tarot-reading-avatar" style="width:34px;height:34px;border-radius:50%;overflow:hidden;flex-shrink:0;background:var(--secondary-bg);border:2px solid rgba(var(--accent-color-rgb),0.35);display:flex;align-items:center;justify-content:center;"></div>
                                <div style="font-size:13px;font-weight:700;color:var(--accent-color);">MJ 想对你说</div>
                            </div>
                            <div id="tarot-reading-mj-text" style="font-size:13.5px;color:var(--text-primary);line-height:1.9;white-space:pre-wrap;word-break:break-word;max-height:30vh;overflow-y:auto;"></div>
                        </div>
                    </div>
                </div>
                <div class="modal-buttons">
                    <button class="modal-btn modal-btn-secondary" id="tarot-reading-close">关闭</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        modal.querySelector('#tarot-reading-close').onclick = function () {
            if (typeof hideModal === 'function') hideModal(modal); else modal.style.display = 'none';
        };
        _readingModal = modal;
        return modal;
    }

    // 复用站点头像（梦角/MJ 当前头像），没有则用默认图标
    function setMjAvatar(el) {
        if (!el) return;
        const img = document.querySelector('#partner-avatar img');
        if (img && img.src && !img.src.endsWith('#') && img.src !== window.location.href) {
            const src = String(img.src).replace(/"/g, '&quot;');
            el.innerHTML = '<img src="' + src + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
        } else {
            el.innerHTML = '<i class="fas fa-user" style="font-size:15px;color:var(--text-secondary);"></i>';
        }
    }

    // 把 AI 两段式解读拆成「牌的意思」+「MJ 想对你说」
    function renderAiText(meaningEl, mjTextEl, mjBlock, aiText) {
        const t = String(aiText || '').trim();
        const mjIdx = t.search(/MJ\s*想对你说|想对你说/);
        if (mjIdx < 0) {
            // AI 没按格式输出：整段放进 MJ 区
            meaningEl.style.display = 'none';
            mjBlock.style.display = 'block';
            mjTextEl.textContent = t;
            return;
        }
        const meaning = t.slice(0, mjIdx).replace(/^牌\s*的意思[：:]\s*/, '').trim();
        const mjPart = t.slice(mjIdx).replace(/^MJ\s*想对你说[：:]\s*/, '').trim();
        if (meaning) {
            meaningEl.style.display = 'block';
            meaningEl.textContent = meaning;
        } else {
            meaningEl.style.display = 'none';
        }
        mjBlock.style.display = 'block';
        mjTextEl.textContent = mjPart || t;
    }

    function openReading(card, question) {
        const modal = buildReadingModal();
        const artEl = modal.querySelector('#tarot-reading-art');
        const nameEl = modal.querySelector('#tarot-reading-name');
        const posEl = modal.querySelector('#tarot-reading-pos');
        const qEl = modal.querySelector('#tarot-reading-question');
        const meaningEl = modal.querySelector('#tarot-reading-meaning');
        const mjBlock = modal.querySelector('#tarot-reading-mj');
        const mjTextEl = modal.querySelector('#tarot-reading-mj-text');
        const pos = card.upright ? '正位' : '逆位';

        nameEl.textContent = card.name || '';
        posEl.textContent = pos;
        posEl.style.background = card.upright ? 'rgba(var(--accent-color-rgb),0.14)' : 'rgba(128,128,128,0.18)';
        posEl.style.color = card.upright ? 'var(--accent-color)' : 'var(--text-secondary)';
        artEl.innerHTML = '<div style="width:130px;border-radius:10px;overflow:hidden;box-shadow:0 4px 14px rgba(0,0,0,0.18);background:var(--secondary-bg);">'
            + renderCardInner({ i: card.i, name: card.name, upright: card.upright }) + '</div>';
        if (question) {
            qEl.style.display = 'block';
            qEl.textContent = '问题 / 语境：' + String(question);
        } else {
            qEl.style.display = 'none';
        }
        setMjAvatar(modal.querySelector('#tarot-reading-avatar'));
        meaningEl.style.display = 'none';
        mjBlock.style.display = 'block';
        mjTextEl.textContent = '解读中...';

        if (typeof showModal === 'function') showModal(modal); else modal.style.display = 'flex';

        fetchReading(card, question).then(function (aiText) {
            if (!document.body.contains(modal) || modal.style.display === 'none') return;
            const local = card.upright ? card.u : card.r;
            if (aiText) {
                renderAiText(meaningEl, mjTextEl, mjBlock, aiText);
            } else if (local) {
                meaningEl.style.display = 'none';
                mjBlock.style.display = 'block';
                mjTextEl.textContent = local + '\n\n（本地预设解读；在「设置 → 高级功能 → MJ 塔罗」填入 Worker 地址后，会由 MJ 亲自解读）';
            } else {
                mjTextEl.textContent = '（暂无解读，请稍后再试）';
            }
        });
    }

    function openReadingFromMessage(el) {
        const wrapper = el && el.closest ? el.closest('.message-wrapper') : null;
        if (!wrapper) return;
        const id = wrapper.dataset.id || wrapper.dataset.msgId;
        const msg = messages.find(function (m) { return String(m.id) === String(id); });
        if (!msg || !msg.tarot) return;
        openReading(msg.tarot, msg.tarot.question || '');
    }

    // ── 设置弹窗 ──────────────────────────────────────────
    let _configModal = null;
    function buildConfigModal() {
        if (_configModal) return _configModal;
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'tarot-config-modal';
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:440px;">
                <div class="modal-title">
                    <i class="fas fa-crystal-ball"></i><span>MJ 塔罗</span>
                </div>
                <div style="font-size:12px;color:var(--text-secondary);line-height:1.8;margin-bottom:14px;">
                    MJ 在聊天回复中有概率发一张塔罗牌（替代普通字卡），点牌面弹出解读。
                    AI 解读通过 <b>DeepSeek</b> 生成，密钥放在你自己的 Cloudflare Worker 环境变量里，
                    不会出现在网站前端。<a href="worker-deepseek-proxy.js" style="color:var(--accent-color);" download>下载 Worker 代码</a>，
                    部署后在下方填入其网址即可。
                </div>
                <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:12px;cursor:pointer;">
                    <input type="checkbox" id="tarot-enable" style="accent-color:var(--accent-color);width:15px;height:15px;"> 启用 MJ 随机塔罗牌
                </label>
                <div style="font-size:12px;font-weight:600;color:var(--text-primary);margin-bottom:6px;">
                    触发概率：<span id="tarot-prob-label" style="color:var(--accent-color);">10%</span>
                </div>
                <input type="range" id="tarot-prob" min="1" max="50" value="10" step="1"
                       style="width:100%;accent-color:var(--accent-color);margin-bottom:14px;">
                <div style="font-size:12px;font-weight:600;color:var(--text-primary);margin-bottom:6px;">解读服务地址（Cloudflare Worker URL）</div>
                <input type="text" id="tarot-worker-url" class="modal-input" placeholder="https://xxx.你的用户名.workers.dev" autocomplete="off" style="margin-bottom:6px;">
                <div id="tarot-config-status" style="font-size:11px;color:var(--text-secondary);margin:4px 0 10px;min-height:16px;"></div>
                <div class="modal-buttons">
                    <button class="modal-btn modal-btn-secondary" id="tarot-config-cancel">取消</button>
                    <button class="modal-btn modal-btn-primary" id="tarot-config-save">保存</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        _configModal = modal;

        const prob = modal.querySelector('#tarot-prob');
        const probLabel = modal.querySelector('#tarot-prob-label');
        prob.addEventListener('input', function () { probLabel.textContent = prob.value + '%'; });

        modal.querySelector('#tarot-config-cancel').onclick = function () {
            if (typeof hideModal === 'function') hideModal(modal);
        };
        modal.querySelector('#tarot-config-save').onclick = function () {
            saveSettings({
                enabled: modal.querySelector('#tarot-enable').checked,
                probability: Number(prob.value) / 100,
                workerUrl: modal.querySelector('#tarot-worker-url').value
            });
            const status = modal.querySelector('#tarot-config-status');
            if (status) { status.textContent = '✓ 已保存'; status.style.color = '#4caf50'; }
            setTimeout(function () {
                if (typeof hideModal === 'function') hideModal(modal);
                if (typeof showNotification === 'function') showNotification('MJ 塔罗设置已保存', 'success', 1800);
            }, 400);
        };
        return modal;
    }

    function openConfig() {
        const modal = buildConfigModal();
        const s = getSettings();
        modal.querySelector('#tarot-enable').checked = s.enabled;
        const prob = modal.querySelector('#tarot-prob');
        prob.value = Math.round(s.probability * 100);
        modal.querySelector('#tarot-prob-label').textContent = Math.round(s.probability * 100) + '%';
        modal.querySelector('#tarot-worker-url').value = s.workerUrl;
        const status = modal.querySelector('#tarot-config-status');
        if (status) {
            status.style.color = 'var(--text-secondary)';
            status.textContent = s.enabled
                ? '已启用，触发概率 ' + Math.round(s.probability * 100) + '%'
                : '当前已关闭';
        }
        if (typeof showModal === 'function') showModal(modal); else modal.style.display = 'flex';
    }

    // ── 样式（与现有主题变量一致）─────────────────────────
    function injectStyles() {
        if (document.getElementById('tarot-module-style')) return;
        const style = document.createElement('style');
        style.id = 'tarot-module-style';
        style.textContent = `
            /* 塔罗牌消息气泡 */
            .tarot-card-msg {
                position: relative; width: 128px; border-radius: 14px; overflow: hidden;
                background: linear-gradient(150deg, #2b2350 0%, #1a1730 60%, #241d3e 100%);
                border: 1px solid rgba(255,255,255,0.10); box-shadow: 0 4px 16px rgba(0,0,0,0.28);
                cursor: pointer; transition: transform 0.16s, box-shadow 0.16s; user-select: none;
            }
            .tarot-card-msg:hover { transform: translateY(-3px); box-shadow: 0 8px 22px rgba(0,0,0,0.34); }
            .tarot-card-msg .tarot-card-inner { display: flex; flex-direction: column; }
            .tarot-card-msg .tarot-card-art {
                aspect-ratio: 5 / 8.6; width: 100%; overflow: hidden; background: var(--secondary-bg);
                display: flex; align-items: center; justify-content: center;
            }
            .tarot-card-msg .tarot-card-art img { width: 100%; height: 100%; object-fit: cover; display: block; }
            .tarot-card-fallback {
                width: 100%; height: 100%; min-height: 150px; display: flex; align-items: center; justify-content: center;
                color: rgba(255,255,255,0.35); font-size: 34px; background: linear-gradient(150deg,#2b2350,#1a1730);
            }
            .tarot-card-info { padding: 8px 10px 6px; display: flex; flex-direction: column; gap: 5px; }
            .tarot-card-name { font-size: 13px; font-weight: 700; color: #fff; letter-spacing: 0.5px; line-height: 1.3; }
            .tarot-card-pos {
                align-self: flex-start; font-size: 10px; font-weight: 600; padding: 1.5px 8px; border-radius: 10px; line-height: 1.6;
            }
            .tarot-card-pos.pos-up { background: rgba(255,214,140,0.18); color: #ffd68c; }
            .tarot-card-pos.pos-rev { background: rgba(150,150,170,0.20); color: #a9a9c4; }
            .tarot-card-hint {
                font-size: 10px; color: rgba(255,255,255,0.45); padding: 0 10px 9px; line-height: 1.4;
            }
            .tarot-card-msg .tarot-card-hint i { margin-right: 3px; }
            /* 逆位：卡片底部向下，加个旋转提示 */
            .tarot-card-msg.reversed .tarot-card-art img { transform: rotate(180deg); }
        `;
        document.head.appendChild(style);
    }

    // ── 初始化 ────────────────────────────────────────────
    function bindEvents() {
        const entry = document.getElementById('tarot-config-entry');
        if (entry) entry.addEventListener('click', openConfig);
    }
    function init() {
        injectStyles();
        bindEvents();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // ── 对外导出（core.js 调用）────────────────────────
    window.Tarot = {
        isEnabled: isEnabled,
        getProbability: getProbability,
        drawCard: drawCard,
        cardImageSrc: cardImageSrc,
        renderCardInner: renderCardInner,
        openReading: openReading,
        openReadingFromMessage: openReadingFromMessage,
        openConfig: openConfig,
        getSettings: getSettings
    };
})();
