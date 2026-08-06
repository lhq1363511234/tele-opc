import fs from 'node:fs/promises';
import path from 'node:path';
import type { MetaAgentBlueprintRecord, MetaAgentComponentRecord } from './contracts.js';

export class ReferenceComponentAssembler {
  constructor(private readonly rootDir = path.resolve(process.cwd(), 'runtime', 'meta-agent', 'components')) {}

  async assemble(blueprint: MetaAgentBlueprintRecord, components: MetaAgentComponentRecord[], limit = 5) {
    const assembled: string[] = [];
    await fs.mkdir(this.rootDir, { recursive: true, mode: 0o700 });
    for (const component of components.slice(0, Math.max(1, Math.min(limit, 10)))) {
      const directory = path.join(this.rootDir, safeId(component.id));
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const manifest = {
        schemaVersion: 1,
        assembledAt: new Date().toISOString(),
        mode: component.source === 'local' ? 'built_in' : 'reference_only',
        executable: false,
        blueprint: {
          id: blueprint.id,
          systemName: blueprint.system_name
        },
        component: {
          id: component.id,
          source: component.source,
          externalId: component.external_id,
          name: component.name,
          description: component.description,
          url: component.url,
          version: component.version,
          score: component.score,
          metadata: component.metadata
        },
        security: {
          trusted: false,
          instructionsExecutable: false,
          credentialsMounted: false,
          networkAccessGranted: false,
          hostExecutionGranted: false
        }
      };
      const target = path.join(directory, 'manifest.json');
      const temporary = `${target}.${process.pid}.tmp`;
      await fs.writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      await fs.rename(temporary, target);
      assembled.push(target);
    }
    return assembled;
  }
}

function safeId(value: string) {
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw new Error('invalid_component_id');
  return value;
}
