export interface CalendarIntake {
  title: string;
  startsAt: string;
  endsAt: string;
  attendees: string[];
  location?: string;
  description: string;
  needsPrep: boolean;
}

export function parseCalendarInstruction(text: string): CalendarIntake | null {
  const normalizedText = text.trim();
  if (!/(记录|新增|保存|导入).*(会议|日程|事件|calendar)/i.test(normalizedText)) return null;

  const date = extractDate(normalizedText);
  const time = extractTime(normalizedText);
  if (!date || !time) return null;

  const durationMinutes = extractDurationMinutes(normalizedText) ?? 60;
  const startsAt = toIsoDateTime(date, time);
  const endsAt = addMinutes(startsAt, durationMinutes);
  const title = extractTitle(normalizedText) ?? inferTitle(normalizedText);

  return {
    title,
    startsAt,
    endsAt,
    attendees: extractAttendees(normalizedText),
    location: extractLocation(normalizedText),
    description: normalizedText,
    needsPrep: /准备|资料|背景|议程|客户|复盘|demo/i.test(normalizedText)
  };
}

export function isCalendarDashboardRequest(text: string) {
  return /日历看板|明天.*会议|今天.*会议|哪些会议需要准备|日程.*(今天|明天)|calendar dashboard|schedule/i.test(text.trim());
}

function extractDate(text: string) {
  const explicit = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (explicit?.[1]) return explicit[1];
  if (/明天/.test(text)) return relativeDate(1);
  if (/后天/.test(text)) return relativeDate(2);
  if (/今天|今日/.test(text)) return relativeDate(0);
  return undefined;
}

function extractTime(text: string) {
  const match = text.match(/\b([01]?\d|2[0-3])[:：]([0-5]\d)\b/) ?? text.match(/(上午|下午|晚上)?\s*([01]?\d|2[0-3])\s*点(?:([0-5]\d)分?)?/);
  if (!match) return undefined;
  if (match[1] && /^\d/.test(match[1])) return `${match[1].padStart(2, '0')}:${match[2]}`;

  const period = match[1];
  let hour = Number(match[2]);
  const minute = match[3] ?? '00';
  if ((period === '下午' || period === '晚上') && hour < 12) hour += 12;
  return `${String(hour).padStart(2, '0')}:${minute.padStart(2, '0')}`;
}

function extractDurationMinutes(text: string) {
  const minute = text.match(/(\d+)\s*分钟/);
  if (minute?.[1]) return Number(minute[1]);
  const hour = text.match(/(\d+(?:\.\d+)?)\s*小时/);
  if (hour?.[1]) return Math.round(Number(hour[1]) * 60);
  return undefined;
}

function extractTitle(text: string) {
  const match = text.match(/(?:主题|标题)[：:\s]+(.+?)(?=\s+(?:和|与|参会人|地点|位置|准备|时长)[：:\s]|$)/);
  return match?.[1] ? cleanup(match[1]) : undefined;
}

function inferTitle(text: string) {
  if (/demo|演示/i.test(text)) return '客户 demo';
  if (/复盘|review/i.test(text)) return '项目复盘';
  if (/销售|客户|线索/i.test(text)) return '客户会议';
  return '会议';
}

function extractAttendees(text: string) {
  const attendees = new Set<string>();
  const match = text.match(/(?:和|与|参会人[：:]?)\s*([A-Za-z0-9_\-\u4e00-\u9fa5、,，\s]+?)(?=\s+(?:讨论|地点|位置|准备|时长|主题|标题)|[。；;]|$)/);
  if (match?.[1]) {
    for (const item of match[1].split(/[、,，\s]+/)) {
      const cleaned = cleanup(item);
      if (cleaned) attendees.add(cleaned);
    }
  }
  return [...attendees];
}

function extractLocation(text: string) {
  const match = text.match(/(?:地点|位置|location)[：:\s]+([A-Za-z0-9_\-\u4e00-\u9fa5]+(?:\s+[A-Za-z0-9_\-\u4e00-\u9fa5]+)?)/i);
  return match?.[1] ? cleanup(match[1]) : undefined;
}

function toIsoDateTime(date: string, time: string) {
  return `${date}T${time}:00.000+08:00`;
}

function addMinutes(isoDate: string, minutes: number) {
  const date = new Date(isoDate);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

function relativeDate(offsetDays: number) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function cleanup(value: string) {
  return value.trim().replace(/^[：:\s，,]+/, '').replace(/[，,。；;]+$/g, '');
}
