'use strict';

const token = process.env.TELEGRAM_BOT_TOKEN || '';
const secret = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const siteUrl = (process.env.TELEGRAM_WEBHOOK_URL || process.env.PUBLIC_SITE_URL || '').replace(/\/+$/, '');

if (!token || !secret || !siteUrl) {
  console.error('Set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, and TELEGRAM_WEBHOOK_URL (or PUBLIC_SITE_URL).');
  process.exitCode = 1;
  return;
}
if (!/^[A-Za-z0-9_-]{16,256}$/.test(secret)) {
  console.error('TELEGRAM_WEBHOOK_SECRET must be 16-256 characters using only letters, numbers, underscores, and hyphens.');
  process.exitCode = 1;
  return;
}
if (!siteUrl.startsWith('https://')) {
  console.error('The Telegram webhook URL must use HTTPS.');
  process.exitCode = 1;
  return;
}

async function telegram(method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(`${method} failed: ${data.description || response.status}`);
  return data.result;
}

async function main() {
  const webhookUrl = `${siteUrl}/api/telegram/webhook`;
  const me = await telegram('getMe', {});
  await telegram('setMyCommands', {
    commands: [
      { command: 'newlisting', description: 'Create and publish a listing' },
      { command: 'editlisting', description: 'Edit an existing listing' },
      { command: 'addprogress', description: 'Add a construction progress photo' },
      { command: 'deletelisting', description: 'Delete a listing' },
      { command: 'mylistings', description: 'Show live listings' },
      { command: 'cancel', description: 'Cancel the current conversation' },
      { command: 'help', description: 'Show available commands' }
    ]
  });
  await telegram('setWebhook', {
    url: webhookUrl,
    secret_token: secret,
    allowed_updates: ['message', 'callback_query'],
    max_connections: 1,
    drop_pending_updates: false
  });
  console.log(`Telegram bot @${me.username} is connected to ${webhookUrl}`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
