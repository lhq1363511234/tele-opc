import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  Brain,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Coffee,
  Command,
  Clock3,
  Eye,
  Gauge,
  Info,
  LayoutDashboard,
  Mail,
  Menu,
  Network,
  RefreshCw,
  Search,
  Send,
  Settings,
  BarChart3,
  ShieldCheck,
  Sparkles,
  Users,
  Workflow,
  X,
  XCircle
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { AgentNetwork } from './components/AgentNetwork';
import { PaperclipGovernance } from './components/PaperclipGovernance';
import { ASelfConsole } from './components/ASelfConsole';
import { QuickEntry, type QuickEntryConfig } from './components/QuickEntry';
import { ApiError, apiGet, apiPost, apiPut, getWebConsoleDevToken, setWebConsoleDevToken } from './api';
import { countItems, formatMoney, formatTime, labelFromSnake } from './format';
import {
  isMiniPanelKind,
  miniPanelFromPath,
  miniPanelHref,
  routeFromPath,
  type MiniPanelKind,
  type RouteId
} from './lib/routing';
import {
  EmptyState,
  ErrorPanel,
  HealthPill,
  LoadingPanel,
  PanelHeader,
  SimpleList,
  StatusPill,
  truncateText
} from './components/ui';
import type {
  AgentDefinition,
  AgentRunRecord,
  AnyRecord,
  AppDependency,
  ArtifactPreviewResponse,
  DependencyListResponse,
  DependencyStatusResponse,
  OverviewResponse,
  TaskRecord,
  WebCommandResponse
} from './types';

const navItems: Array<{ id: RouteId; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'aself', label: 'A- 数字自我', icon: Brain },
  { id: 'paperclip', label: 'Paperclip 治理', icon: Building2 },
  { id: 'mission', label: '执行监控', icon: LayoutDashboard },
  { id: 'tasks', label: '执行任务', icon: Workflow },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'ops', label: '经营分析', icon: BarChart3 },
  { id: 'crm', label: 'CRM', icon: Users },
  { id: 'mail', label: 'Mail', icon: Mail },
  { id: 'finance', label: 'Finance', icon: CircleDollarSign },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'browser', label: 'Browser', icon: Eye },
  { id: 'mini', label: 'Mini App', icon: Sparkles },
  { id: 'dependencies', label: 'Dependencies', icon: Settings },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'debug', label: 'Debug', icon: Info }
];

const miniAppEntries: Array<{ kind: MiniPanelKind; label: string; description: string }> = [
  { kind: 'ppt', label: 'PPT 引导', description: '逐步确认主题、受众、用途、页数、风格和素材' },
  { kind: 'crm', label: 'CRM 导入', description: '线索、客户名单、行业名单和跟进目标' },
  { kind: 'mail', label: '邮件编辑', description: '客户邮件、跟进邮件和 Campaign 草稿' },
  { kind: 'finance', label: '财务动作', description: '记账、发票、付款准备和审批提示' },
  { kind: 'financeImport', label: '财务导入', description: '账单、流水、订阅和发票数据整理' },
  { kind: 'agent', label: 'Agent 设置', description: '模型、权限策略、Skill 偏好和知识库' },
  { kind: 'knowledge', label: '知识库导入', description: '公司资料、报价规则和行业知识沉淀' },
  { kind: 'screenshot', label: '截图分析', description: '图片、页面截图和视觉资料分析' },
  { kind: 'voice', label: '语音转任务', description: '把语音内容整理成可执行任务' },
  { kind: 'artifact', label: '任务资料', description: '把补充材料挂到任务并整理引用方式' }
];

export default function App() {
  useTelegramMiniApp();
  const currentRoute = routeFromPath();
  const isHomeRoute = window.location.pathname === '/' || window.location.pathname === '';
  const isDebugRoute = currentRoute === 'debug';
  const isMiniRoute = currentRoute === 'mini';
  const session = useQuery({
    queryKey: ['session'],
    queryFn: () => apiGet<{ ok: boolean; app: { name: string; env: string; timezone: string } }>('/api/web/session'),
    enabled: !isDebugRoute && !isHomeRoute && !isMiniRoute,
    retry: false
  });

  if (isHomeRoute) {
    return <HomePage />;
  }

  if (isDebugRoute) {
    return <TelegramDebugPage standalone />;
  }

  if (isMiniRoute) {
    return <MiniAppStandalone />;
  }

  if (session.isError) {
    return <ConnectionErrorScreen error={session.error} />;
  }

  if (session.isLoading) {
    return <BootScreen />;
  }

  return <Shell appName={session.data?.app.name ?? 'Tele-OPC OS'} />;
}

function HomePage() {
  useEffect(() => {
    document.title = 'Tele-OPC OS - Telegram-first One-Person Company Operating System';
  }, []);

  const capabilities = [
    { icon: Bot, title: 'Chief Agent', text: '先理解老板原话，再决定工作策略、Agent 分工和展示方式。' },
    { icon: Workflow, title: '任务生命周期', text: 'planned、queued、running、blocked、done 全程可追踪，不跳步骤。' },
    { icon: Sparkles, title: 'Telegram Mini App', text: 'PPT、CRM、邮件、财务、知识库、截图和语音面板直接打开。' },
    { icon: Users, title: 'CRM / 销售开发', text: '客户挖掘、线索评分、跟进节奏、Campaign 邮件和客户状态统一沉淀。' },
    { icon: Mail, title: '邮件与日历', text: 'Nodemailer 发送、邮件草稿、会议准备、冲突检查和下一步提醒。' },
    { icon: CircleDollarSign, title: '财务审批边界', text: '收入、支出、发票、订阅可记录；付款、报价承诺等高风险动作审批。' },
    { icon: Eye, title: '浏览器自动化', text: '浏览器任务保留截图证据、提取结果和被拦截动作。' },
    { icon: LayoutDashboard, title: 'Web Console', text: 'Mission Control、Agent Trace、任务看板、业务看板和系统设置。' },
    { icon: ShieldCheck, title: '私有部署', text: 'VPS + HTTPS + Telegram Webhook，可开源仓库或私有仓库部署。' }
  ];

  const lifecycle = [
    ['01', '理解意图', '判断这是方案、PPT、网页、代码、客户挖掘、邮件、财务还是浏览器任务。'],
    ['02', '制定策略', '先决定怎么做、谁来做、需要哪些 Skill、最终应该怎么展示。'],
    ['03', 'Agent 执行', 'Chief、Research、Content、CRM、Finance、Browser、Dev 等按依赖顺序推进。'],
    ['04', '交付呈现', 'PPT 生成幻灯片预览，网页生成可打开页面，代码进入 artifact，长文进入阅读容器。']
  ];

  const surfaces = ['Telegram Bot', 'Mini App', 'Web Console', 'Agent Trace', 'Artifacts', 'Approvals'];

  return (
    <main className="home-page">
      <section className="home-hero" aria-labelledby="home-title">
        <motion.div
          className="home-hero-visual"
          aria-hidden="true"
          initial={{ opacity: 0, x: 48, rotate: -2 }}
          animate={{ opacity: 1, x: 0, rotate: 0 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        >
          <div className="home-visual-grid">
            <motion.div className="home-visual-panel home-visual-panel-main" whileHover={{ y: -4 }}>
              <div className="home-visual-topline">
                <span>Mission Control</span>
                <span className="home-live-dot">Live</span>
              </div>
              <div className="home-command-preview">
                <Command size={16} />
                <span>做一份 Tele-OPC OS 路演 PPT，并生成可预览幻灯片</span>
              </div>
              <div className="home-flow-row">
                <span>Chief</span>
                <ChevronRight size={14} />
                <span>Work Strategy</span>
                <ChevronRight size={14} />
                <span>Slide Artifact</span>
              </div>
              <div className="home-run-list">
                <div>
                  <CheckCircle2 size={16} />
                  <span>展示方式已选择</span>
                  <small>done</small>
                </div>
                <div>
                  <Activity size={16} />
                  <span>Agent 分工执行中</span>
                  <small>running</small>
                </div>
                <div>
                  <Clock3 size={16} />
                  <span>Mini App 预览待打开</span>
                  <small>queued</small>
                </div>
              </div>
            </motion.div>
            <div className="home-visual-panel">
              <span className="home-visual-label">Agent Mesh</span>
              <div className="home-agent-cloud">
                <span>Chief</span>
                <span>Research</span>
                <span>Content</span>
                <span>CRM</span>
                <span>Finance</span>
                <span>Browser</span>
                <span>Dev</span>
              </div>
            </div>
            <div className="home-visual-panel">
              <span className="home-visual-label">Surfaces</span>
              <strong>6</strong>
              <p>入口、面板、控制台和交付物联动</p>
            </div>
          </div>
        </motion.div>

        <header className="home-nav">
          <a className="home-brand" href="/">
            <span className="brand-mark">
              <Network size={21} />
            </span>
            <span>Tele-OPC OS</span>
          </a>
          <nav>
            <a href="#features">功能</a>
            <a href="#workflow">工作流</a>
            <a href="#surfaces">界面</a>
            <a href="#safety">安全边界</a>
          </nav>
          <a className="home-nav-action" href="/app/mini">
            <Sparkles size={16} />
            打开 Mini App
          </a>
        </header>

        <motion.div
          className="home-hero-content"
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: 'easeOut' }}
        >
          <p className="home-kicker">Telegram-first Agent OS for OPC</p>
          <h1 id="home-title">Tele-OPC OS</h1>
          <p className="home-subtitle">Telegram-first One-Person Company Operating System</p>
          <p className="home-copy">
            一句话进入任务生命周期：Chief Agent 先理解意图和展示方式，再调度行业 Skill、业务 Agent、工具和审批边界，
            把 CRM、邮件、日历、浏览器自动化、财务、PPT、网页、代码和文档交付串成一个操作系统。
          </p>
          <div className="home-surface-strip">
            {surfaces.map((surface) => <span key={surface}>{surface}</span>)}
          </div>
          <div className="home-actions">
            <a className="home-button primary" href="/app/mini">
              <Sparkles size={18} />
              打开 Mini App
            </a>
            <a className="home-button" href="/app">
              <LayoutDashboard size={18} />
              进入控制台
            </a>
          </div>
        </motion.div>
      </section>

      <section id="features" className="home-section">
        <div className="home-section-heading">
          <span className="eyebrow">Full OS</span>
          <h2>覆盖一人公司从获客到交付的完整链路</h2>
        </div>
        <div className="home-feature-grid">
          {capabilities.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <motion.article
                key={feature.title}
                className="home-feature-card"
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-80px' }}
                transition={{ delay: index * 0.035, duration: 0.35 }}
                whileHover={{ y: -3 }}
              >
                <Icon size={20} />
                <h3>{feature.title}</h3>
                <p>{feature.text}</p>
              </motion.article>
            );
          })}
        </div>
      </section>

      <section id="workflow" className="home-section home-workflow-section">
        <div className="home-section-heading">
          <span className="eyebrow">Lifecycle</span>
          <h2>任务发布前，先决定怎么做和怎么展示</h2>
        </div>
        <div className="home-workflow">
          {lifecycle.map(([step, title, text]) => (
            <motion.article key={step} whileHover={{ x: 4 }}>
              <strong>{step}</strong>
              <h3>{title}</h3>
              <p>{text}</p>
            </motion.article>
          ))}
        </div>
      </section>

      <section id="surfaces" className="home-section home-surfaces">
        <div className="home-section-heading">
          <span className="eyebrow">Interfaces</span>
          <h2>Telegram 是入口，Web Console 是驾驶舱，Artifact 是交付物</h2>
        </div>
        <div className="home-surface-grid">
          <article><Command size={18} /><strong>Bot 指令和按钮</strong><span>命令菜单、inline keyboard、callback 更新任务卡。</span></article>
          <article><Sparkles size={18} /><strong>Mini App 面板</strong><span>PPT、CRM、邮件、财务、Agent 设置和知识库导入。</span></article>
          <article><Gauge size={18} /><strong>Mission Control</strong><span>任务、Agent Runs、审批、系统健康和 Codex Bridge。</span></article>
          <article><Eye size={18} /><strong>Deliverables</strong><span>网页、PPT、代码、长文档和浏览器证据都用合适容器展示。</span></article>
        </div>
      </section>

      <section id="safety" className="home-section home-safety">
        <div>
          <span className="eyebrow">Deployment & Safety</span>
          <h2>可公开介绍，也能私有部署</h2>
          <p>
            Tele-OPC OS 面向真实业务执行：公网 HTTPS、Telegram Webhook、Web Console、Mini App 与后台服务分层部署。
            常规任务自动推进，财务付款、报价等高风险动作保留审批，过程 trace 可追踪。
          </p>
        </div>
        <div className="home-safety-list">
          <span><ShieldCheck size={16} /> 财务动作审批</span>
          <span><Network size={16} /> VPS 直连 HTTPS</span>
          <span><Mail size={16} /> 邮件与 CRM 工作流</span>
          <span><CalendarDays size={16} /> 日历和浏览器自动化</span>
        </div>
      </section>
    </main>
  );
}


function ConnectionErrorScreen({ error }: { error: unknown }) {
  const status = error instanceof ApiError ? error.status : 0;
  const message = error instanceof Error ? error.message : '';

  if (status === 401 || status === 403) {
    return <ConsoleLoginScreen />;
  }

  return (
    <main className="login-screen">
      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="login-panel">
        <div className="login-mark">
          <XCircle size={24} />
        </div>
        <h1>Tele-OPC Console</h1>
        <p>控制台会直接打开。如果这里没有加载成功，请检查服务端状态或公网 HTTPS 连接。</p>
        {message ? <p className="form-error">{message}</p> : null}
        <button type="button" className="ghost-button" onClick={() => window.location.reload()}>
          刷新连接
        </button>
      </motion.section>
    </main>
  );
}

function ConsoleLoginScreen() {
  const [token, setToken] = useState(() => getWebConsoleDevToken());
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = token.trim();
    if (!value || checking) return;
    setChecking(true);
    setFailed(false);
    setWebConsoleDevToken(value);
    try {
      await apiGet('/api/web/session');
      window.location.reload();
    } catch {
      setWebConsoleDevToken('');
      setFailed(true);
      setChecking(false);
    }
  };

  return (
    <main className="login-screen">
      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="login-panel">
        <div className="login-mark">
          <ShieldCheck size={24} />
        </div>
        <h1>Tele-OPC Console</h1>
        <p>
          在浏览器直接访问需要访问口令。从 Telegram Mini App 打开会自动登录。
        </p>
        <form className="login-form" onSubmit={submit}>
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="访问口令 (WEB_CONSOLE_DEV_TOKEN)"
            autoFocus
            autoComplete="current-password"
          />
          <button type="submit" className="ghost-button" disabled={checking || !token.trim()}>
            {checking ? '验证中…' : '进入控制台'}
          </button>
        </form>
        {failed ? <p className="form-error">口令不正确，请重新输入。</p> : null}
      </motion.section>
    </main>
  );
}

function BootScreen() {
  return (
    <main className="boot-screen">
      <Activity className="spin" size={28} />
      <span>正在连接 Tele-OPC Agent OS</span>
    </main>
  );
}

function Shell({ appName }: { appName: string }) {
  const [route, setRoute] = useRoute();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const queryClient = useQueryClient();
  const overview = useQuery({
    queryKey: ['overview'],
    queryFn: () => apiGet<OverviewResponse>('/api/web/overview')
  });
  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: () => apiGet<{ ok: boolean; agents: AgentDefinition[] }>('/api/web/agents')
  });

  function refreshAll() {
    void queryClient.invalidateQueries();
  }

  function navigate(nextRoute: RouteId) {
    setRoute(nextRoute);
    setSidebarOpen(false);
  }

  const activeNav = navItems.find((item) => item.id === route) ?? navItems[0];
  const healthOk = Boolean(overview.data?.health.database && overview.data?.health.redis);

  useEffect(() => {
    document.title = `${activeNav.label} · ${appName}`;
  }, [activeNav.label, appName]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.getElementById('chief-command-input')?.focus();
      }
      if (event.key === '/' && !isTyping) {
        event.preventDefault();
        document.getElementById('chief-command-input')?.focus();
      }
      if (event.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className={`app-shell ${sidebarOpen ? 'sidebar-is-open' : ''}`}>
      <button
        type="button"
        className="sidebar-backdrop"
        aria-label="关闭导航"
        onClick={() => setSidebarOpen(false)}
      />
      <aside className="sidebar" aria-label="主导航">
        <div className="brand">
          <div className="brand-mark">
            <Network size={21} />
          </div>
          <div>
            <strong>{appName}</strong>
            <span>Operating Console</span>
          </div>
          <button type="button" className="sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="关闭导航">
            <X size={18} />
          </button>
        </div>
        <div className={`system-summary ${healthOk ? 'healthy' : 'attention'}`}>
          <span className="system-dot" />
          <div>
            <strong>{healthOk ? '系统可执行' : '系统需检查'}</strong>
            <small>{overview.data?.metrics.runningAgentRuns ?? 0} 个 Agent 运行中</small>
          </div>
        </div>
        <nav className="nav-list">
          <NavGroup title="Command" items={navItems.slice(0, 5)} route={route} onRoute={navigate} />
          <NavGroup title="Business" items={navItems.slice(5, 11)} route={route} onRoute={navigate} />
          <NavGroup title="System" items={navItems.slice(11)} route={route} onRoute={navigate} />
        </nav>
        <div className="sidebar-footer">
          <HealthPill label="DB" ok={overview.data?.health.database} />
          <HealthPill label="Redis" ok={overview.data?.health.redis} />
          <span className="sidebar-shortcut">⌘K 快速指令</span>
        </div>
      </aside>

      <main className="main-surface">
        <header className="topbar">
          <div className="topbar-title">
            <button type="button" className="mobile-menu-button" onClick={() => setSidebarOpen(true)} aria-label="打开导航">
              <Menu size={20} />
            </button>
            <div>
              <span className="eyebrow">OPERATIONS / {route === 'mission' ? 'MISSION' : route.toUpperCase()}</span>
              <h1>
                <activeNav.icon size={22} />
                {activeNav.label}
              </h1>
            </div>
          </div>
          <div className="topbar-actions">
            <span className={`live-status ${healthOk ? 'healthy' : 'attention'}`}>
              <i /> {healthOk ? 'Live' : 'Attention'}
            </span>
            <span className="sync-pill">
              <Clock3 size={14} />
              {overview.dataUpdatedAt ? formatTime(new Date(overview.dataUpdatedAt).toISOString()) : '同步中'}
            </span>
            <button className="icon-button" onClick={refreshAll} title="刷新全部数据" aria-label="刷新全部数据">
              <RefreshCw className={overview.isFetching ? 'spin' : ''} size={18} />
            </button>
          </div>
        </header>

        {!healthOk && overview.data ? (
          <div className="system-alert" role="status">
            <AlertTriangle size={17} />
            <span>基础设施状态异常，部分自动化可能暂停。请先检查 {overview.data.health.database ? 'Redis' : 'PostgreSQL'}。</span>
          </div>
        ) : null}

        <CommandInput />

        <AnimatePresence mode="wait">
          <motion.section
            key={route}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="route-surface"
          >
            <RouteView route={route} overview={overview} agents={agents.data?.agents ?? []} />
          </motion.section>
        </AnimatePresence>
      </main>
    </div>
  );
}

function NavGroup({
  title,
  items,
  route,
  onRoute
}: {
  title: string;
  items: typeof navItems;
  route: RouteId;
  onRoute: (route: RouteId) => void;
}) {
  return (
    <div className="nav-group">
      <span className="nav-section-label">{title}</span>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button key={item.id} className={route === item.id ? 'active' : ''} onClick={() => onRoute(item.id)}>
            <Icon size={17} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

const crmQuickEntry: QuickEntryConfig = {
  title: '录入新线索',
  hint: '写入 contacts / opportunities / follow_ups，立即出现在下方看板',
  submitLabel: '新建线索',
  endpoint: '/api/web/crm/leads',
  invalidateKeys: ['dashboard', 'overview', 'ops-insights'],
  successText: '线索已创建',
  fields: [
    { id: 'name', label: '客户姓名', placeholder: '张三', required: true },
    { id: 'organizationName', label: '公司', placeholder: '某某科技' },
    { id: 'interest', label: '意向', placeholder: 'Agent OS 部署' },
    { id: 'note', label: '备注', type: 'textarea', placeholder: '来源、需求、下一步', required: true }
  ],
  buildBody: (v) => ({
    name: v.name.trim(),
    organizationName: v.organizationName.trim() || undefined,
    interest: v.interest.trim() || undefined,
    note: v.note.trim()
  })
};

const calendarQuickEntry: QuickEntryConfig = {
  title: '安排日程',
  hint: '写入 calendar_events，需要准备时自动生成会议准备note',
  submitLabel: '新建日程',
  endpoint: '/api/web/calendar/events',
  invalidateKeys: ['dashboard', 'overview'],
  successText: '日程已创建',
  fields: [
    { id: 'title', label: '标题', placeholder: '与客户对齐方案', required: true },
    { id: 'startsAt', label: '开始时间', type: 'datetime-local', required: true },
    { id: 'endsAt', label: '结束时间', type: 'datetime-local', required: true },
    { id: 'location', label: '地点', placeholder: '线上 / 会议室' },
    { id: 'attendees', label: '参与人', placeholder: '逗号分隔' },
    { id: 'needsPrep', label: '需要会前准备', type: 'select', options: [{ value: 'no', label: '否' }, { value: 'yes', label: '是' }] },
    { id: 'description', label: '说明', type: 'textarea', placeholder: '议题和目标' }
  ],
  buildBody: (v) => ({
    title: v.title.trim(),
    startsAt: new Date(v.startsAt).toISOString(),
    endsAt: new Date(v.endsAt).toISOString(),
    location: v.location.trim() || undefined,
    attendees: v.attendees.split(/[,，]/).map((a) => a.trim()).filter(Boolean),
    description: v.description.trim(),
    needsPrep: v.needsPrep === 'yes'
  })
};

const financeQuickEntry: QuickEntryConfig = {
  title: '记一笔账',
  hint: '写入 transactions / invoices / subscriptions，现金流指标实时更新',
  submitLabel: '记账',
  endpoint: '/api/web/finance/entries',
  invalidateKeys: ['finance-dashboard', 'overview', 'analytics', 'ops-insights'],
  successText: '已入账',
  fields: [
    { id: 'direction', label: '类型', type: 'select', options: [{ value: 'income', label: '收入' }, { value: 'expense', label: '支出' }] },
    { id: 'amount', label: '金额', type: 'number', placeholder: '8800', required: true },
    { id: 'currency', label: '币种', defaultValue: 'CNY' },
    { id: 'counterparty', label: '对方', placeholder: '客户 / 供应商' },
    { id: 'category', label: '科目', placeholder: '服务收入 / 云服务' },
    { id: 'description', label: '摘要', type: 'textarea', placeholder: '这笔钱是什么', required: true }
  ],
  buildBody: (v) => ({
    kind: 'transaction',
    direction: v.direction === 'expense' ? 'expense' : 'income',
    amount: Number(v.amount),
    currency: v.currency.trim() || 'CNY',
    counterparty: v.counterparty.trim() || undefined,
    category: v.category.trim() || undefined,
    description: v.description.trim()
  })
};

function RouteView({
  route,
  overview,
  agents
}: {
  route: RouteId;
  overview: UseQueryResult<OverviewResponse>;
  agents: AgentDefinition[];
}) {
  if (overview.isLoading) return <LoadingPanel />;
  if (overview.isError) return <ErrorPanel error={overview.error} />;
  if (!overview.data) return <LoadingPanel />;

  const overviewData = overview.data;

  switch (route) {
    case 'mission':
      return <MissionControl overview={overviewData} agents={agents} />;
    case 'aself':
      return <ASelfConsole />;
    case 'paperclip':
      return <PaperclipGovernance />;
    case 'agents':
      return <AgentsPage agents={agents} />;
    case 'tasks':
      return <TasksPage />;
    case 'mini':
      return <MiniAppPage />;
    case 'crm':
      return <DashboardPage title="CRM" endpoint="/api/web/crm" miniPanel="crm" quickEntry={crmQuickEntry} sections={[
        ['热线索', 'hotLeads'],
        ['开放机会', 'openOpportunities'],
        ['逾期跟进', 'overdueFollowUps'],
        ['近期跟进', 'upcomingFollowUps'],
        ['风险客户', 'riskContacts']
      ]} />;
    case 'mail':
      return <DashboardPage title="Mail" endpoint="/api/web/mail" miniPanel="mail" sections={[
        ['紧急邮件', 'urgent'],
        ['客户邮件', 'customer'],
        ['财务邮件', 'finance'],
        ['日历邮件', 'calendar'],
        ['邮件草稿', 'draftsWaitingApproval']
      ]} />;
    case 'finance':
      return <FinancePage />;
    case 'calendar':
      return <DashboardPage title="Calendar" endpoint="/api/web/calendar" quickEntry={calendarQuickEntry} sections={[
        ['今日日程', 'todayEvents'],
        ['明日日程', 'tomorrowEvents'],
        ['冲突', 'conflicts'],
        ['空闲时间', 'availabilityWindows'],
        ['会议准备', 'meetingPrep']
      ]} />;
    case 'browser':
      return <DashboardPage title="Browser" endpoint="/api/web/browser" miniPanel="screenshot" sections={[
        ['最近运行', 'recentRuns'],
        ['被拦截动作', 'blockedActions'],
        ['截图证据', 'recentScreenshots'],
        ['提取结果', 'recentExtractions']
      ]} />;
    case 'ops':
      return <OpsInsightsPage />;
    case 'dependencies':
      return <DependencySetupPage />;
    case 'settings':
      return <SettingsPage />;
    case 'debug':
      return <TelegramDebugPage />;
    case 'deliverables':
      return <DeliverablePage />;
    default:
      return <MissionControl overview={overviewData} agents={agents} />;
  }
}

function MissionControl({ overview, agents }: { overview: OverviewResponse; agents: AgentDefinition[] }) {
  const metrics = [
    {
      label: '任务总数',
      value: overview.metrics.tasks,
      detail: `${overview.metrics.queuedTasks} queued / ${overview.metrics.blockedTasks} blocked`,
      icon: Workflow,
      tone: 'neutral'
    },
    {
      label: '运行中 Agent',
      value: overview.metrics.runningAgentRuns,
      detail: overview.metrics.runningAgentRuns ? '正在执行' : '当前空闲',
      icon: Bot,
      tone: overview.metrics.runningAgentRuns ? 'active' : 'neutral'
    },
    {
      label: '待审批',
      value: overview.metrics.pendingApprovals,
      detail: overview.metrics.pendingApprovals ? '需要 Owner 决策' : '无阻塞审批',
      icon: ShieldCheck,
      tone: overview.metrics.pendingApprovals ? 'danger' : 'done'
    },
    {
      label: '活跃 Agent',
      value: overview.metrics.activeAgents,
      detail: `${agents.length} registered`,
      icon: Activity,
      tone: 'active'
    }
  ] as const;

  return (
    <div className="mission-grid">
      <TodayCockpit overview={overview} />

      <section className="metric-grid mission-metrics compact-metrics">
        {metrics.map(({ label, value, detail, icon, tone }) => (
          <MetricCard key={label} label={label} value={value} detail={detail} icon={icon} tone={tone} />
        ))}
      </section>

      <OperationsStrip overview={overview} />

      <section className="panel network-panel">
        <PanelHeader title="Agent Live Map" hint="Chief -> Router -> Skill -> Specialist" />
        <AgentNetwork agents={agents} runs={overview.agentRuns} />
      </section>

      <section className="panel queue-panel">
        <PanelHeader title="Task Queue Flow" hint="queued / running / blocked / done" />
        <TaskFlow counts={overview.taskStatusCounts} />
      </section>

      <section className="panel">
        <PanelHeader title="最近 Agent Runs" hint="模型、状态、错误" />
        <Timeline items={overview.agentRuns} kind="run" />
      </section>

      <section className="panel">
        <PanelHeader title="任务快照" hint="最近 12 个任务" />
        <TaskList tasks={overview.tasks} compact />
      </section>

      <section className="panel">
        <PanelHeader title="审批中心" hint="财务和高风险动作保持最严" />
        <ApprovalList approvals={overview.pendingApprovals} />
      </section>

      <section className="panel">
        <PanelHeader title="最近对话" hint="Telegram / Web Console" />
        <SimpleList
          items={overview.recentMessages}
          primary={(item) => truncateText(item.text ?? '空消息', 180)}
          meta={(item) => `${item.direction} · ${formatTime(item.created_at)}`}
        />
      </section>

      <section className="panel">
        <PanelHeader title="Codex Bridge Inbox" hint="本地转发入口" />
        <SimpleList
          items={overview.codexInbox}
          primary={(item) => truncateText(item.prompt ?? item.text ?? item.raw ?? 'inbox item', 160)}
          meta={(item) => String(item.createdAt ?? item.created_at ?? item.source ?? 'runtime inbox')}
        />
      </section>
    </div>
  );
}

function buildTodayDigest(overview: OverviewResponse): { headline: string; reason: string; tone: string } {
  const m = overview.metrics;
  const crm = overview.dashboards.crm;
  const finance = overview.dashboards.finance;
  const hotLeads = countItems(crm.hotLeads) + countItems(crm.openOpportunities);
  const overdue = countItems(crm.overdueFollowUps);
  const financeRisks = countItems(finance.riskAlerts);
  const netCashflow = Number(finance.netCashflow ?? 0);
  const currency = String(finance.currency ?? 'CNY');

  if (!overview.health.database || !overview.health.redis) {
    return {
      headline: '先恢复系统基础设施，再处理业务',
      reason: 'PostgreSQL 或 Redis 连接异常，任务无法可靠执行。',
      tone: 'danger'
    };
  }
  if (m.pendingApprovals > 0) {
    return {
      headline: `今天最重要的是处理 ${m.pendingApprovals} 项待审批`,
      reason: '这些高风险动作正卡在你这里，批准后关联任务才会继续执行。',
      tone: 'danger'
    };
  }
  if (financeRisks > 0) {
    return {
      headline: `今天最重要的是核对 ${financeRisks} 个财务风险`,
      reason: netCashflow < 0
        ? `本月净现金流为负（${formatMoney(netCashflow, currency)}），需要优先关注。`
        : '发票、付款或订阅出现异常提醒，建议先核对。',
      tone: 'danger'
    };
  }
  if (m.blockedTasks > 0) {
    return {
      headline: `今天最重要的是解除 ${m.blockedTasks} 个阻塞任务`,
      reason: '解除阻塞比继续创建新任务更能推进今天的结果。',
      tone: 'warning'
    };
  }
  if (overdue > 0) {
    return {
      headline: `今天最重要的是跟进 ${overdue} 个逾期客户`,
      reason: '逾期跟进会让成交机会快速冷却，越早联系越好。',
      tone: 'growth'
    };
  }
  if (hotLeads > 0) {
    return {
      headline: `今天可以推进 ${hotLeads} 个销售机会`,
      reason: '没有阻塞项，适合把精力放在获客和成交上。',
      tone: 'growth'
    };
  }
  return {
    headline: '今天没有紧急事项，适合做增长和复盘',
    reason: '可以主动布置一个获客、交付或复盘目标。',
    tone: 'done'
  };
}

type DrillItem = { id: string; primary: string; meta?: string };

function drillItemsFor(key: string, overview: OverviewResponse): DrillItem[] {
  const crm = overview.dashboards.crm;
  const mail = overview.dashboards.mail;
  const finance = overview.dashboards.finance;
  const currency = String(finance.currency ?? 'CNY');
  switch (key) {
    case 'approvals':
      return (overview.pendingApprovals ?? []).slice(0, 6).map((a) => ({
        id: String(a.id),
        primary: String(a.task_title ?? a.action_type ?? '待审批动作'),
        meta: `${a.risk_level ?? ''} · ${formatTime(a.created_at)}`
      }));
    case 'blocked':
      return (overview.tasks ?? [])
        .filter((t) => t.status === 'blocked' || t.status === 'failed')
        .slice(0, 6)
        .map((t) => ({
          id: t.id,
          primary: t.title,
          meta: `${t.owner_agent ?? ''} · ${t.status} · ${formatTime(t.created_at)}`
        }));
    case 'leads': {
      const leads = (crm.hotLeads ?? []).slice(0, 3).map((c: any) => ({
        id: String(c.id),
        primary: String(c.name ?? '未命名联系人'),
        meta: [c.role, c.organization_name].filter(Boolean).join(' · ') || '热线索'
      }));
      const opps = (crm.openOpportunities ?? []).slice(0, 3).map((o: any) => ({
        id: String(o.id),
        primary: String(o.title ?? '销售机会'),
        meta: [
          o.value_amount ? formatMoney(o.value_amount, o.currency ?? currency) : null,
          o.stage,
          o.contact_name ?? o.organization_name
        ].filter(Boolean).join(' · ') || '开放机会'
      }));
      return [...leads, ...opps].slice(0, 6);
    }
    case 'mail': {
      const urgent = (mail.urgent ?? []).slice(0, 4).map((t: any) => ({
        id: String(t.id),
        primary: String(t.subject ?? '(无主题)'),
        meta: [t.contact_name ?? t.organization_name, '紧急'].filter(Boolean).join(' · ')
      }));
      const drafts = (mail.draftsWaitingApproval ?? []).slice(0, 3).map((d: any) => ({
        id: String(d.id),
        primary: String(d.subject ?? '邮件草稿'),
        meta: '等待确认的草稿'
      }));
      return [...urgent, ...drafts].slice(0, 6);
    }
    case 'finance':
      return (finance.riskAlerts ?? []).slice(0, 6).map((r: any, i: number) => ({
        id: `risk_${i}`,
        primary: String(r)
      }));
    default:
      return [];
  }
}

function TodayCockpit({ overview }: { overview: OverviewResponse }) {
  const queryClient = useQueryClient();
  const [openDetail, setOpenDetail] = useState<string | null>(null);
  const opsPulse = useQuery({
    queryKey: ['ops-insights', 'home'],
    queryFn: () => apiGet<OpsInsightsResponse>('/api/web/ops-insights'),
    staleTime: 20_000,
    refetchInterval: 60_000
  });
  const hour = new Date().getHours();
  const greeting = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
  const hotLeads = countItems(overview.dashboards.crm.hotLeads) + countItems(overview.dashboards.crm.openOpportunities);
  const urgentMail = countItems(overview.dashboards.mail.urgent) + countItems(overview.dashboards.mail.draftsWaitingApproval);
  const financeRisks = countItems(overview.dashboards.finance.riskAlerts);
  const todayEvents = countItems(overview.dashboards.calendar.todayEvents);
  const digest = buildTodayDigest(overview);

  const approvalDecision = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) =>
      apiPost<WebCommandResponse>('/api/web/command', { text: `/${action} ${id}` }),
    onSuccess: () => void queryClient.invalidateQueries()
  });

  const priorities = [
    overview.metrics.pendingApprovals > 0 ? {
      key: 'approvals',
      tone: 'danger',
      label: `${overview.metrics.pendingApprovals} 项决策等你确认`,
      detail: '高风险动作不会自动越权，批准后关联任务会继续执行。',
      action: '处理审批',
      onClick: () => openConsoleRoute('finance', 'panel=approvals')
    } : null,
    overview.metrics.blockedTasks > 0 ? {
      key: 'blocked',
      tone: 'warning',
      label: `${overview.metrics.blockedTasks} 个任务被阻塞`,
      detail: '先解除阻塞，比继续创建新任务更能推进今天的结果。',
      action: '查看阻塞任务',
      onClick: () => openConsoleRoute('tasks', 'status=blocked')
    } : null,
    hotLeads > 0 ? {
      key: 'leads',
      tone: 'growth',
      label: `${hotLeads} 个销售机会可推进`,
      detail: '检查热线索、开放机会和逾期跟进，避免机会冷却。',
      action: '打开 CRM',
      onClick: () => openConsoleRoute('crm')
    } : null,
    urgentMail > 0 ? {
      key: 'mail',
      tone: 'neutral',
      label: `${urgentMail} 封邮件需要关注`,
      detail: '优先处理客户邮件与等待确认的草稿。',
      action: '处理邮件',
      onClick: () => openConsoleRoute('mail')
    } : null,
    financeRisks > 0 ? {
      key: 'finance',
      tone: 'danger',
      label: `${financeRisks} 个财务风险提醒`,
      detail: '核对发票、付款、订阅和现金流异常。',
      action: '检查财务',
      onClick: () => openConsoleRoute('finance')
    } : null
  ].filter(Boolean).slice(0, 4) as Array<{
    key: string;
    tone: string;
    label: string;
    detail: string;
    action: string;
    onClick: () => void;
  }>;

  const clearDay = priorities.length === 0;
  const pendingApprovals = overview.pendingApprovals.slice(0, 2);
  const dateLabel = new Intl.DateTimeFormat('zh-CN', {
    month: 'long', day: 'numeric', weekday: 'long'
  }).format(new Date());

  const pulseStats = [
    { key: 'intervene', value: overview.metrics.pendingApprovals + overview.metrics.blockedTasks, label: '需要你介入' },
    { key: 'leads', value: hotLeads, label: '销售机会' },
    { key: 'events', value: todayEvents, label: '今日日程' }
  ];

  function toggleDetail(key: string) {
    setOpenDetail((current) => (current === key ? null : key));
  }

  return (
    <section className="today-cockpit">
      <div className={`today-hero panel tone-${digest.tone}`}>
        <div className="today-greeting">
          <span className="eyebrow"><Coffee size={13} /> {dateLabel}</span>
          <h2>{greeting}，老板。</h2>
          <p className="today-headline">{digest.headline}</p>
          <p className="today-reason">{digest.reason}</p>
        </div>
        <div className="today-pulse">
          {pulseStats.map((stat) => (
            <div key={stat.key}><strong>{stat.value}</strong><span>{stat.label}</span></div>
          ))}
        </div>
      </div>

      {opsPulse.data ? (
        <section className="panel ops-home-pulse">
          <div className="ops-home-pulse-head">
            <PanelHeader title="经营脉搏" hint="自动分析 · 每分钟刷新" />
            <button type="button" className="text-button" onClick={() => openConsoleRoute('ops')}>查看完整分析 <ArrowRight size={14} /></button>
          </div>
          <p className="ops-home-headline">{opsPulse.data.headline}</p>
          <div className="ops-home-kpis">
            {opsPulse.data.kpis.slice(0, 4).map((kpi) => (
              <div key={kpi.key} className={`ops-home-kpi ${kpi.tone ?? ''}`}>
                <span>{kpi.label}</span>
                <strong>{kpi.value}</strong>
                <small>{kpi.hint}</small>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="today-work-grid">
        <section className="panel focus-panel">
          <PanelHeader title="今天先做什么" hint="按经营影响自动排序，点卡片看是哪些" />
          {clearDay ? (
            <div className="clear-day-state">
              <CheckCircle2 size={25} />
              <div><strong>当前没有阻塞项</strong><span>建议主动推进一个增长目标。</span></div>
              <button onClick={() => prefillChiefCommand('帮我分析当前经营数据，找出今天最值得推进的一个增长动作，并创建执行任务', true)}>让 Chief 给建议</button>
            </div>
          ) : (
            <div className="priority-list">
              {priorities.map((priority, index) => {
                const items = drillItemsFor(priority.key, overview);
                const expanded = openDetail === priority.key;
                return (
                  <article key={priority.key} className={`priority-item ${priority.tone} ${expanded ? 'expanded' : ''}`}>
                    <div className="priority-row">
                      <span className="priority-rank">{index + 1}</span>
                      <button
                        type="button"
                        className="priority-body"
                        onClick={() => toggleDetail(priority.key)}
                        aria-expanded={expanded}
                      >
                        <strong>{priority.label}</strong>
                        <p>{priority.detail}</p>
                        {items.length ? (
                          <span className="priority-peek">
                            {expanded ? '收起明细' : '查看是哪些'}
                            <ChevronRight size={13} className={expanded ? 'rot90' : ''} />
                          </span>
                        ) : null}
                      </button>
                      <button className="priority-action" onClick={priority.onClick}>{priority.action}<ArrowRight size={15} /></button>
                    </div>
                    {expanded && items.length ? (
                      <ul className="priority-drill">
                        {items.map((item) => (
                          <li key={item.id}>
                            <span className="drill-primary">{item.primary}</span>
                            {item.meta ? <span className="drill-meta">{item.meta}</span> : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="panel quick-work-panel">
          <PanelHeader title="快速开始" hint="点一下直接让 Chief 执行" />
          <div className="human-actions">
            <button onClick={() => prefillChiefCommand('生成今天的经营简报：总结任务、审批、客户、现金流风险，并告诉我最重要的三件事', true)}>
              <Gauge size={18} /><span><strong>生成今日简报</strong><small>把所有经营信号浓缩成三件事</small></span>
            </button>
            <button onClick={() => prefillChiefCommand('检查所有阻塞和失败任务，按影响排序，并为每项给出下一步修复动作', true)}>
              <AlertTriangle size={18} /><span><strong>清理阻塞任务</strong><small>找原因并生成可执行修复清单</small></span>
            </button>
            <button onClick={() => prefillChiefCommand('检查 CRM 里需要跟进的客户和销售机会，帮我起草今天的跟进计划，但不要直接发送', true)}>
              <Users size={18} /><span><strong>推进客户跟进</strong><small>找出今天最值得联系的人</small></span>
            </button>
            <button onClick={() => prefillChiefCommand('检查当前财务数据、发票、订阅和风险提醒，生成现金流健康摘要', true)}>
              <CircleDollarSign size={18} /><span><strong>检查现金流</strong><small>提前发现付款和订阅风险</small></span>
            </button>
          </div>
        </section>
      </div>

      {pendingApprovals.length ? (
        <section className="panel owner-decision-panel">
          <PanelHeader title="需要你的决定" hint="可在这里直接处理，不必跳转" />
          <div className="owner-decision-list">
            {pendingApprovals.map((approval) => (
              <article key={approval.id}>
                <div>
                  <span className="decision-risk">{approval.risk_level}</span>
                  <strong>{approval.task_title ?? approval.action_type}</strong>
                  <p>{truncateText(approval.prompt, 150)}</p>
                </div>
                <div className="decision-buttons">
                  <button
                    disabled={approvalDecision.isPending}
                    onClick={() => approvalDecision.mutate({ id: approval.id, action: 'approve' })}
                  >批准</button>
                  <button
                    className="danger-button"
                    disabled={approvalDecision.isPending}
                    onClick={() => approvalDecision.mutate({ id: approval.id, action: 'reject' })}
                  >拒绝</button>
                </div>
              </article>
            ))}
          </div>
          {approvalDecision.isSuccess ? <p className="inline-success"><CheckCircle2 size={15} /> 决定已记录，相关数据正在刷新。</p> : null}
          {approvalDecision.isError ? <p className="form-error">操作失败：{approvalDecision.error.message}</p> : null}
        </section>
      ) : null}
    </section>
  );
}

function openConsoleRoute(route: RouteId, query = '') {
  const suffix = query ? `?${query}` : '';
  window.history.pushState({}, '', route === 'mission' ? '/app' : `/app/${route}${suffix}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function prefillChiefCommand(text: string, autoRun = false) {
  window.dispatchEvent(new CustomEvent('tele-opc:prefill-command', { detail: { text, autoRun } }));
}

function OperationsStrip({ overview }: { overview: OverviewResponse }) {
  const items = [
    ['CRM', countItems(overview.dashboards.crm.hotLeads) + countItems(overview.dashboards.crm.openOpportunities), 'leads + opps'],
    ['Mail', countItems(overview.dashboards.mail.urgent) + countItems(overview.dashboards.mail.draftsWaitingApproval), 'urgent + drafts'],
    ['Finance', countItems(overview.dashboards.finance.riskAlerts), 'risk alerts'],
    ['Calendar', countItems(overview.dashboards.calendar.todayEvents) + countItems(overview.dashboards.calendar.tomorrowEvents), 'today + tomorrow'],
    ['Browser', countItems(overview.dashboards.browser.blockedActions), 'blocked actions']
  ] as const;

  return (
    <section className="ops-strip">
      {items.map(([label, value, hint]) => (
        <article key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
          <small>{hint}</small>
        </article>
      ))}
    </section>
  );
}

function AgentsPage({ agents }: { agents: AgentDefinition[] }) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const runs = useQuery({
    queryKey: ['agent-runs'],
    queryFn: () => apiGet<{ ok: boolean; agentRuns: AgentRunRecord[] }>('/api/web/agent-runs?limit=80')
  });
  const runDetail = useQuery({
    queryKey: ['agent-run', selectedRunId],
    queryFn: () => apiGet<{ ok: boolean; run: AgentRunRecord; toolCalls: AnyRecord[] }>(`/api/web/agent-runs/${selectedRunId}`),
    enabled: Boolean(selectedRunId)
  });

  return (
    <div className="two-column">
      <section className="panel">
        <PanelHeader title="Agent Registry" hint="Chief、Router、Skill、业务 Agent" />
        <div className="agent-grid">
          {agents.map((agent) => (
            <article key={agent.id} className="agent-card">
              <div>
                <h3>{agent.displayName}</h3>
                <StatusPill status={agent.mode} />
              </div>
              <p>{agent.role}</p>
              <div className="tag-row">
                {agent.capabilities.slice(0, 4).map((capability) => <span key={capability}>{labelFromSnake(capability)}</span>)}
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="panel">
        <PanelHeader title="Runs Timeline" hint="点击一条 run 查看工具调用" />
        <div className="timeline clickable">
          {(runs.data?.agentRuns ?? []).map((run) => (
            <button key={run.id} onClick={() => setSelectedRunId(run.id)} className={run.id === selectedRunId ? 'selected' : ''}>
              <StatusPill status={run.status} />
              <strong>{run.agent_id}</strong>
              <span>{run.model}</span>
              <small>{formatTime(run.started_at)}</small>
            </button>
          ))}
        </div>
        <TraceDetail detail={runDetail.data} />
      </section>
    </div>
  );
}

function TasksPage() {
  const statusFromQuery = useQueryParam('status');
  const [status, setStatus] = useState(statusFromQuery);
  const panel = usePanelParam();
  const selectedTaskId = useQueryParam('task');
  const queryClient = useQueryClient();
  const tasks = useQuery({
    queryKey: ['tasks', status],
    queryFn: () => apiGet<{ ok: boolean; tasks: TaskRecord[] }>(`/api/web/tasks?limit=80${status ? `&status=${status}` : ''}`)
  });
  const retry = useMutation({
    mutationFn: (taskId: string) => apiPost('/api/web/tasks/' + taskId + '/retry', {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['overview'] });
    }
  });
  const statuses = ['', 'planned', 'queued', 'running', 'blocked', 'waiting_approval', 'done', 'failed'];
  const miniPanel = isMiniPanelKind(panel) ? panel : null;

  useEffect(() => {
    if (statusFromQuery && statuses.includes(statusFromQuery)) setStatus(statusFromQuery);
  }, [statusFromQuery]);

  useEffect(() => {
    if (!miniPanel) return;
    window.history.replaceState({}, '', miniPanelHref(miniPanel));
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, [miniPanel]);

  return (
    <div className="stack">
      {selectedTaskId ? <TaskDetailPanel taskId={selectedTaskId} /> : null}
      <section className="panel">
        <PanelHeader title="任务看板" hint="retry 会走原有 Chief Agent 策略，高风险不能绕过审批" />
        <div className="segmented">
          {statuses.map((item) => (
            <button key={item || 'all'} className={status === item ? 'active' : ''} onClick={() => setStatus(item)}>
              {item || '全部'}
            </button>
          ))}
        </div>
        <div className="task-table">
          {(tasks.data?.tasks ?? []).map((task) => (
            <article key={task.id}>
              <div>
                <strong>{task.title}</strong>
                <span>{task.id}</span>
              </div>
              <StatusPill status={task.status} />
              <span>{task.owner_agent}</span>
              <span>{task.risk_level}</span>
              <span>{formatTime(task.created_at)}</span>
              <a className="icon-button" href={`/app/tasks?task=${encodeURIComponent(task.id)}`} title="查看任务详情">
                <ChevronRight size={16} />
              </a>
              <button className="icon-button" onClick={() => retry.mutate(task.id)} title="重试任务">
                <RefreshCw size={16} />
              </button>
            </article>
          ))}
        </div>
        {!tasks.data?.tasks?.length ? <EmptyState text="当前筛选没有任务" /> : null}
      </section>
    </div>
  );
}

function TaskDetailPanel({ taskId }: { taskId: string }) {
  const query = useQuery({
    queryKey: ['task-detail', taskId],
    queryFn: () => apiGet<WebCommandResponse>(`/api/web/tasks/${encodeURIComponent(taskId)}`),
    enabled: Boolean(taskId),
    refetchInterval: 5000
  });

  if (query.isLoading) return <LoadingPanel />;
  if (query.isError) return <ErrorPanel error={query.error} />;
  if (!query.data?.task) return <EmptyState text="没有找到这个任务" />;

  return <TaskSubmissionCard response={query.data} live />;
}

function MiniAppPage() {
  const activePanel = miniPanelFromPath() ?? 'ppt';
  const activeEntry = miniAppEntries.find((entry) => entry.kind === activePanel) ?? miniAppEntries[0];

  return (
    <div className="mini-app-route">
      <section className="panel mini-app-hero">
        <div>
          <span className="eyebrow">Telegram Mini App</span>
          <h2>{activeEntry.label}</h2>
          <p>{activeEntry.description}</p>
        </div>
        <div className="mini-app-switcher">
          {miniAppEntries.slice(0, 6).map((entry) => (
            <a key={entry.kind} className={entry.kind === activePanel ? 'active' : ''} href={miniPanelHref(entry.kind)}>
              {entry.label}
            </a>
          ))}
        </div>
      </section>
      <MiniAppActionPanel kind={activePanel} />
      <section className="panel mini-app-directory">
        <PanelHeader title="更多 Mini App 面板" hint="/app/mini/:panel" />
        <div className="mini-app-entry-grid">
          {miniAppEntries.map((entry) => (
            <a key={entry.kind} href={miniPanelHref(entry.kind)}>
              <strong>{entry.label}</strong>
              <span>{entry.description}</span>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}

function MiniAppStandalone() {
  return (
    <main className="mini-app-standalone">
      <MiniAppPage />
    </main>
  );
}

function DashboardPage({
  title,
  endpoint,
  sections,
  miniPanel,
  quickEntry
}: {
  title: string;
  endpoint: string;
  sections: Array<[string, string]>;
  miniPanel?: MiniPanelKind;
  quickEntry?: QuickEntryConfig;
}) {
  const panel = usePanelParam();
  const query = useQuery({
    queryKey: ['dashboard', title],
    queryFn: () => apiGet<{ ok: boolean; dashboard: AnyRecord }>(endpoint)
  });
  const dashboard = query.data?.dashboard ?? {};
  const showMiniPanel = Boolean(panel && miniPanel);

  return (
    <div className="dashboard-grid">
      {showMiniPanel ? <MiniAppActionPanel kind={miniPanel!} /> : null}
      {quickEntry ? <QuickEntry config={quickEntry} /> : null}
      <section className="dashboard-summary">
        {sections.map(([label, key]) => (
          <article key={key}>
            <span>{label}</span>
            <strong>{countItems(dashboard[key])}</strong>
          </article>
        ))}
      </section>
      {sections.map(([label, key]) => (
        <section className="panel" key={key}>
          <PanelHeader title={label} hint={`${title}.${key}`} />
          <SimpleList
            items={Array.isArray(dashboard[key]) ? dashboard[key] : []}
            primary={(item) => item.title ?? item.name ?? item.subject ?? item.note ?? item.action_type ?? item.label ?? String(item)}
            meta={(item) => item.status ?? item.stage ?? item.category ?? item.priority ?? item.id ?? ''}
          />
        </section>
      ))}
    </div>
  );
}

type TelegramDiagnosticsResponse = {
  ok: boolean;
  publicBaseUrl: string;
  httpsPublicBaseUrl: boolean;
  botTokenConfigured: boolean;
  ownerIdsConfigured: number;
  initData: {
    present: boolean;
    valid: boolean;
    reason?: string;
    userId?: number;
    ownerAllowed?: boolean;
    authDate?: number;
    ageSeconds?: number | null;
    queryIdPresent: boolean;
    startParam?: string;
  };
  request: {
    url: string;
    host?: string;
    userAgent?: string | null;
  };
};

function TelegramDebugPage({ standalone = false }: { standalone?: boolean }) {
  const [runtime, setRuntime] = useState(() => telegramRuntimeSnapshot());
  const diagnostics = useQuery({
    queryKey: ['telegram-diagnostics'],
    queryFn: () => apiGet<TelegramDiagnosticsResponse>('/api/web/telegram-diagnostics'),
    retry: false
  });

  function refresh() {
    setRuntime(telegramRuntimeSnapshot());
    void diagnostics.refetch();
  }

  const server = diagnostics.data;
  const rows = [
    ['Telegram SDK', runtime.sdkLoaded ? '已注入' : '未注入'],
    ['Mini App initData', runtime.initDataLength ? `${runtime.initDataLength} 字符` : '没有'],
    ['Server initData 校验', server ? (server.initData.valid ? '通过' : `失败：${server.initData.reason ?? 'unknown'}`) : '读取中'],
    ['Telegram user', String(runtime.initUserId ?? server?.initData.userId ?? '未知')],
    ['Owner allowlist', server ? (server.initData.ownerAllowed ? '已匹配' : '未匹配') : '读取中'],
    ['平台', `${runtime.platform} / ${runtime.version}`],
    ['公网 HTTPS', server ? (server.httpsPublicBaseUrl ? server.publicBaseUrl : `不是 HTTPS：${server.publicBaseUrl}`) : '读取中']
  ];

  return (
    <main className={standalone ? 'debug-standalone' : 'stack'}>
      <section className="panel telegram-debug-panel">
        <PanelHeader title="Telegram Mini App 诊断" hint="SDK / initData / HTTPS / Owner" />
        <div className="diagnostic-grid">
          {rows.map(([label, value]) => (
            <article key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </article>
          ))}
        </div>
        <div className="task-card-actions">
          <button className="ghost-button" onClick={refresh}>刷新诊断</button>
          <a className="ghost-button" href="/app">打开控制台</a>
          <a className="ghost-button" href="/app/mini/ppt">测试 PPT 引导</a>
        </div>
        {diagnostics.isError ? <ErrorPanel error={diagnostics.error} /> : null}
      </section>

      <section className="panel">
        <PanelHeader title="客户端环境" hint="Telegram.WebApp" />
        <pre className="json-panel">{JSON.stringify(runtime, null, 2)}</pre>
      </section>

      <section className="panel">
        <PanelHeader title="服务端校验" hint="/api/web/telegram-diagnostics" />
        <pre className="json-panel">{JSON.stringify(server ?? { loading: true }, null, 2)}</pre>
      </section>
    </main>
  );
}

function telegramRuntimeSnapshot() {
  const webApp = (window as any).Telegram?.WebApp;
  return {
    sdkLoaded: Boolean(webApp),
    version: webApp?.version ?? 'unknown',
    platform: webApp?.platform ?? 'unknown',
    colorScheme: webApp?.colorScheme ?? 'unknown',
    initDataLength: webApp?.initData?.length ?? 0,
    initUserId: webApp?.initDataUnsafe?.user?.id ?? null,
    startParam: webApp?.initDataUnsafe?.start_param ?? null,
    queryIdPresent: Boolean(webApp?.initDataUnsafe?.query_id),
    viewportHeight: webApp?.viewportHeight ?? null,
    isExpanded: webApp?.isExpanded ?? null,
    currentUrl: window.location.href,
    userAgent: navigator.userAgent
  };
}

type PptGuidedStep = {
  id: 'topic' | 'audience' | 'purpose' | 'pages' | 'style' | 'materials';
  label: string;
  question: string;
  placeholder: string;
  chips?: string[];
  multiline?: boolean;
};

const pptGuidedSteps: PptGuidedStep[] = [
  {
    id: 'topic',
    label: '主题',
    question: '这份 PPT 要讲什么？',
    placeholder: '例如：旺仔牛奶面向中国青少年的宣传方案'
  },
  {
    id: 'audience',
    label: '受众',
    question: '给谁看？',
    placeholder: '例如：中国青少年用户、家长、渠道商、投资人',
    chips: ['中国青少年用户', '家长和学生', '品牌客户', '投资人', '内部团队']
  },
  {
    id: 'purpose',
    label: '目标',
    question: '看完之后希望对方做什么？',
    placeholder: '例如：理解产品卖点并愿意尝试购买',
    chips: ['品牌宣传', '销售提案', '融资路演', '内部汇报', '活动招商']
  },
  {
    id: 'pages',
    label: '页数',
    question: '大概做多少页？',
    placeholder: '例如：10页',
    chips: ['6页', '8页', '10页', '12页', '15页']
  },
  {
    id: 'style',
    label: '风格',
    question: '希望是什么视觉和表达风格？',
    placeholder: '例如：年轻、明亮、有记忆点，不要太商务',
    chips: ['年轻活力', '简洁商务', '科技感', '咨询公司风', '品牌营销风']
  },
  {
    id: 'materials',
    label: '素材',
    question: '有没有必须包含的资料、卖点、链接或禁忌？',
    placeholder: '可以粘贴资料、口号、产品卖点、参考链接；没有就写“暂无”',
    multiline: true
  }
];

function PptGuidedPanel() {
  const [stepIndex, setStepIndex] = useState(0);
  const [values, setValues] = useState<Record<PptGuidedStep['id'], string>>({
    topic: '',
    audience: '',
    purpose: '',
    pages: '10页',
    style: '品牌营销风',
    materials: ''
  });
  const queryClient = useQueryClient();
  const command = useMutation({
    mutationFn: () => apiPost<WebCommandResponse>('/api/web/mini-app/submit', {
      kind: 'ppt',
      values,
      text: buildPptGuidedCommand(values)
    }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries();
      const webApp = (window as any).Telegram?.WebApp;
      webApp?.HapticFeedback?.notificationOccurred?.('success');
      webApp?.showPopup?.({
        title: 'PPT 任务已创建',
        message: result.task
          ? '我已经创建任务卡。后续会按步骤执行，并在完成后生成可预览页面。'
          : '请求已经提交，结果会显示在当前页面。',
        buttons: [{ type: 'ok' }]
      });
    }
  });
  const current = pptGuidedSteps[stepIndex];
  const canGoNext = stepIndex < pptGuidedSteps.length - 1;
  const topicReady = values.topic.trim().length > 0;
  const canSubmit = topicReady && !command.isPending;

  const submitGuided = useCallback(() => {
    if (!canSubmit) return;
    command.mutate();
  }, [canSubmit, command]);

  useEffect(() => {
    const webApp = (window as any).Telegram?.WebApp;
    const mainButton = webApp?.MainButton;
    if (!mainButton) return;

    const onClick = () => {
      if (canGoNext) {
        setStepIndex((index) => Math.min(index + 1, pptGuidedSteps.length - 1));
        return;
      }
      submitGuided();
    };
    mainButton.setText(canGoNext ? '下一步' : command.isPending ? '提交中...' : '生成 PPT 任务');
    if (command.isPending) {
      mainButton.showProgress?.();
    } else {
      mainButton.hideProgress?.();
    }
    mainButton.show();
    mainButton.onClick(onClick);

    return () => {
      mainButton.offClick?.(onClick);
      mainButton.hideProgress?.();
      mainButton.hide();
    };
  }, [canGoNext, command.isPending, submitGuided]);

  function updateValue(id: PptGuidedStep['id'], value: string) {
    setValues((currentValues) => ({ ...currentValues, [id]: value }));
  }

  function nextStep() {
    setStepIndex((index) => Math.min(index + 1, pptGuidedSteps.length - 1));
  }

  function previousStep() {
    setStepIndex((index) => Math.max(index - 1, 0));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (canGoNext) {
      nextStep();
      return;
    }
    submitGuided();
  }

  return (
    <section className="panel mini-app-panel ppt-guided-panel">
      <PanelHeader title="PPT 引导生成" hint="Telegram Mini App" />
      <p>我会先把你的意图整理成任务合同，再交给 Content Agent 生成真实幻灯片内容，完成后给出可预览页面。</p>

      <div className="ppt-guided-progress">
        {pptGuidedSteps.map((step, index) => (
          <button
            key={step.id}
            type="button"
            className={index === stepIndex ? 'active' : index < stepIndex ? 'done' : ''}
            onClick={() => setStepIndex(index)}
          >
            <span>{index + 1}</span>
            {step.label}
          </button>
        ))}
      </div>

      <form className="ppt-guided-chat" onSubmit={submit}>
        <div className="guided-bubble assistant">
          <span>{current.label}</span>
          <strong>{current.question}</strong>
        </div>

        <label className="guided-answer">
          {current.multiline ? (
            <textarea
              value={values[current.id]}
              onChange={(event) => updateValue(current.id, event.target.value)}
              placeholder={current.placeholder}
              rows={6}
            />
          ) : (
            <input
              value={values[current.id]}
              onChange={(event) => updateValue(current.id, event.target.value)}
              placeholder={current.placeholder}
            />
          )}
        </label>

        {current.chips?.length ? (
          <div className="guided-chip-row">
            {current.chips.map((chip) => (
              <button key={chip} type="button" onClick={() => updateValue(current.id, chip)}>
                {chip}
              </button>
            ))}
          </div>
        ) : null}

        <div className="ppt-guided-summary">
          {pptGuidedSteps.map((step) => (
            <article key={step.id}>
              <span>{step.label}</span>
              <strong>{values[step.id] || '待补充'}</strong>
            </article>
          ))}
        </div>

        <div className="mini-panel-actions">
          <button type="button" className="secondary-button" onClick={previousStep} disabled={stepIndex === 0 || command.isPending}>
            上一步
          </button>
          {canGoNext ? (
            <button type="submit" disabled={command.isPending}>下一步</button>
          ) : (
            <button type="submit" disabled={!canSubmit}>
              {command.isPending ? '提交中...' : '生成 PPT 任务'}
            </button>
          )}
          <small>{topicReady ? '提交后会进入有顺序的 PPT 任务生命周期。' : '至少先填写主题，其他信息可由 Agent 合理补全。'}</small>
        </div>
      </form>

      {command.isError ? <ErrorPanel error={command.error} /> : null}
      {command.isSuccess ? (
        <p className="mini-submit-note">
          已提交到 Tele-OPC。完成后会出现可预览交付物，不会把一整段代码刷到 Telegram 聊天里。
        </p>
      ) : null}
      {command.data ? <TaskSubmissionCard response={command.data} /> : null}
    </section>
  );
}

function buildPptGuidedCommand(values: Record<PptGuidedStep['id'], string>) {
  return [
    '请做一份 PPT，并在最后生成可在 Telegram Mini App 中预览的网页版本。',
    `主题：${values.topic || '未填写主题，请先根据上下文做合理假设'}`,
    `受众：${values.audience || '未填写，请根据主题判断核心听众'}`,
    `使用场景/目标：${values.purpose || '未填写，请以清晰表达价值并促成下一步行动为目标'}`,
    `页数：${values.pages || '10页'}`,
    `风格：${values.style || '清晰、有结构、适合移动端预览'}`,
    `资料和要求：${values.materials || '暂无补充资料，请先生成 v0 幻灯片内容'}`,
    '',
    '工作要求：先分析这份 PPT 应该怎么做、应该由哪些 Agent 步骤完成，再按顺序执行；最终交付可预览的幻灯片页面，不要把内部提示词、任务字段或工作流字段写进幻灯片正文。'
  ].join('\n');
}

function MiniAppActionPanel({ kind }: { kind: MiniPanelKind }) {
  if (kind === 'ppt') {
    return <PptGuidedPanel />;
  }

  const config = miniPanelConfig(kind);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(
    config.fields.map((field) => [field.id, field.defaultValue ?? field.options?.[0] ?? ''])
  ));
  const queryClient = useQueryClient();
  const command = useMutation({
    mutationFn: () => apiPost<WebCommandResponse>('/api/web/mini-app/submit', {
      kind,
      values,
      text: config.toCommand(values)
    }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries();
      const webApp = (window as any).Telegram?.WebApp;
      webApp?.HapticFeedback?.notificationOccurred?.('success');
      webApp?.showPopup?.({
        title: '已提交',
        message: result.task
          ? '任务已经创建，Telegram 聊天里也会收到任务卡。'
          : '请求已经提交，结果会显示在当前页面。',
        buttons: [{ type: 'ok' }]
      });
    }
  });
  const submitPanel = useCallback(() => {
    if (command.isPending) return;
    command.mutate();
  }, [command, values]);

  useEffect(() => {
    const webApp = (window as any).Telegram?.WebApp;
    const mainButton = webApp?.MainButton;
    if (!mainButton) return;

    const onClick = () => submitPanel();
    mainButton.setText(command.isPending ? '提交中...' : config.submitLabel);
    if (command.isPending) {
      mainButton.showProgress?.();
    } else {
      mainButton.hideProgress?.();
    }
    if (command.isSuccess) {
      mainButton.setText('已提交，回 Telegram 看任务卡');
    }
    mainButton.show();
    mainButton.onClick(onClick);

    return () => {
      mainButton.offClick?.(onClick);
      mainButton.hideProgress?.();
      mainButton.hide();
    };
  }, [command.isPending, command.isSuccess, config.submitLabel, submitPanel]);

  function updateValue(id: string, value: string) {
    setValues((current) => ({ ...current, [id]: value }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    submitPanel();
  }

  return (
    <section className="panel mini-app-panel">
      <PanelHeader title={config.title} hint={config.hint} />
      <p>{config.description}</p>
      <form className="mini-panel-form" onSubmit={submit}>
        {config.fields.map((field) => (
          <label key={field.id}>
            <span>{field.label}</span>
            {field.type === 'textarea' ? (
              <textarea
                value={values[field.id] ?? ''}
                onChange={(event) => updateValue(field.id, event.target.value)}
                placeholder={field.placeholder}
                rows={field.rows ?? 4}
              />
            ) : field.type === 'select' ? (
              <select value={values[field.id] ?? ''} onChange={(event) => updateValue(field.id, event.target.value)}>
                {field.options?.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            ) : (
              <input
                value={values[field.id] ?? ''}
                onChange={(event) => updateValue(field.id, event.target.value)}
                placeholder={field.placeholder}
              />
            )}
          </label>
        ))}
        <div className="mini-panel-actions">
          <button type="submit" disabled={command.isPending}>
            {command.isPending ? '提交中' : config.submitLabel}
          </button>
          <small>{config.guardrail}</small>
        </div>
      </form>
      {command.isError ? <ErrorPanel error={command.error} /> : null}
      {command.isSuccess ? (
        <p className="mini-submit-note">
          已提交到 Tele-OPC。Mini App 内会显示任务生命周期，Telegram 聊天里也会收到任务卡。
        </p>
      ) : null}
      {command.data ? <TaskSubmissionCard response={command.data} /> : null}
    </section>
  );
}

function ApprovalCenterPanel() {
  const queryClient = useQueryClient();
  const approvals = useQuery({
    queryKey: ['approvals'],
    queryFn: () => apiGet<{ ok: boolean; approvals: AnyRecord[] }>('/api/web/approvals?limit=30')
  });
  const decision = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) =>
      apiPost<{ ok: boolean }>(`/api/web/approvals/${id}/decide`, {
        decision: action === 'approve' ? 'approved' : 'rejected'
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['approvals'] });
      void queryClient.invalidateQueries({ queryKey: ['overview'] });
      void queryClient.invalidateQueries({ queryKey: ['finance-dashboard'] });
    }
  });

  return (
    <section className="panel mini-app-panel approval-center-panel">
      <PanelHeader title="财务审批面板" hint="付款、报价、账单变更和高风险动作" />
      <p>这里可以直接处理待审批事项。批准或拒绝会继续走后端审批记录和任务生命周期。</p>
      <div className="approval-action-list">
        {(approvals.data?.approvals ?? []).map((approval) => (
          <article key={approval.id}>
            <div>
              <strong>{approval.task_title ?? approval.action_type}</strong>
              <span>{approval.id} · {approval.risk_level} · {approval.prompt}</span>
            </div>
            <div>
              <button onClick={() => decision.mutate({ id: approval.id, action: 'approve' })}>批准</button>
              <button className="danger-button" onClick={() => decision.mutate({ id: approval.id, action: 'reject' })}>拒绝</button>
            </div>
          </article>
        ))}
      </div>
      {!approvals.data?.approvals?.length ? <EmptyState text="当前没有待审批事项" /> : null}
    </section>
  );
}

function TaskSubmissionCard({ response, live = false }: { response: WebCommandResponse; live?: boolean }) {
  const subtasks = response.subtasks ?? [];
  const artifacts = response.artifacts ?? [];
  const task = response.task;
  const currentTask = response.currentTask;
  const doneCount = subtasks.filter((subtask) => subtask.status === 'done').length;

  if (!task) {
    return <pre className="json-panel">{response.reply}</pre>;
  }

  return (
    <section className="task-submission-card">
      <div className="task-submission-head">
        <div>
          <span>{live ? '任务生命周期' : '已提交真实任务'}</span>
          <strong>{task.title}</strong>
          <small>{task.id}</small>
        </div>
        <StatusPill status={task.status} />
      </div>

      <div className="task-submission-grid">
        <article>
          <span>当前步骤</span>
          <strong>{currentTask ? `${currentTask.sequence ?? '-'} · ${currentTask.title}` : '等待调度'}</strong>
          <small>{currentTask ? `${currentTask.id} · ${currentTask.status} · ${currentTask.owner_agent}` : '暂无子任务'}</small>
        </article>
        <article>
          <span>步骤进度</span>
          <strong>{subtasks.length ? `${doneCount}/${subtasks.length}` : '单步任务'}</strong>
          <small>按顺序执行，不能跳过前置步骤</small>
        </article>
      </div>

      {subtasks.length ? (
        <div className="task-step-list">
          {subtasks.slice(0, 8).map((subtask) => (
            <div key={subtask.id} className={subtask.id === currentTask?.id ? 'active' : ''}>
              <span>{subtask.sequence ?? '-'}</span>
              <div>
                <strong>{subtask.title}</strong>
                <small>{subtask.id} · {subtask.owner_agent}</small>
              </div>
              <StatusPill status={subtask.status} />
            </div>
          ))}
        </div>
      ) : null}

      <div className="task-card-actions">
        <a className="ghost-button" href={`/app/tasks?task=${encodeURIComponent(task.id)}`}>打开任务详情</a>
        {artifacts.map((artifact) => (
          <a key={artifact.id} className="ghost-button" href={`/app/deliverables/${encodeURIComponent(artifact.id)}`}>
            预览交付物：{artifact.type}
          </a>
        ))}
      </div>

      <details className="raw-reply">
        <summary>查看 Chief Agent 原始回复</summary>
        <pre className="json-panel">{response.reply}</pre>
      </details>
    </section>
  );
}

type MiniPanelField = {
  id: string;
  label: string;
  type?: 'text' | 'textarea' | 'select';
  placeholder?: string;
  defaultValue?: string;
  options?: string[];
  rows?: number;
};

type MiniPanelConfig = {
  title: string;
  hint: string;
  description: string;
  submitLabel: string;
  guardrail: string;
  fields: MiniPanelField[];
  toCommand: (values: Record<string, string>) => string;
};

function miniPanelConfig(kind: MiniPanelKind): MiniPanelConfig {
  const commonGuardrail = '信息不完整会先按默认假设生成 v0；财务、付款、对外承诺仍走审批。';
  const configs: Record<MiniPanelKind, MiniPanelConfig> = {
    ppt: {
      title: 'PPT 引导生成',
      hint: 'Telegram Mini App',
      description: '逐步确认主题、受众、用途、页数、风格和资料后，Chief Agent 会拆给内容 Agent 生成可预览 PPT。',
      submitLabel: '生成 PPT 任务',
      guardrail: commonGuardrail,
      fields: [
        { id: 'theme', label: '主题', placeholder: '例如：AI Agent OS 产品介绍' },
        { id: 'audience', label: '受众', type: 'select', options: ['老板/客户', '投资人', '团队内部', '销售客户', '政府/机构'] },
        { id: 'pages', label: '页数', type: 'select', options: ['8页', '10页', '12页', '15页', '20页'] },
        { id: 'style', label: '风格', type: 'select', options: ['简洁商务', '科技感', '融资路演', '咨询公司风', '销售提案'] },
        { id: 'materials', label: '资料/要求', type: 'textarea', placeholder: '可粘贴资料、链接、必须包含的观点', rows: 5 }
      ],
      toCommand: (values) => [
        '请生成一份可预览的 PPT。',
        `主题：${values.theme || '待定主题，先按通用商业方案 v0 推进'}`,
        `受众：${values.audience}`,
        `页数：${values.pages}`,
        `风格：${values.style}`,
        `资料和要求：${values.materials || '暂无，先做大纲和 v0'}`
      ].join('\n')
    },
    crm: {
      title: 'CRM 导入面板',
      hint: '线索/客户/机会',
      description: '粘贴线索表、客户名单或目标行业，CRM Agent 会做清洗、分组、评分和跟进任务。',
      submitLabel: '提交 CRM Agent',
      guardrail: commonGuardrail,
      fields: [
        { id: 'source', label: '来源', placeholder: '例如：展会名单 / 小红书 / LinkedIn / 手工表格' },
        { id: 'goal', label: '目标', placeholder: '例如：筛出高意向客户并生成跟进计划' },
        { id: 'data', label: '线索数据', type: 'textarea', placeholder: '粘贴姓名、公司、联系方式、备注等', rows: 7 }
      ],
      toCommand: (values) => `把下面资料导入 CRM，并让 CRM Agent 做线索清洗、评分和下一步跟进计划。\n来源：${values.source}\n目标：${values.goal}\n数据：\n${values.data}`
    },
    mail: {
      title: '邮件编辑面板',
      hint: '草稿/跟进/Campaign',
      description: '邮件发送不审批，但报价、付款、对外承诺会提醒并走审批。',
      submitLabel: '生成邮件草稿',
      guardrail: commonGuardrail,
      fields: [
        { id: 'recipient', label: '收件人/客户', placeholder: '例如：Alice / Acme 市场负责人' },
        { id: 'goal', label: '邮件目标', placeholder: '例如：第一次触达、跟进报价、约会议' },
        { id: 'tone', label: '语气', type: 'select', options: ['专业简洁', '温和礼貌', '销售推进', '正式商务'] },
        { id: 'context', label: '上下文', type: 'textarea', placeholder: '粘贴客户背景、上次沟通、必须提到的点', rows: 5 }
      ],
      toCommand: (values) => `请 Mail Agent 生成邮件草稿。\n收件人：${values.recipient}\n目标：${values.goal}\n语气：${values.tone}\n上下文：\n${values.context}`
    },
    finance: {
      title: '财务动作面板',
      hint: '强审批',
      description: '记录财务事实可以自动执行；付款、退款、转账、账单变更必须审批。',
      submitLabel: '提交财务任务',
      guardrail: '财务风险动作不会自动执行，必须 Owner 审批。',
      fields: [
        { id: 'action', label: '动作', type: 'select', options: ['记录收入', '记录支出', '准备付款审批', '创建发票', '检查订阅扣费'] },
        { id: 'amount', label: '金额', placeholder: '例如：128 CNY' },
        { id: 'counterparty', label: '对象', placeholder: '例如：Google Workspace / Acme' },
        { id: 'notes', label: '说明', type: 'textarea', rows: 4 }
      ],
      toCommand: (values) => `请 Finance Agent 处理财务任务。\n动作：${values.action}\n金额：${values.amount}\n对象：${values.counterparty}\n说明：${values.notes}`
    },
    financeImport: {
      title: '财务导入面板',
      hint: '账单/流水/订阅',
      description: '粘贴或描述账单数据，Finance Agent 会识别收入、支出、发票和订阅。',
      submitLabel: '导入财务数据',
      guardrail: '导入和记账可自动执行，付款类动作仍审批。',
      fields: [
        { id: 'source', label: '数据来源', placeholder: '例如：银行流水 / Stripe / Gmail 账单' },
        { id: 'data', label: '数据内容', type: 'textarea', rows: 7 }
      ],
      toCommand: (values) => `导入下面财务数据，分类收入、支出、发票和订阅。\n来源：${values.source}\n数据：\n${values.data}`
    },
    agent: {
      title: 'Agent 设置面板',
      hint: 'AI Provider / 权限 / 编排',
      description: '调整 Agent 偏好和权限边界，会写入系统记忆或生成设置任务。',
      submitLabel: '提交 Agent 设置',
      guardrail: '涉及密钥、付款、生产部署的改动不会在这里直接执行。',
      fields: [
        { id: 'provider', label: 'Provider/模型偏好', placeholder: '例如：默认 fable-5，开发任务 Claude Code' },
        { id: 'policy', label: '权限策略', type: 'textarea', rows: 4, placeholder: '例如：财务必须审批，邮件可自动发送' },
        { id: 'skills', label: 'Skill 偏好', type: 'textarea', rows: 4, placeholder: '例如：PPT 使用咨询公司风；销售先做客户画像' }
      ],
      toCommand: (values) => `更新 Tele-OPC Agent 设置偏好。\nProvider/模型：${values.provider}\n权限策略：${values.policy}\nSkill 偏好：${values.skills}`
    },
    artifact: {
      title: '任务资料面板',
      hint: 'Artifact',
      description: '把 Telegram 文件、截图或资料挂到任务上，让 Agent 在执行时引用。',
      submitLabel: '整理为任务资料',
      guardrail: commonGuardrail,
      fields: [
        { id: 'task', label: '关联任务', placeholder: '例如：T12 或任务标题' },
        { id: 'usage', label: '用途', type: 'select', options: ['作为知识资料', '作为客户资料', '作为截图证据', '作为 PPT 参考'] },
        { id: 'notes', label: '说明', type: 'textarea', rows: 5 }
      ],
      toCommand: (values) => `把资料挂到任务并整理引用方式。\n关联任务：${values.task}\n用途：${values.usage}\n说明：${values.notes}`
    },
    voice: {
      title: '语音转任务面板',
      hint: 'Voice intake',
      description: '如果自动转写不可用，可以先粘贴语音大意，Chief Agent 会拆解任务。',
      submitLabel: '转成任务',
      guardrail: commonGuardrail,
      fields: [
        { id: 'transcript', label: '语音大意/转写', type: 'textarea', rows: 6 },
        { id: 'goal', label: '希望产出', placeholder: '例如：拆成任务、生成方案、写邮件' }
      ],
      toCommand: (values) => `把这段语音内容转成可执行任务。\n目标：${values.goal}\n内容：\n${values.transcript}`
    },
    screenshot: {
      title: '截图分析面板',
      hint: 'Browser / QA Agent',
      description: '用于分析网页截图、报错截图、竞品页面、数据表截图。',
      submitLabel: '提交截图分析',
      guardrail: commonGuardrail,
      fields: [
        { id: 'goal', label: '分析目标', placeholder: '例如：找出页面问题、提取客户信息、判断报错原因' },
        { id: 'url', label: '相关网址', placeholder: '可选' },
        { id: 'notes', label: '截图说明', type: 'textarea', rows: 5 }
      ],
      toCommand: (values) => `请 Browser/QA Agent 分析截图或视觉资料。\n目标：${values.goal}\n相关网址：${values.url}\n说明：${values.notes}`
    },
    knowledge: {
      title: '知识库导入面板',
      hint: 'Company memory',
      description: '把价格表、SOP、合同、行业资料、公司规则导入 Tele-OPC 知识库。',
      submitLabel: '导入知识库',
      guardrail: commonGuardrail,
      fields: [
        { id: 'category', label: '类别', type: 'select', options: ['价格规则', 'SOP', '合同条款', '行业资料', '公司偏好', '销售话术'] },
        { id: 'content', label: '内容', type: 'textarea', rows: 7 },
        { id: 'importance', label: '重要性', type: 'select', options: ['normal', 'high', 'critical'] }
      ],
      toCommand: (values) => `导入公司知识库。\n类别：${values.category}\n重要性：${values.importance}\n内容：\n${values.content}`
    }
  };

  return configs[kind];
}

function FinancePage() {
  const panel = usePanelParam();
  const query = useQuery({
    queryKey: ['finance-dashboard'],
    queryFn: () => apiGet<{ ok: boolean; dashboard: AnyRecord; policy: AnyRecord }>('/api/web/finance')
  });
  const dashboard = query.data?.dashboard ?? {};
  const currency = dashboard.currency ?? 'CNY';

  return (
    <div className="dashboard-grid finance-grid">
      {panel === 'approvals' ? <ApprovalCenterPanel /> : null}
      {panel === 'import' ? <MiniAppActionPanel kind="financeImport" /> : null}
      <QuickEntry config={financeQuickEntry} />
      <section className="metric-grid wide">
        <MetricCard label="本月收入" value={formatMoney(dashboard.monthlyIncome, currency)} icon={CircleDollarSign} />
        <MetricCard label="本月支出" value={formatMoney(dashboard.monthlyExpenses, currency)} icon={CircleDollarSign} />
        <MetricCard label="净现金流" value={formatMoney(dashboard.netCashflow, currency)} icon={Activity} />
      </section>
      <section className="panel danger-panel">
        <PanelHeader title="财务审批边界" hint="付款、退款、转账、税务、账单变更必须审批" />
        <div className="danger-callout">
          <AlertTriangle size={18} />
          <span>这里可以看账、查风险、准备动作；真实付款或账单变更必须经过 Owner 审批。</span>
        </div>
        <div className="tag-row">
          {(query.data?.policy.approvalRequired ?? []).map((item: string) => <span key={item}>{labelFromSnake(item)}</span>)}
        </div>
      </section>
      <section className="panel">
        <PanelHeader title="风险提醒" hint="Finance Agent 建议" />
        <SimpleList items={dashboard.riskAlerts ?? []} primary={(item) => String(item)} />
      </section>
      <section className="panel">
        <PanelHeader title="建议动作" hint="不直接付款" />
        <SimpleList items={dashboard.suggestedActions ?? []} primary={(item) => String(item)} />
      </section>
      <section className="panel">
        <PanelHeader title="未收发票" hint="openInvoices" />
        <SimpleList items={dashboard.openInvoices ?? []} primary={(item) => item.customer_name ?? item.id} meta={(item) => `${item.status ?? ''} · ${formatMoney(item.amount, item.currency ?? currency)}`} />
      </section>
      <section className="panel">
        <PanelHeader title="订阅扣费" hint="upcomingSubscriptions" />
        <SimpleList items={dashboard.upcomingSubscriptions ?? []} primary={(item) => item.name ?? item.vendor_name ?? item.id} meta={(item) => `${formatMoney(item.amount, item.currency ?? currency)} · ${item.next_billing_at ?? '未设置'}`} />
      </section>
    </div>
  );
}

type DependencyDraft = AppDependency & {
  envJson: string;
};

const dependencyGuides: Record<string, { title: string; purpose: string; steps: string[]; example: string[] }> = {
  dify: {
    title: 'Dify',
    purpose: '顶层 AI 工作流入口，用来生成剪辑策略、字幕、文案、风险点和后续工具调用参数。',
    steps: [
      '先确认 Dify 已经能在本机或服务器访问。',
      '填写 Base URL 和 Workflow API Key。',
      '健康检查地址可填 Dify 控制台或 API 可访问地址。',
      '如果希望系统代启动，模式选系统托管，并填写启动命令和工作目录。'
    ],
    example: ['Base URL: http://127.0.0.1:5001', 'Health: http://127.0.0.1:5001/console/api/setup']
  },
  n8n: {
    title: 'n8n',
    purpose: '流程编排层，负责接收飞书/Telegram 回调、调工具、写状态和发审批卡。',
    steps: [
      '确认 n8n 已启动并能打开编辑器。',
      '填写 n8n Base URL。',
      '如果使用 API，填写 API Key。',
      '把飞书卡片回调、Telegram 回调和北斗选剧流程接到 n8n webhook。'
    ],
    example: ['Base URL: http://127.0.0.1:5678', 'Health: http://127.0.0.1:5678/healthz']
  },
  cloakbrowser: {
    title: 'CloakBrowser Manager',
    purpose: '浏览器 Profile 管理服务，用来保持北斗智影登录态、采集任务和后续多账号分发。',
    steps: [
      '填写 Manager 地址，默认常见端口是 8080。',
      '如果需要系统自动拉起，模式选系统托管。',
      '填写启动命令，例如 python run.py，工作目录填 CloakBrowser Manager 项目目录。',
      '点击测试连接，能返回 profiles 才算可用。'
    ],
    example: ['Base URL: http://127.0.0.1:8080', 'Health: http://127.0.0.1:8080/api/profiles']
  },
  inbeidou_profile: {
    title: '北斗智影 Profile',
    purpose: '已经登录北斗智影的 CloakBrowser Profile。选剧前系统会保证这个 Profile 已运行。',
    steps: [
      '在 CloakBrowser Manager 中找到已登录北斗智影的 Profile ID。',
      '把 Profile ID 写入扩展环境变量 JSON。',
      '字段格式固定为 {"profileId":"你的 Profile ID"}。',
      '选剧流程会使用这个 Profile 的 Cookie 登录北斗智影。'
    ],
    example: ['Env JSON: {"profileId":"152a3eef-6b63-4ef1-a0cb-0c7127110ed5"}']
  },
  capcut_mate: {
    title: 'capcut-mate',
    purpose: '剪映草稿执行层，用来创建 9:16 草稿、添加视频/字幕/特效并导出视频。',
    steps: [
      '确认 capcut-mate API 已启动。',
      '填写 Base URL 和 docs/health 地址。',
      '如果需要系统代启动，填写启动命令。',
      'Dify 生成的剪辑计划会通过这里落到剪映草稿。'
    ],
    example: ['Base URL: http://127.0.0.1:30000', 'Health: http://127.0.0.1:30000/health']
  },
  ffmpeg: {
    title: 'ffmpeg / ffprobe',
    purpose: '媒体预处理工具，用来检测视频信息、抽帧、黑屏比例、时长和比例。',
    steps: [
      '如果 ffmpeg 已加入 PATH，可以只写 notes。',
      '如果没有加入 PATH，把 ffmpeg/ffprobe 绝对路径写入扩展环境变量。',
      '建议字段为 {"ffmpegPath":"...","ffprobePath":"..."}。',
      '媒体预处理流程会优先读取这里的配置。'
    ],
    example: ['Env JSON: {"ffmpegPath":"D:/tools/ffmpeg/bin/ffmpeg.exe","ffprobePath":"D:/tools/ffmpeg/bin/ffprobe.exe"}']
  },
  asr: {
    title: 'ASR',
    purpose: '英文字幕和转写服务。后续 Dify 剪辑策划需要字幕判断钩子、冲突点和切片边界。',
    steps: [
      '可以填本地 ASR 服务地址，也可以填本地模型路径。',
      '如果是服务，填写 Base URL 和健康检查地址。',
      '如果是本地模型，把模型路径写进扩展环境变量。',
      '当前 CPS 短剧流程默认英文字幕。'
    ],
    example: ['Env JSON: {"modelPath":"D:/models/whisper/ggml-large-v3.bin","language":"en"}']
  },
  feishu_base: {
    title: '飞书 Base',
    purpose: '业务数据沉淀层，保存任务、素材、分析结果、剪辑计划、发布记录和收益复盘。',
    steps: [
      '确认 lark-cli 已登录并有 Base 权限。',
      '填写 Base App Token 或在环境变量中配置。',
      '表名和字段由系统维护，用户主要配置目标 Base。',
      '素材、字幕、封面和分析结果会在第五步后写入。'
    ],
    example: ['Env JSON: {"baseAppToken":"bascn..."}']
  },
  telegram_bot: {
    title: 'Telegram Bot',
    purpose: '老板指令、审批和通知入口。日常操作不应该依赖 Codex。',
    steps: [
      '填写 Bot Token 和 Webhook Secret。',
      '确认公网 HTTPS 地址能访问 Tele-OPC。',
      '把 webhook 指到 /telegram/webhook。',
      '选剧按钮和审批卡可以通过 Telegram 触发 n8n。'
    ],
    example: ['Env JSON: {"botToken":"123:xxx","ownerIds":"123456"}']
  }
};

type DetailedDependencyGuide = {
  title: string;
  purpose: string;
  fieldRows: Array<{
    field: string;
    fill: string;
    source: string;
    example: string;
  }>;
  install: string[];
  configure: string[];
  whereToGet: string[];
  verify: string[];
  examples: string[];
  commonIssues: string[];
};

export const dependencySetupGuides: Record<string, DetailedDependencyGuide> = {
  dify: {
    title: 'Dify',
    purpose: '顶层 AI 工作流入口，负责把老板目标变成结构化剪辑策略、字幕、发布文案、风险点和工具调用参数。',
    fieldRows: [
      { field: '安装方式', fill: '已有 Dify 选“外部已安装”；希望系统启动选“系统托管启动”。', source: '看 Dify 是你手动启动，还是准备用 Tele-OPC 启动脚本启动。', example: '外部已安装' },
      { field: '服务地址', fill: 'Dify 控制台或 API 地址。', source: '打开 Dify 后复制浏览器地址栏的协议、主机和端口。', example: 'http://127.0.0.1:5001' },
      { field: '健康检查地址', fill: '一个能稳定返回 200 的 Dify 地址。', source: 'Dify 控制台接口或首页地址；没有 health 接口时用 setup/console 接口。', example: 'http://127.0.0.1:5001/console/api/setup' },
      { field: 'API Key / Token', fill: 'Workflow 应用 API Key。', source: 'Dify Workflow 应用 -> API Access / API 访问。', example: 'app-xxxxxxxx' },
      { field: '启动命令', fill: '可选，只有系统托管启动才需要。', source: '你的 start-dify.ps1 或 Dify README。', example: 'powershell -ExecutionPolicy Bypass -File start-dify.ps1' },
      { field: '工作目录', fill: 'Dify 源码或启动脚本所在目录。', source: '本机 Dify 安装目录。', example: 'D:/apps/dify' }
    ],
    install: [
      'Windows 本机部署时，先准备 PostgreSQL、Redis、Python、Node.js 和 Dify 源码。',
      '如果用户已经有自己的 Dify，只需要填外部服务地址，不需要系统托管启动。',
      '如果希望 Tele-OPC 代启动，把模式改成“系统托管启动”，填写启动命令和 Dify 工作目录。'
    ],
    configure: [
      '服务地址填写 Dify Web/API 可访问地址，例如 http://127.0.0.1:5001。',
      'API Key 填 Dify Workflow 应用的 API Key，不是登录密码。',
      '健康检查地址填写一个能稳定返回 200 的 Dify 地址；没有专门 health 接口时可填控制台接口或首页地址。',
      '剪辑策划 Workflow 建好后，把 Workflow API Key 填到这里，n8n/后端调用时读取这份配置。'
    ],
    whereToGet: [
      'Base URL：打开 Dify 控制台，看浏览器地址栏的协议、域名和端口。',
      'Workflow API Key：Dify 控制台进入对应 Workflow 应用，在 API Access / API 访问中创建或复制。',
      '启动命令：看你的 Dify 启动脚本，例如 start-dify.ps1、python app.py 或 npm run dev。',
      '工作目录：Dify 源码或启动脚本所在目录。'
    ],
    verify: [
      '点击“测试连接”，返回连接正常。',
      '浏览器能打开 Dify 控制台。',
      'n8n 或后端用同一个 API Key 调 workflow 能得到 outputs。'
    ],
    examples: [
      '服务地址: http://127.0.0.1:5001',
      '健康检查地址: http://127.0.0.1:5001/console/api/setup',
      'API Key: app-xxxxxxxx',
      '启动命令: powershell -ExecutionPolicy Bypass -File start-dify.ps1'
    ],
    commonIssues: [
      '连接失败：端口不对，或 Dify 只监听 localhost/容器网络。',
      '401/403：填的是登录密码，不是 Workflow API Key。',
      'Workflow 无输出：Dify 应用没有发布，或 outputs 字段名和流程期望不一致。'
    ]
  },
  n8n: {
    title: 'n8n',
    purpose: '流程编排层，负责飞书/Telegram 回调、工具调用、状态写入、审批卡和跨系统流程推进。',
    fieldRows: [
      { field: '安装方式', fill: '已有 n8n 选“外部已安装”；本机脚本启动选“系统托管启动”。', source: '看 n8n 是手动/npm 启动，还是希望 Tele-OPC 启动。', example: '外部已安装' },
      { field: '服务地址', fill: 'n8n 编辑器地址。', source: '打开 n8n 后复制浏览器地址栏。', example: 'http://127.0.0.1:5678' },
      { field: '健康检查地址', fill: 'n8n health 或可访问 API 地址。', source: '优先用 /healthz；不支持时用编辑器首页或 /rest/settings。', example: 'http://127.0.0.1:5678/healthz' },
      { field: 'API Key / Token', fill: 'Personal Access Token。', source: 'n8n 用户设置 -> API / Personal Access Token。', example: 'n8n_api_xxxxxxxx' },
      { field: '启动命令', fill: '可选，本机托管启动用。', source: '安装方式决定；npm 安装通常是 n8n start 或 start-n8n.ps1。', example: 'powershell -ExecutionPolicy Bypass -File start-n8n.ps1' },
      { field: '工作目录', fill: 'n8n 本地目录或启动脚本目录。', source: '你安装 n8n 的目录。', example: 'D:/apps/n8n-local' }
    ],
    install: [
      '推荐先用 npm 全局或独立目录安装 n8n，也可以使用用户已有的 n8n 服务。',
      '本机运行时确认 Node.js 版本满足 n8n 要求。',
      '如需系统托管启动，填写 n8n 的启动命令和工作目录。'
    ],
    configure: [
      '服务地址填写 n8n 编辑器地址，例如 http://127.0.0.1:5678。',
      'API Key 填 n8n Personal Access Token，用于后端创建/更新/执行 workflow。',
      '健康检查地址优先填 /healthz；如果版本不支持，填 /rest/settings 或编辑器首页。',
      '飞书/Telegram 选剧按钮最终应指向 n8n webhook，由 n8n 再调用 Tele-OPC 后端。'
    ],
    whereToGet: [
      'Base URL：打开 n8n 编辑器，看浏览器地址栏。',
      'API Key：n8n 个人设置或 API 设置里创建 Personal Access Token。',
      'Webhook URL：进入具体 workflow 的 Webhook 节点复制 Test/Production URL。',
      '启动命令：你安装 n8n 的方式决定，例如 n8n start、npm run start 或 start-n8n.ps1。'
    ],
    verify: [
      '点击“测试连接”返回正常。',
      '浏览器能打开 n8n 编辑器。',
      '创建一个测试 webhook，飞书/Telegram 点击后 n8n 能收到请求。'
    ],
    examples: [
      '服务地址: http://127.0.0.1:5678',
      '健康检查地址: http://127.0.0.1:5678/healthz',
      '启动命令: powershell -ExecutionPolicy Bypass -File start-n8n.ps1'
    ],
    commonIssues: [
      'Webhook 不触发：用了 Test URL 但 workflow 没在监听，或 Production URL 未激活。',
      'API 401：Personal Access Token 没填或权限不足。',
      '页面能开但后端连不上：n8n 地址填成了局域网/容器地址。'
    ]
  },
  cloakbrowser: {
    title: 'CloakBrowser Manager',
    purpose: '浏览器 Profile 管理服务，负责北斗智影登录态、任务采集、素材下载和后续多账号分发。',
    fieldRows: [
      { field: '安装方式', fill: '建议选“系统托管启动”，选剧前可自动拉起。', source: '如果 Manager 常驻运行，也可以选外部已安装。', example: '系统托管启动' },
      { field: '服务地址', fill: 'CloakBrowser Manager API 地址。', source: '启动 Manager 后看控制台输出或浏览器页面地址。', example: 'http://127.0.0.1:8080' },
      { field: '健康检查地址', fill: 'Profile 列表接口。', source: 'Manager API 固定接口。', example: 'http://127.0.0.1:8080/api/profiles' },
      { field: '启动命令', fill: '启动 Manager 的命令。', source: '项目 README、run.py 或 run.bat。', example: 'python run.py' },
      { field: '工作目录', fill: 'run.py/run.bat 所在目录。', source: 'CloakBrowser Manager 项目目录。', example: 'D:/apps/CloakBrowser-Manager-main' },
      { field: '扩展环境变量 JSON', fill: '一般不用填；Profile ID 填到北斗智影 Profile。', source: '仅高级配置需要。', example: '{}' }
    ],
    install: [
      '先安装或解压 CloakBrowser Manager 项目。',
      '运行 Manager，确认本机能访问它的管理地址。',
      '如果希望选剧时自动拉起 Manager，模式选“系统托管启动”，填写启动命令和工作目录。'
    ],
    configure: [
      '服务地址填写 Manager API 地址，例如 http://127.0.0.1:8080。',
      '健康检查地址填写 /api/profiles，用于确认 Manager 已运行。',
      '启动命令填写实际命令，例如 python run.py。',
      '工作目录填写 CloakBrowser Manager 项目目录，不要填到 data/profiles 里面。'
    ],
    whereToGet: [
      'Base URL：启动 Manager 后看控制台输出或浏览器打开地址。',
      '启动命令：看项目 README 或 run.bat/run.py。',
      '工作目录：run.py 或 run.bat 所在目录。',
      'Profile ID：在 profiles 列表接口或管理页面中找到，对应填到“北斗智影 Profile”。'
    ],
    verify: [
      '点击“测试连接”，能访问 /api/profiles。',
      '浏览器打开 Manager 页面能看到 Profile 列表。',
      '北斗智影 Profile 能被 launch，并且 CDP list 有页面。'
    ],
    examples: [
      '服务地址: http://127.0.0.1:8080',
      '健康检查地址: http://127.0.0.1:8080/api/profiles',
      '启动命令: python run.py',
      '工作目录: D:/apps/CloakBrowser-Manager-main'
    ],
    commonIssues: [
      '连接失败：Manager 没启动或端口不是 8080。',
      'Profile 找不到：填错 Profile ID，或配置填在了 cloakbrowser 而不是 inbeidou_profile。',
      '采集失败：Profile 没登录北斗智影或 Cookie 过期。'
    ]
  },
  inbeidou_profile: {
    title: '北斗智影 Profile',
    purpose: '指定哪个 CloakBrowser Profile 用于北斗智影采集。这个 Profile 必须已经登录北斗智影。',
    fieldRows: [
      { field: '安装方式', fill: '建议选“系统托管启动”。', source: '选剧前系统需要自动 launch 这个 Profile。', example: '系统托管启动' },
      { field: '服务地址', fill: '通常留空；Manager 地址填到 CloakBrowser Manager。', source: '此项代表 Profile，不是服务。', example: '' },
      { field: '健康检查地址', fill: '通常留空。', source: 'Profile 健康由 CloakBrowser Manager 的 CDP 接口检查。', example: '' },
      { field: '扩展环境变量 JSON', fill: '填写 profileId。', source: 'CloakBrowser Manager 页面或 /api/profiles 返回的 id。', example: '{"profileId":"152a3eef-6b63-4ef1-a0cb-0c7127110ed5"}' },
      { field: '说明', fill: '记录这个 Profile 登录了哪个北斗账号。', source: '人工命名，便于区分账号。', example: '北斗智影已登录采集账号 A' }
    ],
    install: [
      '不需要单独安装，它依赖 CloakBrowser Manager。',
      '先在 CloakBrowser 中创建或选择一个浏览器 Profile。',
      '用这个 Profile 打开 https://creator.inbeidou.cn/task 并完成登录。'
    ],
    configure: [
      '把 Profile ID 写入“扩展环境变量 JSON”。',
      '字段名固定为 profileId。',
      '模式建议选“系统托管启动”，因为选剧前需要自动拉起这个 Profile。',
      '不要把账号密码写到这里，流程使用浏览器 Cookie 登录。'
    ],
    whereToGet: [
      'Profile ID：CloakBrowser Manager 页面中的 Profile 详情。',
      '也可以请求 http://127.0.0.1:8080/api/profiles，从返回 JSON 中复制 id。',
      '确认该 Profile 已登录北斗智影任务页。'
    ],
    verify: [
      '保存后，点击 CloakBrowser 的测试连接。',
      '执行选剧时系统会 launch 该 Profile。',
      '如果能进入北斗任务页并拉到任务候选，说明配置正确。'
    ],
    examples: [
      '扩展环境变量 JSON: {"profileId":"152a3eef-6b63-4ef1-a0cb-0c7127110ed5"}'
    ],
    commonIssues: [
      'Profile ID 填错：选剧前会提示 profile not found。',
      'Cookie 过期：浏览器能启动但北斗跳登录页。',
      '多个 Profile 混用：采集和分发账号不要随便共用。'
    ]
  },
  capcut_mate: {
    title: 'capcut-mate',
    purpose: '剪映执行层，负责创建草稿、添加视频/音频/字幕/特效/遮罩，并导出或保存视频。',
    fieldRows: [
      { field: '安装方式', fill: '已有 API 服务选外部；要系统启动选托管。', source: '看 capcut-mate 是否常驻运行。', example: '外部已安装' },
      { field: '服务地址', fill: 'capcut-mate FastAPI 地址。', source: '启动 capcut-mate 后看控制台输出。', example: 'http://127.0.0.1:30000' },
      { field: '健康检查地址', fill: 'API 文档或 health 地址。', source: '优先使用项目提供的 /health。', example: 'http://127.0.0.1:30000/health' },
      { field: '启动命令', fill: '启动 FastAPI 的命令。', source: 'capcut-mate README 或 run_windows.ps1。', example: 'powershell -NoProfile -ExecutionPolicy Bypass -File run_windows.ps1' },
      { field: '工作目录', fill: 'capcut-mate 项目目录。', source: 'main/app 文件所在目录。', example: 'D:/apps/capcut-mate-main' },
      { field: '扩展环境变量 JSON', fill: '可填草稿目录、剪映路径等项目需要的配置。', source: 'capcut-mate README 或本机剪映设置。', example: '{"draftDir":"D:/CapCut Drafts"}' }
    ],
    install: [
      '下载 capcut-mate 项目并安装 Python 依赖。',
      '启动 FastAPI 服务，确认能打开 /docs。',
      '确保剪映/CapCut 所需本地环境已准备好。'
    ],
    configure: [
      '服务地址填写 capcut-mate API 地址，例如 http://127.0.0.1:30000。',
      '健康检查地址推荐填项目提供的 /health 接口。',
      '如果系统托管启动，填写 uvicorn 或项目启动脚本，例如 run_windows.ps1。',
      'Dify 生成的剪辑计划会被转换成 capcut-mate API 请求。'
    ],
    whereToGet: [
      'Base URL：启动 capcut-mate 后看控制台输出。',
      'API 文档：打开 /docs 查看实际接口和参数。',
      '启动命令：项目 README 中的 uvicorn 或 run 脚本。',
      '草稿目录：如项目需要，写入扩展环境变量 JSON。'
    ],
    verify: [
      '点击“测试连接”，/docs 返回 200。',
      '用 /docs 创建一个空草稿。',
      '确认草稿能在剪映或导出流程中被识别。'
    ],
    examples: [
      '服务地址: http://127.0.0.1:30000',
      '健康检查地址: http://127.0.0.1:30000/health',
      '启动命令: powershell -NoProfile -ExecutionPolicy Bypass -File run_windows.ps1'
    ],
    commonIssues: [
      'Method Not Allowed：用 GET 打了只支持 POST 的接口，应通过 /docs 看方法。',
      '草稿没生成：素材路径不可访问或 capcut-mate 工作目录不对。',
      '字幕不显示：字幕资源没有上传或时间轴单位不匹配。'
    ]
  },
  ffmpeg: {
    title: 'ffmpeg / ffprobe',
    purpose: '媒体预处理工具，用于检测时长/分辨率/比例、抽帧、黑屏检测、格式转换。',
    fieldRows: [
      { field: '安装方式', fill: '通常选外部已安装。', source: 'ffmpeg 是本机命令行工具。', example: '外部已安装' },
      { field: '服务地址', fill: '留空。', source: '不是 HTTP 服务。', example: '' },
      { field: '健康检查地址', fill: '留空。', source: '用命令行 ffmpeg -version 验证。', example: '' },
      { field: '扩展环境变量 JSON', fill: '填写 ffmpegPath 和 ffprobePath。', source: 'ffmpeg 解压目录的 bin 文件夹。', example: '{"ffmpegPath":"D:/tools/ffmpeg/bin/ffmpeg.exe","ffprobePath":"D:/tools/ffmpeg/bin/ffprobe.exe"}' },
      { field: '说明', fill: '记录是否已加入 PATH。', source: 'PowerShell 执行 where ffmpeg。', example: '已加入 PATH / 使用绝对路径' }
    ],
    install: [
      '下载 Windows 版 ffmpeg。',
      '解压后找到 bin 目录里的 ffmpeg.exe 和 ffprobe.exe。',
      '可以加入系统 PATH，也可以在这里填写绝对路径。'
    ],
    configure: [
      '如果已加入 PATH，可以不填服务地址，只在说明里记录。',
      '如果未加入 PATH，把 ffmpegPath 和 ffprobePath 写入扩展环境变量 JSON。',
      '媒体预处理流程应优先读取这份配置。'
    ],
    whereToGet: [
      'ffmpegPath：ffmpeg.exe 的完整路径。',
      'ffprobePath：ffprobe.exe 的完整路径。',
      '验证命令：在 PowerShell 执行 ffmpeg -version 和 ffprobe -version。'
    ],
    verify: [
      'PowerShell 能执行 ffmpeg -version。',
      '媒体预处理能输出视频时长、分辨率和抽帧图片。',
      '飞书 Base 中能看到分析后的媒体字段。'
    ],
    examples: [
      '扩展环境变量 JSON: {"ffmpegPath":"D:/tools/ffmpeg/bin/ffmpeg.exe","ffprobePath":"D:/tools/ffmpeg/bin/ffprobe.exe"}'
    ],
    commonIssues: [
      '命令不存在：没有加入 PATH，也没有填绝对路径。',
      '路径有空格：启动命令里需要用引号包起来。',
      '中文路径问题：优先使用纯英文工具目录。'
    ]
  },
  asr: {
    title: 'ASR',
    purpose: '英文字幕/转写服务，用于让 Dify 根据字幕判断黄金三秒、冲突点、钩子和切片边界。',
    fieldRows: [
      { field: '安装方式', fill: 'HTTP ASR 选外部；本地模型也选外部并写模型路径。', source: '看你使用 whisper 服务还是本地模型。', example: '外部已安装' },
      { field: '服务地址', fill: 'ASR HTTP 服务地址；本地模型可留空。', source: 'ASR 服务启动输出。', example: 'http://127.0.0.1:9010' },
      { field: '健康检查地址', fill: 'ASR 服务 health/docs 地址；本地模型可留空。', source: 'ASR 服务文档。', example: 'http://127.0.0.1:9010/docs' },
      { field: 'API Key / Token', fill: '云 ASR 才需要。', source: '云服务控制台。', example: 'sk-xxxx' },
      { field: '扩展环境变量 JSON', fill: '填写模型路径和语言。', source: '本地 whisper 模型文件路径。', example: '{"modelPath":"D:/models/whisper/ggml-large-v3.bin","language":"en"}' }
    ],
    install: [
      '可以使用本地 whisper.cpp、faster-whisper，也可以使用外部 ASR API。',
      '本地模型需要先下载英文转写模型。',
      '服务化部署时确认有可访问的 HTTP 地址。'
    ],
    configure: [
      '如果是 HTTP 服务，填写 Base URL 和健康检查地址。',
      '如果是本地模型，把 modelPath 和 language 写到扩展环境变量 JSON。',
      'CPS 短剧流程默认 language 为 en。',
      '字幕文件要作为资源上传，不只是写字幕路径。'
    ],
    whereToGet: [
      '模型路径：本地 whisper 模型文件所在位置。',
      '服务地址：ASR 服务启动后控制台输出的 URL。',
      'API Key：如果使用云 ASR，在对应平台控制台创建。'
    ],
    verify: [
      '拿一集视频跑转写，生成英文字幕。',
      '字幕文件能上传到飞书 Base 附件字段。',
      'Dify payload 中能读到字幕文本或字幕资源引用。'
    ],
    examples: [
      '扩展环境变量 JSON: {"modelPath":"D:/models/whisper/ggml-large-v3.bin","language":"en"}'
    ],
    commonIssues: [
      '字幕太短：只跑了样本片段，没有跑完整剧集。',
      '语言错误：ASR 自动识别成中文或混合语言。',
      '工作流拿不到字幕：只保存了本地路径，没有上传资源。'
    ]
  },
  feishu_base: {
    title: '飞书 Base',
    purpose: '业务数据沉淀层，保存任务、剧集、素材、字幕、分析结果、剪辑计划、发布记录、收益和复盘。',
    fieldRows: [
      { field: '安装方式', fill: '外部已安装。', source: '飞书是外部云服务，lark-cli 在本机登录。', example: '外部已安装' },
      { field: '服务地址', fill: '可填飞书域名或留空。', source: '飞书 Base 链接。', example: 'https://inbeidou.feishu.cn' },
      { field: 'API Key / Token', fill: '通常不在这里填，优先用 lark-cli 登录态；也可填 App Token 备注。', source: '飞书开放平台或 Base URL。', example: '' },
      { field: '扩展环境变量 JSON', fill: '填写 baseAppToken，必要时填写 tableId 映射。', source: 'Base URL、lark-cli base table list。', example: '{"baseAppToken":"bascn..."}' },
      { field: '说明', fill: '记录这个 Base 用于哪个业务系统。', source: '人工填写。', example: 'CPS 矩阵内容分发数据沉淀 Base' }
    ],
    install: [
      '先安装并登录 lark-cli。',
      '确认飞书应用或用户有目标 Base 的访问权限。',
      '创建或选择一个用于 Tele-OPC 的多维表格。'
    ],
    configure: [
      '把 Base App Token 写入扩展环境变量 JSON 或环境变量。',
      '表 ID 可以由系统映射维护，用户通常只需要配置目标 Base。',
      '封面、视频、字幕、分析报告应使用附件/文件字段，不要只塞 JSON 文本。',
      '字段名建议使用中文展示，内部仍保留稳定 id 映射。'
    ],
    whereToGet: [
      'Base App Token：打开多维表格 URL，通常在 /base/ 后面或通过飞书开发工具获取。',
      'Table ID：进入具体数据表后，从 API 或 lark-cli field/table list 获取。',
      'lark-cli 身份：用 lark-cli auth / user-default 确认。'
    ],
    verify: [
      'lark-cli 能 list 表和字段。',
      '写入一条测试 CPS 任务记录。',
      '附件字段能看到封面、视频、字幕，而不是只有本地路径。'
    ],
    examples: [
      '扩展环境变量 JSON: {"baseAppToken":"bascn..."}'
    ],
    commonIssues: [
      '权限不足：当前 lark-cli 用户没有 Base 编辑权限。',
      '字段写不进去：字段类型不匹配，例如附件字段被当文本写。',
      '数据看不懂：只写 JSON，没有拆出中文字段。'
    ]
  },
  telegram_bot: {
    title: 'Telegram Bot',
    purpose: '老板指令、审批和结果通知入口。日常操作应通过 Telegram/飞书/n8n 独立完成，不依赖 Codex。',
    fieldRows: [
      { field: '安装方式', fill: '外部已安装。', source: 'Telegram Bot 是外部服务。', example: '外部已安装' },
      { field: '服务地址', fill: '可填 Telegram API 地址或留空。', source: '默认使用官方 Telegram Bot API。', example: 'https://api.telegram.org' },
      { field: 'API Key / Token', fill: 'Bot Token。', source: 'BotFather 创建 Bot 后给出。', example: '123456:ABC-xxxx' },
      { field: '扩展环境变量 JSON', fill: '填写 ownerIds、webhookSecret 等。', source: 'Telegram update 日志、你设置的 webhook secret。', example: '{"ownerIds":"123456789","webhookSecret":"secret"}' },
      { field: '说明', fill: '记录 Bot 用途和 owner。', source: '人工填写。', example: 'OPC 老板审批和选剧入口' }
    ],
    install: [
      '在 BotFather 创建 Telegram Bot。',
      '拿到 Bot Token。',
      '准备公网 HTTPS 地址，Telegram webhook 不能只用本机 localhost。'
    ],
    configure: [
      '把 Bot Token 写入扩展环境变量 JSON 或环境变量。',
      '配置 ownerIds，限制只有老板能操作。',
      'Webhook 指向 Tele-OPC 的 /telegram/webhook 或带 secret 的 webhook。',
      '选剧、审批、结果通知建议用短卡片，不发送长 Markdown。'
    ],
    whereToGet: [
      'Bot Token：BotFather 创建 Bot 后给出。',
      'ownerIds：给 Bot 发消息后从 Telegram update 或日志中查看 user id。',
      'Webhook URL：你的公网 HTTPS 域名 + /telegram/webhook。'
    ],
    verify: [
      'setWebhook 后 Telegram 返回 ok。',
      '给 Bot 发消息，Tele-OPC 能收到 inbound message。',
      '点击选剧按钮能进入 n8n/飞书选择流程。'
    ],
    examples: [
      '扩展环境变量 JSON: {"botToken":"123456:xxx","ownerIds":"123456789"}'
    ],
    commonIssues: [
      '收不到消息：Webhook 不是 HTTPS，或公网地址不可访问。',
      '权限问题：ownerIds 没配置当前用户。',
      '按钮无响应：callback/webhook 没接到 n8n。'
    ]
  }
};

function DependencySetupPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<DependencyDraft | null>(null);
  const [actionMessage, setActionMessage] = useState('');

  const query = useQuery({
    queryKey: ['appos-dependencies'],
    queryFn: () => apiGet<DependencyListResponse>('/api/appos/dependencies')
  });

  const dependencies = query.data?.dependencies ?? [];
  const selected = dependencies.find((item) => item.id === selectedId) ?? dependencies[0];
  const guide: DetailedDependencyGuide = dependencySetupGuides[selected?.id ?? ''] ?? {
    title: selected?.name ?? 'Dependency',
    purpose: '自定义依赖。填写访问地址、启动命令和健康检查后，工作流就可以按配置调用。',
    fieldRows: [
      { field: '安装方式', fill: '按实际情况选择外部已安装或系统托管启动。', source: '看服务是否由 Tele-OPC 启动。', example: '外部已安装' },
      { field: '服务地址', fill: 'HTTP 服务入口地址。', source: '服务启动日志或浏览器地址栏。', example: 'http://127.0.0.1:port' },
      { field: '健康检查地址', fill: '可返回 200 的检查地址。', source: '服务文档中的 health/docs/status 接口。', example: 'http://127.0.0.1:port/health' },
      { field: 'API Key / Token', fill: '需要鉴权时填写。', source: '服务后台、个人设置或开发者设置。', example: 'token-xxxx' }
    ],
    install: ['按该工具官方文档安装，或使用已有外部服务。'],
    configure: ['填写服务地址、健康检查地址；需要系统代启动时填写启动命令和工作目录。'],
    whereToGet: ['服务地址来自工具启动后的控制台输出或浏览器地址栏。', 'API Key/Token 通常在该工具的个人设置或开发者设置里创建。'],
    verify: ['保存配置后点击“测试连接”。', '从实际工作流调用一次，确认能返回预期结果。'],
    examples: ['服务地址: http://127.0.0.1:port'],
    commonIssues: ['端口填错、服务未启动、API Key 权限不足，是最常见的三类问题。']
  };

  useEffect(() => {
    if (!selectedId && dependencies[0]) setSelectedId(dependencies[0].id);
  }, [dependencies, selectedId]);

  useEffect(() => {
    if (!selected) return;
    setDraft({
      ...selected,
      envJson: JSON.stringify(selected.env ?? {}, null, 2)
    });
    setActionMessage('');
  }, [selected?.id]);

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error('missing dependency draft');
      let env: Record<string, string> = {};
      if (draft.envJson.trim()) {
        env = JSON.parse(draft.envJson) as Record<string, string>;
      }
      return apiPut<{ ok: boolean; dependency: AppDependency }>(`/api/appos/dependencies/${draft.id}`, {
        name: draft.name,
        category: draft.category,
        mode: draft.mode,
        baseUrl: draft.baseUrl ?? '',
        healthCheckUrl: draft.healthCheckUrl ?? '',
        apiKey: draft.apiKey ?? '',
        startCommand: draft.startCommand ?? '',
        stopCommand: draft.stopCommand ?? '',
        restartCommand: draft.restartCommand ?? '',
        workingDirectory: draft.workingDirectory ?? '',
        env,
        notes: draft.notes ?? ''
      });
    },
    onSuccess: () => {
      setActionMessage('配置已保存');
      void queryClient.invalidateQueries({ queryKey: ['appos-dependencies'] });
    },
    onError: (error) => {
      setActionMessage(error instanceof Error ? error.message : '保存失败');
    }
  });

  async function runDependencyAction(action: 'test' | 'start' | 'stop' | 'restart') {
    if (!selected) return;
    setActionMessage(`${action} running...`);
    try {
      if (action === 'test') {
        const response = await apiPost<DependencyStatusResponse>(`/api/appos/dependencies/${selected.id}/test`, {});
        setActionMessage(`${response.status.ok ? '连接正常' : '连接失败'}：${response.status.message}`);
      } else {
        await apiPost<{ ok: boolean; result: AnyRecord }>(`/api/appos/dependencies/${selected.id}/${action}`, {});
        setActionMessage(`${action} 命令已提交`);
      }
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : `${action} failed`);
    }
  }

  function updateDraft<K extends keyof DependencyDraft>(key: K, value: DependencyDraft[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  }

  if (query.isLoading) return <LoadingPanel />;
  if (query.isError) return <ErrorPanel error={query.error} />;
  if (!draft || !selected) return <EmptyState text="暂无依赖配置" />;

  return (
    <div className="dependency-layout">
      <section className="panel dependency-list-panel">
        <PanelHeader title="依赖注册中心" hint={query.data?.configPath} />
        <div className="dependency-list">
          {dependencies.map((dependency) => (
            <button
              key={dependency.id}
              type="button"
              className={dependency.id === selected.id ? 'selected' : ''}
              onClick={() => setSelectedId(dependency.id)}
            >
              <strong>{dependency.name}</strong>
              <span>{dependency.category} / {dependency.mode}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel dependency-form-panel">
        <PanelHeader title={draft.name} hint={draft.id} />
        <div className="dependency-actions">
          <button type="button" className="ghost-button" onClick={() => runDependencyAction('test')}>测试连接</button>
          <button type="button" className="ghost-button" onClick={() => runDependencyAction('start')}>启动</button>
          <button type="button" className="ghost-button" onClick={() => runDependencyAction('stop')}>停止</button>
          <button type="button" className="ghost-button" onClick={() => runDependencyAction('restart')}>重启</button>
        </div>
        <form
          className="dependency-form"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <label>
            名称
            <input value={draft.name} onChange={(event) => updateDraft('name', event.target.value)} />
          </label>
          <label>
            类型
            <input value={draft.category} onChange={(event) => updateDraft('category', event.target.value)} />
          </label>
          <label>
            安装方式
            <select value={draft.mode} onChange={(event) => updateDraft('mode', event.target.value as AppDependency['mode'])}>
              <option value="external">外部已安装</option>
              <option value="managed">系统托管启动</option>
              <option value="disabled">暂不启用</option>
            </select>
          </label>
          <label>
            服务地址
            <input value={draft.baseUrl ?? ''} onChange={(event) => updateDraft('baseUrl', event.target.value)} placeholder="http://127.0.0.1:5678" />
          </label>
          <label>
            健康检查地址
            <input value={draft.healthCheckUrl ?? ''} onChange={(event) => updateDraft('healthCheckUrl', event.target.value)} />
          </label>
          <label>
            API Key / Token
            <input value={draft.apiKey ?? ''} onChange={(event) => updateDraft('apiKey', event.target.value)} placeholder="保存后会隐藏显示" />
          </label>
          <label>
            工作目录
            <input value={draft.workingDirectory ?? ''} onChange={(event) => updateDraft('workingDirectory', event.target.value)} placeholder="D:/apps/service" />
          </label>
          <label>
            启动命令
            <input value={draft.startCommand ?? ''} onChange={(event) => updateDraft('startCommand', event.target.value)} placeholder="python run.py" />
          </label>
          <label>
            停止命令
            <input value={draft.stopCommand ?? ''} onChange={(event) => updateDraft('stopCommand', event.target.value)} />
          </label>
          <label>
            重启命令
            <input value={draft.restartCommand ?? ''} onChange={(event) => updateDraft('restartCommand', event.target.value)} />
          </label>
          <label>
            说明
            <textarea rows={3} value={draft.notes ?? ''} onChange={(event) => updateDraft('notes', event.target.value)} />
          </label>
          <label>
            扩展环境变量 JSON
            <textarea rows={5} value={draft.envJson} onChange={(event) => updateDraft('envJson', event.target.value)} />
          </label>
          <div className="dependency-submit-row">
            <button type="submit" disabled={save.isPending}>{save.isPending ? '保存中' : '保存配置'}</button>
            {actionMessage ? <span>{actionMessage}</span> : null}
          </div>
        </form>
      </section>

      <aside className="panel dependency-guide">
        <PanelHeader title={`${guide.title} 安装配置引导`} hint="Setup Guide" />
        <p>{guide.purpose}</p>
        <FieldGuideTable rows={guide.fieldRows} />
        <GuideSection title="如何安装" items={guide.install} />
        <GuideSection title="如何填写配置" items={guide.configure} />
        <GuideSection title="从哪里获取配置" items={guide.whereToGet} />
        <GuideSection title="如何验证" items={guide.verify} />
        <div className="dependency-example">
          <strong>示例</strong>
          {guide.examples.map((item) => <code key={item}>{item}</code>)}
        </div>
        <GuideSection title="常见问题" items={guide.commonIssues} />
      </aside>
    </div>
  );
}

function FieldGuideTable({ rows }: { rows: DetailedDependencyGuide['fieldRows'] }) {
  return (
    <section className="dependency-field-guide">
      <h3>字段怎么填</h3>
      <div>
        {rows.map((row) => (
          <article key={`${row.field}-${row.example}`}>
            <strong>{row.field}</strong>
            <span>{row.fill}</span>
            <small>来源：{row.source}</small>
            {row.example ? <code>{row.example}</code> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function GuideSection({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="dependency-guide-section">
      <h3>{title}</h3>
      <ol>
        {items.map((item) => <li key={item}>{item}</li>)}
      </ol>
    </section>
  );
}

type FeishuStatus = {
  ok: boolean;
  feishu: {
    mirrorEnabled: boolean;
    credentialsConfigured: boolean;
    mode: 'openapi' | 'noop';
    baseAppTokenConfigured: boolean;
    appIdConfigured: boolean;
    appSecretConfigured: boolean;
    openBaseUrl: string;
    baseUrl: string | null;
  };
};

type FeishuSyncCount = { attempted: number; created: number; updated: number; skipped: number; failed: number };
type FeishuSyncSummary = {
  mode: 'openapi' | 'noop';
  startedAt: string;
  finishedAt: string;
  counts: Record<'task' | 'approval' | 'lead' | 'artifact', FeishuSyncCount>;
  errors: Array<{ kind: string; id: string; message: string }>;
};

function FeishuLedgerCard() {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ['feishu-status'],
    queryFn: () => apiGet<FeishuStatus>('/api/web/feishu/status')
  });
  const sync = useMutation({
    mutationFn: () => apiPost<{ ok: boolean; summary: FeishuSyncSummary }>('/api/web/feishu/sync', {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['feishu-status'] })
  });

  const f = status.data?.feishu;
  const live = f?.credentialsConfigured ?? false;
  const summary = sync.data?.summary;

  return (
    <section className="panel" style={{ gridColumn: '1 / -1' }}>
      <PanelHeader
        title="飞书经营台账"
        hint="把任务·审批·线索·交付物投影进飞书多维表格，用飞书当经营台账（Phase A：单向投影）"
      />
      {status.isLoading ? (
        <LoadingPanel />
      ) : status.error ? (
        <ErrorPanel error={status.error} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <HealthPill label={live ? '实时写入 (OpenAPI)' : '演练模式 (未配凭证)'} ok={live} />
            <HealthPill label="Base 已连" ok={f?.baseAppTokenConfigured} />
            <HealthPill label="App ID" ok={f?.appIdConfigured} />
            <HealthPill label="App Secret" ok={f?.appSecretConfigured} />
          </div>

          {!live ? (
            <div className="json-panel" style={{ lineHeight: 1.7 }}>
              飞书写入通道尚未接通。要开启实时同步，需在飞书开放平台建<b>企业自建应用</b>，
              把它加为该 Base 的可编辑协作者，然后在 <code>.env</code> 填入：
              <br />
              <code>APPOS_FEISHU_APP_ID</code> / <code>APPOS_FEISHU_APP_SECRET</code>
              （<code>APPOS_FEISHU_BASE_APP_TOKEN</code> 已配好）。
              <br />
              未配凭证时点击下方按钮会跑<b>演练</b>：只统计将写入的记录数，不触网、不改飞书。
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="secondary-button"
              disabled={sync.isPending}
              onClick={() => sync.mutate()}
            >
              {sync.isPending ? '同步中…' : live ? '同步到飞书' : '演练同步'}
            </button>
            {f?.baseUrl ? (
              <a className="secondary-button" href={f.baseUrl} target="_blank" rel="noreferrer">
                打开飞书 Base
              </a>
            ) : null}
          </div>

          {sync.error ? <ErrorPanel error={sync.error} /> : null}

          {summary ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 13, opacity: 0.75 }}>
                {summary.mode === 'openapi' ? '已写入飞书' : '演练结果（未触网）'} ·
                {' '}耗时 {Math.max(0, Date.parse(summary.finishedAt) - Date.parse(summary.startedAt))}ms
                {summary.errors.length ? ` · ${summary.errors.length} 条失败` : ''}
              </div>
              <div className="dashboard-grid" style={{ gap: 8 }}>
                {(['task', 'approval', 'lead', 'artifact'] as const).map((kind) => {
                  const c = summary.counts[kind];
                  const label = { task: '任务', approval: '审批', lead: '线索', artifact: '交付物' }[kind];
                  return (
                    <div key={kind} className="json-panel" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <b>{label}</b>
                      <span style={{ fontSize: 12, opacity: 0.8 }}>
                        共 {c.attempted}
                        {summary.mode === 'openapi'
                          ? ` · 新建 ${c.created} · 更新 ${c.updated}`
                          : ` · 待写 ${c.skipped}`}
                        {c.failed ? ` · 失败 ${c.failed}` : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}


type OpsInsightsResponse = {
  ok: boolean;
  generatedAt: string;
  headline: string;
  kpis: Array<{ key: string; label: string; value: number; hint?: string; tone?: string }>;
  distributions: {
    taskStatus: Record<string, number>;
    taskPriority: Record<string, number>;
    taskOwner: Record<string, number>;
    leadStatus: Record<string, number>;
    leadSource: Record<string, number>;
  };
  trend: Array<{ day: string; tasks: number; leads: number }>;
  lists: {
    blockedTasks: AnyRecord[];
    activeTasks: AnyRecord[];
    hotLeads: AnyRecord[];
    topScoredLeads: AnyRecord[];
    overdueFollowUps: AnyRecord[];
    urgentMail: AnyRecord[];
    pendingApprovals: AnyRecord[];
  };
  actions: Array<{ kind: string; title: string; detail: string; href: string }>;
  feishu: { baseUrl: string | null; tables: Record<string, string> };
};

type AnalyticsMetric = { key: string; label: string; value: number; format: 'number' | 'money' | 'percent'; hint: string };
type AnalyticsPoint = { date: string; value: number };
type AnalyticsBreakdown = { label: string; value: number };
type BusinessAnalyticsResponse = {
  ok: true;
  source: { mode: string; label: string; refreshedAt: string; facts: number; message: string };
  company: { kpis: AnalyticsMetric[]; trends: Record<string, AnalyticsPoint[]>; breakdowns: Record<string, AnalyticsBreakdown[]> };
  growth: { funnel: AnalyticsBreakdown[]; channels: AnalyticsBreakdown[]; leadStates: AnalyticsBreakdown[]; platform: AnalyticsBreakdown[]; leadQuality: AnalyticsBreakdown[] };
  customers: { kpis: AnalyticsMetric[]; ranking: Array<{ name: string; score: number; amount: number; stage: string; segment: string; source: string }>; segments: AnalyticsBreakdown[]; stages: AnalyticsBreakdown[] };
  execution: { taskStatus: AnalyticsBreakdown[]; agentLoad: AnalyticsBreakdown[]; risk: AnalyticsBreakdown[]; delivery: AnalyticsBreakdown[]; failures: AnalyticsBreakdown[] };
  weekly: { kpis: AnalyticsMetric[]; trends: Record<string, AnalyticsPoint[]> };
};

type AnalyticsTab = 'company' | 'growth' | 'customers' | 'weekly' | 'execution';
const analyticsTabs: Array<{ id: AnalyticsTab; label: string; description: string }> = [
  { id: 'company', label: '公司整体', description: '结果、管道与经营健康' },
  { id: 'growth', label: '增长获客', description: '渠道、漏斗与内容' },
  { id: 'customers', label: '客户下钻', description: '客户价值与质量' },
  { id: 'weekly', label: '周复盘', description: '连续趋势与复盘' },
  { id: 'execution', label: '执行风险', description: '任务、Agent、治理' }
];

function analyticsFormat(value: number, format: AnalyticsMetric['format'] | 'number' = 'number') {
  if (format === 'money') return formatMoney(value);
  if (format === 'percent') return `${Number(value || 0).toFixed(1)}%`;
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(Number(value || 0));
}

function MiniBars({ title, data, valueFormat = 'number' }: { title: string; data: AnalyticsBreakdown[]; valueFormat?: AnalyticsMetric['format'] }) {
  const values = data.filter((item) => Number.isFinite(item.value)).slice(0, 10);
  const max = Math.max(1, ...values.map((item) => item.value));
  return (
    <section className="panel analytics-chart-card">
      <PanelHeader title={title} hint={`${values.length} 个维度`} />
      {values.length ? <div className="analytics-bars">
        {values.map((item) => <div className="analytics-bar-row" key={item.label}>
          <div className="analytics-bar-label"><span title={item.label}>{item.label}</span><strong>{analyticsFormat(item.value, valueFormat)}</strong></div>
          <div className="analytics-bar-track"><i style={{ width: `${Math.max(4, item.value / max * 100)}%` }} /></div>
        </div>)}
      </div> : <EmptyState text="暂无可分析数据" />}
    </section>
  );
}

function MiniTrend({ title, series, format = 'number', color = 'violet' }: { title: string; series: AnalyticsPoint[]; format?: AnalyticsMetric['format']; color?: string }) {
  const points = series.slice(-24);
  const max = Math.max(1, ...points.map((item) => item.value));
  return (
    <section className="panel analytics-chart-card analytics-trend-card">
      <PanelHeader title={title} hint={points.length ? `${points[0].date.slice(5)} — ${points.at(-1)?.date.slice(5)}` : '暂无趋势'} />
      {points.length ? <>
        <div className={`analytics-spark ${color}`}>
          {points.map((point) => <div className="analytics-spark-column" key={point.date} title={`${point.date} · ${analyticsFormat(point.value, format)}`}>
            <i style={{ height: `${Math.max(5, point.value / max * 100)}%` }} />
          </div>)}
        </div>
        <div className="analytics-trend-caption"><span>{points[0].date.slice(5)}</span><strong>{analyticsFormat(points.at(-1)?.value ?? 0, format)}</strong><span>{points.at(-1)?.date.slice(5)}</span></div>
      </> : <EmptyState text="暂无可分析数据" />}
    </section>
  );
}

function AnalyticsMetrics({ metrics }: { metrics: AnalyticsMetric[] }) {
  return <div className="metric-grid wide analytics-metric-grid">{metrics.map((metric) => <article className="metric-card done" key={metric.key}>
    <span>{metric.label}</span><strong>{analyticsFormat(metric.value, metric.format)}</strong><small>{metric.hint}</small>
  </article>)}</div>;
}

function AnalyticsHub() {
  const [tab, setTab] = useState<AnalyticsTab>(() => {
    const requested = new URLSearchParams(window.location.search).get('view') as AnalyticsTab | null;
    return analyticsTabs.some((item) => item.id === requested) ? requested! : 'company';
  });
  const query = useQuery({ queryKey: ['business-analytics'], queryFn: () => apiGet<BusinessAnalyticsResponse>('/api/web/analytics'), refetchInterval: 60_000 });
  const switchTab = (next: AnalyticsTab) => {
    setTab(next);
    const url = new URL(window.location.href); url.searchParams.set('view', next); window.history.replaceState({}, '', url);
  };
  if (query.isLoading) return <LoadingPanel />;
  if (query.isError || !query.data) return <ErrorPanel error={query.error ?? new Error('分析数据不可用')} />;
  const data = query.data;
  return <section className="analytics-hub">
    <div className={`analytics-source ${data.source.mode.includes('demo') ? 'demo' : ''}`}>
      <div><span className="eyebrow">NATIVE BUSINESS INTELLIGENCE</span><strong>{data.source.label}</strong><p>{data.source.message}</p></div>
      <div className="analytics-source-meta"><span>{data.source.facts.toLocaleString()} 条事实</span><span>{formatTime(data.source.refreshedAt)}</span></div>
    </div>
    <div className="analytics-tabs" role="tablist">
      {analyticsTabs.map((item) => <button type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'active' : ''} onClick={() => switchTab(item.id)} key={item.id}><strong>{item.label}</strong><small>{item.description}</small></button>)}
    </div>
    {tab === 'company' ? <div className="analytics-view"><AnalyticsMetrics metrics={data.company.kpis} /><div className="analytics-grid two"><MiniTrend title="新增线索趋势" series={data.company.trends.leads} color="green" /><MiniTrend title="成交金额趋势" series={data.company.trends.revenue} format="money" color="amber" /><MiniTrend title="管道金额趋势" series={data.company.trends.pipeline} format="money" color="violet" /><MiniTrend title="内容产出趋势" series={data.company.trends.content} color="blue" /><MiniBars title="行业管道结构" data={data.company.breakdowns.industryPipeline} valueFormat="money" /><MiniBars title="经营范围覆盖" data={data.company.breakdowns.scope} /></div></div> : null}
    {tab === 'growth' ? <div className="analytics-view"><div className="analytics-grid two"><MiniBars title="获客漏斗" data={data.growth.funnel} /><MiniBars title="渠道进水" data={data.growth.channels} /><MiniBars title="线索阶段" data={data.growth.leadStates} /><MiniBars title="内容平台产出" data={data.growth.platform} /><MiniBars title="行业线索质量" data={data.growth.leadQuality} valueFormat="percent" /></div></div> : null}
    {tab === 'customers' ? <div className="analytics-view"><AnalyticsMetrics metrics={data.customers.kpis} /><section className="panel analytics-customer-table"><PanelHeader title="客户价值排序" hint="可作为 CRM 跟进优先级" /><div className="analytics-table-wrap"><table><thead><tr><th>客户</th><th>质量分</th><th>预估管道</th><th>阶段</th><th>行业</th><th>来源</th></tr></thead><tbody>{data.customers.ranking.map((item) => <tr key={item.name}><td><strong>{item.name}</strong></td><td>{analyticsFormat(item.score, 'percent')}</td><td>{analyticsFormat(item.amount, 'money')}</td><td><StatusPill status={item.stage} /></td><td>{item.segment}</td><td>{item.source}</td></tr>)}</tbody></table></div></section><div className="analytics-grid two"><MiniBars title="行业客户价值" data={data.customers.segments} valueFormat="money" /><MiniBars title="客户所处阶段" data={data.customers.stages} /></div></div> : null}
    {tab === 'weekly' ? <div className="analytics-view"><AnalyticsMetrics metrics={data.weekly.kpis} /><div className="analytics-grid two"><MiniTrend title="新增线索" series={data.weekly.trends.leads} color="green" /><MiniTrend title="合格线索" series={data.weekly.trends.qualified} color="blue" /><MiniTrend title="报价产出" series={data.weekly.trends.quotes} color="violet" /><MiniTrend title="成交单数" series={data.weekly.trends.won} color="amber" /><MiniTrend title="成交金额" series={data.weekly.trends.revenue} format="money" color="amber" /><MiniTrend title="管道金额" series={data.weekly.trends.pipeline} format="money" color="violet" /><MiniTrend title="任务完成" series={data.weekly.trends.tasks} color="green" /><MiniTrend title="阻塞任务" series={data.weekly.trends.blocked} color="red" /></div></div> : null}
    {tab === 'execution' ? <div className="analytics-view"><div className="analytics-grid two"><MiniBars title="任务状态" data={data.execution.taskStatus} /><MiniBars title="Agent 负载" data={data.execution.agentLoad} /><MiniBars title="审批风险" data={data.execution.risk} /><MiniBars title="交付物状态" data={data.execution.delivery} /><MiniBars title="故障等级" data={data.execution.failures} /></div></div> : null}
  </section>;
}

function DistributionBars({ title, data }: { title: string; data: Record<string, number> }) {
  const entries = Object.entries(data || {}).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  if (!entries.length) return (
    <section className="panel">
      <PanelHeader title={title} />
      <EmptyState text="暂无数据" />
    </section>
  );
  return (
    <section className="panel">
      <PanelHeader title={title} hint={`${entries.length} 类`} />
      <div className="ops-bars">
        {entries.map(([label, value]) => (
          <div className="ops-bar-row" key={label}>
            <div className="ops-bar-meta">
              <span>{labelFromSnake(label)}</span>
              <strong>{value}</strong>
            </div>
            <div className="ops-bar-track">
              <div className="ops-bar-fill" style={{ width: `${Math.max(6, (value / max) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TrendChart({ trend }: { trend: Array<{ day: string; tasks: number; leads: number }> }) {
  const max = Math.max(1, ...trend.flatMap((d) => [d.tasks, d.leads]));
  if (!trend.length) {
    return (
      <section className="panel" style={{ gridColumn: '1 / -1' }}>
        <PanelHeader title="近 14 日趋势" />
        <EmptyState text="还没有足够的时间序列数据" />
      </section>
    );
  }
  return (
    <section className="panel" style={{ gridColumn: '1 / -1' }}>
      <PanelHeader title="近 14 日趋势" hint="任务新增 vs 线索新增" />
      <div className="ops-trend">
        {trend.map((d) => (
          <div className="ops-trend-col" key={d.day} title={`${d.day}: 任务 ${d.tasks} / 线索 ${d.leads}`}>
            <div className="ops-trend-bars">
              <div className="ops-trend-bar tasks" style={{ height: `${Math.max(4, (d.tasks / max) * 100)}%` }} />
              <div className="ops-trend-bar leads" style={{ height: `${Math.max(4, (d.leads / max) * 100)}%` }} />
            </div>
            <span>{d.day.slice(5)}</span>
          </div>
        ))}
      </div>
      <div className="ops-legend">
        <span><i className="dot tasks" /> 任务</span>
        <span><i className="dot leads" /> 线索</span>
      </div>
    </section>
  );
}

function OpsInsightsPage() {
  const query = useQuery({
    queryKey: ['ops-insights'],
    queryFn: () => apiGet<OpsInsightsResponse>('/api/web/ops-insights'),
    refetchInterval: 30_000
  });
  const sync = useMutation({
    mutationFn: () => apiPost<{ ok: boolean; summary: AnyRecord }>('/api/web/feishu/sync', {}),
  });

  if (query.isLoading) return <LoadingPanel />;
  if (query.isError) return <ErrorPanel error={query.error} />;
  const data = query.data;
  if (!data) return <LoadingPanel />;

  return (
    <div className="dashboard-grid ops-insights">
      <section className="panel" style={{ gridColumn: '1 / -1' }}>
        <PanelHeader title="经营分析驾驶舱" hint={formatTime(data.generatedAt)} />
        <div className="ops-headline">{data.headline}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button type="button" className="secondary-button" disabled={sync.isPending} onClick={() => sync.mutate()}>
            {sync.isPending ? '同步飞书中…' : '同步到飞书台账'}
          </button>
          {data.feishu.baseUrl ? (
            <a className="secondary-button" href={data.feishu.baseUrl} target="_blank" rel="noreferrer">打开飞书 Base</a>
          ) : null}
          <button type="button" className="secondary-button" onClick={() => void query.refetch()}>刷新分析</button>
        </div>
        {sync.data?.summary ? (
          <div className="json-panel" style={{ marginTop: 12 }}>
            飞书同步完成：任务 {(sync.data.summary as any).counts?.task?.attempted ?? 0} · 线索 {(sync.data.summary as any).counts?.lead?.attempted ?? 0} · 审批 {(sync.data.summary as any).counts?.approval?.attempted ?? 0}
          </div>
        ) : null}
        {sync.error ? <ErrorPanel error={sync.error} /> : null}
      </section>

      <AnalyticsHub />

      <section className="panel" style={{ gridColumn: '1 / -1' }}>
        <PanelHeader title="今日决策层" hint="实时业务库" />
        <p className="analytics-layer-note">下方保留的是实时任务、审批与 CRM 行动面；上方分析中心用于看整体趋势、局部经营与复盘。</p>
      </section>

      <div className="metric-grid wide" style={{ gridColumn: '1 / -1' }}>
        {data.kpis.map((kpi) => (
          <div key={kpi.key} className={`metric-card ${kpi.tone === 'danger' ? 'danger' : kpi.tone === 'warn' ? 'active' : 'done'}`}>
            <span>{kpi.label}</span>
            <strong>{kpi.value}</strong>
            <small>{kpi.hint}</small>
          </div>
        ))}
      </div>

      <TrendChart trend={data.trend} />
      <DistributionBars title="任务状态分布" data={data.distributions.taskStatus} />
      <DistributionBars title="任务优先级" data={data.distributions.taskPriority} />
      <DistributionBars title="执行 Agent" data={data.distributions.taskOwner} />
      <DistributionBars title="线索状态" data={data.distributions.leadStatus} />
      <DistributionBars title="线索来源" data={data.distributions.leadSource} />

      <section className="panel">
        <PanelHeader title="优先行动" hint="先处理这些最值钱" />
        {data.actions.length ? (
          <div className="ops-actions">
            {data.actions.map((action, idx) => (
              <a key={`${action.kind}-${idx}`} className="ops-action" href={action.href}>
                <div>
                  <strong>{action.title}</strong>
                  <small>{action.detail}</small>
                </div>
                <span>{labelFromSnake(action.kind)}</span>
              </a>
            ))}
          </div>
        ) : <EmptyState text="当前没有紧急行动项" />}
      </section>

      <section className="panel">
        <PanelHeader title="阻塞 / 失败任务" />
        {data.lists.blockedTasks.length ? (
          <SimpleList
            items={data.lists.blockedTasks}
            primary={(item) => String(item.title || item.id)}
            meta={(item) => `${String(item.status || '')} · ${String(item.owner_agent || '')}`}
            href={(item) => item.id ? `/app/tasks?task=${encodeURIComponent(String(item.id))}` : null}
          />
        ) : <EmptyState text="没有阻塞任务" />}
      </section>

      <section className="panel">
        <PanelHeader title="高分线索" />
        {data.lists.topScoredLeads.length ? (
          <SimpleList
            items={data.lists.topScoredLeads}
            primary={(item) => String(item.name || item.id)}
            meta={(item) => `分数 ${String(item.score_total ?? '-')} · ${String(item.source || '')}`}
            href={() => '/app/crm'}
          />
        ) : <EmptyState text="还没有可评分线索" />}
      </section>

      <section className="panel">
        <PanelHeader title="逾期跟进" />
        {data.lists.overdueFollowUps.length ? (
          <SimpleList
            items={data.lists.overdueFollowUps}
            primary={(item) => String(item.title || item.name || item.id)}
            meta={(item) => String(item.status || 'overdue')}
            href={() => '/app/crm'}
          />
        ) : <EmptyState text="没有逾期跟进" />}
      </section>

      <section className="panel" style={{ gridColumn: '1 / -1' }}>
        <PanelHeader title="飞书经营台账" hint="表格 + 视图已就绪，仪表盘受飞书 OpenAPI 限制需在 Base 内手动加图表" />
        <div className="json-panel" style={{ lineHeight: 1.7 }}>
          已同步表：{Object.values(data.feishu.tables).join(' / ')}。
          建议在飞书 Base 里用这些视图看经营面：
          <b>进行中任务 / 阻塞任务 / 高分线索 / 待审批</b>。
          {data.feishu.baseUrl ? (
            <>
              <br />
              <a href={data.feishu.baseUrl} target="_blank" rel="noreferrer">打开飞书 Base 做图表</a>
              （飞书 OpenAPI 目前不能远程创建仪表盘组件，但网站这里已经给你完整 KPI 与可视化。）
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function SettingsPage() {
  const panel = usePanelParam();
  const query = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiGet<{ ok: boolean; settings: AnyRecord }>('/api/web/settings')
  });
  const settings = query.data?.settings ?? {};

  return (
    <div className="dashboard-grid">
      <FeishuLedgerCard />
      {panel === 'agents' || panel === 'agent' ? <MiniAppActionPanel kind="agent" /> : null}
      {panel === 'knowledge' ? <MiniAppActionPanel kind="knowledge" /> : null}
      {Object.entries(settings).map(([key, value]) => (
        <section className="panel" key={key}>
          <PanelHeader title={labelFromSnake(key)} hint="只显示状态，不暴露密钥" />
          <pre className="json-panel">{JSON.stringify(value, null, 2)}</pre>
        </section>
      ))}
    </div>
  );
}

function DeliverablePage() {
  const artifactId = window.location.pathname.replace(/^\/app\/deliverables\/?/, '').split('/')[0];
  const query = useQuery({
    queryKey: ['artifact', artifactId],
    queryFn: () => apiGet<ArtifactPreviewResponse>(`/api/web/artifacts/${artifactId}`),
    enabled: Boolean(artifactId)
  });

  if (!artifactId) return <ErrorPanel error={new Error('缺少交付物 ID')} />;
  if (query.isLoading) return <LoadingPanel />;
  if (query.isError) return <ErrorPanel error={query.error} />;
  if (!query.data) return <LoadingPanel />;

  const { artifact, preview } = query.data;
  const workStrategy = preview.metadata?.workStrategy as AnyRecord | undefined;

  return (
    <div className="deliverable-layout">
      <section className="panel deliverable-header">
        <span className="eyebrow">Deliverable</span>
        <h2>{preview.title}</h2>
        <div className="tag-row">
          <span>{artifact.id}</span>
          <span>{artifact.type}</span>
          {artifact.task_id ? <span>{artifact.task_id}</span> : null}
        </div>
        {workStrategy?.rationale ? <p>{String(workStrategy.rationale)}</p> : null}
      </section>

      <section className="panel deliverable-preview">
        <PanelHeader title="预览" hint={preview.mode === 'html' ? 'Telegram Mini App 网页容器' : '阅读器'} />
        {preview.mode === 'html' ? (
          <iframe title={artifact.title} srcDoc={preview.content} sandbox="allow-same-origin" />
        ) : (
          <pre className="deliverable-text">{preview.content}</pre>
        )}
      </section>
    </div>
  );
}

function CommandInput() {
  const [text, setText] = useState('');
  const queryClient = useQueryClient();
  const command = useMutation({
    mutationFn: (commandText: string) => apiPost<WebCommandResponse>('/api/web/command', { text: commandText }),
    onSuccess: () => {
      setText('');
      void queryClient.invalidateQueries();
    }
  });

  useEffect(() => {
    const handlePrefill = (event: Event) => {
      const detail = (event as CustomEvent<string | { text: string; autoRun?: boolean }>).detail;
      const commandText = typeof detail === 'string' ? detail : detail?.text;
      const autoRun = typeof detail === 'object' && detail !== null ? Boolean(detail.autoRun) : false;
      if (!commandText) return;
      setText(commandText);
      window.requestAnimationFrame(() => {
        const input = document.getElementById('chief-command-input');
        input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (autoRun) {
          if (!command.isPending) command.mutate(commandText.trim());
        } else {
          input?.focus();
        }
      });
    };
    window.addEventListener('tele-opc:prefill-command', handlePrefill);
    return () => window.removeEventListener('tele-opc:prefill-command', handlePrefill);
  }, [command]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || command.isPending) return;
    command.mutate(text.trim());
  }

  return (
    <section className="command-bar">
      <div className="command-context">
        <span><Sparkles size={14} /> Chief Agent</span>
        <span>低风险自动执行</span>
        <span>财务/付款强审批</span>
      </div>
      <form onSubmit={submit}>
        <Command size={19} />
        <input
          id="chief-command-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="告诉 Chief Agent 你要达成什么目标…"
          aria-label="给 Chief Agent 下达指令"
          autoComplete="off"
        />
        <kbd className="command-shortcut">⌘K</kbd>
        <button type="submit" disabled={command.isPending}>
          {command.isPending ? '执行中' : <><Send size={16} />发送</>}
        </button>
      </form>
      <AnimatePresence>
        {command.data ? (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <TaskSubmissionCard response={command.data} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}

function TaskFlow({ counts }: { counts: Record<string, number> }) {
  const columns = ['planned', 'queued', 'running', 'blocked', 'review', 'done'];
  const max = Math.max(...columns.map((status) => counts[status] ?? 0), 1);
  return (
    <div className="flow-board">
      {columns.map((status) => {
        const value = counts[status] ?? 0;
        return (
          <div key={status} className="flow-column">
            <span>{status}</span>
            <strong>{value}</strong>
            <div className="flow-track">
              <i style={{ height: `${Math.max(12, (value / max) * 100)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = 'neutral'
}: {
  label: string;
  value: string | number;
  detail?: string;
  icon: typeof LayoutDashboard;
  tone?: 'neutral' | 'active' | 'done' | 'danger';
}) {
  return (
    <motion.article className={`metric-card ${tone}`} whileHover={{ y: -2 }} whileTap={{ scale: 0.99 }}>
      <div className="metric-icon">
        <Icon size={19} />
      </div>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </motion.article>
  );
}

function StatusChip({
  icon: Icon,
  label,
  tone
}: {
  icon: typeof LayoutDashboard;
  label: string;
  tone: 'active' | 'done' | 'danger' | 'neutral';
}) {
  return (
    <span className={`status-chip ${tone}`}>
      <Icon size={15} />
      {label}
    </span>
  );
}

function TaskList({ tasks, compact = false }: { tasks: TaskRecord[]; compact?: boolean }) {
  if (!tasks.length) return <EmptyState text="还没有任务" />;
  return (
    <div className={compact ? 'task-list compact' : 'task-list'}>
      {tasks.map((task) => (
        <article key={task.id}>
          <StatusPill status={task.status} />
          <div>
            <strong>{task.title}</strong>
            <span>{task.owner_agent} · {task.risk_level} · {formatTime(task.created_at)}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function ApprovalList({ approvals }: { approvals: AnyRecord[] }) {
  if (!approvals.length) return <EmptyState text="当前没有待审批动作" />;
  return (
    <div className="approval-list">
      {approvals.map((approval) => (
        <article key={approval.id}>
          <ShieldCheck size={18} />
          <div>
            <strong>{approval.task_title ?? approval.action_type}</strong>
            <span>{approval.id} · {approval.risk_level} · {formatTime(approval.created_at)}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function Timeline({ items, kind }: { items: AnyRecord[]; kind: 'run' | 'task' }) {
  if (!items.length) return <EmptyState text="暂无时间线数据" />;
  return (
    <div className="timeline">
      {items.map((item) => (
        <article key={item.id}>
          <StatusPill status={item.status} />
          <div>
            <strong>{kind === 'run' ? item.agent_id : item.title}</strong>
            <span>{kind === 'run' ? `${item.model} · ${item.provider}` : item.owner_agent}</span>
          </div>
          <small>{formatTime(item.started_at ?? item.created_at)}</small>
        </article>
      ))}
    </div>
  );
}

function TraceDetail({ detail }: { detail?: { run: AgentRunRecord; toolCalls: AnyRecord[] } }) {
  if (!detail) return <EmptyState text="选择一个 Agent Run 查看 Trace" />;
  return (
    <div className="trace-detail">
      <h3>{detail.run.agent_id}</h3>
      <p>{detail.run.id} · {detail.run.model}</p>
      <div className="tool-call-list">
        {detail.toolCalls.length ? detail.toolCalls.map((tool) => (
          <article key={tool.id}>
            <StatusPill status={tool.status} />
            <strong>{tool.tool_name}</strong>
            <span>{tool.approval_required ? '需要审批' : '自动执行'}</span>
          </article>
        )) : <EmptyState text="这个 Run 暂无工具调用记录" />}
      </div>
    </div>
  );
}

function useTelegramMiniApp() {
  useEffect(() => {
    const webApp = (window as any).Telegram?.WebApp;
    if (!webApp) return;
    webApp.ready?.();
    webApp.expand?.();
    document.documentElement.classList.add('telegram-mini-app');
    return () => document.documentElement.classList.remove('telegram-mini-app');
  }, []);
}

function usePanelParam() {
  return useQueryParam('panel');
}

function useQueryParam(name: string) {
  const [value, setValue] = useState(() => new URLSearchParams(window.location.search).get(name) ?? '');

  useEffect(() => {
    const listener = () => setValue(new URLSearchParams(window.location.search).get(name) ?? '');
    window.addEventListener('popstate', listener);
    return () => window.removeEventListener('popstate', listener);
  }, [name]);

  return value;
}

function useRoute(): [RouteId, (route: RouteId) => void] {
  const [route, setRouteState] = useState<RouteId>(() => routeFromPath());

  useEffect(() => {
    const listener = () => setRouteState(routeFromPath());
    window.addEventListener('popstate', listener);
    return () => window.removeEventListener('popstate', listener);
  }, []);

  function setRoute(routeId: RouteId) {
    const href = routeId === 'mission' ? '/app' : `/app/${routeId}`;
    window.history.pushState({}, '', href);
    setRouteState(routeId);
  }

  return [route, setRoute];
}

