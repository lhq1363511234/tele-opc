import fs from 'node:fs';
import path from 'node:path';

type CookieJar = Map<string, string>;

const root = 'B:\\Cir\\CodexProjects';
const envPath = path.join(root, 'opc-local.env');
const credentialsPath = path.join(root, 'opc-local.credentials.txt');
const dslPath = path.resolve('docs/appos/dify-workflows/short_drama_cps_edit_planner.yml');

const readEnvFile = (filePath: string) => {
  const env = new Map<string, string>();
  if (!fs.existsSync(filePath)) return env;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#') || !line.includes('=')) continue;
    const [key, ...rest] = line.split('=');
    env.set(key.trim(), rest.join('=').trim());
  }
  return env;
};

const readLocalCredentials = () => {
  const text = fs.existsSync(credentialsPath) ? fs.readFileSync(credentialsPath, 'utf8') : '';
  const email = text.match(/DIFY_ADMIN_EMAIL=(.+)/)?.[1]?.trim() || process.env.DIFY_ADMIN_EMAIL;
  const password = text.match(/DIFY_ADMIN_PASSWORD=(.+)/)?.[1]?.trim() || process.env.DIFY_ADMIN_PASSWORD;
  if (!email || !password) throw new Error('Missing Dify admin credentials in local private credentials file');
  return { email, password };
};

const cookieHeader = (jar: CookieJar) =>
  [...jar.entries()].map(([key, value]) => `${key}=${value}`).join('; ');

const storeCookies = (jar: CookieJar, headers: Headers) => {
  const raw = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  const cookies = raw.length ? raw : headers.get('set-cookie')?.split(/,(?=\s*[^;,]+=)/) ?? [];
  for (const cookie of cookies) {
    const pair = cookie.split(';')[0];
    const index = pair.indexOf('=');
    if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
};

const requestJson = async (url: string, options: RequestInit & { jar: CookieJar }) => {
  const headers = new Headers(options.headers);
  if (options.jar.size > 0) headers.set('cookie', cookieHeader(options.jar));
  const response = await fetch(url, { ...options, headers });
  storeCookies(options.jar, response.headers);
  const text = await response.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    // keep text
  }
  if (!response.ok) {
    throw new Error(`Dify API ${response.status} ${url}: ${typeof data === 'string' ? data.slice(0, 500) : JSON.stringify(data).slice(0, 500)}`);
  }
  return data as Record<string, unknown>;
};

const upsertEnvLine = (filePath: string, key: string, value: string) => {
  const lines = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8').split(/\r?\n/) : [];
  const prefix = `${key}=`;
  let replaced = false;
  const next = lines.map((line) => {
    if (line.startsWith(prefix)) {
      replaced = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!replaced) next.push(`${key}=${value}`);
  fs.writeFileSync(filePath, `${next.filter((line, index) => line || index < next.length - 1).join('\n')}\n`, 'utf8');
};

async function main() {
  const env = readEnvFile(envPath);
  const apiBaseUrl = (env.get('DIFY_API_URL') || process.env.DIFY_API_URL || 'http://127.0.0.1:5001').replace(/\/$/, '');
  const { email, password } = readLocalCredentials();
  const jar: CookieJar = new Map();

  await requestJson(`${apiBaseUrl}/console/api/login`, {
    jar,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, remember_me: true })
  });

  const yamlContent = fs.readFileSync(dslPath, 'utf8');
  const imported = await requestJson(`${apiBaseUrl}/console/api/apps/imports`, {
    jar,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mode: 'yaml-content',
      yaml_content: yamlContent,
      name: 'OPC 短剧CPS剪辑策划',
      description: '短剧 CPS 第 6 步 Dify 剪辑策划 workflow'
    })
  });

  const appId = String(imported.app_id || '');
  if (!appId) throw new Error(`Dify import did not return app_id: ${JSON.stringify(imported)}`);

  await requestJson(`${apiBaseUrl}/console/api/apps/${appId}/workflows/publish`, {
    jar,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ marked_name: 'v1', marked_comment: 'Tele-OPC short drama CPS edit planner' })
  });

  const apiKey = await requestJson(`${apiBaseUrl}/console/api/apps/${appId}/api-keys`, {
    jar,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({})
  });

  const token = String(apiKey.token || '');
  if (!token) throw new Error(`Dify API key creation did not return token: ${JSON.stringify(apiKey)}`);

  upsertEnvLine(envPath, 'APPOS_DIFY_SHORT_DRAMA_CPS_WORKFLOW_URL', `${apiBaseUrl}/v1/workflows/run`);
  upsertEnvLine(envPath, 'APPOS_DIFY_SHORT_DRAMA_CPS_APP_ID', appId);
  upsertEnvLine(envPath, 'APPOS_DIFY_SHORT_DRAMA_CPS_API_KEY', token);

  console.log(JSON.stringify({ ok: true, appId, workflowUrl: `${apiBaseUrl}/v1/workflows/run`, apiKeyStoredIn: envPath }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
