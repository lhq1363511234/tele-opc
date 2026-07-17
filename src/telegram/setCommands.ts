import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config/index.js';
import { logger } from '../logger.js';
import { TELEGRAM_BOT_COMMANDS } from './commands.js';
import { telegramFetch } from './fetch.js';

async function readTelegramJson(response: Awaited<ReturnType<typeof telegramFetch>>, method: string) {
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(`${method} failed with ${response.status}: ${text}`);
  }

  return body as unknown;
}

type TelegramCommandScope =
  | { type: 'default' }
  | { type: 'all_private_chats' }
  | { type: 'all_group_chats' }
  | { type: 'all_chat_administrators' }
  | { type: 'chat'; chat_id: number };

export async function configureTelegramCommandMenu(botToken: string, publicBaseUrl?: string, ownerIds: number[] = []) {
  if (!botToken || botToken === 'change-me') {
    throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  }

  const commandScopes: TelegramCommandScope[] = [
    { type: 'default' },
    { type: 'all_private_chats' },
    ...ownerIds.map((ownerId) => ({ type: 'chat' as const, chat_id: ownerId }))
  ];
  const cleanupScopes: TelegramCommandScope[] = [
    { type: 'all_group_chats' },
    { type: 'all_chat_administrators' }
  ];

  const commandsBody = [];
  for (const scope of cleanupScopes) {
    commandsBody.push(await callTelegramJson(botToken, 'deleteMyCommands', { scope }));
  }
  for (const scope of commandScopes) {
    commandsBody.push(await callTelegramJson(botToken, 'setMyCommands', {
      commands: TELEGRAM_BOT_COMMANDS,
      scope
    }));
  }

  const menuButton = buildMenuButton(publicBaseUrl);
  const menuResponse = await telegramFetch(`https://api.telegram.org/bot${botToken}/setChatMenuButton`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      menu_button: menuButton
    })
  });
  const menuBody = await readTelegramJson(menuResponse, 'setChatMenuButton');
  const ownerMenuBodies = [];
  for (const ownerId of ownerIds) {
    const ownerMenuResponse = await telegramFetch(`https://api.telegram.org/bot${botToken}/setChatMenuButton`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        chat_id: ownerId,
        menu_button: menuButton
      })
    });
    ownerMenuBodies.push(await readTelegramJson(ownerMenuResponse, 'setChatMenuButton(owner)'));
  }

  return {
    commandCount: TELEGRAM_BOT_COMMANDS.length,
    commandsBody,
    menuBody,
    ownerMenuBodies
  };
}

async function main() {
  const config = loadConfig();
  const result = await configureTelegramCommandMenu(config.telegram.botToken, config.app.publicBaseUrl, config.telegram.ownerIds);
  logger.info({ commandCount: result.commandCount }, 'telegram command menu configured');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    logger.error({ error }, 'failed to set telegram command menu');
    process.exitCode = 1;
  });
}

async function callTelegramJson(botToken: string, method: string, body: Record<string, unknown>) {
  const response = await telegramFetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  return readTelegramJson(response, method);
}

function buildMenuButton(publicBaseUrl?: string) {
  if (publicBaseUrl?.startsWith('https://')) {
    return {
      type: 'web_app',
      text: 'Tele-OPC',
      web_app: {
        url: new URL('/app/mini', publicBaseUrl).toString()
      }
    };
  }

  return {
    type: 'commands'
  };
}
