import type { IntegrationHealthCheckRecord } from '../types.js';

export interface IntegrationHealthRepositories {
  createIntegrationHealthCheck(params: {
    integration: string;
    status: string;
    details?: Record<string, unknown>;
  }): Promise<IntegrationHealthCheckRecord>;
  listBackupTableRows(tableName: string, limit?: number): Promise<Array<Record<string, unknown>>>;
}

export interface IntegrationHealthResult {
  checks: IntegrationHealthCheckRecord[];
  okCount: number;
  warningCount: number;
  failedCount: number;
}

export class LocalIntegrationHealthChecker {
  constructor(
    private readonly repos: IntegrationHealthRepositories,
    private readonly redisPing: () => Promise<boolean> = defaultRedisPing
  ) {}

  async runAll(): Promise<IntegrationHealthResult> {
    const checks: IntegrationHealthCheckRecord[] = [];

    checks.push(await this.checkPostgres());
    checks.push(await this.checkRedis());
    checks.push(await this.recordConfigCheck('telegram', isConfigured(process.env.TELEGRAM_BOT_TOKEN, 'change-me'), {
      requires: ['TELEGRAM_BOT_TOKEN'],
      publicBaseUrlConfigured: isConfigured(process.env.PUBLIC_BASE_URL, 'http://localhost:3000'),
      webhookSecretConfigured: isConfigured(process.env.TELEGRAM_WEBHOOK_SECRET)
    }));
    checks.push(await this.recordConfigCheck('ai', isConfigured(process.env.OPENAI_API_KEY), {
      provider: process.env.AI_PROVIDER ?? 'openai',
      model: process.env.OPENAI_MODEL ?? 'gpt-4.1',
      requires: ['OPENAI_API_KEY']
    }));
    checks.push(await this.recordConfigCheck('email', isConfigured(process.env.GOOGLE_CLIENT_ID) && isConfigured(process.env.GOOGLE_CLIENT_SECRET), {
      mode: 'google_oauth',
      requires: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']
    }));
    checks.push(await this.recordConfigCheck('calendar', isConfigured(process.env.GOOGLE_CLIENT_ID) && isConfigured(process.env.GOOGLE_CLIENT_SECRET), {
      mode: 'google_oauth',
      requires: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']
    }));
    checks.push(await this.recordConfigCheck('finance', isConfigured(process.env.STRIPE_SECRET_KEY), {
      mode: 'stripe_optional',
      internalLedgerAvailable: true,
      requiresForExternal: ['STRIPE_SECRET_KEY']
    }));
    checks.push(await this.recordConfigCheck('browser', isConfigured(process.env.BROWSER_ALLOWED_DOMAINS), {
      allowedDomains: process.env.BROWSER_ALLOWED_DOMAINS ?? 'stripe.com,github.com,google.com',
      requireApprovalForSubmit: process.env.BROWSER_REQUIRE_APPROVAL_FOR_SUBMIT ?? 'true'
    }));

    return summarizeChecks(checks);
  }

  private async checkPostgres() {
    try {
      await this.repos.listBackupTableRows('schema_migrations', 1);
      return this.repos.createIntegrationHealthCheck({
        integration: 'postgres',
        status: 'ok',
        details: {
          check: 'schema_migrations_read',
          note: 'PostgreSQL query succeeded.'
        }
      });
    } catch (error) {
      return this.repos.createIntegrationHealthCheck({
        integration: 'postgres',
        status: 'failed',
        details: {
          check: 'schema_migrations_read',
          error: error instanceof Error ? error.message : 'unknown error'
        }
      });
    }
  }

  private async checkRedis() {
    try {
      const ok = await this.redisPing();
      return this.repos.createIntegrationHealthCheck({
        integration: 'redis',
        status: ok ? 'ok' : 'failed',
        details: {
          check: 'redis_ping'
        }
      });
    } catch (error) {
      return this.repos.createIntegrationHealthCheck({
        integration: 'redis',
        status: 'failed',
        details: {
          check: 'redis_ping',
          error: error instanceof Error ? error.message : 'unknown error'
        }
      });
    }
  }

  private async recordConfigCheck(integration: string, configured: boolean, details: Record<string, unknown>) {
    return this.repos.createIntegrationHealthCheck({
      integration,
      status: configured ? 'configured' : 'not_configured',
      details: {
        check: 'configuration',
        ...details
      }
    });
  }
}

export function summarizeChecks(checks: IntegrationHealthCheckRecord[]): IntegrationHealthResult {
  const failedCount = checks.filter((check) => check.status === 'failed').length;
  const warningCount = checks.filter((check) => ['not_configured', 'degraded'].includes(check.status)).length;
  const okCount = checks.length - failedCount - warningCount;
  return {
    checks,
    okCount,
    warningCount,
    failedCount
  };
}

function isConfigured(value: string | undefined, placeholder?: string) {
  if (!value || !value.trim()) return false;
  if (placeholder && value === placeholder) return false;
  return true;
}

async function defaultRedisPing() {
  const { pingRedis } = await import('../db/redis.js');
  return pingRedis();
}
