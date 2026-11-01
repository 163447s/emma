/* ============================================================
 * 翻译模块（有道翻译 API 免费版）
 * 功能：
 *   1. 发送消息时自动把中文翻译为日语后发出（core.js 的 sendMessage 调用）
 *      - 聊天界面显示日语，messages 数组同时存中文原文（originalText）
 *   2. 每条消息气泡右上角「翻译」小按钮，点击后那条消息独立切换中日显示
 *   3. API Key 配置弹窗（设置 → 高级功能 → 翻译设置）
 * 依赖：无；需在 core.js 之前加载（core.js 调用 window.Translation）
 * ============================================================ */
(function () {
    'use strict';

    // ── 常量 ──────────────────────────────────────────────
    const API_URL = 'https://openapi.youdao.com/api';
    const CACHE_KEY = 'translationCache';                  // 翻译缓存（localStorage）
    const KEYS_KEY = 'youdaoApiKeys';                      // 有道 API 应用ID + 密钥
    const MAX_CACHE_ENTRIES = 600;
    const MAX_CONCURRENT = 4;

    // ── 模块状态 ──────────────────────────────────────────
    let _inFlight = 0;
    const _pendingQueue = [];

    // ── 工具：md5（标准实现；已修复 binl2utf8bytes 中 mask 未定义）──
    function md5(s) {
        function safeAdd(x, y) {
            const lsw = (x & 0xffff) + (y & 0xffff);
            return (((x >> 16) + (y >> 16) + (lsw >> 16)) << 16) | (lsw & 0xffff);
        }
        function bitRotateLeft(num, cnt) { return (num << cnt) | (num >>> (32 - cnt)); }
        function md5cmn(q, a, b, x, s, t) { return safeAdd(bitRotateLeft(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b); }
        function md5ff(a, b, c, d, x, s, t) { return md5cmn((b & c) | (~b & d), a, b, x, s, t); }
        function md5gg(a, b, c, d, x, s, t) { return md5cmn((b & d) | (c & ~d), a, b, x, s, t); }
        function md5hh(a, b, c, d, x, s, t) { return md5cmn(b ^ c ^ d, a, b, x, s, t); }
        function md5ii(a, b, c, d, x, s, t) { return md5cmn(c ^ (b | ~d), a, b, x, s, t); }

        function binl2hex(binarray) {
            let hexTab = '0123456789abcdef';
            let str = '';
            for (let i = 0; i < binarray.length * 4; i++) {
                str += hexTab.charAt((binarray[i >> 2] >> ((i % 4) * 8 + 4)) & 0xf) +
                       hexTab.charAt((binarray[i >> 2] >> ((i % 4) * 8)) & 0xf);
            }
            return str;
        }
        function str2binl(str) {
            const bin = [];
            let mask = (1 << 8) - 1;
            for (let i = 0; i < str.length * 8; i += 8) {
                bin[i >> 5] |= (str.charCodeAt(i / 8) & mask) << (i % 32);
            }
            return bin;
        }
        function binl2utf8bytes(str) {
            // 将字符串转成 UTF-8 字节后再按 32 位组装，保证中文签名与官方一致
            const mask = (1 << 8) - 1;
            const bytes = [];
            for (let i = 0; i < str.length; i++) {
                let c = str.charCodeAt(i);
                if (c < 0x80) {
                    bytes.push(c);
                } else if (c < 0x800) {
                    bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
                } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
                    const c2 = str.charCodeAt(i + 1);
                    if (c2 >= 0xdc00 && c2 <= 0xdfff) {
                        const code = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
                        bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
                        i++;
                    } else {
                        bytes.push(0xef, 0xbf, 0xbd);
                    }
                } else if (c >= 0xd800 && c <= 0xdfff) {
                    bytes.push(0xef, 0xbf, 0xbd);
                } else {
                    bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
                }
            }
            const bin = [];
            for (let i = 0; i < bytes.length * 8; i += 8) {
                bin[i >> 5] |= (bytes[i / 8] & mask) << (i % 32);
            }
            return bin;
        }

        const x = binl2utf8bytes(s);
        const n = x.length;
        const bitLen = n * 8;
        x[n >> 5] |= 0x80 << (n % 32);
        x[(((bitLen + 64) >>> 9) << 4) + 14] = bitLen;

        let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
        for (let i = 0; i < x.length; i += 16) {
            const olda = a, oldb = b, oldc = c, oldd = d;
            a = md5ff(a, b, c, d, x[i], 7, -680876936);
            d = md5ff(d, a, b, c, x[i + 1], 12, -389564586);
            c = md5ff(c, d, a, b, x[i + 2], 17, 606105819);
            b = md5ff(b, c, d, a, x[i + 3], 22, -1044525330);
            a = md5ff(a, b, c, d, x[i + 4], 7, -176418897);
            d = md5ff(d, a, b, c, x[i + 5], 12, 1200080426);
            c = md5ff(c, d, a, b, x[i + 6], 17, -1473231341);
            b = md5ff(b, c, d, a, x[i + 7], 22, -45705983);
            a = md5ff(a, b, c, d, x[i + 8], 7, 1770035416);
            d = md5ff(d, a, b, c, x[i + 9], 12, -1958414417);
            c = md5ff(c, d, a, b, x[i + 10], 17, -42063);
            b = md5ff(b, c, d, a, x[i + 11], 22, -1990404162);
            a = md5ff(a, b, c, d, x[i + 12], 7, 1804603682);
            d = md5ff(d, a, b, c, x[i + 13], 12, -40341101);
            c = md5ff(c, d, a, b, x[i + 14], 17, -1502002290);
            b = md5ff(b, c, d, a, x[i + 15], 22, 1236535329);
            a = md5gg(a, b, c, d, x[i + 1], 5, -165796510);
            d = md5gg(d, a, b, c, x[i + 6], 9, -1069501632);
            c = md5gg(c, d, a, b, x[i + 11], 14, 643717713);
            b = md5gg(b, c, d, a, x[i], 20, -373897302);
            a = md5gg(a, b, c, d, x[i + 5], 5, -701558691);
            d = md5gg(d, a, b, c, x[i + 10], 9, 38016083);
            c = md5gg(c, d, a, b, x[i + 15], 14, -660478335);
            b = md5gg(b, c, d, a, x[i + 4], 20, -405537848);
            a = md5gg(a, b, c, d, x[i + 9], 5, 568446438);
            d = md5gg(d, a, b, c, x[i + 14], 9, -1019803690);
            c = md5gg(c, d, a, b, x[i + 3], 14, -187363961);
            b = md5gg(b, c, d, a, x[i + 8], 20, 1163531501);
            a = md5gg(a, b, c, d, x[i + 13], 5, -1444681467);
            d = md5gg(d, a, b, c, x[i + 2], 9, -51403784);
            c = md5gg(c, d, a, b, x[i + 7], 14, 1735328473);
            b = md5gg(b, c, d, a, x[i + 12], 20, -1926607734);
            a = md5hh(a, b, c, d, x[i + 5], 4, -378558);
            d = md5hh(d, a, b, c, x[i + 8], 11, -2022574463);
            c = md5hh(c, d, a, b, x[i + 11], 16, 1839030562);
            b = md5hh(b, c, d, a, x[i + 14], 23, -35309556);
            a = md5hh(a, b, c, d, x[i + 1], 4, -1530992060);
            d = md5hh(d, a, b, c, x[i + 4], 11, 1272893353);
            c = md5hh(c, d, a, b, x[i + 7], 16, -155497632);
            b = md5hh(b, c, d, a, x[i + 10], 23, -1094730640);
            a = md5hh(a, b, c, d, x[i + 13], 4, 681279174);
            d = md5hh(d, a, b, c, x[i], 11, -358537222);
            c = md5hh(c, d, a, b, x[i + 3], 16, -722521979);
            b = md5hh(b, c, d, a, x[i + 6], 23, 76029189);
            a = md5hh(a, b, c, d, x[i + 9], 4, -640364487);
            d = md5hh(d, a, b, c, x[i + 12], 11, -421815835);
            c = md5hh(c, d, a, b, x[i + 15], 16, 530742520);
            b = md5hh(b, c, d, a, x[i + 2], 23, -995338651);
            a = md5ii(a, b, c, d, x[i], 6, -198630844);
            d = md5ii(d, a, b, c, x[i + 7], 10, 1126891415);
            c = md5ii(c, d, a, b, x[i + 14], 15, -1416354905);
            b = md5ii(b, c, d, a, x[i + 5], 21, -57434055);
            a = md5ii(a, b, c, d, x[i + 12], 6, 1700485571);
            d = md5ii(d, a, b, c, x[i + 3], 10, -1894986606);
            c = md5ii(c, d, a, b, x[i + 10], 15, -1051523);
            b = md5ii(b, c, d, a, x[i + 1], 21, -2054922799);
            a = md5ii(a, b, c, d, x[i + 8], 6, 1873313359);
            d = md5ii(d, a, b, c, x[i + 15], 10, -30611744);
            c = md5ii(c, d, a, b, x[i + 6], 15, -1560198380);
            b = md5ii(b, c, d, a, x[i + 13], 21, 1309151649);
            a = md5ii(a, b, c, d, x[i + 4], 6, -145523070);
            d = md5ii(d, a, b, c, x[i + 11], 10, -1120210379);
            c = md5ii(c, d, a, b, x[i + 2], 15, 718787259);
            b = md5ii(b, c, d, a, x[i + 9], 21, -343485551);
            a = safeAdd(a, olda);
            b = safeAdd(b, oldb);
            c = safeAdd(c, oldc);
            d = safeAdd(d, oldd);
        }
        return binl2hex([a, b, c, d]);
    }

    // ── 工具：localStorage 读写 ─────────────────────────
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

    // ── API Key 配置 ─────────────────────────────────────
    function getKeys() {
        const o = lsGet(KEYS_KEY, null);
        return (o && typeof o === 'object')
            ? { appId: String(o.appId || '').trim(), appSecret: String(o.appSecret || '').trim() }
            : { appId: '', appSecret: '' };
    }
    function saveKeys(appId, appSecret) {
        lsSet(KEYS_KEY, { appId: String(appId || '').trim(), appSecret: String(appSecret || '').trim() });
    }
    function hasKeys() {
        const { appId, appSecret } = getKeys();
        return !!(appId && appSecret);
    }

    // ── 翻译缓存 ─────────────────────────────────────────
    function getCachedTranslation(text, lang, cacheKey) {
        const key = String(lang) + ':' + String(text);
        const cache = lsGet(cacheKey || CACHE_KEY, {});
        if (cache && Object.prototype.hasOwnProperty.call(cache, key)) return cache[key];
        return null;
    }
    function setCachedTranslation(text, lang, translation, cacheKey) {
        const key = String(lang) + ':' + String(text);
        const storeKey = cacheKey || CACHE_KEY;
        const cache = lsGet(storeKey, {}) || {};
        cache[key] = String(translation);
        const keys = Object.keys(cache);
        if (keys.length > MAX_CACHE_ENTRIES) {
            keys.slice(0, keys.length - MAX_CACHE_ENTRIES).forEach(k => delete cache[k]);
        }
        lsSet(storeKey, cache);
    }

    // ── 并发限制：避免瞬间打爆免费额度 ─────────────────
    function _withConcurrency(fn) {
        return new Promise((resolve, reject) => {
            const run = () => {
                _inFlight++;
                Promise.resolve().then(fn).then(resolve, reject).finally(() => {
                    _inFlight--;
                    if (_pendingQueue.length) _pendingQueue.shift()();
                });
            };
            if (_inFlight < MAX_CONCURRENT) run();
            else _pendingQueue.push(run);
        });
    }

    // ── 有道翻译 v3 签名 ─────────────────────────────────
    function _truncateQ(q) {
        return q.length <= 20 ? q : q.substring(0, 10) + q.length + q.substring(q.length - 10);
    }
    // sha256（官方现行 v3 方案，需要 WebCrypto；https/file 安全上下文可用）
    async function _sha256Hex(str) {
        try {
            if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
                const data = new TextEncoder().encode(str);
                const buf = await crypto.subtle.digest('SHA-256', data);
                return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
            }
        } catch (e) {}
        return null;
    }
    // JSONP 调用（浏览器跨域专用：有道 API 不支持 CORS，官方 JS demo 即用 JSONP）
    function _jsonp(url, callbackName, timeoutMs) {
        return new Promise(function (resolve, reject) {
            const script = document.createElement('script');
            let done = false;
            const timer = setTimeout(function () {
                cleanup();
                reject(new Error('jsonp timeout'));
            }, timeoutMs || 12000);
            function cleanup() {
                if (done) return;
                done = true;
                clearTimeout(timer);
                try { delete window[callbackName]; } catch (e) { window[callbackName] = undefined; }
                if (script.parentNode) script.parentNode.removeChild(script);
            }
            window[callbackName] = function (data) {
                cleanup();
                resolve(data);
            };
            script.onerror = function () {
                cleanup();
                reject(new Error('jsonp error'));
            };
            script.src = url;
            document.head.appendChild(script);
        });
    }
    async function _callYoudao(q, toLang) {
        const { appId, appSecret } = getKeys();
        if (!appId || !appSecret) return null; // 未配置密钥 → 由调用方回退原文
        // JSONP 走 GET，URL 长度有限：超长文本直接回退原文
        if (String(q).length > 300) return null;
        const to = toLang === 'zh' ? 'zh-CHS' : 'ja';
        const salt = String(Date.now()) + String(Math.floor(Math.random() * 100000));
        const curtime = String(Math.round(Date.now() / 1000));
        const input = _truncateQ(q);

        // 方案1（官方现行）：signType=v3 + sha256(appKey+input+salt+curtime+secret) + curtime
        const attempts = [];
        const sha = await _sha256Hex(appId + input + salt + curtime + appSecret);
        if (sha) {
            attempts.push({ q, from: 'auto', to, appKey: appId, salt, sign: sha, signType: 'v3', curtime });
        }
        // 方案2（兼容旧版）：signType=v3 + md5(appKey+input+salt+secret)，无 curtime
        // 签名计算失败（如 md5 异常）时跳过该方案，不阻塞正确方案
        try {
            attempts.push({ q, from: 'auto', to, appKey: appId, salt, sign: md5(appId + input + salt + appSecret), signType: 'v3' });
        } catch (e) {}

        for (const attempt of attempts) {
            try {
                const qs = Object.keys(attempt).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(attempt[k])).join('&');
                const cbName = '__yd_cb_' + Math.random().toString(36).slice(2, 10);
                const data = await _jsonp(API_URL + '?callback=' + cbName + '&' + qs, cbName, 12000);
                if (data && data.errorCode === '0' && Array.isArray(data.translation) && data.translation.length) {
                    const t = String(data.translation[0] || '').trim();
                    if (t) return t;
                }
                if (data && (String(data.errorCode) === '105' || String(data.errorCode) === '106')) {
                    continue; // 签名/签名类型问题 → 尝试下一个方案
                }
                break; // 其他错误（108/110/111/112/113/超时等）重试无意义
            } catch (e) {
                continue;
            }
        }
        return null;
    }

    /**
     * 翻译文本（异步，永不 reject）
     * @param {string} text 原文
     * @param {string} lang 目标语言（'ja' / 'zh'）
     * @returns {Promise<string>} 译文；失败/未配置密钥时返回原文
     */
    async function translateText(text, lang) {
        const raw = String(text == null ? '' : text);
        if (!raw.trim()) return raw;
        const toLang = lang === 'ja' ? 'ja' : 'zh';

        const cached = getCachedTranslation(raw, toLang);
        if (cached) return cached;

        if (!hasKeys()) return raw; // 无密钥：回退原文，不影响使用

        try {
            const t = await _withConcurrency(() => _callYoudao(raw, toLang));
            if (t && t !== raw) {
                setCachedTranslation(raw, toLang, t);
                return t;
            }
            return raw;
        } catch (e) {
            return raw;
        }
    }

    // ── API Key 配置弹窗 ────────────────────────────────
    let _configModal = null;
    function buildConfigModal() {
        if (_configModal) return _configModal;
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'translate-config-modal';
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:430px;">
                <div class="modal-title">
                    <i class="fas fa-language"></i><span>翻译设置</span>
                </div>
                <div style="font-size:12px;color:var(--text-secondary);line-height:1.8;margin-bottom:14px;">
                    使用<b>有道翻译 API 免费版</b>（每日 2000 次免费额度）。请先在
                    <a href="https://ai.youdao.com/" target="_blank" rel="noopener" style="color:var(--accent-color);font-weight:600;">有道智云</a>
                    创建「文本翻译」应用，把「应用ID」和「应用密钥」填到这里。密钥仅保存在本机浏览器，不会上传。
                </div>
                <div style="font-size:12px;font-weight:600;color:var(--text-primary);margin-bottom:6px;">应用ID（AppID）</div>
                <input type="text" id="translate-appid-input" class="modal-input" placeholder="例如：a1b2c3d4e5f6" autocomplete="off" style="margin-bottom:12px;">
                <div style="font-size:12px;font-weight:600;color:var(--text-primary);margin-bottom:6px;">应用密钥（AppSecret）</div>
                <input type="password" id="translate-secret-input" class="modal-input" placeholder="请输入应用密钥" autocomplete="off" style="margin-bottom:6px;">
                <div id="translate-config-status" style="font-size:11px;color:var(--text-secondary);margin:4px 0 10px;min-height:16px;"></div>
                <div class="modal-buttons">
                    <button class="modal-btn modal-btn-secondary" id="translate-config-cancel">取消</button>
                    <button class="modal-btn modal-btn-primary" id="translate-config-save">保存</button>
                </div>
            </div>`;
        document.body.appendChild(modal);

        const status = modal.querySelector('#translate-config-status');
        const appIdInput = modal.querySelector('#translate-appid-input');
        const secretInput = modal.querySelector('#translate-secret-input');

        modal.querySelector('#translate-config-cancel').onclick = () => {
            if (typeof hideModal === 'function') hideModal(modal);
        };
        modal.querySelector('#translate-config-save').onclick = () => {
            const appId = appIdInput.value.trim();
            const secret = secretInput.value.trim();
            if (!appId || !secret) {
                if (status) { status.textContent = '请填写应用ID和应用密钥'; status.style.color = '#ef4444'; }
                return;
            }
            saveKeys(appId, secret);
            if (status) { status.textContent = '✓ 已保存，翻译功能已启用'; status.style.color = '#4caf50'; }
            setTimeout(() => {
                if (typeof hideModal === 'function') hideModal(modal);
                if (typeof showNotification === 'function') showNotification('翻译设置已保存', 'success', 1800);
            }, 400);
        };
        return modal;
    }

    function openConfig() {
        const modal = buildConfigModal();
        const { appId, appSecret } = getKeys();
        const appIdInput = modal.querySelector('#translate-appid-input');
        const secretInput = modal.querySelector('#translate-secret-input');
        const status = modal.querySelector('#translate-config-status');
        if (appIdInput) appIdInput.value = appId;
        if (secretInput) secretInput.value = appSecret;
        if (status) {
            status.style.color = 'var(--text-secondary)';
            status.textContent = appId ? '已配置（应用ID：' + appId + '）' : '尚未配置';
        }
        if (typeof showModal === 'function') showModal(modal, appIdInput);
        else modal.style.display = 'flex';
    }

    // ── 样式：消息气泡翻译小按钮 ────────────────────────
    function injectStyles() {
        if (document.getElementById('translation-module-style')) return;
        const style = document.createElement('style');
        style.id = 'translation-module-style';
        style.textContent = `
            .msg-translate-btn {
                position: absolute; top: 4px; right: 6px; z-index: 3;
                font-size: 10px; line-height: 1; padding: 3px 7px;
                border: none; border-radius: 10px; cursor: pointer;
                background: rgba(128, 128, 128, 0.28); color: inherit;
                opacity: 0; transition: opacity 0.18s;
                font-family: var(--font-family);
            }
            .message:hover .msg-translate-btn { opacity: 1; }
            .msg-translate-btn:hover { background: rgba(128, 128, 128, 0.45); }
            .msg-translate-btn:disabled { cursor: wait; opacity: 0.7; }
        `;
        document.head.appendChild(style);
    }

    // ── 初始化 ───────────────────────────────────────────
    function bindEvents() {
        const configEntry = document.getElementById('translate-config-entry');
        if (configEntry) configEntry.addEventListener('click', openConfig);
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
    window.Translation = {
        translateText: translateText,
        getCachedTranslation: getCachedTranslation,
        setCachedTranslation: setCachedTranslation,
        getKeys: getKeys,
        hasKeys: hasKeys,
        saveKeys: saveKeys,
        openConfig: openConfig
    };
})();
