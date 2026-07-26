import { Brain, CheckCircle2, Database, KeyRound, Plus, RefreshCw, ShieldCheck, Sparkles, Sunrise, Target, X } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../api';
import { formatTime } from '../format';
import type { ASelfConsoleResponse } from '../types';
import { EmptyState, ErrorPanel, LoadingPanel, PanelHeader, StatusPill, truncateText } from './ui';

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

export function ASelfConsole() {
  const queryClient = useQueryClient();
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const query = useQuery({
    queryKey: ['a-self-console'],
    queryFn: () => apiGet<ASelfConsoleResponse>('/api/web/a-self'),
    refetchInterval: 30_000
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['a-self-console'] });
  const morningMutation = useMutation({ mutationFn: () => apiPost('/api/web/a-self/run-morning', {}), onSuccess: refresh });
  const eveningMutation = useMutation({ mutationFn: () => apiPost('/api/web/a-self/run-evening', {}), onSuccess: refresh });

  if (query.isLoading) return <LoadingPanel />;
  if (query.isError) return <ErrorPanel error={query.error} />;
  if (!query.data) return <LoadingPanel />;

  const data = query.data;
  const confidencePercent = Math.round((data.metrics.confidence || 0) * 100);

  return <div className="a-self-console">
    <section className="a-self-hero panel">
      <div>
        <span className="eyebrow"><Brain size={14} /> DIGITAL SELF PROTOTYPE</span>
        <h2>{data.profile?.display_name ?? 'A-'}</h2>
        <p>{data.profile?.mission ?? '先建立个人画像、长期记忆、决策日志和权限边界。'}</p>
        <div className="a-self-hero-meta"><span><i /> {data.phase}</span><span>更新 {formatTime(data.generatedAt)}</span><span>相似度置信 {confidencePercent}%</span></div>
      </div>
      <div className="a-self-hero-actions">
        <button type="button" className="secondary-button" onClick={() => morningMutation.mutate()} disabled={morningMutation.isPending}><Sunrise size={16} className={morningMutation.isPending ? 'spin' : ''} /> 早间扫描</button>
        <button type="button" className="secondary-button" onClick={() => eveningMutation.mutate()} disabled={eveningMutation.isPending}><Brain size={16} className={eveningMutation.isPending ? 'spin' : ''} /> 晚间复盘</button>
        <button type="button" className="primary-button" onClick={() => setMemoryOpen(true)}><Plus size={16} /> 新增记忆</button>
        <button type="button" className="secondary-button" onClick={() => setDecisionOpen(true)}><Plus size={16} /> 记录决策</button>
      </div>
    </section>

    <div className="a-self-kpis">
      <Metric icon={Database} label="记忆条目" value={data.metrics.memories} hint={`${data.metrics.memoryCategories} 类资料`} />
      <Metric icon={Target} label="决策日志" value={data.metrics.decisions} hint={`${data.metrics.decisionRules} 条规则`} />
      <Metric icon={ShieldCheck} label="权限规则" value={data.metrics.permissionRules} hint="Level 1/2/3" />
      <Metric icon={Sunrise} label="OPC 运行" value={data.metrics.opcRuns} hint="早晚经营循环" />
    </div>

    <div className="a-self-grid">
      <section className="panel a-self-profile-card">
        <PanelHeader title="人格基因 A_profile" hint="价值排序、决策原则、沟通风格、禁区" />
        <p>{data.profile?.profile_markdown}</p>
        <div className="a-self-profile-columns">
          <GeneList title="价值排序" items={data.profile?.values_order ?? []} />
          <GeneList title="决策原则" items={data.profile?.decision_principles ?? []} />
          <GeneList title="禁区" items={data.profile?.boundaries ?? []} />
        </div>
      </section>

      <section className="panel">
        <PanelHeader title="30 天生成路线" hint="记忆 → 判断 → 行动 → 经营" />
        <div className="a-self-roadmap">
          {data.roadmap.map((item) => <article key={item.phase}>
            <CheckCircle2 size={16} />
            <div><strong>{item.phase}</strong><p>{item.description}</p></div>
            <StatusPill status={item.status} />
          </article>)}
        </div>
      </section>
    </div>

    <div className="a-self-grid three">
      <section className="panel">
        <PanelHeader title="长期记忆" hint="重点记录为什么" />
        <div className="a-self-list">
          {data.memories.slice(0, 8).map((item) => <article key={item.id}>
            <span>{item.category}</span>
            <strong>{item.title}</strong>
            <p>{truncateText(item.content, 140)}</p>
            {item.why ? <small>为什么：{truncateText(item.why, 120)}</small> : null}
          </article>)}
          {!data.memories.length ? <EmptyState text="还没有个人记忆。先添加人生经历、项目记录、复盘或聊天摘要。" /> : null}
        </div>
      </section>

      <section className="panel">
        <PanelHeader title="Decision Log" hint="复制判断系统" />
        <div className="a-self-list">
          {data.decisions.slice(0, 8).map((decision) => <article key={decision.id}>
            <span>{formatTime(decision.decided_at)} · {decision.impact}</span>
            <strong>{decision.question}</strong>
            <p>选择：{truncateText(decision.choice, 120)}</p>
            {decision.future_rule ? <small>以后规则：{truncateText(decision.future_rule, 140)}</small> : null}
          </article>)}
          {!data.decisions.length ? <EmptyState text="还没有决策日志。每次选择都记录：问题、选择、为什么、结果、以后规则。" /> : null}
        </div>
      </section>

      <section className="panel">
        <PanelHeader title="行动权限" hint="不要一开始给完全自主权" />
        <div className="a-self-permissions">
          {data.permissions.map((rule) => <article key={rule.id} className={`level-${rule.level}`}>
            <div><KeyRound size={15} /><strong>Level {rule.level}</strong><span>{rule.automation_mode}</span></div>
            <h3>{rule.action_type}</h3>
            <p>{rule.description}</p>
            <small>{rule.requires_approval ? '需要确认/审批' : '可自动执行'}</small>
          </article>)}
        </div>
      </section>
    </div>

    <section className="panel">
      <PanelHeader title="OPC 公司环境" hint="早晨市场扫描，晚上经营总结" />
      <div className="a-self-opc-runs">
        {data.opcRuns.map((run) => <article key={run.id}>
          <Sparkles size={16} />
          <div><strong>{run.title}</strong><span>{run.run_type} · {formatTime(run.created_at)}</span><p>{truncateText(run.recommendations || run.market_scan || run.company_state || '暂无内容', 220)}</p></div>
          <StatusPill status={run.status} />
        </article>)}
        {!data.opcRuns.length ? <EmptyState text="还没有 OPC 运行记录。下一步可以创建早晨市场扫描和晚上经营总结自动任务。" /> : null}
      </div>
    </section>

    {memoryOpen ? <MemoryDialog onClose={() => setMemoryOpen(false)} onCreated={() => { setMemoryOpen(false); refresh(); }} /> : null}
    {decisionOpen ? <DecisionDialog onClose={() => setDecisionOpen(false)} onCreated={() => { setDecisionOpen(false); refresh(); }} /> : null}
  </div>;
}

function Metric({ icon: Icon, label, value, hint }: { icon: typeof Brain; label: string; value: number | string; hint: string }) {
  return <article className="a-self-kpi"><div><Icon size={17} /></div><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>;
}

function GeneList({ title, items }: { title: string; items: string[] }) {
  return <div><h3>{title}</h3>{items.map((item) => <p key={item}>{item}</p>)}</div>;
}

function MemoryDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  useModalGuard(onClose);
  const [form, setForm] = useState({ category: '人生经历', title: '', content: '', why: '', tags: '' });
  const mutation = useMutation({
    mutationFn: () => apiPost('/api/web/a-self/memory', { ...form, tags: form.tags.split(/[,，\s]+/).map((tag) => tag.trim()).filter(Boolean) }),
    onSuccess: onCreated
  });
  function submit(event: FormEvent) { event.preventDefault(); if (form.title.trim() && form.content.trim()) mutation.mutate(); }
  return <div className="a-self-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="a-self-dialog" role="dialog" aria-modal="true">
      <header><span className="eyebrow">MEMORY DELTA</span><button className="icon-button" type="button" onClick={onClose}><X size={18} /></button></header>
      <h2>新增 A- 长期记忆</h2>
      <form onSubmit={submit}>
        <label><span>分类</span><select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option>人生经历</option><option>学习笔记</option><option>创业记录</option><option>项目文件</option><option>沟通记录</option><option>决策复盘</option><option>OPC 公司</option></select></label>
        <label><span>标题</span><input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="例如：2025 年为什么做 AI 项目" /></label>
        <label><span>事实 / 经历</span><textarea rows={5} value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} placeholder="发生了什么？" /></label>
        <label><span>为什么 / Δ</span><textarea rows={4} value={form.why} onChange={(event) => setForm({ ...form, why: event.target.value })} placeholder="为什么这么选？失败原因？经验是什么？" /></label>
        <label><span>标签</span><input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="AI, Agent, 获客, 复盘" /></label>
        <footer><button type="button" className="ghost-button" onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={mutation.isPending}>{mutation.isPending ? '写入中…' : '写入记忆'}</button></footer>
      </form>
    </section>
  </div>;
}

function DecisionDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  useModalGuard(onClose);
  const [form, setForm] = useState({ question: '', choice: '', why: '', result: '', review: '', futureRule: '', impact: 'unknown' });
  const mutation = useMutation({ mutationFn: () => apiPost('/api/web/a-self/decisions', form), onSuccess: onCreated });
  function submit(event: FormEvent) { event.preventDefault(); if (form.question.trim() && form.choice.trim() && form.why.trim()) mutation.mutate(); }
  return <div className="a-self-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="a-self-dialog" role="dialog" aria-modal="true">
      <header><span className="eyebrow">DECISION LOG</span><button className="icon-button" type="button" onClick={onClose}><X size={18} /></button></header>
      <h2>记录一次判断</h2>
      <form onSubmit={submit}>
        <label><span>问题</span><input value={form.question} onChange={(event) => setForm({ ...form, question: event.target.value })} placeholder="是否接受某个合作？" /></label>
        <label><span>选择</span><textarea rows={3} value={form.choice} onChange={(event) => setForm({ ...form, choice: event.target.value })} /></label>
        <label><span>为什么</span><textarea rows={4} value={form.why} onChange={(event) => setForm({ ...form, why: event.target.value })} /></label>
        <label><span>结果</span><textarea rows={3} value={form.result} onChange={(event) => setForm({ ...form, result: event.target.value })} /></label>
        <label><span>复盘</span><textarea rows={3} value={form.review} onChange={(event) => setForm({ ...form, review: event.target.value })} /></label>
        <label><span>以后规则</span><input value={form.futureRule} onChange={(event) => setForm({ ...form, futureRule: event.target.value })} placeholder="低质量现金流会消耗长期机会" /></label>
        <label><span>影响级别</span><select value={form.impact} onChange={(event) => setForm({ ...form, impact: event.target.value })}><option value="unknown">unknown</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="strategic">strategic</option></select></label>
        <footer><button type="button" className="ghost-button" onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={mutation.isPending}>{mutation.isPending ? '记录中…' : '记录决策'}</button></footer>
      </form>
    </section>
  </div>;
}
