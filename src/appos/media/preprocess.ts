import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export type MediaPreprocessOptions = {
  inputPath: string;
  outputDir: string;
  sampleCount?: number;
  whisperModelPath?: string;
  whisperCliPath?: string;
  whisperCliModel?: string;
  whisperCliTimeoutMs?: number;
  language?: string;
};

export type MediaProbeSummary = {
  durationSeconds: number;
  sizeBytes: number;
  bitrate: number | null;
  width: number | null;
  height: number | null;
  aspectRatio: string;
  orientation: 'vertical' | 'horizontal' | 'square' | 'unknown';
  frameRate: number | null;
  videoCodec: string;
  audioCodec: string;
  audioChannels: number | null;
  audioSampleRate: number | null;
};

export type TimedInterval = {
  start: number;
  end: number;
  duration: number;
};

export type MediaPreprocessReport = {
  source: {
    inputPath: string;
    sha256: string;
  };
  probe: MediaProbeSummary;
  screenshots: Array<{
    timeSeconds: number;
    path: string;
  }>;
  keyframes: Array<{
    timeSeconds: number;
    pictType: string;
  }>;
  quality: {
    blackIntervals: TimedInterval[];
    blackDurationSeconds: number;
    blackRatio: number;
    silenceIntervals: TimedInterval[];
    silenceDurationSeconds: number;
    dialogueDensity: number;
  };
  asr: {
    status: 'done' | 'skipped' | 'failed';
    language: string;
    transcriptPath: string;
    transcriptText: string;
    segments: Array<{
      start: string;
      end: string;
      text: string;
    }>;
    error?: string;
  };
  outputs: {
    probeJsonPath: string;
    audioPath: string;
    blackdetectLogPath: string;
    silencedetectLogPath: string;
    reportPath: string;
    difyPayloadPath: string;
  };
};

const asNumber = (value: unknown) => {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const round = (value: number, digits = 4) => Number(value.toFixed(digits));

const run = (command: string, args: string[], capture = false) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed\n${result.stderr || result.stdout || ''}`);
  }
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  };
};

const ensureDir = (dir: string) => mkdirSync(dir, { recursive: true });

const writeJson = (filePath: string, value: unknown) => {
  ensureDir(path.dirname(filePath));
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const sha256File = (filePath: string) => {
  const hash = createHash('sha256');
  hash.update(readFileSync(filePath));
  return hash.digest('hex');
};

const parseFrameRate = (value: unknown) => {
  const text = String(value ?? '');
  const [left, right] = text.split('/').map(Number);
  if (!Number.isFinite(left) || !Number.isFinite(right) || right === 0) return null;
  return round(left / right);
};

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));

const aspectRatio = (width: number | null, height: number | null) => {
  if (!width || !height) return 'unknown';
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
};

export function summarizeProbe(probe: any, filePath: string): MediaProbeSummary {
  const video = probe.streams?.find((stream: any) => stream.codec_type === 'video');
  const audio = probe.streams?.find((stream: any) => stream.codec_type === 'audio');
  const width = asNumber(video?.width);
  const height = asNumber(video?.height);
  const durationSeconds = asNumber(probe.format?.duration) ?? asNumber(video?.duration) ?? 0;
  const sizeBytes = asNumber(probe.format?.size) ?? statSync(filePath).size;

  return {
    durationSeconds: round(durationSeconds),
    sizeBytes,
    bitrate: asNumber(probe.format?.bit_rate),
    width,
    height,
    aspectRatio: aspectRatio(width, height),
    orientation: !width || !height ? 'unknown' : width < height ? 'vertical' : width > height ? 'horizontal' : 'square',
    frameRate: parseFrameRate(video?.avg_frame_rate ?? video?.r_frame_rate),
    videoCodec: String(video?.codec_name ?? ''),
    audioCodec: String(audio?.codec_name ?? ''),
    audioChannels: asNumber(audio?.channels),
    audioSampleRate: asNumber(audio?.sample_rate)
  };
}

export function parseBlackdetectLog(log: string): TimedInterval[] {
  return [...log.matchAll(/black_start:([0-9.]+)\s+black_end:([0-9.]+)\s+black_duration:([0-9.]+)/g)].map((match) => ({
    start: round(Number(match[1])),
    end: round(Number(match[2])),
    duration: round(Number(match[3]))
  }));
}

export function parseSilencedetectLog(log: string): TimedInterval[] {
  const starts = [...log.matchAll(/silence_start:\s*([0-9.]+)/g)].map((match) => Number(match[1]));
  const ends = [...log.matchAll(/silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/g)].map((match) => ({
    end: Number(match[1]),
    duration: Number(match[2])
  }));
  return ends.map((item, index) => ({
    start: round(starts[index] ?? Math.max(0, item.end - item.duration)),
    end: round(item.end),
    duration: round(item.duration)
  }));
}

export function parseSrt(srt: string) {
  return srt
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\r?\n/);
      const timingLine = lines.find((line) => line.includes('-->')) ?? '';
      const [start = '', end = ''] = timingLine.split('-->').map((part) => part.trim());
      const text = lines.slice(lines.indexOf(timingLine) + 1).join(' ').trim();
      return { start, end, text };
    })
    .filter((segment) => segment.start && segment.end && segment.text);
}

const sumIntervals = (intervals: TimedInterval[]) => round(intervals.reduce((sum, interval) => sum + interval.duration, 0));

const ffprobeJson = (inputPath: string) => {
  const result = run(
    'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', inputPath],
    true
  );
  return JSON.parse(result.stdout);
};

const keyframes = (inputPath: string) => {
  const result = run(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-skip_frame',
      'nokey',
      '-show_frames',
      '-show_entries',
      'frame=best_effort_timestamp_time,pict_type',
      '-print_format',
      'json',
      inputPath
    ],
    true
  );
  const parsed = JSON.parse(result.stdout);
  return (parsed.frames ?? [])
    .map((frame: any) => ({
      timeSeconds: round(Number(frame.best_effort_timestamp_time ?? 0)),
      pictType: String(frame.pict_type ?? '')
    }))
    .filter((frame: { timeSeconds: number }) => Number.isFinite(frame.timeSeconds))
    .slice(0, 50);
};

const screenshotTimes = (durationSeconds: number, sampleCount: number) => {
  if (durationSeconds <= 0) return [0];
  const count = Math.max(1, sampleCount);
  return Array.from({ length: count }, (_, index) => round(((index + 1) * durationSeconds) / (count + 1), 3));
};

const captureScreenshots = (inputPath: string, outputDir: string, durationSeconds: number, sampleCount: number) => {
  const dir = path.join(outputDir, 'screenshots');
  ensureDir(dir);
  return screenshotTimes(durationSeconds, sampleCount).map((time, index) => {
    const filePath = path.join(dir, `sample_${String(index + 1).padStart(2, '0')}_${String(Math.round(time)).padStart(4, '0')}s.jpg`);
    run('ffmpeg', ['-y', '-ss', String(time), '-i', inputPath, '-frames:v', '1', '-q:v', '2', '-update', '1', filePath], true);
    return { timeSeconds: time, path: filePath };
  });
};

const extractAudio = (inputPath: string, outputDir: string) => {
  const audioPath = path.join(outputDir, 'audio_16k_mono.wav');
  run('ffmpeg', ['-y', '-i', inputPath, '-vn', '-ac', '1', '-ar', '16000', audioPath], true);
  return audioPath;
};

const filterPath = (filePath: string) => {
  const absolutePath = path.resolve(filePath);
  const relativePath = path.relative(process.cwd(), absolutePath);
  const portablePath = !relativePath.startsWith('..') && !path.isAbsolute(relativePath) ? relativePath : absolutePath;
  return portablePath.replace(/\\/g, '/').replace(/'/g, "\\'");
};

const defaultWhisperCliPath = () => {
  const candidate = 'B:\\Cir\\AI\\CosyVoice\\app\\.venv\\Scripts\\whisper.exe';
  return existsSync(candidate) ? candidate : undefined;
};

const readTranscript = (transcriptPath: string, language: string) => {
  const segments = existsSync(transcriptPath) ? parseSrt(readFileSync(transcriptPath, 'utf8')) : [];
  return {
    status: 'done' as const,
    language,
    transcriptPath,
    transcriptText: segments.map((segment) => segment.text).join('\n'),
    segments
  };
};

const runWhisperCli = (
  audioPath: string,
  outputDir: string,
  transcriptPath: string,
  cliPath: string,
  language: string,
  modelName: string | undefined,
  timeoutMs: number
) => {
  const args = [
    audioPath,
    '--language',
    language,
    '--task',
    'transcribe',
    '--output_format',
    'srt',
    '--output_dir',
    outputDir,
    '--fp16',
    'False'
  ];
  if (modelName) args.push('--model', modelName);
  const result = spawnSync(cliPath, args, {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: timeoutMs,
    env: {
      ...process.env,
      PYTHONIOENCODING: process.env.PYTHONIOENCODING || 'utf-8'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.error?.message.includes('ETIMEDOUT')) {
    throw new Error(`Whisper CLI timed out after ${timeoutMs}ms: ${cliPath} ${args.join(' ')}`);
  }
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${cliPath} ${args.join(' ')} failed\n${result.stderr || result.stdout || ''}`);
  }
  const generatedPath = path.join(outputDir, `${path.parse(audioPath).name}.srt`);
  if (!existsSync(generatedPath)) {
    throw new Error(`Whisper CLI did not generate SRT: ${generatedPath}`);
  }
  if (generatedPath !== transcriptPath) {
    writeFileSync(transcriptPath, readFileSync(generatedPath));
  }
};

const runAsr = (
  inputPath: string,
  audioPath: string,
  outputDir: string,
  modelPath: string | undefined,
  language: string,
  whisperCliPath?: string,
  whisperCliModel?: string,
  whisperCliTimeoutMs?: number
) => {
  const transcriptPath = path.join(outputDir, 'transcript.srt');
  if (modelPath && !existsSync(modelPath)) {
    return {
      status: 'failed' as const,
      language,
      transcriptPath,
      transcriptText: '',
      segments: [],
      error: `Whisper model not found: ${modelPath}`
    };
  }
  try {
    if (modelPath) {
      const filter = `whisper=model=${filterPath(modelPath)}:language=${language}:use_gpu=false:destination=${filterPath(transcriptPath)}:format=srt`;
      run('ffmpeg', ['-y', '-i', inputPath, '-af', filter, '-f', 'null', '-'], true);
      return readTranscript(transcriptPath, language);
    }
    const cliPath = whisperCliPath || defaultWhisperCliPath();
    if (cliPath && existsSync(cliPath)) {
      const timeoutMs = whisperCliTimeoutMs ?? Number(process.env.APPOS_WHISPER_CLI_TIMEOUT_MS || 900000);
      runWhisperCli(audioPath, outputDir, transcriptPath, cliPath, language, whisperCliModel ?? process.env.APPOS_WHISPER_CLI_MODEL ?? 'tiny.en', timeoutMs);
      return readTranscript(transcriptPath, language);
    }
    return {
      status: 'skipped' as const,
      language,
      transcriptPath,
      transcriptText: '',
      segments: [],
      error:
        'No whisper model or CLI configured. Set APPOS_WHISPER_MODEL_PATH for ffmpeg whisper filter or APPOS_WHISPER_CLI_PATH for OpenAI Whisper CLI.'
    };
  } catch (error) {
    return {
      status: 'failed' as const,
      language,
      transcriptPath,
      transcriptText: '',
      segments: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
};

export function runMediaPreprocess(options: MediaPreprocessOptions): MediaPreprocessReport {
  const inputPath = path.resolve(options.inputPath);
  const outputDir = path.resolve(options.outputDir);
  const sampleCount = options.sampleCount ?? 8;
  const language = options.language ?? 'en';
  if (!existsSync(inputPath)) {
    throw new Error(`Input video not found: ${inputPath}`);
  }
  ensureDir(outputDir);

  const probe = ffprobeJson(inputPath);
  const probeJsonPath = path.join(outputDir, 'ffprobe.json');
  writeJson(probeJsonPath, probe);
  const probeSummary = summarizeProbe(probe, inputPath);

  const screenshots = captureScreenshots(inputPath, outputDir, probeSummary.durationSeconds, sampleCount);
  const audioPath = extractAudio(inputPath, outputDir);

  const blackdetect = run(
    'ffmpeg',
    ['-hide_banner', '-i', inputPath, '-vf', 'blackdetect=d=0.5:pix_th=0.10', '-an', '-f', 'null', '-'],
    true
  );
  const blackdetectLogPath = path.join(outputDir, 'blackdetect.log');
  writeFileSync(blackdetectLogPath, blackdetect.stderr, 'utf8');
  const blackIntervals = parseBlackdetectLog(blackdetect.stderr);

  const silencedetect = run(
    'ffmpeg',
    ['-hide_banner', '-i', inputPath, '-af', 'silencedetect=noise=-35dB:d=0.3', '-f', 'null', '-'],
    true
  );
  const silencedetectLogPath = path.join(outputDir, 'silencedetect.log');
  writeFileSync(silencedetectLogPath, silencedetect.stderr, 'utf8');
  const silenceIntervals = parseSilencedetectLog(silencedetect.stderr);

  const silenceDurationSeconds = sumIntervals(silenceIntervals);
  const blackDurationSeconds = sumIntervals(blackIntervals);
  const asr = runAsr(
    inputPath,
    audioPath,
    outputDir,
    options.whisperModelPath,
    language,
    options.whisperCliPath ?? process.env.APPOS_WHISPER_CLI_PATH,
    options.whisperCliModel,
    options.whisperCliTimeoutMs
  );
  const reportPath = path.join(outputDir, 'media_preprocess_report.json');
  const difyPayloadPath = path.join(outputDir, 'dify_media_preprocess_payload.json');

  const report: MediaPreprocessReport = {
    source: {
      inputPath,
      sha256: sha256File(inputPath)
    },
    probe: probeSummary,
    screenshots,
    keyframes: keyframes(inputPath),
    quality: {
      blackIntervals,
      blackDurationSeconds,
      blackRatio: probeSummary.durationSeconds > 0 ? round(blackDurationSeconds / probeSummary.durationSeconds) : 0,
      silenceIntervals,
      silenceDurationSeconds,
      dialogueDensity:
        probeSummary.durationSeconds > 0 ? round(Math.max(0, probeSummary.durationSeconds - silenceDurationSeconds) / probeSummary.durationSeconds) : 0
    },
    asr,
    outputs: {
      probeJsonPath,
      audioPath,
      blackdetectLogPath,
      silencedetectLogPath,
      reportPath,
      difyPayloadPath
    }
  };

  writeJson(reportPath, report);
  writeJson(difyPayloadPath, {
    workflow: 'short_drama_media_analysis',
    source: 'tele-opc-media-preprocess',
    video: report.source,
    probe: report.probe,
    transcriptText: report.asr.transcriptText,
    transcriptSegments: report.asr.segments,
    screenshots: report.screenshots,
    keyframes: report.keyframes,
    quality: report.quality,
    requiredOutput: ['clip_opportunities', 'hook_candidates', 'risk_notes', 'edit_timeline_candidates']
  });
  return report;
}
