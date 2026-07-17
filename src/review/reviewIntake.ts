import type { TaskRecord } from '../types.js';

export interface ReviewDraft {
  outcome: string;
  resultMet: boolean;
  lessons: string[];
  nextActions: string[];
  playbookCandidate?: string;
}

export function createReviewDraft(task: TaskRecord, note: string): ReviewDraft {
  const normalizedNote = note.trim();
  const resultMet = inferResultMet(task, normalizedNote);
  const lessons = extractLessons(normalizedNote);
  const nextActions = extractNextActions(normalizedNote, resultMet);
  const playbookCandidate = extractPlaybookCandidate(task, normalizedNote);

  return {
    outcome: normalizedNote || defaultOutcomeFor(task),
    resultMet,
    lessons,
    nextActions,
    playbookCandidate
  };
}

function inferResultMet(task: TaskRecord, note: string) {
  if (/未达标|失败|没完成|不满意|blocked|failed/i.test(note)) return false;
  if (/达标|成功|完成|满意|有效|done/i.test(note)) return true;
  return task.status === 'done';
}

function extractLessons(note: string) {
  const lessons = splitNote(note)
    .filter((item) => /经验|教训|下次|以后|因为|注意|保持|避免/i.test(item))
    .slice(0, 5);

  return lessons.length ? lessons : ['记录本次任务结果，后续可用于改进同类流程。'];
}

function extractNextActions(note: string, resultMet: boolean) {
  const explicit = splitNote(note)
    .filter((item) => /下一步|下次|需要|应该|继续|补充|沉淀|复用/i.test(item))
    .slice(0, 5);

  if (explicit.length) return explicit;
  return resultMet
    ? ['把有效做法沉淀为可复用流程。']
    : ['补充上下文并重新拆解任务。'];
}

function extractPlaybookCandidate(task: TaskRecord, note: string) {
  if (!/playbook|SOP|流程|标准|模板|沉淀|复用/i.test(note)) return undefined;

  const reusableNotes = splitNote(note)
    .filter((item) => /playbook|SOP|流程|标准|模板|沉淀|复用|下次|应该/i.test(item));

  return [
    `适用任务：${task.title}`,
    '',
    ...(reusableNotes.length ? reusableNotes : [note.trim()])
  ].join('\n');
}

function defaultOutcomeFor(task: TaskRecord) {
  return task.status === 'done'
    ? `任务已完成：${task.title}`
    : `任务当前状态为 ${task.status}：${task.title}`;
}

function splitNote(note: string) {
  return note
    .split(/[。；;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
