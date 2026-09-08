'use strict';

const token = process.env.TELEGRAM_BOT_TOKEN || '';
if (!token) {
  console.error('Set TELEGRAM_BOT_TOKEN, send your bot a private message, then run this command again.');
  process.exitCode = 1;
  return;
}

async function main() {
  const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=100&timeout=0`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.description || `Telegram returned ${response.status}`);
  const chats = new Map();
  for (const update of data.result || []) {
    const message = update.message || update.callback_query?.message;
    const from = update.message?.from || update.callback_query?.from;
    if (message?.chat?.type === 'private' && from?.id) {
      chats.set(String(from.id), {
        chatId: String(from.id),
        username: from.username ? `@${from.username}` : '',
        name: [from.first_name, from.last_name].filter(Boolean).join(' ')
      });
    }
  }
  if (!chats.size) {
    console.log('No private chat found. Open the bot in Telegram, send /start, wait a moment, and run this command again.');
    return;
  }
  console.log('Private Telegram accounts found:');
  for (const chat of chats.values()) console.log(`${chat.chatId}  ${chat.username || chat.name}`.trim());
  console.log('\nUse your numeric value as TELEGRAM_OWNER_CHAT_ID.');
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
