import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  normalizeAiGeneratedTimelineForCapcut,
  parseSrtCues,
  remapSrtCuesToTimeline,
  stabilizeCaptionsForDraft,
  type SubtitleCue
} from '../../src/appos/domains/cps/short-drama-capcut-prep.js';
import { normalizeShortDramaTask, type ShortDramaEditPlan } from '../../src/appos/domains/cps/short-drama-edit-planner.js';

type DraftResult = {
  variantId: string;
  variantName: string;
  status: string;
  clips: Array<{ clipPath?: string }>;
};

const argValue = (flag: string) => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
};

const readJson = <T>(filePath: string) => JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;

const writeJson = (filePath: string, data: unknown) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
};

const escapeAssText = (text: string) =>
  wrapEnglishSubtitle(text)
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\n/g, '\\N');

const wrapEnglishSubtitle = (text: string, maxLineLength = 34) => {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxLineLength || !current) {
      current = next;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  if (lines.length <= 2) return lines.join('\n');
  return `${lines[0]}\n${lines.slice(1).join(' ')}`;
};

const assTime = (seconds: number) => {
  const totalCentiseconds = Math.max(0, Math.round(seconds * 100));
  const centiseconds = totalCentiseconds % 100;
  const totalSeconds = Math.floor(totalCentiseconds / 100);
  const secs = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
};

const writeAss = (filePath: string, cues: SubtitleCue[]) => {
  const dialogue = cues
    .filter((cue) => cue.text.trim() && cue.end > cue.start)
    .map((cue) => `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},English,,0,0,0,,${escapeAssText(cue.text)}`)
    .join('\n');

  const ass = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1080',
    'PlayResY: 1920',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: English,Arial,44,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,0,2,64,64,150,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    dialogue
  ].join('\n');

  fs.writeFileSync(filePath, ass, 'utf8');
};

const run = (command: string, args: string[], cwd?: string) => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
};

const ffmpeg = () => process.env.FFMPEG_PATH || 'ffmpeg';

export function main() {
  const payloadPath = argValue('--payload');
  const planPath = argValue('--plan');
  const draftsPath = argValue('--drafts');
  const outputDir = path.resolve(argValue('--output-dir') || 'runtime/short-drama-hardsub-exports');
  if (!payloadPath || !planPath || !draftsPath) {
    throw new Error('Missing --payload, --plan, or --drafts');
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const task = normalizeShortDramaTask(readJson(path.resolve(payloadPath)));
  const plan = readJson<ShortDramaEditPlan>(path.resolve(planPath));
  const drafts = readJson<DraftResult[]>(path.resolve(draftsPath));

  const cuesByEpisode = new Map<number, SubtitleCue[]>();
  for (const episode of task.mediaEpisodes) {
    if (!episode.transcriptPath || !fs.existsSync(episode.transcriptPath)) continue;
    const cues = parseSrtCues(fs.readFileSync(episode.transcriptPath, 'utf8'));
    cuesByEpisode.set(episode.episodeNumber, cues);
  }

  const manifest: unknown[] = [];
  for (const variant of plan.styleVariants) {
    const draft = drafts.find((item) => item.variantId === variant.variantId);
    if (!draft || draft.status !== 'created') continue;
    const clipPaths = draft.clips.map((clip) => clip.clipPath).filter((clipPath): clipPath is string => Boolean(clipPath));
    if (clipPaths.length === 0) continue;
    for (const clipPath of clipPaths) {
      if (!fs.existsSync(clipPath)) throw new Error(`Missing clip for ${variant.variantId}: ${clipPath}`);
    }

    const variantDir = path.join(outputDir, variant.variantId);
    fs.mkdirSync(variantDir, { recursive: true });
    const concatListPath = path.join(variantDir, 'concat.txt');
    const assPath = path.join(variantDir, 'english_subtitles.ass');
    const concatVideoPath = path.join(variantDir, 'merged_no_subtitles.mp4');
    const outputVideoPath = path.join(outputDir, `${variant.variantId}.mp4`);

    fs.writeFileSync(concatListPath, clipPaths.map((clipPath) => `file '${clipPath.replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');

    const timeline = normalizeAiGeneratedTimelineForCapcut(variant.timeline, task.mediaEpisodes, {
      targetMinSeconds: 90,
      targetMaxSeconds: 180
    });
    const cues = stabilizeCaptionsForDraft(remapSrtCuesToTimeline(timeline, cuesByEpisode));
    writeAss(assPath, cues);

    run(ffmpeg(), ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', concatVideoPath]);
    run(
      ffmpeg(),
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        concatVideoPath,
        '-vf',
        `ass=${path.basename(assPath)}`,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '20',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        outputVideoPath
      ],
      variantDir
    );

    manifest.push({
      variantId: variant.variantId,
      variantName: variant.variantName,
      outputVideoPath,
      subtitlePath: assPath,
      captionCount: cues.length,
      clipCount: clipPaths.length
    });
  }

  const manifestPath = path.join(outputDir, 'export_manifest.json');
  writeJson(manifestPath, manifest);
  console.log(JSON.stringify({ outputDir, manifestPath, exported: manifest.length }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
