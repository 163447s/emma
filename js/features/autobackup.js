/**
 * autobackup.js — 每天存一份备份，只留最近 7 份
 * 1) 每天第一次打开站点，自动把当天数据存进站内（IndexedDB），旧的自动滚掉
 * 2) 页面开着跨过 0 点，也会立刻补一份
 * 3) 入口：「设置 → 高级功能 → 备份存档」，可查看 7 份、单独导出
 */
(function () {
    'use strict';

    var DAY_KEY = 'cx_auto_backup_day';
    var ON_KEY = 'cx_auto_backup_on';
    var HIST_KEY = 'cx_auto_backup_hist';
    var MAX_KEEP = 7;
    var busy = false;

    function pad(n) { return ('0' + n).slice(-2); }
    function dayKey(d) {
        d = d || new Date();
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }
    function lastDay() { try { return localStorage.getItem(DAY_KEY) || ''; } catch (e) { return ''; } }
    function enabled() { try { return localStorage.getItem(ON_KEY) !== '0'; } catch (e) { return true; } }

    function store() {
        try { if (window.localforage) return window.localforage; } catch (e) {}
        return null;
    }

    function readHist() {
        var lf = store();
        if (lf) return lf.getItem(HIST_KEY).then(function (v) { return Array.isArray(v) ? v : []; }).catch(function () { return []; });
        try { return Promise.resolve(JSON.parse(localStorage.getItem(HIST_KEY) || '[]')); } catch (e) { return Promise.resolve([]); }
    }
    function writeHist(arr) {
        var lf = store();
        if (lf) return lf.setItem(HIST_KEY, arr);
        try { localStorage.setItem(HIST_KEY, JSON.stringify(arr)); } catch (e) {}
        return Promise.resolve();
    }

    function humanSize(n) {
        if (!n) return '0 KB';
        if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
        return (n / 1024 / 1024).toFixed(1) + ' MB';
    }

    /* ── 存一份 ── */
    function snapshot(reason) {
        if (busy) return Promise.reject('busy');
        var cb = window.ChatBackup;
        if (!cb || !cb.buildBackupPayload || !cb.serializeBackupV4) return Promise.reject('no-backup-engine');

        busy = true;
        return cb.buildBackupPayload({}).then(function (payload) {
            var json = cb.serializeBackupV4(payload);
            return readHist().then(function (arr) {
                var today = dayKey();
                arr = arr.filter(function (x) { return x && x.day !== today; });
                arr.push({ day: today, ts: Date.now(), size: json.length, json: json });
                // 只留最近 7 份，按时间从旧到新，从头丢
                while (arr.length > MAX_KEEP) arr.shift();
                return writeHist(arr).then(function () {
                    try { localStorage.setItem(DAY_KEY, today); } catch (e) {}
                    busy = false;
                    if (typeof showNotification === 'function') {
                        showNotification(reason === 'manual' ? '已存档一份（共保留最近 7 份）' : '今天的数据已自动存档（保留最近 7 份）', 'success', 2400);
                    }
                    return true;
                });
            });
        }).catch(function (e) {
            busy = false;
            throw e;
        });
    }

    function tick() {
        if (!enabled()) return;
        if (lastDay() === dayKey()) return;
        snapshot('auto').catch(function () {});
    }

    /* ── 导出某一份到手机 ── */
    function exportOne(day) {
        return readHist().then(function (arr) {
            var item = null;
            for (var i = 0; i < arr.length; i++) if (arr[i] && arr[i].day === (day || '')) item = arr[i];
            if (!item) item = arr[arr.length - 1];
            if (!item) { if (typeof showNotification === 'function') showNotification('还没有存过备份', 'error'); return; }
            var blob = new Blob([item.json], { type: 'application/json;charset=utf-8' });
            var name = 'chatapp-backup-' + item.day + '.json';
            try {
                if (typeof downloadFileFallback === 'function') { downloadFileFallback(blob, name); }
                else {
                    var a = document.createElement('a');
                    a.href = URL.createObjectURL(blob); a.download = name;
                    document.body.appendChild(a); a.click(); a.remove();
                    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
                }
                if (typeof showNotification === 'function') showNotification('已导出 ' + item.day + ' 的备份', 'success');
            } catch (e) {
                if (typeof showNotification === 'function') showNotification('导出失败', 'error');
            }
        });
    }

    /* ── 面板 ── */
    var STYLE_ID = 'cx-abk-style';
    function style() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '.cxabk-mask{position:fixed;inset:0;z-index:4200;background:rgba(18,26,36,.5);display:flex;align-items:center;justify-content:center;padding:18px;-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)}',
            '.cxabk-box{width:100%;max-width:360px;border-radius:20px;background:rgba(252,254,255,.97);box-shadow:0 18px 50px rgba(30,55,80,.24);overflow:hidden}',
            '.cxabk-hd{padding:16px 18px 12px;border-bottom:1px solid rgba(140,170,195,.18);display:flex;align-items:center;justify-content:space-between}',
            '.cxabk-hd b{font-size:15px;color:#40607a;font-weight:600}',
            '.cxabk-x{border:none;background:none;color:#9fb3c4;font-size:18px;cursor:pointer}',
            '.cxabk-bd{padding:10px 14px 6px;max-height:52vh;overflow:auto}',
            '.cxabk-row{display:flex;align-items:center;justify-content:space-between;padding:9px 4px;border-bottom:1px solid rgba(140,170,195,.14)}',
            '.cxabk-row:last-child{border-bottom:none}',
            '.cxabk-day{font-size:13px;color:#3f5d77}',
            '.cxabk-size{font-size:11.5px;color:#93a8ba;margin-top:2px}',
            '.cxabk-btn{border:none;border-radius:9px;padding:6px 12px;font-size:12px;background:#6f9ec2;color:#fff;font-family:inherit;cursor:pointer}',
            '.cxabk-tip{padding:2px 18px 12px;font-size:11.5px;color:#93a8ba;line-height:1.6}',
            '.cxabk-ft{padding:10px 18px 16px;display:flex;gap:9px}',
            '.cxabk-ft button{flex:1}'
        ].join('');
        document.head.appendChild(st);
    }

    function openPanel() {
        style();
        if (document.querySelector('.cxabk-mask')) return;
        var mask = document.createElement('div');
        mask.className = 'cxabk-mask';
        mask.innerHTML = '<div class="cxabk-box"><div class="cxabk-hd"><b>备份存档</b><button class="cxabk-x">×</button></div>' +
            '<div class="cxabk-bd" id="cxabk-list"><div class="cxabk-tip">读取中…</div></div>' +
            '<div class="cxabk-tip">每天自动存一份，只保留最近 7 份，旧的自动滚掉。点「导出」会存到手机「下载」里。</div>' +
            '<div class="cxabk-ft"><button class="cxabk-btn" id="cxabk-now" style="background:rgba(120,150,175,.16);color:#4d7392">现在存一份</button></div></div>';
        document.body.appendChild(mask);
        mask.querySelector('.cxabk-x').addEventListener('click', function () { mask.remove(); });
        mask.addEventListener('click', function (e) { if (e.target === mask) mask.remove(); });
        mask.querySelector('#cxabk-now').addEventListener('click', function () {
            snapshot('manual').then(function () { render(mask); }).catch(function () {
                if (typeof showNotification === 'function') showNotification('存档失败（可能空间不足）', 'error');
            });
        });
        render(mask);

        function render(m) {
            var list = m.querySelector('#cxabk-list');
            readHist().then(function (arr) {
                if (!arr.length) { list.innerHTML = '<div class="cxabk-tip">还没有存档，明天打开站点会自动存第一份。</div>'; return; }
                var html = '';
                for (var i = arr.length - 1; i >= 0; i--) {
                    var it = arr[i];
                    html += '<div class="cxabk-row"><div><div class="cxabk-day">' + it.day + '</div>' +
                        '<div class="cxabk-size">' + humanSize(it.size) + '</div></div>' +
                        '<button class="cxabk-btn" data-day="' + it.day + '">导出</button></div>';
                }
                list.innerHTML = html;
                Array.prototype.forEach.call(list.querySelectorAll('.cxabk-btn'), function (b) {
                    b.addEventListener('click', function () { exportOne(b.getAttribute('data-day')); });
                });
            });
        }
    }

    function ensureEntry() {
        var box = document.getElementById('advanced-modal');
        var list = box ? box.querySelector('.settings-item-list') : null;
        if (!list || document.getElementById('cxabk-entry')) return;
        var item = document.createElement('div');
        item.className = 'settings-item';
        item.id = 'cxabk-entry';
        item.innerHTML = '<i class="fas fa-clock-rotate-left"></i><span>备份存档</span>';
        item.addEventListener('click', function () {
            try { if (typeof window.hideModal === 'function') window.hideModal(box); } catch (e) {}
            setTimeout(openPanel, 180);
        });
        list.appendChild(item);
    }

    function boot() {
        setTimeout(tick, 7000);
        setInterval(tick, 60 * 1000);
        setTimeout(ensureEntry, 1200);
        setTimeout(ensureEntry, 3000);
        window.CxAutoBackup = {
            run: function () { return snapshot('manual'); },
            list: readHist,
            export: exportOne,
            panel: openPanel,
            last: lastDay,
            enabled: enabled,
            on: function () { try { localStorage.removeItem(ON_KEY); } catch (e) {} },
            off: function () { try { localStorage.setItem(ON_KEY, '0'); } catch (e) {} }
        };
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 400); });
    else setTimeout(boot, 400);
})();
