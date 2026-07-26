export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: unknown
  ) {
    super(message);
  }
}

export function getTelegramInitData() {
  return (window as any).Telegram?.WebApp?.initData ?? '';
}

export function getWebConsoleDevToken() {
  const tokenFromUrl = new URLSearchParams(window.location.search).get('dev_token')?.trim() ?? '';
  if (tokenFromUrl) {
    window.localStorage.setItem('teleOpcDevToken', tokenFromUrl);
    return tokenFromUrl;
  }
  return window.localStorage.getItem('teleOpcDevToken')?.trim() ?? '';
}

export function setWebConsoleDevToken(token: string) {
  const value = token.trim();
  if (value) {
    window.localStorage.setItem('teleOpcDevToken', value);
  } else {
    window.localStorage.removeItem('teleOpcDevToken');
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>(path);
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: 'PUT',
    body: JSON.stringify(body)
  });
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: 'PATCH',
    body: JSON.stringify(body)
  });
}

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const telegramInitData = getTelegramInitData();
  const devToken = getWebConsoleDevToken();
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(telegramInitData ? { 'X-Telegram-Init-Data': telegramInitData } : {}),
      ...(devToken ? { 'X-Tele-OPC-Dev-Token': devToken } : {}),
      ...(init.headers ?? {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(errorMessage(payload, response.statusText), response.status, payload);
  }
  return payload as T;
}

function errorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string') {
    return payload.message;
  }
  if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') {
    return payload.error;
  }
  return fallback || 'Request failed';
}
