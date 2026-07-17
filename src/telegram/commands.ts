export type TelegramBotCommand = {
  command: string;
  description: string;
};

export const TELEGRAM_BOT_COMMANDS: TelegramBotCommand[] = [
  { command: 'start', description: '启动 Tele-OPC' },
  { command: 'new', description: '新建任务或打开配置面板' },
  { command: 'tasks', description: '查看当前任务卡片' },
  { command: 'next', description: '查看下一步该处理什么' },
  { command: 'approvals', description: '查看待审批事项' },
  { command: 'help', description: '查看使用说明' }
];
