// server.js
// Node.js 18+
// Бот должен быть администратором канала @focus_iron.
// Запуск: BOT_TOKEN="ТОКЕН_БОТА" node server.js

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL = '@focus_iron';
const HTML_FILE = path.join(__dirname, 'index.html');

if (!BOT_TOKEN) {
  throw new Error('Не задан BOT_TOKEN');
}

// Проверка подлинности данных Telegram Mini App
function verifyTelegramData(initData) {
  if (typeof initData !== 'string' || !initData) return null;

  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');

  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) {
    return null;
  }

  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  // Правильный алгоритм проверки Telegram WebApp initData
  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(BOT_TOKEN)
    .digest();

  const calculatedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest();

  const suppliedHash = Buffer.from(receivedHash, 'hex');

  if (
    suppliedHash.length !== calculatedHash.length ||
    !crypto.timingSafeEqual(suppliedHash, calculatedHash)
  ) {
    return null;
  }

  const authDate = Number(params.get('auth_date'));
  const now = Math.floor(Date.now() / 1000);

  if (!Number.isFinite(authDate) || now - authDate > 86400 || authDate > now + 60) {
    return null;
  }

  try {
    const user = JSON.parse(params.get('user') || 'null');

    if (!user || !Number.isSafeInteger(user.id)) {
      return null;
    }

    return user;
  } catch {
    return null;
  }
}

// Проверка подписки через Telegram Bot API
async function checkSubscription(userId) {
  const response = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHANNEL,
        user_id: userId
      }),
      signal: AbortSignal.timeout(10000)
    }
  );

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error(result.description || 'Ошибка Telegram API');
  }

  const member = result.result;

  return (
    member.status === 'creator' ||
    member.status === 'administrator' ||
    member.status === 'member' ||
    (member.status === 'restricted' && member.is_member === true)
  );
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });

  res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/access') {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();

      if (body.length > 30000) {
        req.destroy();
      }
    });

    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const user = verifyTelegramData(payload.initData);

        if (!user) {
          return sendJson(res, 401, {
            ok: false,
            subscribed: false,
            error: 'INVALID_TELEGRAM_DATA'
          });
        }

        const subscribed = await checkSubscription(user.id);

        return sendJson(res, 200, {
          ok: true,
          subscribed
        });

      } catch (error) {
        console.error('Ошибка проверки подписки:', error.message);

        return sendJson(res, 503, {
          ok: false,
          subscribed: false,
          error: 'SUBSCRIPTION_CHECK_FAILED'
        });
      }
    });

    return;
  }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    });

    return fs.createReadStream(HTML_FILE).pipe(res);
  }

  if (req.method === 'GET' && req.url === '/health') {
    return sendJson(res, 200, { ok: true });
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server started on port ${PORT}`);
});
