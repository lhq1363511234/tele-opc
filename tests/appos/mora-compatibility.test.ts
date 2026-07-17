import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/mora-intent-content-matrix.json' with { type: 'json' };
import { createBusinessContractFromMoraIntent, moraIntentPacketSchema } from '../../src/appos/contracts/schemas.js';

describe('Mora bridge readiness', () => {
  it('converts a simulated MoraIntentPacket into the same AppOS path', () => {
    const intent = moraIntentPacketSchema.parse(fixture);
    const contract = createBusinessContractFromMoraIntent(intent, '2026-06-24T01:30:00.000Z');

    expect(contract.domain).toBe('social_distribution');
    expect(contract.sourceIntentPacketId).toBe('intent_content_matrix_001');
    expect(contract.constraints).toContain('Mora frozen');
  });
});
