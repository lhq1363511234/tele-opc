import type { TaskPublicBrief } from '../work/workStrategy.js';

export interface DeckInput {
  subject: string;
  audience: string;
  objective: string;
  pageCount: number;
  style: string;
  outputLanguage: string;
  mustCover: string[];
}

export interface SlideDeckSpec {
  title: string;
  theme: string;
  slides: SlideSpec[];
}

export interface SlideSpec {
  eyebrow: string;
  title: string;
  subtitle: string;
  bullets: string[];
  speakerNotes?: string;
  visualHint?: string;
}

const INTERNAL_LEAK_PATTERNS = [
  /Work Strategy/i,
  /artifactType/i,
  /deliveryStrategy/i,
  /leaderIntent/i,
  /internalBrief/i,
  /publicBrief/i,
  /expectedOutput/i,
  /qualityBar/i,
  /系统理解/,
  /领导原话/,
  /预期产出/,
  /交付判断/,
  /默认假设/,
  /执行 Agent/,
  /Agent 执行链/,
  /当前最需要解决的障碍是什么/,
  /为什么会在这个问题上犹豫/,
  /哪里不够好/,
  /给出结论、依据和下一步/,
  /必须用具体场景表达/
];

export function deckInputFromPublicBrief(brief: TaskPublicBrief): DeckInput {
  return {
    subject: cleanSubject(brief.subject || brief.title || brief.originalRequest),
    audience: cleanAudience(brief.audience),
    objective: cleanObjective(brief.purpose, brief.subject),
    pageCount: clampPageCount(brief.pageCount),
    style: brief.style || '简洁商务',
    outputLanguage: brief.outputLanguage || '中文',
    mustCover: cleanMustCover(brief.mustInclude)
  };
}

export function slideDeckSpecFromAgentContent(content: string, input: DeckInput): SlideDeckSpec {
  const parsed = parseJsonObjectFromModel(content);
  const spec = normalizeGeneratedDeckSpec(parsed, input);
  assertDeckCanShip(spec, input);
  return spec;
}

export function sanitizeSlideDeckSpec(spec: SlideDeckSpec, input: DeckInput): SlideDeckSpec {
  const fallback = fallbackDeckSpec(input);
  const slides = spec.slides
    .map((slide, index) => sanitizeSlide(slide, fallback.slides[index] ?? fallback.slides[fallback.slides.length - 1]))
    .filter((slide) => slide.title && slide.bullets.length > 0);

  const sanitized = {
    title: hasInternalLeak(spec.title) ? fallback.title : spec.title,
    theme: hasInternalLeak(spec.theme) ? fallback.theme : spec.theme,
    slides: slides.length > 0 ? slides : fallback.slides
  };

  return {
    ...sanitized,
    slides: sanitized.slides.slice(0, input.pageCount)
  };
}

export function slideDeckContainsInternalLeak(spec: SlideDeckSpec) {
  return hasInternalLeak(JSON.stringify(spec));
}

function normalizeGeneratedDeckSpec(value: unknown, input: DeckInput): SlideDeckSpec {
  if (!isRecord(value)) {
    throw new Error('slide_deck_ai_output_not_object');
  }
  const rawSlides = Array.isArray(value.slides) ? value.slides : [];
  const slides = rawSlides.map((item, index) => normalizeGeneratedSlide(item, index)).filter(Boolean);
  return {
    title: stringValue(value.title) || `${input.subject} PPT`,
    theme: stringValue(value.theme) || input.style,
    slides: slides.slice(0, input.pageCount)
  };
}

function normalizeGeneratedSlide(value: unknown, index: number): SlideSpec {
  const record = isRecord(value) ? value : {};
  const bullets = Array.isArray(record.bullets)
    ? record.bullets.map(stringValue).filter(Boolean).filter((item) => !hasInternalLeak(item)).slice(0, 4)
    : [];
  return {
    eyebrow: stringValue(record.eyebrow) || String(index + 1).padStart(2, '0'),
    title: stringValue(record.title),
    subtitle: stringValue(record.subtitle),
    bullets,
    visualHint: stringValue(record.visualHint) || undefined,
    speakerNotes: stringValue(record.speakerNotes) || undefined
  };
}

function assertDeckCanShip(spec: SlideDeckSpec, input: DeckInput) {
  if (spec.slides.length !== input.pageCount) {
    throw new Error(`slide_deck_ai_slide_count_mismatch:${spec.slides.length}/${input.pageCount}`);
  }
  if (slideDeckContainsInternalLeak(spec)) {
    throw new Error('slide_deck_ai_internal_prompt_leak');
  }
  if (looksLikeBuiltInTemplate(spec)) {
    throw new Error('slide_deck_ai_used_builtin_template');
  }
  const weakSlide = spec.slides.find((slide) => !slide.title || !slide.subtitle || slide.bullets.length < 3);
  if (weakSlide) {
    throw new Error('slide_deck_ai_incomplete_slide');
  }
  const subjectSignal = mainSubjectSignal(input.subject);
  if (subjectSignal && !JSON.stringify(spec).includes(subjectSignal)) {
    throw new Error('slide_deck_ai_missed_subject');
  }
}

function looksLikeBuiltInTemplate(spec: SlideDeckSpec) {
  const templateTitles = new Set([
    '核心传播结论',
    '消费趋势',
    '产品定位',
    '目标人群',
    '传播主张',
    '内容打法',
    '渠道打法',
    '执行节奏',
    '下一步建议'
  ]);
  const count = spec.slides.filter((slide) => templateTitles.has(slide.title.trim())).length;
  return count >= 3 || spec.slides[1]?.title.trim() === '核心传播结论';
}

function parseJsonObjectFromModel(content: string) {
  const trimmed = content.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    }
    throw new Error('slide_deck_ai_json_parse_failed');
  }
}

function mainSubjectSignal(subject: string) {
  const compact = subject.replace(/\s+/g, '');
  if (!compact) return '';
  const brand = compact.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,8}/)?.[0] ?? '';
  return brand.length >= 2 ? brand : '';
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeSlide(slide: SlideSpec, fallback: SlideSpec): SlideSpec {
  const bullets = slide.bullets
    .filter((bullet) => bullet.trim())
    .filter((bullet) => !hasInternalLeak(bullet))
    .slice(0, 4);

  return {
    eyebrow: hasInternalLeak(slide.eyebrow) ? fallback.eyebrow : slide.eyebrow,
    title: hasInternalLeak(slide.title) ? fallback.title : slide.title,
    subtitle: hasInternalLeak(slide.subtitle) ? fallback.subtitle : slide.subtitle,
    bullets: bullets.length > 0 ? bullets : fallback.bullets,
    speakerNotes: slide.speakerNotes && !hasInternalLeak(slide.speakerNotes) ? slide.speakerNotes : undefined,
    visualHint: slide.visualHint && !hasInternalLeak(slide.visualHint) ? slide.visualHint : fallback.visualHint
  };
}

function fallbackDeckSpec(input: DeckInput): SlideDeckSpec {
  return {
    title: `${input.subject}方案`,
    theme: input.style,
    slides: [
      {
        eyebrow: 'Cover',
        title: `${input.subject}方案`,
        subtitle: `${input.audience} · ${input.style}`,
        bullets: [
          input.objective,
          '围绕核心价值、目标人群和落地动作形成可展示材料。',
          '后续可继续补充真实数据、图片和案例。'
        ]
      },
      {
        eyebrow: '01 Value',
        title: '核心价值',
        subtitle: `${input.subject}需要被讲成一个清楚的选择理由。`,
        bullets: [
          '明确产品或方案最值得被记住的价值。',
          '用目标人群熟悉的场景表达收益。',
          '把优势转化成可验证、可行动的卖点。'
        ]
      }
    ]
  };
}

function cleanSubject(value: string) {
  return value
    .replace(/帮我|请|给我|写一个|做一个|生成|制作|PPT|ppt|幻灯片|演示文稿/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[，,。；;：:\s]+|[，,。；;：:\s]+$/g, '')
    .trim() || '主题';
}

function cleanAudience(value: string) {
  return value && value !== '目标听众' ? value : '目标受众';
}

function cleanObjective(value: string, subject: string) {
  if (value && !hasInternalLeak(value)) return value;
  return `让目标受众快速理解${subject}的核心价值、适用场景和下一步行动。`;
}

function cleanMustCover(value: string[]) {
  const cleaned = value
    .map((item) => item.trim())
    .filter((item) => item && !hasInternalLeak(item));
  return cleaned.length > 0 ? cleaned : ['核心价值', '目标人群', '传播主张', '执行计划', '风险边界'];
}

function clampPageCount(value: number | undefined) {
  return Math.min(Math.max(value ?? 10, 6), 14);
}

function hasInternalLeak(value: string) {
  return INTERNAL_LEAK_PATTERNS.some((pattern) => pattern.test(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
