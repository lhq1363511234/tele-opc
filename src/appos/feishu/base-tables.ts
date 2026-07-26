export const APPOS_FEISHU_BASE_TOKEN = 'OIbnbkS2sa9jBrsQtqzcMj8pnep';

type FeishuTableDefinition = {
  id?: string;
  displayName: string;
};

export const APPOS_FEISHU_TABLES = {
  BusinessContracts: { id: 'tblSefyLkVrcZLJr', displayName: '业务合同' },
  WorkflowDefinitions: { id: 'tblnXyMVwJOr2Nsm', displayName: '工作流定义' },
  WorkflowRuns: { id: 'tblb1c0rlMcFB33W', displayName: '工作流运行' },
  ContentCampaigns: { id: 'tblFRJGMw5s5liaC', displayName: '内容活动' },
  ContentPosts: { id: 'tbl30exiTHGpptri', displayName: '内容发布' },
  Artifacts: { id: 'tblMpVlj76F6gkPR', displayName: '交付物' },
  Approvals: { id: 'tbl6qIpQg2pxDRwW', displayName: '审批' },
  ApplicationEvents: { id: 'tblgsQpAUdILf4qF', displayName: '应用事件' },
  ExternalResources: { id: 'tbl5Ob6tEXvw9DgO', displayName: '外部资源' },
  MediaJobs: { id: 'tbliaqiHox3knmAG', displayName: '媒体任务' },
  FailureEvents: { id: 'tblrWGxqK8DE0WEp', displayName: '失败事件' },
  CPSProducts: { id: 'tbl18D4jhOy76S8d', displayName: 'CPS商品' },
  SourceMaterials: { id: 'tblxg3MPIyRSlIgm', displayName: '源素材' },
  CloakProfiles: { displayName: 'Profile资产' },
  PlatformAccounts: { id: 'tblhLYEyQX5uY2WX', displayName: '平台账号' },
  EditingTemplates: { id: 'tblqAMIoXKmJnSM4', displayName: '剪辑模板' },
  MediaAnalyses: { displayName: '媒体分析' },
  EditingVersions: { displayName: '剪辑版本' },
  PublishRecords: { id: 'tblAThebEIdZnWnm', displayName: '发布记录' },
  OperatingTasks: { id: 'tblC66H0byA5tbWb', displayName: '经营任务' },
  OperatingLeads: { id: 'tblkWSkGAUrJDp24', displayName: '经营线索' },
  AnalyticsFacts: { id: 'tblHDS9vbbsRTHM4', displayName: '经营分析事实' }
} as const satisfies Record<string, FeishuTableDefinition>;

export type ApposFeishuTableName = keyof typeof APPOS_FEISHU_TABLES;

type TableMapValue = string | { id?: string; tableId?: string; displayName?: string; name?: string };
type TableMapInput = Record<string, TableMapValue> | { tables?: Record<string, TableMapValue> };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const tableIdFromValue = (value: TableMapValue | undefined) => {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  return value.id ?? value.tableId;
};

export function parseFeishuTableMap(raw: string | undefined): Record<string, string> {
  if (!raw) return {};

  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('APPOS_FEISHU_TABLE_MAP_JSON must be a JSON object');
  }

  const input = parsed as TableMapInput;
  const source = isRecord(input.tables) ? input.tables : (input as Record<string, TableMapValue>);
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(source)) {
    const tableId = tableIdFromValue(value as TableMapValue);
    if (tableId) result[key] = tableId;
  }

  return result;
}

export function resolveFeishuTableId(tableNameOrAlias: string, rawMap = process.env.APPOS_FEISHU_TABLE_MAP_JSON) {
  if (tableNameOrAlias.startsWith('tbl')) return tableNameOrAlias;

  const envMap = parseFeishuTableMap(rawMap);
  const defaultMap: Record<string, string> = {};
  const chineseAliasMap: Record<string, string> = {};

  for (const [name, table] of Object.entries(APPOS_FEISHU_TABLES)) {
    const staticTableId = 'id' in table ? table.id : undefined;
    const tableId = envMap[name] ?? staticTableId;
    if (!tableId) continue;
    defaultMap[name] = tableId;
    chineseAliasMap[table.displayName] = tableId;
  }

  const tableId = envMap[tableNameOrAlias] ?? defaultMap[tableNameOrAlias] ?? chineseAliasMap[tableNameOrAlias];

  if (!tableId) {
    throw new Error(`Missing Feishu table id for ${tableNameOrAlias}`);
  }

  return tableId;
}
