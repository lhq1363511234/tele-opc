export type SearchHit = {
  title: string;
  url: string;
  snippet: string;
};

const READER = 'https://r.jina.ai/';
const DDG = 'https://duckduckgo.com/html/';

/**
 * DuckDuckGo HTML endpoint blocks plain scraping but is readable through
 * Jina Reader, which returns markdown. No API key required.
 */
export async function webSearch(query: string, limit = 8): Promise<SearchHit[]> {
  const target = `${DDG}?q=${encodeURIComponent(query)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${READER}${target}`, {
      signal: controller.signal,
      headers: {
        'user-agent': 'Tele-OPC-OS/0.1 lead-research',
        'x-return-format': 'markdown'
      }
    });
    if (!response.ok) return [];
    return parseReaderMarkdown(await response.text()).slice(0, limit);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function readPage(url: string, maxChars = 6000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${READER}${url}`, {
      signal: controller.signal,
      headers: { 'user-agent': 'Tele-OPC-OS/0.1 lead-research' }
    });
    if (!response.ok) return '';
    return stripBoilerplate(await response.text()).slice(0, maxChars);
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reader output is mostly site chrome (nav bars, footers, image links).
 * Keep lines that read like prose so the model sees actual company mentions.
 */
function stripBoilerplate(markdown: string): string {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim())
    .filter((line) => {
      if (line.length < 12) return false;
      if (/^(Title|URL Source|Markdown Content|Published Time):/i.test(line)) return false;
      const letters = line.replace(/[^\u4e00-\u9fa5a-zA-Z]/g, '').length;
      return letters / line.length > 0.45;
    })
    .join('\n');
}

function parseReaderMarkdown(markdown: string): SearchHit[] {
  const lines = markdown.split(/\r?\n/);
  const hits: SearchHit[] = [];
  let current: SearchHit | null = null;

  for (const line of lines) {
    const heading = line.match(/^##\s+\[([^\]]+)\]\(([^)]+)\)/);
    if (heading) {
      if (current) hits.push(current);
      current = { title: cleanText(heading[1]), url: unwrapDdgUrl(heading[2]), snippet: '' };
      continue;
    }
    if (!current || current.snippet) continue;

    const body = line.match(/^\[([^\]]{25,})\]\(/);
    if (body) {
      const text = cleanText(body[1]);
      // skip the repeated display-url line that precedes the real snippet
      if (!/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(text)) current.snippet = text;
    }
  }
  if (current) hits.push(current);

  return hits.filter((hit) => hit.title && hit.url.startsWith('http'));
}

function unwrapDdgUrl(raw: string): string {
  const match = raw.match(/[?&]uddg=([^&]+)/);
  if (!match) return raw;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return raw;
  }
}

function cleanText(value: string) {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
