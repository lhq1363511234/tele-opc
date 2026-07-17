export type DeliverySurface =
  | 'telegram_summary'
  | 'telegram_mini_app'
  | 'web_console'
  | 'downloadable_file';

export type DeliverableKind =
  | 'presentation_deck'
  | 'html_page'
  | 'long_document'
  | 'code_or_markup'
  | 'short_copy'
  | 'structured_plan';

export interface DeliveryStrategy {
  kind: DeliverableKind;
  primarySurface: DeliverySurface;
  artifactType: string;
  title: string;
  rationale: string;
  telegramMode: 'summary_with_preview' | 'summary_only';
}

export function planDeliveryStrategy(text: string): DeliveryStrategy {
  const normalized = text.trim();

  if (/PPT|ppt|幻灯片|演示文稿|presentation|slide deck|slides/i.test(normalized)) {
    return {
      kind: 'presentation_deck',
      primarySurface: 'telegram_mini_app',
      artifactType: 'slide_deck_html',
      title: '幻灯片预览',
      rationale: '用户要的是可展示的幻灯片成品，Telegram 聊天里只适合放摘要、任务卡和预览按钮。',
      telegramMode: 'summary_with_preview'
    };
  }

  if (/HTML|html|网页|介绍页|落地页|官网|landing page|web page|website/i.test(normalized)) {
    return {
      kind: 'html_page',
      primarySurface: 'telegram_mini_app',
      artifactType: 'html_page',
      title: '网页预览',
      rationale: '用户要的是网页体验，Telegram 聊天里只适合放摘要和预览按钮。',
      telegramMode: 'summary_with_preview'
    };
  }

  if (/代码|源码|组件|React|Vue|TypeScript|JavaScript|CSS|脚本|script|component|code/i.test(normalized)) {
    return {
      kind: 'code_or_markup',
      primarySurface: 'web_console',
      artifactType: 'code_deliverable',
      title: '代码交付物',
      rationale: '代码需要语法结构、复制和审阅入口，不适合刷满 Telegram 聊天。',
      telegramMode: 'summary_with_preview'
    };
  }

  if (/报告|文档|方案|计划书|白皮书|长文|PRD|README|roadmap|document|report/i.test(normalized)) {
    return {
      kind: 'long_document',
      primarySurface: 'telegram_mini_app',
      artifactType: 'document_draft',
      title: '文档预览',
      rationale: '长内容需要阅读容器、目录和可复制正文，Telegram 只保留摘要。',
      telegramMode: 'summary_with_preview'
    };
  }

  if (/流程|规划|拆解|路线|执行计划|strategy|plan/i.test(normalized)) {
    return {
      kind: 'structured_plan',
      primarySurface: 'web_console',
      artifactType: 'structured_plan',
      title: '结构化计划',
      rationale: '计划类内容需要和任务生命周期、状态、负责人一起呈现。',
      telegramMode: 'summary_with_preview'
    };
  }

  return {
    kind: 'short_copy',
    primarySurface: 'telegram_summary',
    artifactType: 'content_draft',
    title: '内容草稿',
    rationale: '短文案可以直接在 Telegram 摘要展示，完整草稿仍进入任务结果。',
    telegramMode: 'summary_only'
  };
}

export function deliveryStrategyFromMetadata(metadata: Record<string, unknown> | null | undefined): DeliveryStrategy | null {
  const raw = metadata?.deliveryStrategy;
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (
    typeof record.kind !== 'string'
    || typeof record.primarySurface !== 'string'
    || typeof record.artifactType !== 'string'
    || typeof record.title !== 'string'
    || typeof record.rationale !== 'string'
    || typeof record.telegramMode !== 'string'
  ) {
    return null;
  }
  return {
    kind: record.kind as DeliverableKind,
    primarySurface: record.primarySurface as DeliverySurface,
    artifactType: record.artifactType,
    title: record.title,
    rationale: record.rationale,
    telegramMode: record.telegramMode === 'summary_only' ? 'summary_only' : 'summary_with_preview'
  };
}
