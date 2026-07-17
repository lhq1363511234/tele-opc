import { describe, expect, it } from 'vitest';
import type { UserConfig } from 'vite';
import viteConfig from '../../web/vite.config.js';

describe('web dev proxy', () => {
  it('uses IPv4 loopback for the API proxy on Windows-friendly local dev', () => {
    const config = viteConfig as UserConfig;
    const proxy = config.server?.proxy;
    expect(proxy && typeof proxy === 'object' && !Array.isArray(proxy) ? proxy['/api'] : undefined).toBe(
      'http://127.0.0.1:3000'
    );
  });
});
