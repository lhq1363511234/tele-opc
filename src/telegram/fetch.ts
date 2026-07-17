import { fetch as undiciFetch, ProxyAgent, type Dispatcher } from 'undici';

let proxyAgent: Dispatcher | undefined;
let proxyAgentUrl: string | undefined;

type TelegramFetchInit = Parameters<typeof undiciFetch>[1];

function getTelegramProxyAgent() {
  const proxyUrl = process.env.TELEGRAM_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
  if (!proxyUrl) {
    return undefined;
  }

  if (!proxyAgent || proxyAgentUrl !== proxyUrl) {
    proxyAgent = new ProxyAgent(proxyUrl);
    proxyAgentUrl = proxyUrl;
  }

  return proxyAgent;
}

export function telegramFetch(input: string | URL, init: TelegramFetchInit = {}) {
  const dispatcher = getTelegramProxyAgent();
  if (!dispatcher) {
    return undiciFetch(input, init);
  }

  return undiciFetch(input, { ...init, dispatcher });
}
