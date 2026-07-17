export type CleanipScoreStatus = 'qualified' | 'unqualified';

export type CleanipProxyScoreResult = {
  score: number;
  threshold: number;
  passed: boolean;
  status: CleanipScoreStatus;
  reason?: string;
};

export type CleanipProxyScoreCheckInput = {
  readPageText: () => string | Promise<string>;
  threshold?: number;
};

const DEFAULT_CLEANIP_THRESHOLD = 90;

const scorePatterns = [
  /(?:clean\s*ip\s*)?score[^\d]{0,40}(\d{1,3})(?:\s*(?:\/\s*100|%|points?))?/i,
  /(?:纯净度|清洁度|评分|分数)[^\d]{0,40}(\d{1,3})(?:\s*(?:分|\/\s*100|%))?/i,
  /(\d{1,3})\s*(?:\/\s*100|分|%)/
];

export function parseCleanipScore(pageText: string) {
  for (const pattern of scorePatterns) {
    const match = pageText.match(pattern);
    if (!match?.[1]) continue;
    const score = Number(match[1]);
    if (Number.isInteger(score) && score >= 0 && score <= 100) {
      return score;
    }
  }

  throw new Error('Unable to parse cleanip score from page text');
}

export function evaluateCleanipProxyScore(pageText: string, threshold = DEFAULT_CLEANIP_THRESHOLD): CleanipProxyScoreResult {
  const score = parseCleanipScore(pageText);
  const passed = score >= threshold;
  return {
    score,
    threshold,
    passed,
    status: passed ? 'qualified' : 'unqualified',
    ...(passed ? {} : { reason: `cleanip score ${score} is below required threshold ${threshold}` })
  };
}

export async function checkCleanipProxyScore(input: CleanipProxyScoreCheckInput) {
  const pageText = await input.readPageText();
  return evaluateCleanipProxyScore(pageText, input.threshold ?? DEFAULT_CLEANIP_THRESHOLD);
}

export function assertCleanipProxyScore(result: CleanipProxyScoreResult) {
  if (!result.passed) {
    throw new Error(result.reason ?? `cleanip score ${result.score} is below required threshold ${result.threshold}`);
  }
}
