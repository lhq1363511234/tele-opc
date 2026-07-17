import { describe, expect, it } from 'vitest';
import {
  assertCleanipProxyScore,
  checkCleanipProxyScore,
  evaluateCleanipProxyScore,
  parseCleanipScore
} from '../../src/appos/domains/cps/cleanip-check.js';

describe('cleanip proxy score check', () => {
  it('parses numeric cleanip score from page text', () => {
    expect(parseCleanipScore('Clean IP Score\n92 / 100\nResidential proxy')).toBe(92);
    expect(parseCleanipScore('纯净度分数：90分，代理可用')).toBe(90);
  });

  it('returns pass when score meets the threshold', () => {
    expect(evaluateCleanipProxyScore('Clean IP Score 90/100')).toMatchObject({
      score: 90,
      threshold: 90,
      passed: true,
      status: 'qualified'
    });
  });

  it('returns fail when score is below the threshold', () => {
    expect(evaluateCleanipProxyScore('Clean IP Score 89/100')).toMatchObject({
      score: 89,
      threshold: 90,
      passed: false,
      status: 'unqualified',
      reason: 'cleanip score 89 is below required threshold 90'
    });
  });

  it('throws from the gate when score is below threshold', () => {
    const result = evaluateCleanipProxyScore('Clean IP Score 88/100');

    expect(() => assertCleanipProxyScore(result)).toThrow('cleanip score 88 is below required threshold 90');
  });

  it('checks page text through an async reader for later browser automation integration', async () => {
    const result = await checkCleanipProxyScore({
      readPageText: async () => 'Proxy Quality\nClean IP Score: 93\nDone'
    });

    expect(result).toMatchObject({
      score: 93,
      threshold: 90,
      passed: true,
      status: 'qualified'
    });
  });

  it('fails clearly when no score can be parsed', () => {
    expect(() => parseCleanipScore('IP address details only')).toThrow('Unable to parse cleanip score from page text');
  });
});
