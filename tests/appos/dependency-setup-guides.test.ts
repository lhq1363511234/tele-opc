import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const appSource = readFileSync(path.resolve(process.cwd(), 'web/src/App.tsx'), 'utf8');
const detailedGuideSource = appSource.slice(appSource.indexOf('dependencySetupGuides'));

describe('dependency setup guides', () => {
  it('provides field-level setup rows for core OPC dependencies', () => {
    for (const id of ['dify', 'n8n', 'cloakbrowser', 'inbeidou_profile', 'capcut_mate', 'feishu_base']) {
      const guideStart = detailedGuideSource.indexOf(`${id}: {`);
      expect(guideStart, id).toBeGreaterThan(-1);
      const guideSnippet = detailedGuideSource.slice(guideStart, guideStart + 3000);
      expect(guideSnippet, id).toContain('fieldRows');
    }
  });

  it('explains where users get the values for critical fields', () => {
    expect(detailedGuideSource).toContain("field: 'API Key / Token'");
    expect(detailedGuideSource).toContain('Personal Access Token');
    expect(detailedGuideSource).toContain("field: '启动命令'");
    expect(detailedGuideSource).toContain('profileId');
  });
});
