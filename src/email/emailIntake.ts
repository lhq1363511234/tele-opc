import type { EmailCategory } from '../types.js';

export interface EmailIntake {
  fromName: string;
  fromAddress?: string;
  subject: string;
  body: string;
  category: EmailCategory;
  needsFollowUp: boolean;
}

export function parseEmailRecordInstruction(text: string): EmailIntake | null {
  const normalizedText = text.trim();
  if (!/(记录|导入|保存|收到).*(邮件|email)|^邮件[：:]/i.test(normalizedText)) return null;

  const sender = extractSender(normalizedText);
  if (!sender?.fromName) return null;

  const subject = extractSubject(normalizedText) ?? inferSubject(normalizedText);
  const body = extractBody(normalizedText, subject);
  const category = classifyEmail(`${subject}\n${body}`);

  return {
    fromName: sender.fromName,
    fromAddress: sender.fromAddress,
    subject,
    body,
    category,
    needsFollowUp: /跟进|回复|报价|询问|需要|请求|demo|试用|合作/i.test(normalizedText)
  };
}

export function isMailDashboardRequest(text: string) {
  return /分拣.*(收件箱|邮件)|看看.*客户邮件.*跟进|邮件看板|mail dashboard|inbox/i.test(text.trim());
}

export function classifyEmail(text: string): EmailCategory {
  if (/忽略|垃圾|spam|unsubscribe/i.test(text)) return 'ignored';
  if (/newsletter|周报|订阅邮件|营销邮件/i.test(text)) return 'newsletter';
  if (/紧急|尽快|马上|asap|urgent/i.test(text)) return 'urgent';
  if (/发票|付款|账单|退款|支付|invoice|payment/i.test(text)) return 'finance';
  if (/会议|日程|时间|calendar|meeting|schedule/i.test(text)) return 'calendar';
  return 'customer';
}

function extractSender(text: string) {
  const withEmail = text.match(/(?:来自|from)?\s*([A-Za-z0-9_\-\u4e00-\u9fa5]+)\s*<([^>]+)>/i);
  if (withEmail?.[1] && withEmail?.[2]) {
    return {
      fromName: cleanup(withEmail[1]),
      fromAddress: withEmail[2].trim()
    };
  }

  const received = text.match(/收到\s*([A-Za-z0-9_\-\u4e00-\u9fa5]+)\s*的邮件/);
  if (received?.[1]) return { fromName: cleanup(received[1]) };

  const prefixed = text.match(/(?:记录|导入|保存)?邮件[：:\s]+([A-Za-z0-9_\-\u4e00-\u9fa5]+)/);
  if (prefixed?.[1]) return { fromName: cleanup(prefixed[1]) };

  return null;
}

function extractSubject(text: string) {
  const match = text.match(/(?:主题|subject)[：:\s]+(.+?)(?=\s+(?:正文|内容|body)[：:]|[；;。]|$)/i);
  return match?.[1] ? cleanup(match[1]) : undefined;
}

function inferSubject(text: string) {
  if (/报价|企业版|价格/i.test(text)) return '企业版咨询';
  if (/会议|时间|日程/i.test(text)) return '会议安排';
  if (/发票|付款|账单/i.test(text)) return '财务事项';
  return '客户邮件跟进';
}

function extractBody(text: string, subject: string) {
  const bodyMatch = text.match(/(?:正文|内容|body)[：:\s]+(.+)$/i);
  if (bodyMatch?.[1]) return cleanup(bodyMatch[1]);

  return cleanup(text.replace(subject, ''));
}

function cleanup(value: string) {
  return value.trim().replace(/^[：:\s，,]+/, '').replace(/[，,。；;]+$/g, '');
}
