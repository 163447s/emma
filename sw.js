/* milk字卡 PWA Service Worker
 * 缓存版本号：v3 —— 修改网站代码后，请同步更新此版本号（如 v4），
 * 并更新 index.html 中 js 文件的 ?v= 参数，用户才会加载到新版本。
 * v3：图标 URL 加版本参数（?v=2），强制刷新已安装的图标缓存。
 */
const CACHE_NAME = 'milk-emma-v6';

/* 核心资源（同源，首次访问时预缓存） */
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/config.js',
  './js/utils.js',
  './js/backup-engine.js',
  './js/state.js',
  './js/translation.js?v=20261102a',
  './js/tarot.js?v=20261102c',
  './js/core.js?v=20261102a',
  './js/features/mood.js',
  './js/features/envelope.js',
  './js/features/reply-library.js',
  './js/features/theme-editor.js',
  './js/features/group-chat.js',
  './js/features/call.js',
  './js/features/qa.js',
  './js/games.js',
  './js/features.js',
  './js/data.js',
  './js/onboarding.js',
  './js/listeners.js',
  './js/app.js',
  './icons/icon-192.png?v=2',
  './icons/icon-512.png?v=2',
  './icons/icon-maskable-512.png?v=2',
  './icons/apple-touch-icon.png?v=2'
];

/* 外部 CDN 资源（尽力缓存，失败不影响安装） */
const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/localforage/1.10.0/localforage.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
];

/* 允许做跨域运行时缓存的域名 */
const RUNTIME_CACHE_HOSTS = ['cdnjs.cloudflare.com', 'file.youtochat.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

/* 预缓存单个资源：8 秒超时 + 失败吞掉，保证某个资源慢/挂起不会卡住整个安装 */
function addWithTimeout(cache, url) {
  return Promise.race([
    cache.add(url).catch(function () {}),
    new Promise(function (resolve) { setTimeout(resolve, 8000); })
  ]);
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return Promise.all(
        CORE_ASSETS.concat(CDN_ASSETS).map(function (url) {
          return addWithTimeout(cache, url);
        })
      );
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  var sameOrigin = url.origin === self.location.origin;

  /* 同源页面导航：网络优先（拿到最新页面），断网时回退缓存首页 */
  if (sameOrigin && req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function (c) { c.put('./index.html', copy); });
        return res;
      }).catch(function () {
        return caches.match('./index.html');
      })
    );
    return;
  }

  /* 允许运行时缓存的请求：同源静态资源 + 白名单 CDN */
  var allowRuntime = sameOrigin || RUNTIME_CACHE_HOSTS.indexOf(url.hostname) !== -1;
  if (!allowRuntime) return;

  event.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (res) {
        if (res && (res.status === 200 || res.type === 'opaque')) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return cached;
      });
    })
  );
});
