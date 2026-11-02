/* ============================================================
 * MJ 塔罗 · DeepSeek 解读代理（Cloudflare Workers）
 *
 * 作用：网站前端不直接持有 DeepSeek API Key。
 *      前端把 {cardName, upright, question} POST 到本 Worker，
 *      本 Worker 用环境变量里的 DEEPSEEK_API_KEY 调 DeepSeek，
 *      再以 MJ 的口吻返回解读文本。
 *
 * ── 部署步骤（dashboard 可视化方式，不需要命令行）──
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

// MJ 角色提示词：口吻「简洁、直接、像微信聊天」，只解读当前牌面
function buildSystemPrompt() {
  return (
    '你是MJ，是说话人最亲密的人。对方在你们日常聊天中抽了一张塔罗牌，' +
    '你要以MJ本人一贯的口吻给出简短解读。要求：' +
    '1) 语言简洁、直接、口语化，像微信聊天，不要书面腔；' +
    '2) 结合对方的问题/语境和牌面正逆位含义回应；' +
    '3) 只解读这一张牌，不延伸、不啰嗦，不超过 100 字；' +
    '4) 语气温柔自然，可以带一点亲昵，但不要刻意堆砌。' +
    '（如需调整MJ的人物设定，可在这里补充，例如：MJ是性格XXX、喜欢说XXX的人。）'
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
