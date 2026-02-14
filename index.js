const TelegramBot = require('node-telegram-bot-api');
const https = require('https');
const http = require('http');

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const SITE_URL = (process.env.SITE_URL || '').replace(/\/+$/, '');
const BOT_API_SECRET = process.env.BOT_API_SECRET || '';

if (!BOT_TOKEN) throw new Error('ENV BOT_TOKEN is empty');
if (!SITE_URL) throw new Error('ENV SITE_URL is empty');
if (!BOT_API_SECRET) throw new Error('ENV BOT_API_SECRET is empty');

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

function reqJson(method, urlStr, bodyObj) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;

    const body = bodyObj ? Buffer.from(JSON.stringify(bodyObj), 'utf8') : null;

    const opts = {
      method,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + (u.search || ''),
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Bot-Secret': BOT_API_SECRET,
      },
    };

    if (body) opts.headers['Content-Length'] = String(body.length);

    const r = lib.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const j = data ? JSON.parse(data) : {};
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) return resolve(j);
          return reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        } catch (e) {
          return reject(new Error(`Bad JSON: ${data}`));
        }
      });
    });

    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

function api(path) {
  return SITE_URL + path;
}

async function bindByCode(chatId, tgUser, code) {
  const payload = {
    code,
    telegramId: String(chatId),
    username: tgUser?.username || '',
    firstName: tgUser?.first_name || '',
  };
  return reqJson('POST', api('/api/twofa/bot_bind.php'), payload);
}

async function markQueue(id, status, errorText) {
  return reqJson('POST', api('/api/twofa/bot_mark.php'), {
    id,
    status,
    errorText: errorText || null,
  });
}

async function setSession(sessionId, action) {
  return reqJson('POST', api('/api/twofa/bot_session.php'), {
    sessionId,
    action,
  });
}

function buildKeyboard(sessionId) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Подтвердить', callback_data: `2fa:approve:${sessionId}` },
        { text: '❌ Отклонить', callback_data: `2fa:deny:${sessionId}` },
      ],
    ],
  };
}

async function processQueueItem(item) {
  const chatId = item.telegram_id;
  const sessionId = item.session_id;

  const text =
    `🔐 Sakura Client — подтверждение входа\n\n` +
    `Аккаунт: ${item.username}\n` +
    `Сессия: ${sessionId}\n\n` +
    `Если это ты — нажми ✅ Подтвердить. Если нет — ❌ Отклонить.`;

  try {
    await bot.sendMessage(chatId, text, {
      reply_markup: buildKeyboard(sessionId),
      disable_web_page_preview: true,
    });
    await markQueue(item.id, 'sent', null);
  } catch (e) {
    await markQueue(item.id, 'error', String(e && e.message ? e.message : e));
  }
}

let pollingBusy = false;

async function pollQueue() {
  if (pollingBusy) return;
  pollingBusy = true;
  try {
    const data = await reqJson('GET', api('/api/twofa/bot_pull.php?limit=10'), null);
    const items = Array.isArray(data.items) ? data.items : [];
    for (const item of items) {
      if (!item || !item.id) continue;
      await processQueueItem(item);
    }
  } catch (e) {
    // молча, чтобы не спамить логи
  } finally {
    pollingBusy = false;
  }
}

bot.onText(/^\/start(?:\s+([A-Za-z0-9_-]{8,80}))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const code = (match && match[1]) ? String(match[1]).trim() : '';

  if (!code) {
    return bot.sendMessage(chatId, '✅ Bothost OK. Бот живой.\n\nПришли /start <код> из сайта, чтобы привязать 2FA.');
  }

  try {
    const r = await bindByCode(chatId, msg.from, code);
    if (r && r.ok) {
      return bot.sendMessage(chatId, '✅ Привязка успешна. Теперь включи 2FA в профиле на сайте.');
    }
    return bot.sendMessage(chatId, '❌ Не получилось привязать. Проверь, что код ещё не истёк и правильный.');
  } catch (e) {
    return bot.sendMessage(chatId, '❌ Ошибка привязки: ' + (e && e.message ? e.message : String(e)));
  }
});

bot.on('callback_query', async (cq) => {
  const data = String(cq.data || '');
  const m = data.match(/^2fa:(approve|deny):([a-f0-9]{32,64})$/i);
  if (!m) {
    try { await bot.answerCallbackQuery(cq.id, { text: 'Неизвестное действие' }); } catch {}
    return;
  }

  const action = m[1].toLowerCase();
  const sessionId = m[2];

  try {
    const r = await setSession(sessionId, action);
    if (r && r.ok) {
      const msgText = action === 'approve'
        ? '✅ Вход подтверждён.'
        : '❌ Вход отклонён.';

      try { await bot.answerCallbackQuery(cq.id, { text: msgText, show_alert: false }); } catch {}
      try {
        await bot.editMessageText(msgText, {
          chat_id: cq.message.chat.id,
          message_id: cq.message.message_id,
        });
      } catch {}
      return;
    }
    try { await bot.answerCallbackQuery(cq.id, { text: 'Ошибка сайта', show_alert: true }); } catch {}
  } catch (e) {
    try { await bot.answerCallbackQuery(cq.id, { text: 'Ошибка: ' + (e && e.message ? e.message : String(e)), show_alert: true }); } catch {}
  }
});

// запуск очереди
setInterval(pollQueue, 2500);

// стартовый пинг
bot.sendMessage(process.env.ADMIN_CHAT_ID ? Number(process.env.ADMIN_CHAT_ID) : undefined, '').catch(() => {});
console.log('Bot started. Polling + queue enabled.');
