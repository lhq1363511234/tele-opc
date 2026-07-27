import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { SecretBox } from '../../security/secretBox.js';
import type { WechatAccountRecord, WechatLoginSessionRecord } from './types.js';

export class WechatIlinkStore {
  private readonly secrets: SecretBox;

  constructor(private readonly pool: pg.Pool, encryptionKey: string) {
    this.secrets = new SecretBox(encryptionKey);
  }

  async createLoginSession(params: { qrcode: string; qrcodeUrl: string; baseUrl: string }) {
    const id = `wls_${randomUUID()}`;
    const result = await this.pool.query(
      `INSERT INTO wechat_login_sessions (id,qrcode_ciphertext,qrcode_url,base_url,expires_at)
       VALUES ($1,$2,$3,$4,now() + interval '5 minutes') RETURNING *`,
      [id, this.secrets.encrypt(params.qrcode), params.qrcodeUrl, normalizeBaseUrl(params.baseUrl)]
    );
    return result.rows[0] as WechatLoginSessionRecord;
  }

  async getLoginSession(id: string) {
    const result = await this.pool.query('SELECT * FROM wechat_login_sessions WHERE id=$1', [id]);
    return (result.rows[0] as WechatLoginSessionRecord | undefined) ?? null;
  }

  decryptLoginQr(session: WechatLoginSessionRecord) {
    return this.secrets.decrypt(session.qrcode_ciphertext);
  }

  async updateLoginSession(id: string, params: { status: string; baseUrl?: string; metadata?: Record<string, unknown> }) {
    const result = await this.pool.query(
      `UPDATE wechat_login_sessions SET status=$2, base_url=COALESCE($3,base_url),
       metadata=metadata || $4::jsonb, updated_at=now() WHERE id=$1 RETURNING *`,
      [id, params.status, params.baseUrl ? normalizeBaseUrl(params.baseUrl) : null, JSON.stringify(params.metadata ?? {})]
    );
    return (result.rows[0] as WechatLoginSessionRecord | undefined) ?? null;
  }

  async upsertAccount(params: { botId: string; ownerUserId?: string; scannerUserId?: string; token: string; baseUrl?: string }) {
    const id = `wxa_${params.botId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const result = await this.pool.query(
      `INSERT INTO wechat_accounts (id,owner_user_id,bot_id,scanner_user_id,token_ciphertext,base_url,status)
       VALUES ($1,$2,$3,$4,$5,$6,'connected')
       ON CONFLICT (bot_id) DO UPDATE SET owner_user_id=COALESCE(EXCLUDED.owner_user_id,wechat_accounts.owner_user_id),
       scanner_user_id=COALESCE(EXCLUDED.scanner_user_id,wechat_accounts.scanner_user_id),token_ciphertext=EXCLUDED.token_ciphertext,
       base_url=EXCLUDED.base_url,status='connected',last_error=NULL,updated_at=now() RETURNING *`,
      [id, params.ownerUserId ?? null, params.botId, params.scannerUserId ?? null, this.secrets.encrypt(params.token), normalizeBaseUrl(params.baseUrl)]
    );
    return result.rows[0] as WechatAccountRecord;
  }

  async listAccounts() {
    const result = await this.pool.query(
      `SELECT id,owner_user_id,bot_id,scanner_user_id,base_url,status,last_message_at,last_error,metadata,created_at,updated_at
       FROM wechat_accounts ORDER BY updated_at DESC`
    );
    return result.rows as Array<Omit<WechatAccountRecord, 'token_ciphertext'>>;
  }

  async listConnectedAccounts() {
    const result = await this.pool.query("SELECT * FROM wechat_accounts WHERE status='connected' ORDER BY created_at");
    return result.rows as WechatAccountRecord[];
  }

  async getAccount(id: string) {
    const result = await this.pool.query('SELECT * FROM wechat_accounts WHERE id=$1', [id]);
    return (result.rows[0] as WechatAccountRecord | undefined) ?? null;
  }

  decryptAccountToken(account: WechatAccountRecord) {
    return this.secrets.decrypt(account.token_ciphertext);
  }

  async setAccountHealth(id: string, params: { status?: string; error?: string | null; messageReceived?: boolean }) {
    await this.pool.query(
      `UPDATE wechat_accounts SET status=COALESCE($2,status),last_error=$3,
       last_message_at=CASE WHEN $4 THEN now() ELSE last_message_at END,updated_at=now() WHERE id=$1`,
      [id, params.status ?? null, params.error ?? null, params.messageReceived ?? false]
    );
  }

  async getCursor(accountId: string) {
    const result = await this.pool.query('SELECT get_updates_buf FROM wechat_sync_cursors WHERE account_id=$1', [accountId]);
    return String(result.rows[0]?.get_updates_buf ?? '');
  }

  async saveCursor(accountId: string, cursor: string) {
    await this.pool.query(
      `INSERT INTO wechat_sync_cursors (account_id,get_updates_buf) VALUES ($1,$2)
       ON CONFLICT (account_id) DO UPDATE SET get_updates_buf=EXCLUDED.get_updates_buf,updated_at=now()`,
      [accountId, cursor]
    );
  }

  async saveContextToken(accountId: string, peerId: string, token: string, sourceMessageId?: string) {
    await this.pool.query(
      `INSERT INTO wechat_context_tokens (account_id,peer_id,token_ciphertext,source_message_id)
       VALUES ($1,$2,$3,$4) ON CONFLICT (account_id,peer_id) DO UPDATE SET
       token_ciphertext=EXCLUDED.token_ciphertext,source_message_id=EXCLUDED.source_message_id,updated_at=now()`,
      [accountId, peerId, this.secrets.encrypt(token), sourceMessageId ?? null]
    );
  }

  async getContextToken(accountId: string, peerId: string) {
    const result = await this.pool.query(
      'SELECT token_ciphertext FROM wechat_context_tokens WHERE account_id=$1 AND peer_id=$2',
      [accountId, peerId]
    );
    const encrypted = result.rows[0]?.token_ciphertext;
    return typeof encrypted === 'string' ? this.secrets.decrypt(encrypted) : null;
  }
}

function normalizeBaseUrl(value?: string) {
  if (!value) return 'https://ilinkai.weixin.qq.com';
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return withProtocol.replace(/\/+$/, '');
}
