import { spawn } from 'node:child_process';
import path from 'node:path';
import { DependencyRegistry, type AppDependency } from '../../dependencies/registry.js';

export type CloakBrowserPrerequisiteOptions = {
  baseUrl?: string;
  profileId?: string;
  profileName?: string;
  managerDir?: string;
  managerStartCommand?: string;
  managerStartArgs?: string[];
  pollIntervalMs?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  startDetached?: (command: string, args: string[], options: { cwd?: string }) => void;
  dependencyProvider?: {
    get: (id: string) => Promise<AppDependency | undefined>;
  };
};

export type CloakBrowserPrerequisiteResult = {
  baseUrl: string;
  profileId: string;
  profileName?: string;
  profileStatus: string;
  cdpReady: boolean;
};

type CloakBrowserProfile = {
  id?: string;
  profileId?: string;
  uuid?: string;
  name?: string;
  profileName?: string;
  title?: string;
  status?: string;
  state?: string;
  running?: boolean;
};

const DEFAULT_INBEIDOU_PROFILE_ID = '152a3eef-6b63-4ef1-a0cb-0c7127110ed5';
const DEFAULT_MANAGER_DIR = 'B:\\Cir\\CodexProjects\\CloakBrowser-Manager-main';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeBaseUrl = (baseUrl: string) => baseUrl.replace(/\/+$/, '');

const parseCommand = (commandLine: string) =>
  commandLine.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, '')) ?? [];

const defaultStartDetached = (command: string, args: string[], options: { cwd?: string }) => {
  const child = spawn(command, args, {
    cwd: options.cwd,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    shell: false
  });
  child.unref();
};

const parseJson = async (response: Response) => {
  const text = await response.text();
  if (!text.trim()) return null;
  return JSON.parse(text) as unknown;
};

const asProfileList = (payload: unknown): CloakBrowserProfile[] => {
  if (Array.isArray(payload)) return payload as CloakBrowserProfile[];
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.data)) return record.data as CloakBrowserProfile[];
    if (Array.isArray(record.profiles)) return record.profiles as CloakBrowserProfile[];
  }
  return [];
};

const profileMatches = (profile: CloakBrowserProfile, profileId: string) =>
  profile.id === profileId || profile.profileId === profileId || profile.uuid === profileId;

const profileRuntimeId = (profile: CloakBrowserProfile) => profile.id ?? profile.profileId ?? profile.uuid;

const profileDisplayName = (profile: CloakBrowserProfile) => profile.name ?? profile.profileName ?? profile.title;

const profileStatus = (profile: CloakBrowserProfile) => {
  if (profile.status) return profile.status;
  if (profile.state) return profile.state;
  if (profile.running) return 'running';
  return 'unknown';
};

const isProfileRunning = (profile: CloakBrowserProfile) => {
  const status = profileStatus(profile).toLowerCase();
  return profile.running === true || status === 'running' || status === 'started';
};

const isCdpReadyPayload = (payload: unknown) => {
  if (!Array.isArray(payload)) return false;
  return payload.some((item) => item && typeof item === 'object' && 'webSocketDebuggerUrl' in item);
};

class CloakBrowserProfileResolutionError extends Error {}

async function waitFor<T>(
  action: () => Promise<T | undefined>,
  options: { timeoutMs: number; pollIntervalMs: number; description: string }
) {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt <= options.timeoutMs) {
    try {
      const result = await action();
      if (result !== undefined) return result;
    } catch (error) {
      if (error instanceof CloakBrowserProfileResolutionError) throw error;
      lastError = error;
    }
    await sleep(options.pollIntervalMs);
  }
  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : '';
  throw new Error(`Timed out waiting for ${options.description}.${suffix}`);
}

export async function ensureCloakBrowserProfileReady(
  input: CloakBrowserPrerequisiteOptions = {}
): Promise<CloakBrowserPrerequisiteResult> {
  const dependencyProvider = input.dependencyProvider ?? new DependencyRegistry();
  const [cloakbrowserConfig, profileConfig] = await Promise.all([
    dependencyProvider.get('cloakbrowser'),
    dependencyProvider.get('inbeidou_profile')
  ]);
  const configuredStartCommand = cloakbrowserConfig?.startCommand ? parseCommand(cloakbrowserConfig.startCommand) : [];
  const baseUrl = normalizeBaseUrl(
    input.baseUrl ?? cloakbrowserConfig?.baseUrl ?? process.env.CLOAKBROWSER_MANAGER_URL ?? 'http://127.0.0.1:8080'
  );
  const profileName =
    input.profileName ??
    profileConfig?.env?.profileName ??
    profileConfig?.env?.profile_name ??
    process.env.INBEIDOU_CLOAK_PROFILE_NAME ??
    process.env.CLOAKBROWSER_PROFILE_NAME;
  const configuredProfileId =
    input.profileId ??
    profileConfig?.env?.profileId ??
    process.env.INBEIDOUB_PROFILE_ID ??
    process.env.INBEIDOU_CLOAK_PROFILE_ID ??
    (profileName ? undefined : DEFAULT_INBEIDOU_PROFILE_ID);
  const managerDir = input.managerDir ?? cloakbrowserConfig?.workingDirectory ?? process.env.CLOAKBROWSER_MANAGER_DIR ?? DEFAULT_MANAGER_DIR;
  const managerStartCommand = input.managerStartCommand ?? configuredStartCommand[0] ?? process.env.CLOAKBROWSER_MANAGER_START_COMMAND ?? 'python';
  const managerStartArgs =
    input.managerStartArgs ??
    (configuredStartCommand.length > 0 ? configuredStartCommand.slice(1) : undefined) ??
    (process.env.CLOAKBROWSER_MANAGER_START_ARGS
      ? process.env.CLOAKBROWSER_MANAGER_START_ARGS.split(' ').filter(Boolean)
      : [path.join(managerDir, 'run.py')]);
  const pollIntervalMs = input.pollIntervalMs ?? Number(process.env.CLOAKBROWSER_POLL_INTERVAL_MS ?? '1000');
  const timeoutMs = input.timeoutMs ?? Number(process.env.CLOAKBROWSER_START_TIMEOUT_MS ?? '60000');
  const fetchImpl = input.fetch ?? fetch;
  const startDetached = input.startDetached ?? defaultStartDetached;

  const fetchProfiles = async () => {
    const response = await fetchImpl(`${baseUrl}/api/profiles`);
    if (!response.ok) throw new Error(`CloakBrowser profiles API returned ${response.status}`);
    const profiles = asProfileList(await parseJson(response));

    if (profileName) {
      const matches = profiles.filter((item) => profileDisplayName(item) === profileName);
      if (matches.length === 0) {
        throw new CloakBrowserProfileResolutionError(`CloakBrowser profile name not found: ${profileName}`);
      }
      if (matches.length > 1) {
        throw new CloakBrowserProfileResolutionError(`CloakBrowser profile name is duplicated: ${profileName}`);
      }
      const resolvedProfileId = profileRuntimeId(matches[0]);
      if (!resolvedProfileId) {
        throw new CloakBrowserProfileResolutionError(`CloakBrowser profile is missing runtime ID: ${profileName}`);
      }
      return matches[0];
    }

    if (!configuredProfileId) {
      throw new CloakBrowserProfileResolutionError('Missing CloakBrowser profileId or profileName');
    }

    const profile = profiles.find((item) => profileMatches(item, configuredProfileId));
    if (!profile) {
      throw new CloakBrowserProfileResolutionError(`CloakBrowser profile not found: ${configuredProfileId}`);
    }
    return profile;
  };

  let profile = await fetchProfiles().catch((error) => {
    if (error instanceof CloakBrowserProfileResolutionError) throw error;
    return undefined;
  });
  if (!profile) {
    startDetached(managerStartCommand, managerStartArgs, { cwd: managerDir });
    profile = await waitFor(fetchProfiles, {
      timeoutMs,
      pollIntervalMs,
      description: 'CloakBrowser Manager startup'
    });
  }

  const profileId = profileRuntimeId(profile);
  if (!profileId) {
    throw new CloakBrowserProfileResolutionError(`CloakBrowser profile is missing runtime ID: ${profileName ?? configuredProfileId}`);
  }

  if (!isProfileRunning(profile)) {
    const response = await fetchImpl(`${baseUrl}/api/profiles/${profileId}/launch`, { method: 'POST' });
    if (!response.ok) {
      throw new Error(`Failed to launch CloakBrowser profile ${profileId}: ${response.status} ${await response.text()}`);
    }
  }

  await waitFor(async () => {
    const response = await fetchImpl(`${baseUrl}/api/profiles/${profileId}/cdp/json/list`);
    if (!response.ok) throw new Error(`CloakBrowser CDP API returned ${response.status}`);
    return isCdpReadyPayload(await parseJson(response)) ? true : undefined;
  }, {
    timeoutMs,
    pollIntervalMs,
    description: `CloakBrowser profile CDP ${profileId}`
  });

  return {
    baseUrl,
    profileId,
    ...(profileName ? { profileName } : {}),
    profileStatus: 'running',
    cdpReady: true
  };
}
