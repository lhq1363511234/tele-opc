import { loadConfig } from '../config/index.js';
import { logger } from '../logger.js';
import { telegramFetch } from './fetch.js';
import { configureTelegramCommandMenu } from './setCommands.js';

async function main() {
  const config = loadConfig();
  const { botToken, webhookSecret } = config.telegram;
  if (!botToken || botToken === 'change-me') {
    throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  }

  const webhookPath = webhookSecret ? `/telegram/webhook/${webhookSecret}` : '/telegram/webhook';
  const webhookUrl = new URL(webhookPath, config.app.publicBaseUrl).toString();
  const response = await telegramFetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      url: webhookUrl,
      allowed_updates: ['message', 'edited_message', 'callback_query'],
      drop_pending_updates: false
    })
  });

  const body = await response.json();
  const commandMenu = await configureTelegramCommandMenu(botToken, config.app.publicBaseUrl, config.telegram.ownerIds);
  logger.info({ webhookUrl, body, commandCount: commandMenu.commandCount }, 'telegram webhook and command menu configured');
}

main().catch((error) => {
  logger.error({ error }, 'failed to set telegram webhook');
  process.exitCode = 1;
});
