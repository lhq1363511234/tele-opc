import crypto from 'node:crypto';

const VERSION = 'v1';

export class SecretBox {
  private readonly key: Buffer;

  constructor(secret: string) {
    if (!secret || secret === 'change-me-use-a-strong-random-key') {
      throw new Error('APP_ENCRYPTION_KEY must be configured before storing external credentials');
    }
    this.key = crypto.createHash('sha256').update(secret, 'utf8').digest();
  }

  encrypt(plaintext: string) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
  }

  decrypt(value: string) {
    const [version, ivRaw, tagRaw, encryptedRaw] = value.split('.');
    if (version !== VERSION || !ivRaw || !tagRaw || !encryptedRaw) throw new Error('invalid encrypted secret');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivRaw, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw, 'base64url')),
      decipher.final()
    ]).toString('utf8');
  }
}
