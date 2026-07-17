import { describe, expect, it } from 'vitest';
import { ensureCloakBrowserProfileReady } from '../../src/appos/domains/cps/cloakbrowser-prerequisites.js';

describe('ensureCloakBrowserProfileReady', () => {
  it('resolves an exact unique CloakBrowser profile name to the runtime ID', async () => {
    const calls: string[] = [];

    const result = await ensureCloakBrowserProfileReady({
      baseUrl: 'http://127.0.0.1:8080',
      profileName: 'facebook-01',
      pollIntervalMs: 1,
      timeoutMs: 100,
      fetch: async (url, init) => {
        const target = String(url);
        calls.push(`${init?.method ?? 'GET'} ${target}`);
        if (target.endsWith('/api/profiles')) {
          return new Response(
            JSON.stringify([
              { id: 'profile-a', name: 'facebook-01', status: 'stopped' },
              { id: 'profile-b', name: 'tiktok-01', status: 'running' }
            ]),
            { status: 200 }
          );
        }
        if (target.endsWith('/api/profiles/profile-a/launch')) {
          return new Response(JSON.stringify({ status: 'running' }), { status: 200 });
        }
        if (target.endsWith('/api/profiles/profile-a/cdp/json/list')) {
          return new Response(JSON.stringify([{ webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/page/1' }]), {
            status: 200
          });
        }
        return new Response('not found', { status: 404 });
      },
      startDetached: (command, args) => {
        calls.push(`START ${command} ${args.join(' ')}`);
      }
    });

    expect(result.profileId).toBe('profile-a');
    expect(result.profileName).toBe('facebook-01');
    expect(calls).toContain('POST http://127.0.0.1:8080/api/profiles/profile-a/launch');
  });

  it('fails clearly when a configured CloakBrowser profile name is missing', async () => {
    await expect(
      ensureCloakBrowserProfileReady({
        baseUrl: 'http://127.0.0.1:8080',
        profileName: 'missing-profile',
        pollIntervalMs: 1,
        timeoutMs: 5,
        managerStartCommand: 'python',
        managerStartArgs: ['run.py'],
        fetch: async (url) => {
          if (String(url).endsWith('/api/profiles')) {
            return new Response(JSON.stringify([{ id: 'profile-a', name: 'facebook-01', status: 'running' }]), {
              status: 200
            });
          }
          return new Response('not found', { status: 404 });
        },
        startDetached: () => undefined
      })
    ).rejects.toThrow('CloakBrowser profile name not found: missing-profile');
  });

  it('fails clearly when a configured CloakBrowser profile name is duplicated', async () => {
    await expect(
      ensureCloakBrowserProfileReady({
        baseUrl: 'http://127.0.0.1:8080',
        profileName: 'facebook-01',
        pollIntervalMs: 1,
        timeoutMs: 5,
        managerStartCommand: 'python',
        managerStartArgs: ['run.py'],
        fetch: async (url) => {
          if (String(url).endsWith('/api/profiles')) {
            return new Response(
              JSON.stringify([
                { id: 'profile-a', name: 'facebook-01', status: 'running' },
                { id: 'profile-b', name: 'facebook-01', status: 'running' }
              ]),
              { status: 200 }
            );
          }
          return new Response('not found', { status: 404 });
        },
        startDetached: () => undefined
      })
    ).rejects.toThrow('CloakBrowser profile name is duplicated: facebook-01');
  });

  it('starts the manager, launches the target profile, and waits for CDP', async () => {
    const calls: string[] = [];
    const launches: string[] = [];
    let profilePolls = 0;
    let cdpPolls = 0;

    const result = await ensureCloakBrowserProfileReady({
      baseUrl: 'http://127.0.0.1:8080',
      profileId: 'profile-001',
      managerStartCommand: 'python',
      managerStartArgs: ['B:/CloakBrowser/run.py'],
      pollIntervalMs: 1,
      timeoutMs: 100,
      fetch: async (url, init) => {
        const target = String(url);
        calls.push(`${init?.method ?? 'GET'} ${target}`);
        if (target.endsWith('/api/profiles') && init?.method !== 'POST') {
          profilePolls += 1;
          if (profilePolls === 1) throw new Error('manager down');
          return new Response(JSON.stringify([{ id: 'profile-001', status: 'stopped' }]), { status: 200 });
        }
        if (target.endsWith('/api/profiles/profile-001/launch')) {
          launches.push(target);
          return new Response(JSON.stringify({ status: 'running' }), { status: 200 });
        }
        if (target.endsWith('/api/profiles/profile-001/cdp/json/list')) {
          cdpPolls += 1;
          if (cdpPolls === 1) return new Response(JSON.stringify([]), { status: 200 });
          return new Response(JSON.stringify([{ webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/page/1' }]), { status: 200 });
        }
        return new Response('not found', { status: 404 });
      },
      startDetached: (command, args) => {
        calls.push(`START ${command} ${args.join(' ')}`);
      }
    });

    expect(calls).toContain('START python B:/CloakBrowser/run.py');
    expect(launches).toEqual(['http://127.0.0.1:8080/api/profiles/profile-001/launch']);
    expect(result.profileId).toBe('profile-001');
    expect(result.profileStatus).toBe('running');
    expect(result.cdpReady).toBe(true);
  });

  it('reads manager and profile values from the dependency registry provider', async () => {
    const calls: string[] = [];

    const result = await ensureCloakBrowserProfileReady({
      pollIntervalMs: 1,
      timeoutMs: 100,
      dependencyProvider: {
        get: async (id) => {
          if (id === 'cloakbrowser') {
            return {
              id,
              name: 'CloakBrowser Manager',
              category: 'browser',
              mode: 'managed',
              baseUrl: 'http://127.0.0.1:18080',
              startCommand: 'python D:/apps/CloakBrowser/run.py',
              workingDirectory: 'D:/apps/CloakBrowser'
            };
          }
          if (id === 'inbeidou_profile') {
            return {
              id,
              name: '北斗智影 Profile',
              category: 'browser_profile',
              mode: 'managed',
              env: { profileId: 'configured-profile' }
            };
          }
          return undefined;
        }
      },
      fetch: async (url, init) => {
        calls.push(`${init?.method ?? 'GET'} ${String(url)}`);
        if (String(url).endsWith('/api/profiles')) {
          return new Response(JSON.stringify([{ id: 'configured-profile', status: 'running' }]), { status: 200 });
        }
        if (String(url).endsWith('/api/profiles/configured-profile/cdp/json/list')) {
          return new Response(JSON.stringify([{ webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/page/1' }]), {
            status: 200
          });
        }
        return new Response('not found', { status: 404 });
      },
      startDetached: (command, args) => {
        calls.push(`START ${command} ${args.join(' ')}`);
      }
    });

    expect(result.baseUrl).toBe('http://127.0.0.1:18080');
    expect(result.profileId).toBe('configured-profile');
    expect(calls).toContain('GET http://127.0.0.1:18080/api/profiles');
  });
});
