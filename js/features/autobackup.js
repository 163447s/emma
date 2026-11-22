/**
 * autobackup.js — 每天自动存一份备份
 * 1) 每天第一次打开站点，自动导出一份到手机的「下载」里（不弹分享面板）
 * 2) 页面开着跨过 0 点，也会立刻补一份
 * 关掉：localStorage['cx_auto_backup_on'] = '0'
 */
(function () {
    'use strict';

    var DAY_KEY = 'cx_auto_backup_day';
    var ON_KEY = 'cx_auto_backup_on';
    var busy = false;

    function pad(n) { return ('0' + n).slice(-2); }
    function dayKey(d) {
        d = d || new Date();
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }
    function lastDay() { try { return localStorage.getItem(DAY_KEY) || ''; } catch (e) { return ''; } }
    function enabled() { try { return localStorage.getItem(ON_KEY) !== '0'; } catch (e) { return true; } }

    function run(force) {
        if (busy) return false;
        if (!force && !enabled()) return false;
        var be = window.ChatBackup || window.BackupEngine;
        if (!be || typeof be.exportBackupToFile !== 'function') return false;

        busy = true;
        var today = dayKey();
        try { localStorage.setItem(DAY_KEY, today); } catch (e) {}

        try {
            var p = be.exportBackupToFile({}, { noShare: true });
            if (p && typeof p.then === 'function') {
                p.then(function () {
                    busy = false;
                    if (typeof showNotification === 'function') {
                        showNotification('今天的备份已存到「下载」里', 'success', 2600);
                    }
                }).catch(function () {
                    busy = false;
                    try { localStorage.setItem(DAY_KEY, ''); } catch (e) {}
                });
            } else {
                busy = false;
            }
            return true;
        } catch (e) {
            busy = false;
            return false;
        }
    }

    function tick() {
        if (lastDay() !== dayKey()) run(false);
    }

    function boot() {
        setTimeout(tick, 7000);                 // 等数据、JSZip 就绪
        setInterval(tick, 60 * 1000);           // 页面开着跨过 0 点，立刻补
        window.CxAutoBackup = {
            run: function () { return run(true); },
            last: lastDay,
            today: function () { return dayKey(); },
            enabled: enabled,
            on: function () { try { localStorage.removeItem(ON_KEY); } catch (e) {} },
            off: function () { try { localStorage.setItem(ON_KEY, '0'); } catch (e) {} }
        };
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 400); });
    } else {
        setTimeout(boot, 400);
    }
})();
