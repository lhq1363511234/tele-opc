import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, CheckCircle2, ExternalLink, GitBranch, RefreshCw, Search, ShieldCheck, Sparkles, Workflow, XCircle } from 'lucide-react';
import { apiGet, apiPost } from '../api';
import type {
  MetaAgentAttemptRecord,
  MetaAgentBlueprintRecord,
  MetaAgentComponentRecord,
  MetaAgentDashboardResponse,
  MetaAgentRunRecord
} from '../types';
import { EmptyState, ErrorPanel, LoadingPanel, PanelHeader, StatusPill, truncateText } from './ui';

export function MetaAgentWorkbench() {
  const queryClient = useQueryClient();
  const [requirement, setRequirement] = useState('');
  const [taskInput, setTaskInput] = useState('');
  const dashboard = useQuery({
    queryKey: ['meta-agent-dashboard'],
    queryFn: () => apiGet<MetaAgentDashboardResponse>('/api/web/meta-agent')
  });
  const selected = dashboard.data?.dashboard.selected ?? null;

  const plan = useMutation({
    mutationFn: (value: string) => apiPost<{
      ok: boolean;
      blueprint: MetaAgentBlueprintRecord;
      components: MetaAgentComponentRecord[];
      architectFallback: boolean;
    }>('/api/web/meta-agent/blueprints', { requirement: value }),
    onSuccess: async (result) => {
      setTaskInput((current) => current || requirement);
      await queryClient.invalidateQueries({ queryKey: ['meta-agent-dashboard'] });
    }
  });

  const rediscover = useMutation({
    mutationFn: (id: string) => apiPost(`/api/web/meta-agent/blueprints/${id}/rediscover`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['meta-agent-dashboard'] })
  });

  const run = useMutation({
    mutationFn: ({ id, input }: { id: string; input: string }) => apiPost<{
      ok: boolean;
      run: MetaAgentRunRecord;
      attempts: MetaAgentAttemptRecord[];
    }>(`/api/web/meta-agent/blueprints/${id}/run`, { taskInput: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['meta-agent-dashboard'] })
  });

  const submitPlan = (event: FormEvent) => {
    event.preventDefault();
    const value = requirement.trim();
    if (value.length >= 8) plan.mutate(value);
  };

  const submitRun = (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !taskInput.trim()) return;
    run.mutate({ id: selected.id, input: taskInput.trim() });
  };

  if (dashboard.isLoading) return <LoadingPanel />;
  if (dashboard.isError) return <ErrorPanel error={dashboard.error} />;

  const components = dashboard.data?.dashboard.components ?? [];
  const latestRun = run.data?.run
    ?? dashboard.data?.dashboard.runs.find((item) => item.blueprint_id === selected?.id)
    ?? null;
  const attempts = run.data?.attempts ?? [];

  return (
    <section className="meta-agent-workbench panel">
      <PanelHeader title="元智能体架构师与进化引擎" hint="需求 → 多 Agent 图谱 → GitHub/MCP 搜索 → 独立审计 → 热替换" />
      <div className="meta-agent-safety-note">
        <ShieldCheck size={18} />
        <div>
          <strong>第三方能力默认以只读参考挂载</strong>
          <span>实时搜索和热替换已经启用；第三方代码不会在宿主机直接执行。未来的可执行安装必须先审批并进入隔离运行环境。</span>
        </div>
      </div>

      <form className="meta-agent-plan-form" onSubmit={submitPlan}>
        <label>
          <span>描述任意业务系统</span>
          <textarea
            value={requirement}
            onChange={(event) => setRequirement(event.target.value)}
            rows={4}
            maxLength={8000}
            placeholder="例如：为跨境 SaaS 搭建一个会研究市场、找客户、生成报价，并由独立审计官检查证据与合规的多智能体系统。"
          />
        </label>
        <button className="primary-action" disabled={plan.isPending || requirement.trim().length < 8}>
          {plan.isPending ? <RefreshCw className="spin" size={17} /> : <Sparkles size={17} />}
          {plan.isPending ? '正在设计并实时搜索…' : '生成架构并装配候选'}
        </button>
      </form>
      {plan.isError ? <p className="form-error">架构生成失败：{plan.error.message}</p> : null}

      {selected ? (
        <>
          <BlueprintOverview blueprint={selected} />
          <section className="meta-agent-components">
            <header>
              <div>
                <h3>实时能力候选</h3>
                <span>{components.length} 个 GitHub / MCP 组件已评分并暂存</span>
              </div>
              <button disabled={rediscover.isPending} onClick={() => rediscover.mutate(selected.id)}>
                <Search size={16} />重新搜索
              </button>
            </header>
            <div className="meta-agent-component-grid">
              {components.slice(0, 8).map((component, index) => (
                <ComponentCard key={component.id} component={component} selected={index === 0} />
              ))}
            </div>
          </section>

          <form className="meta-agent-run-form" onSubmit={submitRun}>
            <label>
              <span>交给这套智能体系统的具体任务</span>
              <textarea
                value={taskInput}
                onChange={(event) => setTaskInput(event.target.value)}
                rows={4}
                maxLength={20000}
                placeholder="输入要真正执行和交付的任务。审计不及格时，运行时会切换下一个候选组件并返工。"
              />
            </label>
            <button className="primary-action" disabled={run.isPending || !taskInput.trim()}>
              {run.isPending ? <RefreshCw className="spin" size={17} /> : <Workflow size={17} />}
              {run.isPending ? '生产、审计与热替换中…' : '运行进化工作流'}
            </button>
          </form>
          {run.isError ? <p className="form-error">运行失败：{run.error.message}</p> : null}
          {latestRun ? <RunResult run={latestRun} attempts={attempts} components={components} /> : null}
        </>
      ) : (
        <EmptyState text="还没有元智能体蓝图。输入一个真实业务需求，系统会生成岗位图谱并实时搜索 GitHub 和 MCP Registry。" />
      )}
    </section>
  );
}

function BlueprintOverview({ blueprint }: { blueprint: MetaAgentBlueprintRecord }) {
  const spec = blueprint.blueprint;
  return (
    <section className="meta-agent-blueprint">
      <header>
        <div>
          <span className="eyebrow">ASSEMBLED BLUEPRINT</span>
          <h3>{spec.systemName}</h3>
          <p>{spec.objective}</p>
        </div>
        <StatusPill status={blueprint.status} />
      </header>
      <div className="meta-agent-role-grid">
        <article>
          <Bot size={18} />
          <span>生产</span>
          <strong>{spec.productionAgent.role}</strong>
          <p>{spec.productionAgent.responsibility}</p>
        </article>
        <article>
          <ShieldCheck size={18} />
          <span>独立审计</span>
          <strong>{spec.auditorAgent.role}</strong>
          <p>{spec.auditorAgent.responsibility}</p>
        </article>
        <article>
          <GitBranch size={18} />
          <span>淘汰规则</span>
          <strong>低于 {spec.minimumAuditScore} 分自动换人</strong>
          <p>最多 {spec.maxAttempts} 次尝试；候选按实时评分依次热替换。</p>
        </article>
      </div>
      <div className="meta-agent-criteria">
        <strong>验收标准</strong>
        <div>{spec.successCriteria.map((item) => <span key={item}>{item}</span>)}</div>
      </div>
    </section>
  );
}

function ComponentCard({ component, selected }: { component: MetaAgentComponentRecord; selected: boolean }) {
  return (
    <article className={selected ? 'is-selected' : ''}>
      <header>
        <span>{component.source === 'mcp_registry' ? 'MCP Registry' : component.source === 'github' ? 'GitHub' : 'Local'}</span>
        <strong>{Math.round(component.score)} 分</strong>
      </header>
      <h4>{component.name}</h4>
      <p>{truncateText(component.description, 150)}</p>
      <footer>
        <span>{component.stars ? `★ ${component.stars.toLocaleString()}` : component.version || component.status}</span>
        {component.url ? <a href={component.url} target="_blank" rel="noreferrer">查看来源 <ExternalLink size={13} /></a> : null}
      </footer>
      {selected ? <small><CheckCircle2 size={13} /> 当前首选</small> : null}
    </article>
  );
}

function RunResult({
  run,
  attempts,
  components
}: {
  run: MetaAgentRunRecord;
  attempts: MetaAgentAttemptRecord[];
  components: MetaAgentComponentRecord[];
}) {
  const componentName = components.find((component) => component.id === run.selected_component_id)?.name;
  const score = Number(run.audit_summary?.score ?? 0);
  return (
    <section className={`meta-agent-result ${run.status === 'passed' ? 'is-passed' : 'is-failed'}`}>
      <header>
        <div>
          {run.status === 'passed' ? <CheckCircle2 size={19} /> : <XCircle size={19} />}
          <div>
            <strong>{run.status === 'passed' ? '审计通过，形成最终交付' : '候选已耗尽，保留最高分版本'}</strong>
            <span>{componentName ? `最终组件：${componentName} · ` : ''}审计 {score} 分</span>
          </div>
        </div>
        <StatusPill status={run.status} />
      </header>
      {attempts.length ? (
        <div className="meta-agent-attempts">
          {attempts.map((attempt) => (
            <span key={attempt.id} className={attempt.audit_status === 'passed' ? 'passed' : 'failed'}>
              第 {attempt.attempt_no} 轮 · {attempt.audit_score} 分 · {attempt.audit_status === 'passed' ? '通过' : '换人'}
            </span>
          ))}
        </div>
      ) : null}
      <pre>{run.final_output}</pre>
    </section>
  );
}
