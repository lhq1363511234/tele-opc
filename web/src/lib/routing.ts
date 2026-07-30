export type RouteId =
  | 'mission'
  | 'aself'
  | 'paperclip'
  | 'agents'
  | 'tasks'
  | 'mini'
  | 'crm'
  | 'mail'
  | 'finance'
  | 'calendar'
  | 'browser'
  | 'dependencies'
  | 'ops'
  | 'settings'
  | 'architecture'
  | 'debug'
  | 'deliverables';

export type MiniPanelKind =
  | 'ppt'
  | 'crm'
  | 'mail'
  | 'finance'
  | 'financeImport'
  | 'agent'
  | 'artifact'
  | 'voice'
  | 'screenshot'
  | 'knowledge';

export function isMiniPanelKind(value: string): value is MiniPanelKind {
  return [
    'ppt',
    'crm',
    'mail',
    'finance',
    'financeImport',
    'agent',
    'artifact',
    'voice',
    'screenshot',
    'knowledge'
  ].includes(value);
}

export function miniPanelFromPath(): MiniPanelKind | null {
  const segment = window.location.pathname.replace(/^\/app\/mini\/?/, '').split('/')[0];
  if (!segment) return null;
  const normalized = segment === 'finance-import' ? 'financeImport' : segment;
  return isMiniPanelKind(normalized) ? normalized : null;
}

export function miniPanelHref(kind: MiniPanelKind) {
  const slug = kind === 'financeImport' ? 'finance-import' : kind;
  return `/app/mini/${slug}`;
}

const DEFAULT_NAV_IDS: RouteId[] = [
  'mission',
  'aself',
  'paperclip',
  'agents',
  'tasks',
  'mini',
  'deliverables',
  'crm',
  'mail',
  'finance',
  'calendar',
  'browser',
  'ops',
  'dependencies',
  'settings',
  'architecture',
  'debug'
];

export function routeFromPath(navItemIds: RouteId[] = DEFAULT_NAV_IDS): RouteId {
  const segment = window.location.pathname.replace(/^\/app\/?/, '').split('/')[0] as RouteId;
  if (segment === 'deliverables') return 'deliverables';
  return navItemIds.includes(segment) ? segment : 'mission';
}
