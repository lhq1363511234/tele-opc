import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildDramaRun, materializeDramaRun, type DramaRunInputPayload } from '../../src/appos/domains/cps/drama-run.js';

const argValue = (flag: string) => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
};

export function main() {
  const payloadPath = argValue('--payload');
  if (!payloadPath) throw new Error('Missing --payload <dify_short_drama_cps_payload.json>');
  const runtimeRoot = argValue('--runtime-root') ?? 'runtime/runs';
  const payload = JSON.parse(fs.readFileSync(path.resolve(payloadPath), 'utf8')) as DramaRunInputPayload;
  const run = buildDramaRun(payload, { runtimeRoot: path.resolve(runtimeRoot) });
  const outputs = materializeDramaRun(run);
  console.log(JSON.stringify({ runId: run.manifest.runId, runDir: run.runDir, ...outputs }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
