/* ============================================================
 * MJ 主动商品推送 —— 商品查询函数（Cloudflare Pages Functions）
 * 路由：GET /get-product?q=关键词
 *
 * 功能：
 *   1. 配置了淘宝联盟（阿里妈妈）环境变量时，调用
 *      taobao.tbk.dg.material.optional 搜索真实商品
 *   2. 未配置 / 调用失败时返回内置 mock 商品，保证流程可用
 *
 * 环境变量（CF Pages 项目设置里配置，绝对不要写进前端代码）：
 *   TAOBAO_APP_KEY    阿里妈妈开放平台 AppKey
 *   TAOBAO_APP_SECRET 阿里妈妈开放平台 AppSecret
 *   TAOBAO_ADZONE_ID  推广位 ID（联盟后台 → 推广管理 → 推广位）
 *
 * 返回：{ ok, keyword, mock?, items: [{ title, img, price, url, shop }] }
 * ============================================================ */

/* ── 纯 JS MD5（WebCrypto 不支持 MD5，淘宝签名需要它）── */
function md5(str) {
  function rotl(x, n) { return (x << n) | (x >>> (32 - n)); }
  function add32(a, b) {
    return (a + b) & 0xffffffff;
  }
  function toHex(n) {
    var s = '';
    for (var i = 0; i < 4; i++) {
      s += ('0' + ((n >>> (i * 8)) & 0xff).toString(16)).slice(-2);
    }
    return s;
  }
  var bytes = unescape(encodeURIComponent(str));
  var n = bytes.length;
  var blocks = [];
  var i, j;
  for (i = 0; i < n + 8; i = i + 64) {
    blocks.push(i / 64);
  }
  var paddedLen = (((n + 8) >> 6) + 1) << 6;
  var b = new Array(paddedLen / 4);
  for (i = 0; i < b.length; i++) b[i] = 0;
  for (i = 0; i < n; i++) b[i >> 2] |= (bytes.charCodeAt(i) & 0xff) << (((i % 4) * 8));
  b[n >> 2] |= 0x80 << (((n % 4) * 8));
  b[((paddedLen - 8) >> 2)] = (n * 8) & 0xffffffff;
  b[((paddedLen - 8) >> 2) + 1] = Math.floor(n * 8 / 0x100000000);

  var s = [1732584193, -271733879, -1732584194, 271733878];
  var S = [
    [7, 12, 17, 22], [5, 9, 14, 20], [4, 11, 16, 23], [6, 10, 15, 21]
  ];
  var K = [];
  for (i = 0; i < 64; i++) {
    K.push(Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000));
  }
  function F(x, y, z) { return (x & y) | (~x & z); }
  function G(x, y, z) { return (x & z) | (y & ~z); }
  function H(x, y, z) { return x ^ y ^ z; }
  function I(x, y, z) { return y ^ (x | ~z); }

  for (i = 0; i < b.length / 16; i++) {
    var X = b.slice(i * 16, i * 16 + 16);
    var a = s[0], d = s[3], c = s[2], bl = s[1];
    for (j = 0; j < 64; j++) {
      var f, g;
      if (j < 16) { f = F(bl, c, d); g = j; }
      else if (j < 32) { f = G(bl, c, d); g = (5 * j + 1) % 16; }
      else if (j < 48) { f = H(bl, c, d); g = (3 * j + 5) % 16; }
      else { f = I(bl, c, d); g = (7 * j) % 16; }
      var tmp = add32(add32(add32(a, f), K[j]), X[g]);
      a = d; d = c; c = bl;
      bl = add32(bl, rotl(tmp, S[j >> 4][j % 4]));
    }
    s[0] = add32(s[0], a);
    s[1] = add32(s[1], bl);
    s[2] = add32(s[2], c);
    s[3] = add32(s[3], d);
  }
  return toHex(s[0]) + toHex(s[1]) + toHex(s[2]) + toHex(s[3]);
}

/* ── 工具 ── */
function toQueryString(obj) {
  var parts = [];
  Object.keys(obj).sort().forEach(function (k) { parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(obj[k])); });
  return parts.join('&');
}

function nowTimestamp() {
  var d = new Date();
  var p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

function svgImg(emoji, c1, c2) {
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">'
    + '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
    + '<stop offset="0" stop-color="' + c1 + '"/><stop offset="1" stop-color="' + c2 + '"/>'
    + '</linearGradient></defs>'
    + '<rect width="400" height="400" fill="url(#g)"/>'
    + '<text x="200" y="235" font-size="150" text-anchor="middle">' + emoji + '</text></svg>';
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}

/* ── mock 商品池（无 key 或接口失败时的兜底）── */
var MOCK_POOL = [
  { title: '时透无一郎 刀纹钥匙扣', img: svgImg('🗡️', '#2e7d8f', '#1f4e5c'), price: '29.9', url: 'https://s.taobao.com/search?q=%E6%97%B6%E9%80%8F%E6%97%A0%E4%B8%80%E9%83%8E%20%E9%92%A5%E5%8C%99%E6%89%A3', shop: '梦角周边小铺' },
  { title: '鬼灭之刃 亚克力立牌', img: svgImg('⚔️', '#4a5d7a', '#2c3a52'), price: '39.9', url: 'https://s.taobao.com/search?q=%E9%AC%BC%E7%81%AD%E4%B9%8B%E5%88%83%20%E4%BA%9A%E5%85%8B%E5%8A%9B%E7%AB%8B%E7%89%8C', shop: '动漫周边屋' },
  { title: '星星月亮 锁骨链', img: svgImg('🌙', '#5b4a7a', '#33234d'), price: '29.9', url: 'https://s.taobao.com/search?q=%E6%98%9F%E6%98%9F%20%E7%88%B1%E5%BF%83%20%E9%94%81%E9%AA%A8%E9%93%BE', shop: '星光饰品店' },
  { title: '手作草莓巧克力礼盒', img: svgImg('🍓', '#b25a5a', '#7a3030'), price: '59.9', url: 'https://s.taobao.com/search?q=%E8%8D%89%E8%8E%93%20%E5%B7%A7%E5%85%8B%E5%8A%9B%20%E7%A4%BC%E7%9B%92', shop: '甜心烘焙' },
  { title: '软fufu 猫咪小夜灯', img: svgImg('🐱', '#8a7a5a', '#5a4a30'), price: '35.0', url: 'https://s.taobao.com/search?q=%E7%8C%AB%E5%92%AA%20%E5%B0%8F%E5%A4%9C%E7%81%AF%20%E6%9F%94%E5%85%89', shop: '暖光家居' },
  { title: '手账贴纸包·星空系列', img: svgImg('✨', '#4a5a7a', '#232f4d'), price: '12.9', url: 'https://s.taobao.com/search?q=%E6%89%8B%E8%B4%A6%20%E8%B4%B4%E7%BA%B8%20%E6%98%9F%E7%A9%BA', shop: '手账少女' },
  { title: '棉麻日系托特包', img: svgImg('👜', '#7a6a5a', '#4d4030'), price: '49.9', url: 'https://s.taobao.com/search?q=%E6%97%A5%E7%B3%BB%20%E6%A3%89%E9%BA%BB%20%E6%89%98%E7%89%B9%E5%8C%85', shop: '慢生活杂货' },
  { title: '动漫徽章盲盒·刀剑款', img: svgImg('🎴', '#5a7a4a', '#2f4d23'), price: '19.9', url: 'https://s.taobao.com/search?q=%E6%91%A9%E5%BE%BD%E7%AB%A0%20%E7%9B%B2%E7%9B%92%20%E5%8A%A8%E6%BC%AB', shop: '次元收藏' }
];

function mockItems(q) {
  var pool = MOCK_POOL.slice();
  for (var i = pool.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
  }
  return pool.slice(0, 3).map(function (it) {
    return { title: it.title, img: it.img, price: it.price, url: it.url, shop: it.shop };
  });
}

/* ── 淘宝联盟 API ── */
var GATEWAY = 'https://eco.taobao.com/router/rest';
var METHOD = 'taobao.tbk.dg.material.optional';

function pickByKeyword(pool, q) {
  if (!q) return pool;
  var lower = q.toLowerCase();
  var kwMap = {
    '零食': ['手作草莓巧克力礼盒'],
    '饰品': ['星星月亮 锁骨链'],
    '周边': ['时透无一郎 刀纹钥匙扣', '鬼灭之刃 亚克力立牌', '动漫徽章盲盒·刀剑款'],
    '手办': ['鬼灭之刃 亚克力立牌', '动漫徽章盲盒·刀剑款'],
    '可爱': ['软fufu 猫咪小夜灯', '手账贴纸包·星空系列', '手作草莓巧克力礼盒']
  };
  for (var k in kwMap) {
    if (lower.indexOf(k) !== -1) {
      var hit = pool.filter(function (it) { return kwMap[k].indexOf(it.title) !== -1; });
      if (hit.length) return hit;
    }
  }
  return pool;
}

async function fetchTbk(appKey, secret, adzoneId, q) {
  var params = {
    method: METHOD,
    app_key: appKey,
    timestamp: nowTimestamp(),
    format: 'json',
    v: '2.0',
    sign_method: 'md5',
    adzone_id: String(adzoneId),
    q: q,
    page_size: '10'
  };
  var sortedKeys = Object.keys(params).sort();
  var signStr = sortedKeys.map(function (k) { return k + params[k]; }).join('');
  params.sign = md5(secret + signStr + secret).toUpperCase();

  var resp = await fetch(GATEWAY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: toQueryString(params)
  });
  var text = await resp.text();
  var data = null;
  try { data = JSON.parse(text); } catch (e) { throw new Error('淘宝响应解析失败: ' + text.slice(0, 200)); }

  if (data && data.error_response) {
    throw new Error('淘宝API错误 [' + (data.error_response.sub_code || data.error_response.code) + '] ' + (data.error_response.sub_msg || data.error_response.msg || ''));
  }

  var dtos = (data && data.tbk_dg_material_optional_response
    && data.tbk_dg_material_optional_response.result_list
    && data.tbk_dg_material_optional_response.result_list.nztbk_dtos) || [];
  return dtos.map(function (d) {
    return {
      title: d.title || '商品',
      img: d.pict_url || '',
      price: d.zk_final_price != null ? String(d.zk_final_price) : '',
      url: d.click_url || d.url || 'https://s.taobao.com/search?q=' + encodeURIComponent(q),
      shop: d.shop_title || ''
    };
  });
}

/* ── 入口 ── */
export async function onRequestGet(context) {
  var url = new URL(context.request.url);
  var q = (url.searchParams.get('q') || '').trim().slice(0, 30);
  var cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8'
  };
  var send = function (body, status) {
    return new Response(JSON.stringify(body), { status: status || 200, headers: cors });
  };

  if (!q) return send({ ok: false, error: '缺少关键词参数 q' }, 400);

  var appKey = (context.env && context.env.TAOBAO_APP_KEY) || '';
  var secret = (context.env && context.env.TAOBAO_APP_SECRET) || '';
  var adzoneId = (context.env && context.env.TAOBAO_ADZONE_ID) || '';

  // 未配置真实 key：返回 mock，保证整条流程可用
  if (!appKey || !secret || !adzoneId) {
    return send({ ok: true, mock: true, keyword: q, items: pickByKeyword(mockItems(q), q) });
  }

  try {
    var items = await fetchTbk(appKey, secret, adzoneId, q);
    if (!items.length) return send({ ok: true, items: [], keyword: q });
    return send({ ok: true, mock: false, keyword: q, items: items.slice(0, 3) });
  } catch (e) {
    return send({ ok: true, mock: true, keyword: q, items: pickByKeyword(mockItems(q), q), error: String(e.message || e).slice(0, 160) });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    }
  });
}
