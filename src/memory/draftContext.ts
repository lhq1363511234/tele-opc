import type { MemoryRecord } from '../types.js';

export interface AppliedMemory {
  id: string;
  type: string;
  content: string;
}

export interface DraftContext {
  appliedMemories: AppliedMemory[];
  maxChars?: number;
  toneNotes: string[];
}

export function buildDraftContext(memories: MemoryRecord[]): DraftContext {
  const context: DraftContext = {
    appliedMemories: [],
    toneNotes: []
  };

  for (const memory of memories) {
    const content = memory.content.trim();
    const maxChars = extractMaxChars(content);
    const isToneMemory = /语气|风格|简洁|直接|销售|短|brief|concise|tone/i.test(content);

    if (maxChars || isToneMemory) {
      context.appliedMemories.push({
        id: memory.id,
        type: memory.type,
        content
      });
    }

    if (maxChars) {
      context.maxChars = context.maxChars ? Math.min(context.maxChars, maxChars) : maxChars;
    }

    if (isToneMemory) {
      context.toneNotes.push(content);
    }
  }

  return context;
}

export function charLength(text: string) {
  return Array.from(text).length;
}

function extractMaxChars(content: string) {
  const match = content.match(/(?:最大|最多|不超过|少于|控制在|<=|max(?:imum)?|under)\s*(\d+)\s*(?:个?字|字符|chars?|characters?)?/i);
  if (!match) return undefined;

  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return value;
}
