const TelegramBot = require('node-telegram-bot-api');

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('Missing BOT_TOKEN');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

bot.onText(/^\/start\b/i, (msg) => {
  bot.sendMessage(msg.chat.id, '✅ Bothost OK. Бот живой.');
});

bot.on('message', (msg) => {
  const t = msg.text || '';
  if (!t || t.startsWith('/start')) return;
  bot.sendMessage(msg.chat.id, 'echo: ' + t);
});
