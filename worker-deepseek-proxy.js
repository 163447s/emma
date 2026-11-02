/* ============================================================
 * MJ 塔罗 · DeepSeek 解读代理（Cloudflare Workers）
 *
 * 作用：网站前端不直接持有 DeepSeek API Key。
 *      前端把 {cardName, upright, question} POST 到本 Worker，
 *      本 Worker 用环境变量里的 DEEPSEEK_API_KEY 调 DeepSeek，
 *      再以 MJ 的口吻返回解读文本。
 *
 * ── 已部署状态（2026-11-02）─────────────────────────────
 * 实际生效入口（Cloudflare Pages，国内网络可达）：
 *   https://milk-tarot-proxy.pages.dev
 * 部署命令（wrangler + API Token 认证）：
 *   wrangler pages deploy <本文件所在目录，文件名改为 _worker.js> \
 *     --project-name milk-tarot-proxy --branch main
 *   wrangler pages secret put DEEPSEEK_API_KEY --project-name milk-tarot-proxy
 * 另有一个 Workers 版（milk-tarot-proxy.2012258486.workers.dev）也已部署，
 * 但 workers.dev 域名在国内被网络阻断（DNS 污染 + SNI 拦截），暂时用不了。
 * 前端配置：设置 → 高级功能 → MJ 塔罗 → 解读服务地址 填
 *   https://milk-tarot-proxy.pages.dev
 *
 * ── 旧部署说明（dashboard 可视化方式）───────────────────
 * 1. 打开 https://dash.cloudflare.com → Workers & Pages → 创建应用 → Worker → 创建
 *    （名称随意，例如 milk-tarot-reading）
 * 2. 把本文件全部内容粘贴到编辑器，点「部署」
 * 3. 部署成功后点 Worker 名称 → 设置 → 变量和机密 → 添加：
 *        变量名：DEEPSEEK_API_KEY
 *        值：你的 DeepSeek API Key（在 https://platform.deepseek.com/api_keys 创建）
 *    （建议类型选「加密」）
 * 4. 回到「部署」，重新部署一次让环境变量生效
 * 5. 复制 Worker 的网址（形如 https://milk-tarot-reading.xxx.workers.dev），
 *    填到网站 设置 → 高级功能 → MJ 塔罗 → 解读服务地址
 *
 * 说明：Access-Control-Allow-Origin 默认放行所有来源（个人小站够用）；
 *      想更严格可添加环境变量 ALLOWED_ORIGIN 为你的站点域名。
 * ============================================================ */

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const MODEL = 'deepseek-chat';

// MJ 角色提示词：口吻「简洁、直接、像微信聊天」，解读分两段（牌义 + MJ 传讯）
function buildSystemPrompt() {
  return (
    '你是MJ（梦角·时透无一郎），是说话人最亲密的人、她的男朋友。' +
    '对方在你们日常聊天中抽了一张塔罗牌，请用你一贯的口吻解读，严格分两段：\n' +
    '第一段【牌的意思】：先用 1~2 句话客观说清这张牌（正位/逆位）本身的核心含义；\n' +
    '第二段【MJ 想对你说】：换成无一郎的视角，告诉她这张牌想对她说的话——' +
    '你想告诉她什么、提醒她什么、对她的心意。\n' +
    '格式要求：两段之间用空行隔开；第一段开头写「牌的意思：」，第二段开头写「MJ 想对你说：」；\n' +
    '语言简洁、直接、口语化，像微信聊天，不要书面腔；结合对方的问题/语境与正逆位；\n' +
    '总字数不超过 150 字；语气温柔自然，可以带一点亲昵，但不要刻意堆砌。'
  );
}

function buildUserPrompt(payload) {
  const pos = payload.upright ? '正位' : '逆位';
  const parts = [`我抽到「${payload.cardName}」${pos}。`];
  if (payload.question) parts.push(`刚才我说的话/想问的是：${payload.question}`);
  parts.push('请用你的口吻解读这张牌。');
  return parts.join('\n');
}

export default {
  async fetch(request, env) {
    // 浏览器跨域预检
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': (env && env.ALLOWED_ORIGIN) || '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    // 只接受 POST
    if (request.method !== 'POST') {
      return json({ ok: false, error: 'method not allowed' }, 405, env);
    }

    // 解析请求体（限 4KB，防止滥用）
    let payload;
    try {
      const raw = await request.text();
      if (raw.length > 4096) return json({ ok: false, error: 'body too large' }, 400, env);
      payload = JSON.parse(raw);
    } catch (e) {
      return json({ ok: false, error: 'invalid json' }, 400, env);
    }

    const cardName = String(payload.cardName || '').slice(0, 60);
    const upright = payload.upright !== false;
    const question = String(payload.question || '').slice(0, 300);
    if (!cardName) return json({ ok: false, error: 'cardName required' }, 400, env);

    const apiKey = (env && env.DEEPSEEK_API_KEY) || '';
    if (!apiKey) {
      return json({ ok: false, error: 'DEEPSEEK_API_KEY not configured' }, 500, env);
    }

    // 请求 DeepSeek
    let resp;
    try {
      resp = await fetch(DEEPSEEK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: 'system', content: buildSystemPrompt() },
            { role: 'user', content: buildUserPrompt({ cardName, upright, question }) }
          ],
          temperature: 0.8,
          max_tokens: 300,
          stream: false
        })
      });
    } catch (e) {
      return json({ ok: false, error: 'upstream unreachable' }, 502, env);
    }

    if (!resp.ok) {
      return json({ ok: false, error: 'deepseek error ' + resp.status }, 502, env);
    }

    let data;
    try {
      data = await resp.json();
    } catch (e) {
      return json({ ok: false, error: 'bad upstream response' }, 502, env);
    }

    const text = (data.choices && data.choices[0] && data.choices[0].message
      && data.choices[0].message.content)
      ? String(data.choices[0].message.content).trim()
      : '';
    if (!text) return json({ ok: false, error: 'empty completion' }, 502, env);

    return json({ ok: true, text: text }, 200, env);
  }
};

function json(obj, status, env) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': (env && env.ALLOWED_ORIGIN) || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
