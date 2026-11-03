/* ============================================================
 * MJ 主动商品推送模块
 * 功能：
 *   1. MJ（梦角）主动说话时，按概率触发商品推送
 *   2. 随机关键词（饰品/零食/可爱小物/时透无一郎周边/手办）
 *      调用 Cloudflare Pages 函数（milk-product-api）获取商品
 *   3. 频率控制：localStorage 记录上次推送时间，默认每 3-7 天一次
 *   4. 商品卡片在聊天中渲染（小红书风格），点击跳转购买链接
 * 设置入口：设置 → 高级功能 → 商品推送（开关 / 触发概率 / 间隔 / 接口地址）
 * 依赖：core.js 的 addMessage / createMessageFragment（type:'product' 分支）
 * ============================================================ */
(function () {
    'use strict';

    // ── 常量 ──────────────────────────────────────────────
    const SETTINGS_KEY = 'productSettings';
    const LAST_PUSH_KEY = 'lastProductPushTs';
    const KEYWORDS = ['饰品', '零食', '可爱小物', '时透无一郎周边', '手办'];
    const DEFAULT_SETTINGS = {
        enabled: false,
        workerUrl: 'https://milk-product-api.pages.dev/get-product',
        intervalDays: 5,
        probability: 0.25
    };

    // ── 设置 ──────────────────────────────────────────────
    function getSettings() {
        const base = Object.assign({}, DEFAULT_SETTINGS);
        try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            if (!raw) return base;
            const saved = JSON.parse(raw);
            return Object.assign(base, saved);
        } catch (e) {
            return base;
        }
    }

    function saveSettings(s) {
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { console.error('[ProductPush] 保存设置失败', e); }
    }

    function isEnabled() { return !!getSettings().enabled; }

    function getProbability() {
        const p = getSettings().probability;
        return (typeof p === 'number' && p > 0 && p <= 1) ? p : DEFAULT_SETTINGS.probability;
    }

    function getIntervalDays() {
        const d = getSettings().intervalDays;
        return (typeof d === 'number' && d > 0) ? d : DEFAULT_SETTINGS.intervalDays;
    }

    // ── 频率控制 ──────────────────────────────────────────
    function lastPushTime() {
        try { return Number(localStorage.getItem(LAST_PUSH_KEY) || 0); } catch (e) { return 0; }
    }

    // 距上次推送是否已达到间隔（天）
    function shouldPush() {
        const diffDays = (Date.now() - lastPushTime()) / 86400000;
        return diffDays >= getIntervalDays();
    }

    function markPushed() {
        try { localStorage.setItem(LAST_PUSH_KEY, String(Date.now())); } catch (e) {}
    }

    // ── 商品获取 ──────────────────────────────────────────
    function fetchProducts(keyword) {
        const s = getSettings();
        const url = String(s.workerUrl || '').trim();
        if (!/^https?:\/\//.test(url)) return Promise.reject(new Error('未配置商品接口地址'));
        return fetch(url + (url.indexOf('?') > -1 ? '&' : '?') + 'q=' + encodeURIComponent(keyword))
            .then(function (r) { return r.json(); });
    }

    // ── 触发推送：随机关键词 → 拉商品 → 发卡片消息 ──────
    function pushProduct() {
        const kw = KEYWORDS[Math.floor(Math.random() * KEYWORDS.length)];
        return fetchProducts(kw).then(function (data) {
            const items = (data && Array.isArray(data.items)) ? data.items : [];
            if (!items.length) return null;
            const item = items[Math.floor(Math.random() * items.length)];
            const partnerName = (typeof settings !== 'undefined' && settings.partnerName) ? settings.partnerName : '对方';
            if (typeof addMessage === 'function') {
                addMessage({
                    id: Date.now() + Math.random(),
                    sender: partnerName,
                    text: '',
                    timestamp: new Date(),
                    status: 'received',
                    favorited: false,
                    note: null,
                    type: 'product',
                    product: {
                        title: item.title || '好物推荐',
                        img: item.img || '',
                        price: item.price != null ? String(item.price) : '',
                        url: item.url || '',
                        shop: item.shop || ''
                    }
                });
                if (typeof playSound === 'function') playSound('message');
                if (typeof window._sendPartnerNotification === 'function') {
                    window._sendPartnerNotification(partnerName, '🛍️ ' + (item.title || '好物推荐'));
                }
            }
            markPushed();
            return item;
        }).catch(function (err) {
            console.error('[ProductPush] 获取商品失败:', err);
            return null;
        });
    }

    // ── 卡片渲染（core.js createMessageFragment 调用）────
    function renderCardInner(product) {
        const p = product || {};
        const title = p.title || '好物推荐';
        const price = p.price || '';
        const img = p.img || '';
        const shop = p.shop || '';
        const priceHTML = price
            ? '<div class="product-card-price">¥' + price + '</div>'
            : '<div class="product-card-price product-card-price--na">看价格</div>';
        return '<div class="product-card" onclick="window.open(\'' + escapeAttr(p.url) + '\', \'_blank\', \'noopener\')">'
            + '<div class="product-card-img">'
            + (img ? '<img src="' + escapeAttr(img) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '<div class="product-card-img-fallback"><i class="fas fa-gift"></i></div>')
            + '</div>'
            + '<div class="product-card-body">'
            + '<div class="product-card-title">' + escapeHtml(title) + '</div>'
            + (shop ? '<div class="product-card-shop"><i class="fas fa-store-alt"></i> ' + escapeHtml(shop) + '</div>' : '')
            + '<div class="product-card-buyrow">' + priceHTML + '<button class="product-card-buy"><i class="fas fa-shopping-bag"></i> 购买</button></div>'
            + '</div>'
            + '</div>';
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function escapeAttr(s) {
        return escapeHtml(String(s == null ? '' : s));
    }

    // ── 设置弹窗 ──────────────────────────────────────────
    let _configModal = null;
    function buildConfigModal() {
        if (_configModal) return _configModal;
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'product-config-modal';
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:440px;">
                <div class="modal-title">
                    <i class="fas fa-gift"></i><span>商品推送</span>
                </div>
                <div style="font-size:12px;color:var(--text-secondary);line-height:1.8;margin-bottom:14px;">
                    MJ 主动说话时，有概率推送一件好物给你（饰品 / 零食 / 周边等），
                    点卡片直接跳转购买页。商品通过 <b>Cloudflare 函数</b> 获取，
                    淘宝联盟密钥放在服务端环境变量里，不会出现在网站前端。
                    <a href="product-get-product.js" style="color:var(--accent-color);" download>下载函数代码</a>，
                    部署后在下方填入接口地址即可。
                </div>
                <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:12px;cursor:pointer;">
                    <input type="checkbox" id="product-enable" style="accent-color:var(--accent-color);width:15px;height:15px;"> 启用 MJ 主动商品推送
                </label>
                <div style="font-size:12px;font-weight:600;color:var(--text-primary);margin-bottom:6px;">
                    触发概率：<span id="product-prob-label" style="color:var(--accent-color);">25%</span>
                </div>
                <input type="range" id="product-prob" min="5" max="50" value="25" step="5"
                       style="width:100%;accent-color:var(--accent-color);margin-bottom:12px;">
                <div style="font-size:12px;font-weight:600;color:var(--text-primary);margin-bottom:6px;">
                    推送间隔：<span id="product-interval-label" style="color:var(--accent-color);">5 天</span>
                </div>
                <input type="range" id="product-interval" min="3" max="7" value="5" step="1"
                       style="width:100%;accent-color:var(--accent-color);margin-bottom:12px;">
                <div style="font-size:12px;font-weight:600;color:var(--text-primary);margin-bottom:6px;">商品接口地址（Cloudflare 函数 URL）</div>
                <input type="text" id="product-worker-url" class="modal-input" placeholder="https://milk-product-api.pages.dev/get-product" autocomplete="off" style="margin-bottom:6px;">
                <div id="product-config-status" style="font-size:11px;color:var(--text-secondary);margin:4px 0 10px;min-height:16px;"></div>
                <div class="modal-buttons">
                    <button class="modal-btn modal-btn-secondary" id="product-config-cancel">取消</button>
                    <button class="modal-btn modal-btn-primary" id="product-config-save">保存</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        _configModal = modal;

        const prob = modal.querySelector('#product-prob');
        const probLabel = modal.querySelector('#product-prob-label');
        prob.addEventListener('input', function () { probLabel.textContent = prob.value + '%'; });

        const interval = modal.querySelector('#product-interval');
        const intervalLabel = modal.querySelector('#product-interval-label');
        interval.addEventListener('input', function () { intervalLabel.textContent = interval.value + ' 天'; });

        modal.querySelector('#product-config-cancel').onclick = function () {
            if (typeof hideModal === 'function') hideModal(modal);
        };
        modal.querySelector('#product-config-save').onclick = function () {
            saveSettings({
                enabled: modal.querySelector('#product-enable').checked,
                probability: Number(prob.value) / 100,
                intervalDays: Number(interval.value),
                workerUrl: modal.querySelector('#product-worker-url').value
            });
            const status = modal.querySelector('#product-config-status');
            if (status) { status.textContent = '✓ 已保存'; status.style.color = '#4caf50'; }
            setTimeout(function () {
                if (typeof hideModal === 'function') hideModal(modal);
                if (typeof showNotification === 'function') showNotification('商品推送设置已保存', 'success', 1800);
            }, 400);
        };
        return modal;
    }

    function openConfig() {
        const modal = buildConfigModal();
        const s = getSettings();
        modal.querySelector('#product-enable').checked = s.enabled;
        const prob = modal.querySelector('#product-prob');
        prob.value = Math.round(s.probability * 100);
        modal.querySelector('#product-prob-label').textContent = Math.round(s.probability * 100) + '%';
        const interval = modal.querySelector('#product-interval');
        interval.value = s.intervalDays || DEFAULT_SETTINGS.intervalDays;
        modal.querySelector('#product-interval-label').textContent = interval.value + ' 天';
        modal.querySelector('#product-worker-url').value = s.workerUrl;
        const status = modal.querySelector('#product-config-status');
        if (status) {
            status.style.color = 'var(--text-secondary)';
            status.textContent = s.enabled
                ? '已启用，概率 ' + Math.round(s.probability * 100) + '%，间隔 ' + (s.intervalDays || DEFAULT_SETTINGS.intervalDays) + ' 天'
                : '当前已关闭';
        }
        if (typeof showModal === 'function') showModal(modal); else modal.style.display = 'flex';
    }

    // ── 样式（小红书风格商品卡片，与现有主题变量一致）──
    function injectStyles() {
        if (document.getElementById('product-module-style')) return;
        const style = document.createElement('style');
        style.id = 'product-module-style';
        style.textContent = `
            /* 商品卡片消息气泡 */
            .product-card-msg {
                position: relative; cursor: pointer; user-select: none;
            }
            .product-card {
                display: flex; align-items: center; gap: 10px;
                width: 248px; max-width: 100%;
                background: var(--secondary-bg, #fff);
                border: 1px solid var(--border-color, rgba(0,0,0,0.08));
                border-radius: 14px; padding: 10px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.06);
                transition: transform 0.16s, box-shadow 0.16s;
            }
            .product-card:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(0,0,0,0.12); }
            .product-card-img {
                flex: 0 0 74px; width: 74px; height: 74px; border-radius: 10px; overflow: hidden;
                background: var(--secondary-bg, #f3f3f3); display: flex; align-items: center; justify-content: center;
            }
            .product-card-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
            .product-card-img-fallback { font-size: 26px; color: var(--text-secondary, #999); }
            .product-card-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
            .product-card-title {
                font-size: 12.5px; font-weight: 600; color: var(--text-primary, #222);
                line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
            }
            .product-card-shop {
                font-size: 10.5px; color: var(--text-secondary, #888); line-height: 1.4;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
            .product-card-shop i { margin-right: 2px; }
            .product-card-buyrow { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: 2px; }
            .product-card-price {
                font-size: 14px; font-weight: 700; color: var(--accent-color, #e05656);
            }
            .product-card-price--na { font-size: 11px; font-weight: 500; color: var(--text-secondary, #888); }
            .product-card-buy {
                background: var(--accent-color, #e05656); color: #fff; border: none; border-radius: 8px;
                padding: 4px 10px; font-size: 11px; font-weight: 600; cursor: pointer;
            }
            .product-card-buy i { margin-right: 2px; }
        `;
        document.head.appendChild(style);
    }

    // ── 导出 ──────────────────────────────────────────────
    window.ProductPush = {
        isEnabled: isEnabled,
        getProbability: getProbability,
        getIntervalDays: getIntervalDays,
        shouldPush: shouldPush,
        markPushed: markPushed,
        pushProduct: pushProduct,
        renderCardInner: renderCardInner,
        openConfig: openConfig,
        getSettings: getSettings,
        saveSettings: saveSettings,
        KEYWORDS: KEYWORDS
    };

    // ── 自注册设置入口 ────────────────────────────────────
    const entry = document.getElementById('product-config-entry');
    if (entry) entry.addEventListener('click', openConfig);

    injectStyles();
})();
