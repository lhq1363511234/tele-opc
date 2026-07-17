import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import {
  DependencyRegistry,
  registerDependencyRegistryRoutes
} from '../../src/appos/dependencies/registry.js';

const tempDirs: string[] = [];

async function tempConfigPath() {
  const dir = await mkdtemp(path.join(tmpdir(), 'tele-opc-deps-'));
  tempDirs.push(dir);
  return path.join(dir, 'appos-local-config.json');
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('DependencyRegistry', () => {
  it('loads default dependencies and persists user overrides', async () => {
    const registry = new DependencyRegistry({ configPath: await tempConfigPath() });
    const initial = await registry.list();
    expect(initial.map((item) => item.id)).toContain('dify');
    expect(initial.map((item) => item.id)).toContain('cloakbrowser');

    const saved = await registry.upsert({
      id: 'n8n',
      name: 'n8n',
      category: 'workflow',
      mode: 'external',
      baseUrl: 'http://127.0.0.1:5678',
      healthCheckUrl: 'http://127.0.0.1:5678/healthz',
      startCommand: 'npm run start',
      workingDirectory: 'D:/apps/n8n'
    });

    expect(saved.baseUrl).toBe('http://127.0.0.1:5678');

    const reloaded = new DependencyRegistry({ configPath: registry.configPath });
    const n8n = await reloaded.get('n8n');
    expect(n8n?.workingDirectory).toBe('D:/apps/n8n');
  });

  it('tests a dependency health check URL', async () => {
    const registry = new DependencyRegistry({
      configPath: await tempConfigPath(),
      fetch: async () => new Response('ok', { status: 200 })
    });
    await registry.upsert({
      id: 'capcut-mate',
      name: 'capcut-mate',
      category: 'editing',
      mode: 'external',
      baseUrl: 'http://127.0.0.1:9001',
      healthCheckUrl: 'http://127.0.0.1:9001/docs'
    });

    const status = await registry.test('capcut-mate');
    expect(status.ok).toBe(true);
    expect(status.status).toBe(200);
  });

  it('exposes web API routes for dependency setup pages', async () => {
    const app = Fastify();
    const registry = new DependencyRegistry({ configPath: await tempConfigPath() });
    registerDependencyRegistryRoutes(app, registry);

    const saveResponse = await app.inject({
      method: 'PUT',
      url: '/api/appos/dependencies/dify',
      payload: {
        name: 'Dify',
        category: 'ai_workflow',
        mode: 'external',
        baseUrl: 'http://127.0.0.1:5001',
        healthCheckUrl: 'http://127.0.0.1:5001/console/api/setup',
        notes: 'local windows install'
      }
    });
    expect(saveResponse.statusCode).toBe(200);

    const listResponse = await app.inject({ method: 'GET', url: '/api/appos/dependencies' });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().dependencies.find((item: { id: string }) => item.id === 'dify').baseUrl).toBe(
      'http://127.0.0.1:5001'
    );
  });
});
