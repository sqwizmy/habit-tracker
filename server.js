// Node.js 18+
// Установка: npm install
// Запуск: BOT_TOKEN="токен_бота" npm start
// Бот должен быть администратором канала @focus_iron.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL = '@focus_iron';
const HTML = path.join(__dirname, 'index.html');

if (!BOT_TOKEN) {
  throw new Error('Укажи BOT_TOKEN в переменных окружения');
}

function verifyInitData(initData) {
  if (typeof initData !== 'string' || !initData || initData.length > 20000) {
    return null;
  }

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

  if (
    !Number.isFinite(authDate) ||
    Math.abs(Date.now() / 1000 - authDate) > 86400
  ) {
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

async function isSubscribed(userId) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHANNEL,
      user_id: userId
    }),
    signal: AbortSignal.timeout(8000)
  });

  if (!response.ok) {
    throw new Error(`Telegram API HTTP ${response.status}`);
  }

  const data = await response.json();

  if (!data.ok || !data.result) {
    throw new Error(data.description || 'Telegram membership check failed');
  }

  const member = data.result;

  return (
    member.status === 'creator' ||
    member.status === 'administrator' ||
    member.status === 'member' ||
    (member.status === 'restricted' && member.is_member === true)
  );
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (req.method === 'POST' && req.url === '/api/access') {
    let body = '';

    req.on('data', chunk => {
      body += chunk;

      if (body.length > 30000) {
        req.destroy();
      }
    });

    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const user = verifyInitData(payload.initData);

        if (!user) {
          res.writeHead(401, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store'
          });

          return res.end(JSON.stringify({
            ok: false,
            error: 'invalid_telegram_init_data'
          }));
        }

        const subscribed = await isSubscribed(user.id);

        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store'
        });

        res.end(JSON.stringify({
          ok: true,
          subscribed
        }));
      } catch (error) {
        console.error('Access check error:', error.message);

        res.writeHead(503, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store'
        });

        res.end(JSON.stringify({
          ok: false,
          error: 'membership_check_unavailable'
        }));
      }
    });

    return;
  }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store'
    });

    return fs.createReadStream(HTML).pipe(res);
  }

  res.writeHead(404, {
    'content-type': 'text/plain; charset=utf-8'
  });

  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Habit tracker listening on ${PORT}`);
});
