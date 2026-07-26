import type { BrainContext } from '../chiefOfStaff.js';

export type CommandHandler = (
  arg: string | undefined,
  context: BrainContext
) => Promise<string> | string;

export type CommandRegistry = Record<string, CommandHandler>;
