import { describe, expect, it } from 'vitest';
import {
  businessContractSchema,
  channelMessageSchema,
  createBusinessContractFromMoraIntent,
  moraIntentPacketSchema
} from '../../src/appos/contracts/schemas.js';

describe('AppOS contract schemas', () => {
  it('accepts a valid business contract', () => {
    const parsed = businessContractSchema.parse({
      id: 'bc_001',
      sourceIntentPacketId: 'intent_001',
      sourceUtteranceId: 'utt_001',
      goal: 'Create a CPS content matrix',
      domain: 'social_distribution',
      successCriteria: ['create campaign', 'request approval before publish'],
      inputs: { topic: 'AI tools CPS' },
      expectedOutputs: ['artifact', 'approval', 'workflow_run'],
      riskLevel: 'medium',
      approvalRequired: true,
      approvalReason: 'External publishing requires owner review',
      constraints: ['Mora frozen', 'No automatic publishing'],
      memoryPolicy: 'candidate_only',
      createdAt: '2026-06-24T01:20:00.000Z'
    });

    expect(parsed.domain).toBe('social_distribution');
    expect(parsed.expectedOutputs).toContain('workflow_run');
  });

  it('rejects invalid business contracts with missing goal', () => {
    const result = businessContractSchema.safeParse({
      id: 'bc_002',
      sourceIntentPacketId: 'intent_002',
      sourceUtteranceId: 'utt_002',
      domain: 'content',
      successCriteria: [],
      inputs: {},
      expectedOutputs: ['workflow_run'],
      riskLevel: 'low',
      approvalRequired: false,
      constraints: [],
      memoryPolicy: 'no_write',
      createdAt: '2026-06-24T01:20:00.000Z'
    });

    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'))).toContain('goal');
  });

  it('accepts a normalized channel message', () => {
    const parsed = channelMessageSchema.parse({
      id: 'msg_001',
      channel: 'feishu',
      senderExternalId: 'ou_xxx',
      senderDisplayName: 'Owner',
      conversationExternalId: 'chat_xxx',
      text: 'Create a CPS matrix',
      attachments: [],
      rawEventRef: 'feishu:event:001',
      timestamp: '2026-06-24T01:20:00.000Z'
    });

    expect(parsed.channel).toBe('feishu');
  });

  it('converts a Mora intent packet into a business contract', () => {
    const intent = moraIntentPacketSchema.parse({
      id: 'intent_001',
      sourceUtteranceId: 'utt_001',
      rawText: 'Help me make a CPS matrix',
      speechAct: 'command',
      intentDomain: 'social_distribution',
      entities: [{ productCategory: 'AI tools' }],
      references: [],
      temporalAnchors: [],
      uncertainty: 0.12,
      worldContextRefs: ['world_ref_001'],
      selfCore: {
        schemaVersion: '1.0',
        identityScore: 0.99,
        identityStatus: 'stable',
        crisisMode: false,
        reasons: []
      },
      openAttributes: {
        platforms: ['douyin', 'xiaohongshu']
      }
    });

    const contract = createBusinessContractFromMoraIntent(intent, '2026-06-24T01:20:00.000Z');

    expect(contract.sourceIntentPacketId).toBe('intent_001');
    expect(contract.goal).toBe('Help me make a CPS matrix');
    expect(contract.domain).toBe('social_distribution');
    expect(contract.expectedOutputs).toEqual(['workflow_run', 'artifact', 'approval']);
    expect(contract.memoryPolicy).toBe('candidate_only');
  });
});
