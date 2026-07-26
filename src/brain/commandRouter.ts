import type { BrainContext } from './chiefOfStaff.js';
import type { CommandRegistry } from './commands/types.js';

export function routeCommand(
  registry: CommandRegistry,
  commandText: string,
  context: BrainContext
) {
  const match = commandText.match(/^(\S+)(?:\s+([\s\S]+))?$/);
  const command = match?.[1] ?? commandText;
  const arg = match?.[2]?.trim();
  const handler = registry[command];
  if (!handler) {
    return { handled: false as const, command, arg };
  }
  return {
    handled: true as const,
    command,
    arg,
    result: handler(arg, context)
  };
}
