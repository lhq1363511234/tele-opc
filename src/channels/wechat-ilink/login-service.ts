import type { Repositories } from '../../db/repositories.js';
import { WechatIlinkClient } from './api-client.js';
import { WechatIlinkStore } from './store.js';

export class WechatLoginService {
  constructor(
    private readonly store: WechatIlinkStore,
    private readonly repos: Repositories,
    private readonly client = new WechatIlinkClient()
  ) {}

  async start() {
    const qr = await this.client.createQr();
    const session = await this.store.createLoginSession({
      qrcode: qr.qrcode,
      qrcodeUrl: qr.qrcode_img_content,
      baseUrl: 'https://ilinkai.weixin.qq.com'
    });
    return { sessionId: session.id, qrcodeUrl: session.qrcode_url, expiresAt: session.expires_at, status: session.status };
  }

  async poll(sessionId: string, verifyCode?: string) {
    const session = await this.store.getLoginSession(sessionId);
    if (!session) throw new Error('wechat_login_session_not_found');
    if (new Date(session.expires_at).getTime() <= Date.now()) {
      await this.store.updateLoginSession(sessionId, { status: 'expired' });
      return { status: 'expired', connected: false };
    }
    const status = await this.client.pollQr(session.base_url, this.store.decryptLoginQr(session), verifyCode);
    if (status.status === 'scaned_but_redirect' && status.redirect_host) {
      const baseUrl = `https://${status.redirect_host}`;
      await this.store.updateLoginSession(sessionId, { status: status.status, baseUrl });
      return { status: status.status, connected: false };
    }
    if (status.status !== 'confirmed') {
      await this.store.updateLoginSession(sessionId, { status: status.status });
      return { status: status.status, connected: false, needsVerifyCode: status.status === 'need_verifycode' };
    }
    if (!status.bot_token || !status.ilink_bot_id) throw new Error('wechat_login_confirmed_without_credentials');
    const owner = await this.repos.getPrimaryOwnerConversation([]);
    const account = await this.store.upsertAccount({
      botId: status.ilink_bot_id,
      ownerUserId: owner?.userId,
      scannerUserId: status.ilink_user_id,
      token: status.bot_token,
      baseUrl: status.baseurl ?? session.base_url
    });
    await this.store.updateLoginSession(sessionId, { status: 'confirmed', metadata: { accountId: account.id } });
    return { status: 'confirmed', connected: true, accountId: account.id, botId: account.bot_id };
  }
}
