import { describe, expect, it } from 'vitest';
import { parseBlackdetectLog, parseSilencedetectLog, parseSrt, summarizeProbe } from '../../src/appos/media/preprocess.js';

describe('media preprocess helpers', () => {
  it('parses ffmpeg blackdetect intervals', () => {
    const intervals = parseBlackdetectLog(
      '[blackdetect @ 000] black_start:1.2 black_end:2.8 black_duration:1.6\n[blackdetect @ 000] black_start:9 black_end:10 black_duration:1'
    );

    expect(intervals).toEqual([
      { start: 1.2, end: 2.8, duration: 1.6 },
      { start: 9, end: 10, duration: 1 }
    ]);
  });

  it('parses ffmpeg silencedetect intervals', () => {
    const intervals = parseSilencedetectLog('silence_start: 3.5\nsilence_end: 5.75 | silence_duration: 2.25');

    expect(intervals).toEqual([{ start: 3.5, end: 5.75, duration: 2.25 }]);
  });

  it('summarizes ffprobe streams for downstream planning', () => {
    const summary = summarizeProbe(
      {
        format: { duration: '12.5', size: '1000', bit_rate: '64000' },
        streams: [
          { codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920, avg_frame_rate: '30000/1001' },
          { codec_type: 'audio', codec_name: 'aac', channels: 2, sample_rate: '48000' }
        ]
      },
      'video.mp4'
    );

    expect(summary).toMatchObject({
      durationSeconds: 12.5,
      width: 1080,
      height: 1920,
      aspectRatio: '9:16',
      orientation: 'vertical',
      videoCodec: 'h264',
      audioCodec: 'aac',
      audioChannels: 2,
      audioSampleRate: 48000
    });
    expect(summary.frameRate).toBeCloseTo(29.97, 2);
  });

  it('parses SRT transcript segments for Dify payloads', () => {
    const segments = parseSrt('1\n00:00:01,000 --> 00:00:02,000\nHello there.\n\n2\n00:00:03,000 --> 00:00:04,500\nSecond line.');

    expect(segments).toEqual([
      { start: '00:00:01,000', end: '00:00:02,000', text: 'Hello there.' },
      { start: '00:00:03,000', end: '00:00:04,500', text: 'Second line.' }
    ]);
  });
});
