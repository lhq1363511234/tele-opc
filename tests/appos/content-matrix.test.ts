import { describe, expect, it } from 'vitest';
import type { BusinessContract } from '../../src/appos/contracts/types.js';
import { createContentMatrixFromContract, canGenerateCapcutDraft } from '../../src/appos/domains/content/content-service.js';

const contract: BusinessContract = {
  id: 'bc_content_001',
  sourceIntentPacketId: 'intent_001',
  sourceUtteranceId: 'utt_001',
  goal: 'Create CPS content matrix',
  domain: 'social_distribution',
  successCriteria: ['create posts'],
  inputs: { topic: 'AI tools CPS', platforms: ['douyin', 'xiaohongshu'] },
  expectedOutputs: ['workflow_run', 'artifact', 'approval'],
  riskLevel: 'medium',
  approvalRequired: true,
  constraints: ['No publish before approval'],
  memoryPolicy: 'candidate_only',
  createdAt: '2026-06-24T01:30:00.000Z'
};

describe('content matrix service', () => {
  it('creates a campaign and platform posts from Dify output', () => {
    const result = createContentMatrixFromContract(contract, {
      campaign: { name: 'AI tools CPS', objective: 'Create platform posts' },
      posts: [
        { platform: 'douyin', title: 'Title 1', script: 'Script 1', caption: 'Caption 1', tags: ['AI'] },
        { platform: 'xiaohongshu', title: 'Title 2', script: 'Script 2', caption: 'Caption 2', tags: ['AI'] }
      ]
    });

    expect(result.campaign.contractId).toBe('bc_content_001');
    expect(result.posts).toHaveLength(2);
    expect(result.approvals).toHaveLength(2);
  });

  it('blocks capcut generation until approval', () => {
    expect(canGenerateCapcutDraft({ status: 'reviewing' })).toBe(false);
    expect(canGenerateCapcutDraft({ status: 'approved' })).toBe(true);
  });
});
