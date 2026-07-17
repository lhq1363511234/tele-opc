import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

type CheckResult = {
  name: string;
  command: string;
  args: string[];
  required: boolean;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stdoutTail: string;
  stderrTail: string;
};

type LoopReport = {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  iteration: number;
  mode: 'quick' | 'full';
  repairEnabled: boolean;
  results: CheckResult[];
  npmOutdated?: unknown;
  nextAction: string;
};

const argValue = (flag: string) => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
};

const hasFlag = (flag: string) => process.argv.includes(flag);

const npmCommand = () => (process.platform === 'win32' ? 'npm.cmd' : 'npm');
const npxCommand = () => (process.platform === 'win32' ? 'npx.cmd' : 'npx');

const tail = (value: string, max = 6000) => (value.length <= max ? value : value.slice(-max));

const quoteWindowsArg = (value: string) => {
  if (!/[ \t&()^|<>"]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
};

const spawnTarget = (command: string, args: string[]) => {
  if (process.platform !== 'win32') return { command, args };
  const comspec = process.env.ComSpec || 'cmd.exe';
  const line = [quoteWindowsArg(command), ...args.map(quoteWindowsArg)].join(' ');
  return { command: comspec, args: ['/d', '/s', '/c', line] };
};

const runCommand = (
  name: string,
  command: string,
  args: string[],
  options: { timeoutMs: number; required: boolean }
): Promise<CheckResult> =>
  new Promise((resolve) => {
    const started = Date.now();
    const target = spawnTarget(command, args);
    const child = spawn(target.command, target.args, {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, Math.max(1000, options.timeoutMs));

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        name,
        command,
        args,
        required: options.required,
        exitCode: 1,
        timedOut,
        durationMs: Date.now() - started,
        stdoutTail: tail(stdout),
        stderrTail: tail(`${stderr}\n${error.message}`.trim())
      });
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({
        name,
        command,
        args,
        required: options.required,
        exitCode,
        timedOut,
        durationMs: Date.now() - started,
        stdoutTail: tail(stdout),
        stderrTail: tail(stderr)
      });
    });
  });

const checksForMode = (mode: 'quick' | 'full') => {
  const checks = [
    {
      name: 'typecheck',
      command: npmCommand(),
      args: ['run', 'typecheck'],
      required: true,
      timeoutMs: 120_000
    },
    {
      name: 'cps-critical-tests',
      command: npxCommand(),
      args: [
        'vitest',
        'run',
        'tests/appos/drama-run.test.ts',
        'tests/appos/short-drama-capcut-prep.test.ts',
        'tests/appos/short-drama-edit-planner-contract.test.ts'
      ],
      required: true,
      timeoutMs: 120_000
    }
  ];
  if (mode === 'full') {
    checks.push(
      { name: 'web-typecheck', command: npmCommand(), args: ['run', 'web:typecheck'], required: true, timeoutMs: 120_000 },
      { name: 'all-tests', command: npmCommand(), args: ['test'], required: true, timeoutMs: 300_000 },
      { name: 'build', command: npmCommand(), args: ['run', 'build'], required: true, timeoutMs: 300_000 }
    );
  }
  return checks;
};

const collectNpmOutdated = async () => {
  const result = await runCommand('npm-outdated', npmCommand(), ['outdated', '--json'], { required: false, timeoutMs: 60_000 });
  const text = result.stdoutTail.trim() || result.stderrTail.trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text, exitCode: result.exitCode };
  }
};

const reportMarkdown = (report: LoopReport) => {
  const lines = [
    `# Codex Project Repair Loop`,
    '',
    `- ok: ${report.ok}`,
    `- iteration: ${report.iteration}`,
    `- mode: ${report.mode}`,
    `- repairEnabled: ${report.repairEnabled}`,
    `- startedAt: ${report.startedAt}`,
    `- finishedAt: ${report.finishedAt}`,
    `- nextAction: ${report.nextAction}`,
    '',
    `## Checks`,
    ''
  ];
  for (const result of report.results) {
    lines.push(
      `### ${result.name}`,
      '',
      `- command: \`${[result.command, ...result.args].join(' ')}\``,
      `- required: ${result.required}`,
      `- exitCode: ${result.exitCode}`,
      `- timedOut: ${result.timedOut}`,
      `- durationMs: ${result.durationMs}`,
      '',
      'stdout tail:',
      '```text',
      result.stdoutTail || '(empty)',
      '```',
      '',
      'stderr tail:',
      '```text',
      result.stderrTail || '(empty)',
      '```',
      ''
    );
  }
  if (report.npmOutdated) {
    lines.push('## npm outdated', '', '```json', JSON.stringify(report.npmOutdated, null, 2), '```', '');
  }
  return `${lines.join('\n')}\n`;
};

const writeReport = (report: LoopReport, outputDir: string) => {
  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, `iteration-${String(report.iteration).padStart(2, '0')}.json`);
  const mdPath = path.join(outputDir, `iteration-${String(report.iteration).padStart(2, '0')}.md`);
  const latestJsonPath = path.join(outputDir, 'latest.json');
  const latestMdPath = path.join(outputDir, 'latest.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(mdPath, reportMarkdown(report), 'utf8');
  fs.copyFileSync(jsonPath, latestJsonPath);
  fs.copyFileSync(mdPath, latestMdPath);
  return { jsonPath, mdPath, latestJsonPath, latestMdPath };
};

const buildRepairPrompt = (report: LoopReport) =>
  [
    '你是当前 tele-opc 项目的 Codex 修复循环。',
    '请只修复本轮检查失败暴露的问题，不要重构无关代码，不要使用破坏性 git 命令。',
    '重点目标：让 npm run typecheck 和关键 vitest 测试通过，同时保持短剧 CPS DramaRun 逻辑符合用户要求：不写死剧、不固定 20 秒切片、不把中间 clips 当最终成片。',
    '',
    '失败报告 JSON：',
    JSON.stringify(report, null, 2)
  ].join('\n');

const runCodexRepair = async (report: LoopReport, timeoutMs: number) => {
  const codex = process.env.CODEX_CLI_PATH || 'codex';
  const args = ['exec', 'resume', '--last', '--skip-git-repo-check', '-'];
  const prompt = buildRepairPrompt(report);
  return new Promise<CheckResult>((resolve) => {
    const started = Date.now();
    const target = spawnTarget(codex, args);
    const child = spawn(target.command, target.args, {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, Math.max(1000, timeoutMs));
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        name: 'codex-repair',
        command: codex,
        args,
        required: false,
        exitCode: 1,
        timedOut,
        durationMs: Date.now() - started,
        stdoutTail: tail(stdout),
        stderrTail: tail(`${stderr}\n${error.message}`.trim())
      });
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({
        name: 'codex-repair',
        command: codex,
        args,
        required: false,
        exitCode,
        timedOut,
        durationMs: Date.now() - started,
        stdoutTail: tail(stdout),
        stderrTail: tail(stderr)
      });
    });
    child.stdin.end(prompt);
  });
};

export async function main() {
  const mode = hasFlag('--full') ? 'full' : 'quick';
  const repairEnabled = hasFlag('--repair');
  const maxIterations = Math.max(1, Number(argValue('--max-iterations') ?? '3'));
  const outputDir = path.resolve(argValue('--output-dir') ?? 'runtime/codex-repair-loop');
  const repairTimeoutMs = Math.max(30_000, Number(argValue('--repair-timeout-ms') ?? '600000'));
  let finalReport: LoopReport | undefined;

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const startedAt = new Date().toISOString();
    const results: CheckResult[] = [];
    for (const check of checksForMode(mode)) {
      results.push(await runCommand(check.name, check.command, check.args, check));
    }
    const npmOutdated = hasFlag('--check-updates') ? await collectNpmOutdated() : undefined;
    const ok = results.every((result) => !result.required || (result.exitCode === 0 && !result.timedOut));
    const report: LoopReport = {
      ok,
      startedAt,
      finishedAt: new Date().toISOString(),
      iteration,
      mode,
      repairEnabled,
      results,
      npmOutdated,
      nextAction: ok
        ? 'No action required.'
        : repairEnabled && iteration < maxIterations
          ? 'Invoke Codex repair and re-run checks.'
          : 'Inspect latest.md and repair manually or re-run with --repair.'
    };
    finalReport = report;
    const paths = writeReport(report, outputDir);
    console.log(JSON.stringify({ ok: report.ok, iteration, latest: paths.latestMdPath }, null, 2));
    if (ok) break;
    if (!repairEnabled || iteration >= maxIterations) break;
    const repair = await runCodexRepair(report, repairTimeoutMs);
    fs.writeFileSync(path.join(outputDir, `repair-${String(iteration).padStart(2, '0')}.json`), `${JSON.stringify(repair, null, 2)}\n`, 'utf8');
  }

  if (!finalReport?.ok) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
