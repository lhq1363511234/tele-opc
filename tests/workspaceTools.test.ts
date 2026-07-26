import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildWorkspaceTools } from '../src/ai/workspaceTools.js';

function fakeRepos() {
  const artifacts: Array<Record<string, unknown>> = [];
  return {
    artifacts,
    async createArtifact(params: Record<string, unknown>) {
      const id = `art_${artifacts.length + 1}`;
      artifacts.push({ id, ...params });
      return { id };
    }
  };
}

describe('workspace tools', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-tools-'));
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  function toolsFor(repos: ReturnType<typeof fakeRepos>) {
    const tools = buildWorkspaceTools(repos, { taskId: 'tsk_test', rootDir });
    return new Map(tools.map((tool) => [tool.name, tool]));
  }

  it('writes then reads a file back', async () => {
    const tools = toolsFor(fakeRepos());
    const written = await tools.get('write_file')!.execute({ path: 'site/index.html', content: '<!doctype html><h1>hi</h1>' });
    expect(written.ok).toBe(true);
    const read = await tools.get('read_file')!.execute({ path: 'site/index.html' });
    expect(read.content).toContain('<h1>hi</h1>');
  });

  it('refuses paths that escape the workspace', async () => {
    const tools = toolsFor(fakeRepos());
    const result = await tools.get('write_file')!.execute({ path: '../../escaped.txt', content: 'nope' });
    expect(result).toEqual({ ok: false, error: 'invalid_path' });
    await expect(fs.stat(path.join(rootDir, '..', '..', 'escaped.txt'))).rejects.toThrow();
  });

  it('only runs allow-listed commands', async () => {
    const tools = toolsFor(fakeRepos());
    const blocked = await tools.get('run_command')!.execute({ command: 'systemctl', args: ['restart', 'nginx'] });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toBe('command_not_allowed');

    await tools.get('write_file')!.execute({ path: 'hello.js', content: 'console.log("built")' });
    const allowed = await tools.get('run_command')!.execute({ command: 'node', args: ['hello.js'] });
    expect(allowed.ok).toBe(true);
    expect(String(allowed.stdout)).toContain('built');
  });

  it('publishes html as a previewable artifact and reports missing paths', async () => {
    const repos = fakeRepos();
    const tools = toolsFor(repos);
    await tools.get('write_file')!.execute({ path: 'index.html', content: '<!doctype html><title>site</title>' });
    const result = await tools.get('publish_deliverable')!.execute({
      title: '客户官网',
      paths: ['index.html', 'missing.html'],
      summary: '首页已完成'
    });

    expect(result.ok).toBe(true);
    expect(result.publishedCount).toBe(1);
    expect(result.missing).toEqual(['missing.html']);
    expect(repos.artifacts[0]).toMatchObject({ type: 'html_page', taskId: 'tsk_test' });
    expect(repos.artifacts[1]).toMatchObject({ type: 'report' });
  });

  it('lists files it produced', async () => {
    const tools = toolsFor(fakeRepos());
    await tools.get('write_file')!.execute({ path: 'a/b.txt', content: 'x' });
    const listed = await tools.get('list_workspace')!.execute({});
    expect(listed.fileCount).toBe(1);
    expect(listed.files).toEqual([{ path: path.join('a', 'b.txt'), bytes: 1 }]);
  });
});
