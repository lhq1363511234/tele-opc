import { describe, expect, it } from 'vitest';
import { SecretBox } from '../src/security/secretBox.js';

 describe('WeChat iLink credential protection', () => {
  it('encrypts with authenticated encryption and round-trips', () => {
    const box = new SecretBox('a-strong-test-key-that-is-not-the-default');
    const encrypted = box.encrypt('bot-token-value');
    expect(encrypted).not.toContain('bot-token-value');
    expect(box.decrypt(encrypted)).toBe('bot-token-value');
  });

  it('rejects the placeholder production key', () => {
    expect(() => new SecretBox('change-me-use-a-strong-random-key')).toThrow(/APP_ENCRYPTION_KEY/);
  });

  it('detects ciphertext tampering', () => {
    const box = new SecretBox('another-strong-test-key');
    const encrypted = box.encrypt('context-token');
    expect(() => box.decrypt(`${encrypted.slice(0, -2)}xx`)).toThrow();
  });
});
