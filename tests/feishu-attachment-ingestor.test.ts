import { describe, expect, it } from 'vitest';
import { classifyAttachmentFile } from '../src/feishu/attachmentIngestor.js';

describe('Feishu attachment classification', () => {
  it('routes bank statement spreadsheets to finance analysis', () => {
    const csv = Buffer.from('交易日期,交易对方,收入,支出,余额\n2026-07-01,客户A,1000,,3000');
    expect(classifyAttachmentFile('银行流水.csv', csv, 'file')).toBe('finance_sheet');
  });

  it('routes conversation exports to persona evidence ingestion', () => {
    const csv = Buffer.from('时间,发送者,消息\n2026-07-01,卢华庆,我选择先验证需求，因为获客成本不确定');
    expect(classifyAttachmentFile('微信聊天记录.csv', csv, 'file')).toBe('persona_source');
  });

  it('keeps unknown documents as general assets', () => {
    expect(classifyAttachmentFile('合同扫描件.pdf', Buffer.from('%PDF-test'), 'file')).toBe('general_file');
  });

  it('routes images without pretending to parse text', () => {
    expect(classifyAttachmentFile('截图.png', Buffer.from([1, 2, 3]), 'image')).toBe('image');
  });
});
