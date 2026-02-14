const TelegramBot = require('node-telegram-bot-api');

const token = process.env.BOT_TOKEN;
const siteUrl = (process.env.SITE_URL || '').replace(/\/+$/, '');
const botSecret = process.env.BOT_API_SECRET || '';

if (!token) { console.error('Missing BOT_TOKEN'); process.exit(1); }
if (!siteUrl) { console.error('Missing SITE_URL'); process.exit(1); }
if (!botSecret) { console.error('Missing BOT_API_SECRET'); process.exit(1); }

const bot = new TelegramBot(token, { polling: true });

async function api(path, method = 'GET', body = null) {
  const res = await fetch(siteUrl + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Bot-Secret': botSecret
    },
    body: body ? JSON.stringify(body) : null
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`API ${res.status}: ${text}`);
  return json;
}

bot.onText(/^\/start(?:\s+(.+))?$/i, async (msg, m) => {
  const chatId = msg.chat.id;
  const code = (m[1] || '').trim();

  if (!code) {
    bot.sendMessage(chatId, '✅ Бот работает. Открой ссылку привязки из профиля сайта.');
    return;
  }

  try {
    const r = await api('/api/twofa/bot_bind.php', 'POST', {
      code,
      telegram_id: String(chatId),
      username: msg.from?.username ? String(msg.from.username) : ''
    });

    if (r && r.ok) {
      bot.sendMessage(chatId, '✅ Telegram привязан к аккаунту. Теперь при входе будет приходить запрос на подтверждение.');
    } else {
      bot.sendMessage(chatId, '❌ Не получилось привязать. Сгенерируй новую ссылку в профиле и попробуй ещё раз.');
    }
  } catch (e) {
    bot.sendMessage(chatId, '❌ Ошибка привязки. Проверь сайт/эндпоинт.');
  }
});

bot.on('callback_query', async (q) => {
  const data = String(q.data || '');
  const chatId = q.message?.chat?.id;
  if (!chatId) return;

  const m = data.match(/^2fa:(approve|deny):([A-Za-z0-9_-]{8,128})$/);
  if (!m) return;

  const action = m[1];
  const sessionId = m[2];

  try {
    await api('/api/twofa/bot_action.php', 'POST', {
      action,
      session_id: sessionId,
      telegram_id: String(chatId)
    });

    await bot.answerCallbackQuery(q.id, { text: action === 'approve' ? '✅ Подтверждено' : '❌ Отклонено' });
    try {
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: q.message.message_id });
    } catch {}
  } catch (e) {
    await bot.answerCallbackQuery(q.id, { text: 'Ошибка. Попробуй ещё раз.' });
  }
});

async function tick() {
  try {
    const r = await api('/api/twofa/bot_pull.php', 'GET');
    const items = Array.isArray(r?.items) ? r.items : [];
    for (const it of items) {
      const tid = String(it.telegram_id || '');
      const sid = String(it.session_id || '');
      if (!tid || !sid) continue;

      const text =
        '🔐 Подтверждение входа\n' +
        (it.ip ? `IP: ${it.ip}\n` : '') +
        (it.when ? `Время: ${it.when}\n` : '') +
        '\nПодтвердить вход?';

      await bot.sendMessage(tid, text, {
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Approve', callback_data: `2fa:approve:${sid}` },
            { text: '❌ Deny', callback_data: `2fa:deny:${sid}` }
          ]]
        }
      });

      await api('/api/twofa/bot_ack.php', 'POST', { id: it.id });
    }
  } catch {}
  setTimeout(tick, 2000);
}

tick();
