import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalBrowserRunner } from '../src/browser/browserRunner.js';
import type {
  BrowserExtractionRecord,
  BrowserRunRecord,
  BrowserScreenshotRecord,
  BrowserStepRecord
} from '../src/types.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'tele-opc-browser-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('LocalBrowserRunner', () => {
  it('executes safe browser inspection runs and writes evidence artifacts', async () => {
    const repos = new FakeBrowserRunnerRepos();
    const runner = new LocalBrowserRunner(
      repos,
      tempDir,
      async () => ({
        ok: true,
        status: 200,
        finalUrl: 'https://example.com/final',
        contentType: 'text/html',
        title: 'Example Domain',
        description: 'Example description',
        textSample: 'Example page text'
      })
    );

    const result = await runner.runTask('tsk_1');

    expect(result?.summary).toContain('HTTP 200');
    expect(repos.run.status).toBe('completed');
    expect(repos.run.result_summary).toContain('HTTP 200');
    expect(repos.steps.map((step) => [step.action, step.status])).toEqual([
      ['open_page', 'done'],
      ['read_page', 'done'],
      ['screenshot', 'skipped'],
      ['extract_data', 'done']
    ]);
    expect(repos.screenshots[0].status).toBe('skipped');
    expect(repos.screenshots[0].artifact_path).toContain('evidence.json');
    expect(repos.extractions[0].status).toBe('completed');
    expect(repos.extractions[0].content).toMatchObject({
      title: 'Example Domain',
      httpStatus: 200,
      artifactPath: repos.screenshots[0].artifact_path
    });

    const evidence = JSON.parse(await readFile(repos.screenshots[0].artifact_path!, 'utf8')) as {
      runId: string;
      page: { title: string };
    };
    expect(evidence.runId).toBe('brn_1');
    expect(evidence.page.title).toBe('Example Domain');
  });
});

class FakeBrowserRunnerRepos {
  run: BrowserRunRecord = {
    id: 'brn_1',
    task_id: 'tsk_1',
    session_id: null,
    goal: '去 example.com 看看页面',
    target_url: 'https://example.com',
    target_domain: 'example.com',
    status: 'planned',
    risk_level: 'low',
    source: 'telegram',
    result_summary: null,
    metadata: {},
    created_at: '2026-06-11T00:00:00.000Z',
    updated_at: '2026-06-11T00:00:00.000Z'
  };

  steps: BrowserStepRecord[] = ['open_page', 'read_page', 'screenshot', 'extract_data'].map((action, index) => ({
    id: `bst_${index + 1}`,
    run_id: 'brn_1',
    sequence: index + 1,
    action,
    target: action === 'open_page' ? 'https://example.com' : null,
    status: 'planned',
    note: null,
    metadata: {},
    created_at: '2026-06-11T00:00:00.000Z',
    updated_at: '2026-06-11T00:00:00.000Z'
  }));

  screenshots: BrowserScreenshotRecord[] = [
    {
      id: 'bss_1',
      run_id: 'brn_1',
      step_id: 'bst_3',
      label: 'initial-page-evidence',
      artifact_path: null,
      status: 'planned',
      metadata: {},
      created_at: '2026-06-11T00:00:00.000Z'
    }
  ];

  extractions: BrowserExtractionRecord[] = [
    {
      id: 'bex_1',
      run_id: 'brn_1',
      extraction_type: 'summary',
      content: {},
      status: 'planned',
      metadata: {},
      created_at: '2026-06-11T00:00:00.000Z'
    }
  ];

  async getBrowserRunForTask(taskId: string) {
    return this.run.task_id === taskId ? this.run : null;
  }

  async listBrowserSteps(runId: string) {
    return this.steps.filter((step) => step.run_id === runId);
  }

  async listBrowserScreenshots(runId: string) {
    return this.screenshots.filter((screenshot) => screenshot.run_id === runId);
  }

  async listBrowserExtractions(runId: string) {
    return this.extractions.filter((extraction) => extraction.run_id === runId);
  }

  async updateBrowserRunExecution(id: string, params: {
    status: string;
    resultSummary?: string;
    metadata?: Record<string, unknown>;
  }) {
    if (this.run.id !== id) return null;
    this.run.status = params.status;
    this.run.result_summary = params.resultSummary ?? this.run.result_summary;
    this.run.metadata = {
      ...this.run.metadata,
      ...params.metadata
    };
    return this.run;
  }

  async updateBrowserStepExecution(id: string, params: {
    status: string;
    note?: string;
    metadata?: Record<string, unknown>;
  }) {
    const step = this.steps.find((item) => item.id === id);
    if (!step) return null;
    step.status = params.status;
    step.note = params.note ?? step.note;
    step.metadata = {
      ...step.metadata,
      ...params.metadata
    };
    return step;
  }

  async updateBrowserScreenshotExecution(id: string, params: {
    status: string;
    artifactPath?: string;
    metadata?: Record<string, unknown>;
  }) {
    const screenshot = this.screenshots.find((item) => item.id === id);
    if (!screenshot) return null;
    screenshot.status = params.status;
    screenshot.artifact_path = params.artifactPath ?? screenshot.artifact_path;
    screenshot.metadata = {
      ...screenshot.metadata,
      ...params.metadata
    };
    return screenshot;
  }

  async updateBrowserExtractionExecution(id: string, params: {
    status: string;
    content?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }) {
    const extraction = this.extractions.find((item) => item.id === id);
    if (!extraction) return null;
    extraction.status = params.status;
    extraction.content = params.content ?? extraction.content;
    extraction.metadata = {
      ...extraction.metadata,
      ...params.metadata
    };
    return extraction;
  }
}
