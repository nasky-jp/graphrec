// Node.js Runtime（Edge は setTimeout が使えないため）
const DISCORD_BOT_TOKEN        = process.env.DISCORD_BOT_TOKEN;
const GRAPHREC_CHAT_CHANNEL_ID = process.env.GRAPHREC_CHAT_CHANNEL_ID;
const WEBCHAT_PREFIX           = '[WEBCHAT]';
const REPLY_PREFIX             = '[REPLY]';
const POLL_INTERVAL_MS         = 2500;
const POLL_MAX_ATTEMPTS        = 10;   // 最大25秒（Vercel Node関数は60秒制限）

function makeSessionId() {
  return Math.random().toString(36).slice(2, 10);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Discord send failed: ${res.status} ${err}`);
  }
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

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  if (!DISCORD_BOT_TOKEN || !GRAPHREC_CHAT_CHANNEL_ID) {
    return res.status(500).json({ error: 'Bot not configured' });
  }

  const { message, card } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message is required' });

  const sessionId = makeSessionId();
  const cardContext = card
    ? `タイトル:${card.title} / タグ:${(card.tags || []).join(',')} / 結論:${(card.conclusion || '').slice(0, 100)}`
    : 'カード情報なし';

  const discordContent = `${WEBCHAT_PREFIX}${sessionId}|${cardContext}|${message}`.slice(0, 1900);

  let sentMsg;
  try {
    sentMsg = await sendDiscordMessage(discordContent);
  } catch (err) {
    return res.status(500).json({ error: `Discord送信失敗: ${err.message}` });
  }

  // botの返信をポーリングで待つ
  let reply = null;
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS);
    try {
      const messages = await fetchRecentMessages(sentMsg.id);
      const found = messages.find(m =>
        m.content && m.content.startsWith(`${REPLY_PREFIX}${sessionId}|`)
      );
      if (found) {
        reply = found.content.slice(`${REPLY_PREFIX}${sessionId}|`.length);
        break;
      }
    } catch (err) {
      console.error('poll error:', err.message);
    }
  }

  if (!reply) {
    return res.status(504).json({ error: 'タイムアウト：Botが応答しませんでした（25秒）' });
  }

  return res.status(200).json({ reply });
}
