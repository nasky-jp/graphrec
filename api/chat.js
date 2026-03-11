export const config = { runtime: 'edge' };

const DISCORD_BOT_TOKEN    = process.env.DISCORD_BOT_TOKEN;
const GRAPHREC_CHAT_CHANNEL_ID = process.env.GRAPHREC_CHAT_CHANNEL_ID;
const WEBCHAT_PREFIX       = '[WEBCHAT]';
const REPLY_PREFIX         = '[REPLY]';
const POLL_INTERVAL_MS     = 2000;  // 2秒ごとにポーリング
const POLL_MAX_ATTEMPTS    = 25;    // 最大50秒待つ

function makeSessionId() {
  return Math.random().toString(36).slice(2, 10);
}

async function sendDiscordMessage(content) {
  const res = await fetch(
    `https://discord.com/api/v10/channels/${GRAPHREC_CHAT_CHANNEL_ID}/messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    }
  );
  if (!res.ok) throw new Error(`Discord send failed: ${res.status}`);
  return await res.json();
}

async function fetchRecentMessages(after) {
  const res = await fetch(
    `https://discord.com/api/v10/channels/${GRAPHREC_CHAT_CHANNEL_ID}/messages?after=${after}&limit=10`,
    {
      headers: { 'Authorization': `Bot ${DISCORD_BOT_TOKEN}` },
    }
  );
  if (!res.ok) throw new Error(`Discord fetch failed: ${res.status}`);
  return await res.json();
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  if (!DISCORD_BOT_TOKEN || !GRAPHREC_CHAT_CHANNEL_ID) {
    return new Response(JSON.stringify({ error: 'Bot not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const { message, card } = body;
  if (!message) {
    return new Response(JSON.stringify({ error: 'message is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const sessionId = makeSessionId();

  // カード情報を1行にまとめてDiscordに送る
  const cardContext = card
    ? `タイトル:${card.title} / タグ:${(card.tags || []).join(',')} / 結論:${(card.conclusion || '').slice(0, 100)}`
    : 'カード情報なし';

  // [WEBCHAT]{session_id}|{card_context}|{user_message} 形式で送信
  const discordContent = `${WEBCHAT_PREFIX}${sessionId}|${cardContext}|${message}`;

  let sentMsg;
  try {
    sentMsg = await sendDiscordMessage(discordContent.slice(0, 1900));
  } catch (err) {
    return new Response(JSON.stringify({ error: `Discord送信失敗: ${err.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  // botの返信をポーリングで待つ
  // sentMsg.id より後のメッセージの中から [REPLY]{sessionId}| で始まるものを探す
  let reply = null;
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS);
    try {
      const messages = await fetchRecentMessages(sentMsg.id);
      const found = messages.find(m =>
        m.content.startsWith(`${REPLY_PREFIX}${sessionId}|`)
      );
      if (found) {
        reply = found.content.slice(`${REPLY_PREFIX}${sessionId}|`.length);
        break;
      }
    } catch (err) {
      console.error('poll error:', err);
    }
  }

  if (!reply) {
    return new Response(JSON.stringify({ error: 'タイムアウト：Botが応答しませんでした' }), {
      status: 504,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  return new Response(JSON.stringify({ reply }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
