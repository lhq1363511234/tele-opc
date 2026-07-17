import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { runMediaPreprocess } from '../../src/appos/media/preprocess.js';

const argValue = (flag: string) => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
};

export function main() {
  const rootEnv = 'B:\\Cir\\CodexProjects\\opc-local.env';
  if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv, override: false });
  dotenv.config({ override: false });

  const inputPath = argValue('--input');
  if (!inputPath) {
    throw new Error('Missing --input <video-path>');
  }
  const outputDir = argValue('--output-dir') ?? 'runtime/media-preprocess-output';
  const sampleCount = Number(argValue('--samples') ?? '8');
  const whisperModelPath = argValue('--whisper-model') ?? process.env.APPOS_WHISPER_MODEL_PATH;
  const whisperCliPath = argValue('--whisper-cli') ?? process.env.APPOS_WHISPER_CLI_PATH;
  const whisperCliModel = argValue('--whisper-cli-model') ?? process.env.APPOS_WHISPER_CLI_MODEL;
  const whisperCliTimeoutMs = Number(argValue('--whisper-cli-timeout-ms') ?? process.env.APPOS_WHISPER_CLI_TIMEOUT_MS ?? '900000');
  const language = argValue('--language') ?? process.env.APPOS_ASR_LANGUAGE ?? 'en';

  const report = runMediaPreprocess({
    inputPath: path.resolve(inputPath),
    outputDir: path.resolve(outputDir),
    sampleCount: Number.isFinite(sampleCount) ? sampleCount : 8,
    whisperModelPath,
    whisperCliPath,
    whisperCliModel,
    whisperCliTimeoutMs: Number.isFinite(whisperCliTimeoutMs) ? whisperCliTimeoutMs : 900000,
    language
  });

  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
