/**
 * autobackup.js — 每日自动备份
 * 跨天后自动导出一份完整备份（chatapp-backup-YYYY-MM-DD.zip）下载到手机。
 * 浏览器不能在页面关掉时定时跑，所以：
 *   · 页面在跑时，零点前后会自动触发；
 *   · 页面没开，就在你下次打开时立刻补当天的这一份。
 * 入口：设置 → 高级功能 → 每日自动备份（可开关）
 */
(function () {
    'use strict';

    var DATE_KEY = 'cx_autobackup_date';
    var ON_KEY = 'cx_autobackup_on';
    var running = false;

    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    function dayKey() {
        var d = new Date();
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }
    function isOn() { try { return localStorage.getItem(ON_KEY) !== '0'; } catch (e) { return true; } }
    function setOn(v) { try { localStorage.setItem(ON_KEY, v ? '1' : '0'); } catch (e) {} }
    function lastDone() { try { return localStorage.getItem(DATE_KEY) || ''; } catch (e) { return ''; } }
    function mark() { try { localStorage.setItem(DATE_KEY, dayKey()); } catch (e) {} }

    function run(manual) {
        if (running) return;
        if (!manual && !isOn()) return;
        if (!window.ChatBackup || typeof window.ChatBackup.exportBackupToFile !== 'function') return;

        running = true;
        mark();
        var p;
        try { p = window.ChatBackup.exportBackupToFile(); }
        catch (e) { running = false; return; }

        Promise.resolve(p).then(function () {
            running = false;
        }).catch(function () {
            running = false;
            try { if (window.showNotification) window.showNotification('自动备份没成功，可以手动导一次', 'error', 2200); } catch (e) {}
        });
    }

    function tick() {
        var now = new Date();
        if (now.getHours() === 0 && now.getMinutes() < 3) {         // 零点附近
            if (lastDone() !== dayKey()) run(false);
            return;
        }
        if (lastDone() !== dayKey()) run(false);                    // 今天还没备份过 → 补做
    }

    /* 设置里的开关 */
    function ensureEntry() {
        var box = document.getElementById('advanced-modal');
        var list = box ? box.querySelector('.settings-item-list') : null;
        if (!list || document.getElementById('cx-autobackup-entry')) return;
        var item = document.createElement('div');
        item.className = 'settings-item';
        item.id = 'cx-autobackup-entry';
        item.innerHTML = '<i class="fas fa-download"></i><span>每日自动备份</span><b id="cx-autobackup-state" style="margin-left:auto;font-size:11px;color:#8ba4b9;font-weight:400;">' + (isOn() ? '开' : '关') + '</b>';
        item.addEventListener('click', function () {
            var next = !isOn();
            setOn(next);
            var st = document.getElementById('cx-autobackup-state');
            if (st) st.textContent = next ? '开' : '关';
            try {
                if (window.showNotification) window.showNotification(next ? '每天会自动导出一份备份' : '已关闭自动备份', 'success', 1600);
            } catch (e) {}
            if (next) run(true);
        });
        list.appendChild(item);
    }

    function boot() {
        window.CxAUTOBackup = {
            run: function () { run(true); },
            on: isOn,
            set: setOn,
            last: lastDone
        };
        setTimeout(ensureEntry, 600);
        setTimeout(ensureEntry, 2000);
        setTimeout(ensureEntry, 4000);
        setTimeout(tick, 6000);
        setInterval(tick, 60 * 1000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 500); });
    } else {
        setTimeout(boot, 500);
    }
})();
