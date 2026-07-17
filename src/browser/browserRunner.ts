import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  BrowserExtractionRecord,
  BrowserRunRecord,
  BrowserScreenshotRecord,
  BrowserStepRecord
} from '../types.js';

export interface BrowserRunnerRepositories {
  getBrowserRunForTask(taskId: string): Promise<BrowserRunRecord | null>;
  listBrowserSteps(runId: string): Promise<BrowserStepRecord[]>;
  listBrowserScreenshots(runId: string): Promise<BrowserScreenshotRecord[]>;
  listBrowserExtractions(runId: string): Promise<BrowserExtractionRecord[]>;
  updateBrowserRunExecution(id: string, params: {
    status: string;
    resultSummary?: string;
    metadata?: Record<string, unknown>;
  }): Promise<BrowserRunRecord | null>;
  updateBrowserStepExecution(id: string, params: {
    status: string;
    note?: string;
    metadata?: Record<string, unknown>;
  }): Promise<BrowserStepRecord | null>;
  updateBrowserScreenshotExecution(id: string, params: {
    status: string;
    artifactPath?: string;
    metadata?: Record<string, unknown>;
  }): Promise<BrowserScreenshotRecord | null>;
  updateBrowserExtractionExecution(id: string, params: {
    status: string;
    content?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): Promise<BrowserExtractionRecord | null>;
}

export interface PageFetchResult {
  ok: boolean;
  status: number;
  finalUrl: string;
  contentType?: string | null;
  title?: string | null;
  description?: string | null;
  textSample?: string;
}

export interface BrowserRunnerResult {
  run: BrowserRunRecord;
  artifactPath: string;
  summary: string;
}

export class LocalBrowserRunner {
  constructor(
    private readonly repos: BrowserRunnerRepositories,
    private readonly artifactRoot = path.join('runtime', 'artifacts', 'browser'),
    private readonly fetchPage: (url: string) => Promise<PageFetchResult> = defaultPageFetcher
  ) {}

  async runTask(taskId: string): Promise<BrowserRunnerResult | null> {
    const run = await this.repos.getBrowserRunForTask(taskId);
    if (!run) return null;

    if (!['planned', 'queued'].includes(run.status)) {
      return {
        run,
        artifactPath: '',
        summary: `Browser run ${run.id} is ${run.status}; no execution needed.`
      };
    }

    await this.repos.updateBrowserRunExecution(run.id, {
      status: 'running',
      metadata: {
        runner: 'safe_fetch_v1',
        startedAt: new Date().toISOString()
      }
    });

    const [steps, screenshots, extractions] = await Promise.all([
      this.repos.listBrowserSteps(run.id),
      this.repos.listBrowserScreenshots(run.id),
      this.repos.listBrowserExtractions(run.id)
    ]);

    try {
      for (const step of steps) {
        await this.repos.updateBrowserStepExecution(step.id, {
          status: 'running',
          note: `Runner started ${step.action}.`
        });
      }

      const page = await this.fetchPage(run.target_url);
      const artifactDir = path.join(this.artifactRoot, run.id);
      await mkdir(artifactDir, { recursive: true });
      const artifactPath = path.join(artifactDir, 'evidence.json');
      const evidence = {
        runId: run.id,
        taskId,
        goal: run.goal,
        targetUrl: run.target_url,
        targetDomain: run.target_domain,
        runner: 'safe_fetch_v1',
        capturedAt: new Date().toISOString(),
        page
      };
      await writeFile(artifactPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

      for (const step of steps) {
        await this.repos.updateBrowserStepExecution(step.id, {
          status: step.action === 'screenshot' ? 'skipped' : 'done',
          note: step.action === 'screenshot'
            ? 'Screenshot skipped until Playwright runner is enabled.'
            : `Completed ${step.action} with safe fetch runner.`,
          metadata: {
            artifactPath,
            httpStatus: page.status,
            finalUrl: page.finalUrl
          }
        });
      }

      for (const screenshot of screenshots) {
        await this.repos.updateBrowserScreenshotExecution(screenshot.id, {
          status: 'skipped',
          artifactPath,
          metadata: {
            reason: 'playwright_not_configured',
            evidenceType: 'json_page_snapshot'
          }
        });
      }

      const extractionContent = {
        goal: run.goal,
        targetUrl: run.target_url,
        targetDomain: run.target_domain,
        httpStatus: page.status,
        ok: page.ok,
        finalUrl: page.finalUrl,
        contentType: page.contentType,
        title: page.title,
        description: page.description,
        textSample: page.textSample,
        artifactPath
      };
      for (const extraction of extractions) {
        await this.repos.updateBrowserExtractionExecution(extraction.id, {
          status: 'completed',
          content: extractionContent,
          metadata: {
            runner: 'safe_fetch_v1'
          }
        });
      }

      const summary = `Browser safe fetch completed for ${run.target_domain} with HTTP ${page.status}.`;
      const completed = await this.repos.updateBrowserRunExecution(run.id, {
        status: 'completed',
        resultSummary: summary,
        metadata: {
          artifactPath,
          completedAt: new Date().toISOString(),
          httpStatus: page.status,
          finalUrl: page.finalUrl
        }
      });

      return {
        run: completed ?? run,
        artifactPath,
        summary
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      await this.repos.updateBrowserRunExecution(run.id, {
        status: 'failed',
        resultSummary: message,
        metadata: {
          failedAt: new Date().toISOString(),
          error: message
        }
      });
      throw error;
    }
  }
}

async function defaultPageFetcher(url: string): Promise<PageFetchResult> {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(10000)
  });
  const contentType = response.headers.get('content-type');
  const text = await response.text();
  const sample = normalizeText(text).slice(0, 1000);

  return {
    ok: response.ok,
    status: response.status,
    finalUrl: response.url,
    contentType,
    title: extractHtmlTag(text, 'title'),
    description: extractMetaDescription(text),
    textSample: sample
  };
}

function extractHtmlTag(html: string, tag: string) {
  const match = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match?.[1] ? normalizeText(match[1]).slice(0, 240) : null;
}

function extractMetaDescription(html: string) {
  const match = html.match(/<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i)
    ?? html.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*name=["']description["'][^>]*>/i);
  return match?.[1] ? normalizeText(match[1]).slice(0, 500) : null;
}

function normalizeText(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
