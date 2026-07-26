import {
  Activity,
  AlertTriangle,
  Bot,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  GitBranch,
  Layers3,
  ListChecks,
  Plus,
  RefreshCw,
  Target,
  Users,
  Workflow,
  X
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, apiPost } from '../api';
import { formatMoney, formatTime } from '../format';
import type {
  AnyRecord,
  PaperclipAgent,
  PaperclipGovernanceResponse,
  PaperclipIssue,
  PaperclipIssueDetailResponse
} from '../types';
import { EmptyState, ErrorPanel, LoadingPanel, PanelHeader, StatusPill, truncateText } from './ui';

const issueColumns = [
  { id: 'todo', label: '待执行', statuses: ['backlog', 'todo'], tone: 'neutral' },
  { id: 'active', label: '执行中', statuses: ['in_progress', 'in_review'], tone: 'active' },
  { id: 'blocked', label: '受阻', statuses: ['blocked'], tone: 'danger' },
  { id: 'done', label: '已完成', statuses: ['done', 'cancelled'], tone: 'done' }
];

export function PaperclipGovernance() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [issueSearch, setIssueSearch] = useState('');
  const query = useQuery({
    queryKey: ['paperclip-governance'],
    queryFn: () => apiGet<PaperclipGovernanceResponse>('/api/web/paperclip'),
    refetchInterval: 30_000
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['paperclip-governance'] });

  if (query.isLoading) return <LoadingPanel />;
  if (query.isError) return <ErrorPanel error={query.error} />;
  if (!query.data) return <LoadingPanel />;

  const data = query.data;
  const activeGoals = data.goals.filter((goal) => goal.status === 'active').length;
  const activeProjects = data.projects.filter((project) => project.status === 'in_progress').length;
  const activeAgents = data.agents.filter((agent) => !['paused', 'terminated', 'error'].includes(agent.status ?? '')).length;
  const openIssues = data.issues.filter((issue) => !['done', 'cancelled'].includes(issue.status ?? '')).length;
  const filteredIssues = data.issues.filter((issue) => {
    const needle = issueSearch.trim().toLowerCase();
    return !needle || `${issue.identifier ?? ''} ${issue.title} ${issue.description ?? ''}`.toLowerCase().includes(needle);
  });

  return (
    <div className="paperclip-governance">
      <section className="paperclip-hero panel">
        <div className="paperclip-hero-copy">
          <span className="eyebrow"><Building2 size={14} /> PAPERCLIP CONTROL PLANE</span>
          <h2>{data.company.name}</h2>
          <p>{data.company.description || '公司目标、项目、AI 员工和任务治理中心。'}</p>
          <div className="paperclip-hero-meta">
            <span><i className="paperclip-live-dot" /> 控制面已连接</span>
            <span>数据更新 {formatTime(data.generatedAt)}</span>
          </div>
        </div>
        <div className="paperclip-hero-actions">
          <button type="button" className="secondary-button" onClick={refresh}>
            <RefreshCw size={16} className={query.isFetching ? 'spin' : ''} /> 刷新
          </button>
          <button type="button" className="primary-button" onClick={() => setCreateOpen(true)}>
            <Plus size={16} /> 创建公司任务
          </button>
        </div>
      </section>

      <div className="paperclip-kpis">
        <GovernanceMetric icon={Target} label="活跃目标" value={activeGoals} hint={`${data.goals.length} 个目标`} />
        <GovernanceMetric icon={Layers3} label="进行中项目" value={activeProjects} hint={`${data.projects.length} 个项目`} />
        <GovernanceMetric icon={Users} label="AI 员工" value={activeAgents} hint={`${data.agents.length} 个已登记`} />
        <GovernanceMetric icon={ListChecks} label="开放 Issue" value={openIssues} hint={`${data.issues.length} 个总任务`} />
        <GovernanceMetric icon={Workflow} label="执行面任务" value={data.execution.linkedTasks} hint="已关联 Tele-OPC" />
        <GovernanceMetric icon={CheckCircle2} label="执行成功率" value={`${data.execution.successRate}%`} hint={`${data.execution.done} 完成 / ${data.execution.failed} 失败`} />
      </div>

      <div className="paperclip-strategy-grid">
        <section className="panel paperclip-goals">
          <PanelHeader title="公司目标" hint="从愿景到可执行结果" />
          <div className="paperclip-goal-list">
            {data.goals.map((goal) => (
              <article key={goal.id}>
                <div className="paperclip-goal-icon"><Target size={18} /></div>
                <div>
                  <div className="paperclip-row-title"><strong>{goal.title}</strong><StatusPill status={goal.status ?? 'planned'} /></div>
                  <p>{truncateText(goal.description, 180) || '暂未补充目标说明'}</p>
                  <small>{goal.level ?? 'company'} · 更新于 {formatTime(goal.updatedAt)}</small>
                </div>
              </article>
            ))}
            {!data.goals.length ? <EmptyState text="尚未建立公司目标" /> : null}
          </div>
        </section>

        <section className="panel paperclip-projects">
          <PanelHeader title="项目组合" hint="目标的执行容器" />
          <div className="paperclip-project-list">
            {data.projects.map((project) => (
              <article key={project.id} style={{ '--project-color': project.color || '#42c0aa' } as React.CSSProperties}>
                <i />
                <div>
                  <div className="paperclip-row-title"><strong>{project.name}</strong><StatusPill status={project.status ?? 'planned'} /></div>
                  <p>{truncateText(project.description, 150) || '暂无项目说明'}</p>
                  <small>{project.taskCount ?? 0} 个 Paperclip 任务{project.targetDate ? ` · 目标 ${project.targetDate}` : ''}</small>
                </div>
              </article>
            ))}
            {!data.projects.length ? <EmptyState text="尚未建立项目" /> : null}
          </div>
        </section>
      </div>

      <section className="panel paperclip-org-panel">
        <PanelHeader title="AI 公司组织" hint="治理角色与执行适配器" />
        <OrganizationMap agents={data.agents} />
      </section>

      <section className="panel paperclip-issue-section">
        <div className="paperclip-issue-toolbar">
          <PanelHeader title="公司任务流" hint="Paperclip Issue → Tele-OPC Worker" />
          <label className="paperclip-search">
            <span className="sr-only">搜索 Paperclip Issue</span>
            <input value={issueSearch} onChange={(event) => setIssueSearch(event.target.value)} placeholder="搜索编号、标题或说明" />
          </label>
        </div>
        <div className="paperclip-board">
          {issueColumns.map((column) => {
            const issues = filteredIssues.filter((issue) => column.statuses.includes(issue.status ?? ''));
            return (
              <div className={`paperclip-column tone-${column.tone}`} key={column.id}>
                <header><strong>{column.label}</strong><span>{issues.length}</span></header>
                <div className="paperclip-column-list">
                  {issues.map((issue) => (
                    <button type="button" className="paperclip-issue-card" key={issue.id} onClick={() => setSelectedIssueId(issue.id)}>
                      <div className="paperclip-issue-topline">
                        <span>{issue.identifier ?? issue.id.slice(0, 8)}</span>
                        <PriorityDot priority={issue.priority ?? 'medium'} />
                      </div>
                      <strong>{issue.title}</strong>
                      <p>{truncateText(issue.description, 100) || '暂无任务说明'}</p>
                      <div className="paperclip-issue-foot">
                        <span><Bot size={13} /> {agentName(data.agents, issue.assigneeAgentId)}</span>
                        {issue.teleOpcTask ? <StatusPill status={issue.teleOpcTask.status} /> : <span className="paperclip-not-linked">待接入</span>}
                      </div>
                    </button>
                  ))}
                  {!issues.length ? <EmptyState text="暂无任务" /> : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="paperclip-execution-grid">
        <section className="panel">
          <PanelHeader title="执行闭环" hint="来自真实经营事实" />
          <div className="paperclip-funnel">
            <ExecutionStage label="已接入" value={data.execution.received} tone="neutral" />
            <ChevronRight size={18} />
            <ExecutionStage label="已完成" value={data.execution.done} tone="done" />
            <ChevronRight size={18} />
            <ExecutionStage label="失败 / 阻塞" value={data.execution.failed} tone="danger" />
          </div>
          <div className="paperclip-agent-performance">
            {data.execution.byAgent.map((row) => (
              <div key={row.agent}>
                <span>{row.agent}</span>
                <div><i style={{ width: `${Math.max(6, row.received ? row.done / row.received * 100 : 0)}%` }} /></div>
                <strong>{row.done}/{row.received}</strong>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <PanelHeader title="最近控制面事件" hint="Paperclip → Tele-OPC" />
          <div className="paperclip-event-list">
            {data.execution.recentFacts.slice(0, 8).map((fact) => (
              <article key={fact.id}>
                <Activity size={15} />
                <div><strong>{fact.metricName}</strong><span>{fact.note || fact.issueId}</span></div>
                <small>{formatTime(fact.occurredAt)}</small>
              </article>
            ))}
            {!data.execution.recentFacts.length ? <EmptyState text="尚无控制面事件" /> : null}
          </div>
        </section>
      </div>

      {createOpen ? <CreateIssueDialog data={data} onClose={() => setCreateOpen(false)} onCreated={(issue) => {
        setCreateOpen(false);
        setSelectedIssueId(issue.id);
        refresh();
      }} /> : null}
      {selectedIssueId ? <IssueDetailDrawer issueId={selectedIssueId} agents={data.agents} onClose={() => setSelectedIssueId(null)} onUpdated={refresh} /> : null}
    </div>
  );
}

function GovernanceMetric({ icon: Icon, label, value, hint }: { icon: typeof Target; label: string; value: string | number; hint: string }) {
  return <article className="paperclip-kpi"><div><Icon size={17} /></div><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>;
}

function OrganizationMap({ agents }: { agents: PaperclipAgent[] }) {
  const roots = agents.filter((agent) => !agent.reportsTo || !agents.some((item) => item.id === agent.reportsTo));
  const rendered = new Set<string>();
  const renderAgent = (agent: PaperclipAgent, depth = 0): React.ReactNode => {
    if (rendered.has(agent.id)) return null;
    rendered.add(agent.id);
    const children = agents.filter((item) => item.reportsTo === agent.id);
    return (
      <div className="paperclip-org-branch" key={agent.id} style={{ '--org-depth': depth } as React.CSSProperties}>
        <article className="paperclip-agent-node">
          <div className="paperclip-agent-avatar">{agent.name.slice(0, 1).toUpperCase()}</div>
          <div><strong>{agent.name}</strong><span>{agent.title || agent.role || 'AI Employee'}</span><small>{agent.adapterType} · {agent.status}</small></div>
          <StatusPill status={agent.status ?? 'idle'} />
        </article>
        {children.length ? <div className="paperclip-org-children">{children.map((child) => renderAgent(child, depth + 1))}</div> : null}
      </div>
    );
  };
  return <div className="paperclip-org-map">{roots.map((agent) => renderAgent(agent))}{agents.filter((agent) => !rendered.has(agent.id)).map((agent) => renderAgent(agent))}</div>;
}

function CreateIssueDialog({ data, onClose, onCreated }: { data: PaperclipGovernanceResponse; onClose: () => void; onCreated: (issue: PaperclipIssue) => void }) {
  const [form, setForm] = useState({ title: '', description: '', priority: 'medium', projectId: data.projects[0]?.id ?? '', goalId: data.goals[0]?.id ?? '', assigneeAgentId: '' });
  const selectedAgent = data.agents.find((agent) => agent.id === form.assigneeAgentId);
  const willExecute = selectedAgent?.adapterType === 'http';
  useModalGuard(onClose);
  const mutation = useMutation({
    mutationFn: () => apiPost<{ ok: boolean; issue: PaperclipIssue }>('/api/web/paperclip/issues', {
      ...form,
      projectId: form.projectId || null,
      goalId: form.goalId || null,
      assigneeAgentId: form.assigneeAgentId || null
    }),
    onSuccess: (result) => onCreated(result.issue)
  });
  function submit(event: FormEvent) { event.preventDefault(); if (form.title.trim()) mutation.mutate(); }
  return <div className="paperclip-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="paperclip-dialog" role="dialog" aria-modal="true" aria-labelledby="paperclip-create-title">
      <header><div><span className="eyebrow">NEW COMPANY ISSUE</span><h2 id="paperclip-create-title">创建可执行公司任务</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button></header>
      <form onSubmit={submit}>
        <label><span>任务标题</span><input autoFocus required maxLength={240} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="例如：整理本周重点客户并生成跟进计划" /></label>
        <label><span>验收标准 / 背景</span><textarea rows={5} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="写清楚结果、范围和不允许触碰的边界" /></label>
        <div className="paperclip-form-grid">
          <label><span>优先级</span><select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
          <label><span>执行 Agent</span><select value={form.assigneeAgentId} onChange={(event) => setForm({ ...form, assigneeAgentId: event.target.value })}><option value="">暂不分配</option>{data.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.title || agent.role}</option>)}</select></label>
          <label><span>所属项目</span><select value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })}><option value="">不绑定项目</option>{data.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          <label><span>关联目标</span><select value={form.goalId} onChange={(event) => setForm({ ...form, goalId: event.target.value })}><option value="">不绑定目标</option>{data.goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select></label>
        </div>
        <div className="paperclip-dialog-note"><AlertTriangle size={15} /><span>分配给 HTTP Agent 后会真实进入 Tele-OPC 队列执行。高风险动作仍由 Tele-OPC 审批策略控制。</span></div>
        {mutation.error ? <p className="form-error">{mutation.error instanceof Error ? mutation.error.message : '创建失败'}</p> : null}
        <footer><button type="button" className="ghost-button" onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={mutation.isPending}>{mutation.isPending ? '创建中…' : willExecute ? '创建并执行' : '创建任务'}</button></footer>
      </form>
    </section>
  </div>;
}

function IssueDetailDrawer({ issueId, agents, onClose, onUpdated }: { issueId: string; agents: PaperclipAgent[]; onClose: () => void; onUpdated: () => void }) {
  useModalGuard(onClose);
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['paperclip-issue', issueId], queryFn: () => apiGet<PaperclipIssueDetailResponse>(`/api/web/paperclip/issues/${encodeURIComponent(issueId)}`), refetchInterval: 5_000 });
  const update = useMutation({
    mutationFn: (status: string) => apiPatch(`/api/web/paperclip/issues/${encodeURIComponent(issueId)}`, { status }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['paperclip-issue', issueId] }); onUpdated(); }
  });
  return <div className="paperclip-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="paperclip-drawer" role="dialog" aria-modal="true" aria-label="Paperclip 任务详情">
      <header><span className="eyebrow">ISSUE DETAIL</span><button className="icon-button" type="button" onClick={onClose} aria-label="关闭"><X size={18} /></button></header>
      {query.isLoading ? <LoadingPanel /> : query.isError ? <ErrorPanel error={query.error} /> : query.data ? <>
        <div className="paperclip-detail-title"><span>{query.data.issue.identifier}</span><h2>{query.data.issue.title}</h2><div><StatusPill status={query.data.issue.status ?? 'todo'} /><span className="paperclip-priority-label">{query.data.issue.priority}</span></div></div>
        <p className="paperclip-detail-description">{query.data.issue.description || '暂无任务说明'}</p>
        <div className="paperclip-detail-actions"><button type="button" onClick={() => update.mutate('in_progress')}>标记执行中</button><button type="button" onClick={() => update.mutate('blocked')}>标记阻塞</button><button type="button" onClick={() => update.mutate('done')}>标记完成</button></div>
        <section className="paperclip-detail-block"><h3>执行关联</h3>{query.data.issue.teleOpcTask ? <article className="paperclip-linked-task"><Workflow size={17} /><div><strong>{query.data.issue.teleOpcTask.title}</strong><span>{query.data.issue.teleOpcTask.id} · {query.data.issue.teleOpcTask.ownerAgent}</span><p>{truncateText(query.data.issue.teleOpcTask.result, 220)}</p></div><StatusPill status={query.data.issue.teleOpcTask.status} /></article> : <EmptyState text="尚未生成 Tele-OPC 任务" />}</section>
        <section className="paperclip-detail-block"><h3>Heartbeat Runs</h3><div className="paperclip-run-list">{query.data.runs.map((run) => <article key={run.runId}><GitBranch size={15} /><div><strong>{run.invocationSource} · {run.status}</strong><span>{run.livenessState} · {run.livenessReason}</span></div><small>{formatTime(run.startedAt)}</small></article>)}</div>{!query.data.runs.length ? <EmptyState text="暂无运行记录" /> : null}</section>
        <section className="paperclip-detail-block"><h3>活动记录</h3><div className="paperclip-comment-list">{query.data.comments.map((comment) => <article key={comment.id}><p>{comment.body}</p><small>{formatTime(comment.createdAt)}</small></article>)}</div>{!query.data.comments.length ? <EmptyState text="暂无活动记录" /> : null}</section>
      </> : null}
    </aside>
  </div>;
}


function useModalGuard(onClose: () => void) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);
}

function ExecutionStage({ label, value, tone }: { label: string; value: number; tone: string }) { return <div className={`paperclip-stage tone-${tone}`}><span>{label}</span><strong>{value}</strong></div>; }
function PriorityDot({ priority }: { priority: string }) { return <span className={`paperclip-priority priority-${priority}`} title={`优先级 ${priority}`} />; }
function agentName(agents: PaperclipAgent[], id?: string | null) { return agents.find((agent) => agent.id === id)?.name ?? '未分配'; }
