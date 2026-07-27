import crypto from 'node:crypto';
import { fetch } from 'undici';
import type { WechatMessage } from './types.js';

const CHANNEL_VERSION = '0.1.0';
const ILINK_APP_ID = 'bot';
const ILINK_APP_CLIENT_VERSION = String((2 << 16) | (4 << 8) | 6);

export interface QrStatusResponse {
  status: 'wait' | 'scaned' | 'confirmed' | 'expired' | 'scaned_but_redirect' | 'need_verifycode' | 'verify_code_blocked' | 'binded_redirect';
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
  redirect_host?: string;
}

export class WechatIlinkClient {
  constructor(private readonly defaultBaseUrl = 'https://ilinkai.weixin.qq.com') {}

  async createQr(botType = '3') {
    return await this.post<{ qrcode: string; qrcode_img_content: string }>(
      this.defaultBaseUrl,
      `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
      { local_token_list: [] },
      undefined,
      15_000
    );
  }

  async pollQr(baseUrl: string, qrcode: string, verifyCode?: string) {
    let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
    if (verifyCode) endpoint += `&verify_code=${encodeURIComponent(verifyCode)}`;
    return await this.get<QrStatusResponse>(baseUrl, endpoint, 35_000);
  }

  async getUpdates(params: { baseUrl: string; token: string; cursor: string; signal?: AbortSignal }) {
    return await this.post<{
      ret?: number;
      errcode?: number;
      errmsg?: string;
      msgs?: WechatMessage[];
      get_updates_buf?: string;
      longpolling_timeout_ms?: number;
    }>(params.baseUrl, 'ilink/bot/getupdates', {
      get_updates_buf: params.cursor,
      base_info: this.baseInfo()
    }, params.token, 40_000, params.signal);
  }

  async sendText(params: { baseUrl: string; token: string; to: string; contextToken: string; text: string; clientId?: string }) {
    const clientId = params.clientId ?? `tele-opc-${crypto.randomUUID()}`;
    const result = await this.post<{ ret?: number; errmsg?: string }>(params.baseUrl, 'ilink/bot/sendmessage', {
      msg: {
        from_user_id: '',
        to_user_id: params.to,
        client_id: clientId,
        message_type: 2,
        message_state: 2,
        item_list: [{ type: 1, text_item: { text: params.text } }],
        context_token: params.contextToken
      },
      base_info: this.baseInfo()
    }, params.token, 15_000);
    if (result.ret && result.ret !== 0) throw new Error(`wechat_send_failed:${result.ret}:${result.errmsg ?? 'unknown'}`);
    return { messageId: clientId };
  }

  async notifyStart(baseUrl: string, token: string) {
    return await this.post(baseUrl, 'ilink/bot/msg/notifystart', { base_info: this.baseInfo() }, token, 10_000);
  }

  async notifyStop(baseUrl: string, token: string) {
    return await this.post(baseUrl, 'ilink/bot/msg/notifystop', { base_info: this.baseInfo() }, token, 10_000);
  }

  private baseInfo() {
    return { channel_version: CHANNEL_VERSION, bot_agent: 'Tele-OPC/0.1.0' };
  }

  private commonHeaders() {
    return { 'iLink-App-Id': ILINK_APP_ID, 'iLink-App-ClientVersion': ILINK_APP_CLIENT_VERSION };
  }

  private headers(token?: string) {
    return {
      'content-type': 'application/json',
      AuthorizationType: 'ilink_bot_token',
      'X-WECHAT-UIN': Buffer.from(String(crypto.randomBytes(4).readUInt32BE(0))).toString('base64'),
      ...this.commonHeaders(),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    };
  }

  private async get<T>(baseUrl: string, endpoint: string, timeoutMs: number): Promise<T> {
    const response = await fetch(new URL(endpoint, ensureSlash(baseUrl)), {
      method: 'GET', headers: this.commonHeaders(), signal: AbortSignal.timeout(timeoutMs)
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`wechat_http_${response.status}`);
    return JSON.parse(text) as T;
  }

  private async post<T = Record<string, unknown>>(
    baseUrl: string,
    endpoint: string,
    body: Record<string, unknown>,
    token?: string,
    timeoutMs = 15_000,
    externalSignal?: AbortSignal
  ): Promise<T> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = externalSignal ? AbortSignal.any([timeout, externalSignal]) : timeout;
    const response = await fetch(new URL(endpoint, ensureSlash(baseUrl)), {
      method: 'POST', headers: this.headers(token), body: JSON.stringify(body), signal
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`wechat_http_${response.status}`);
    return JSON.parse(text) as T;
  }
}

function ensureSlash(value: string) {
  return value.endsWith('/') ? value : `${value}/`;
}
