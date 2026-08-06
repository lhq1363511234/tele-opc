import { AlertTriangle, Brain, CheckCircle2, Database, KeyRound, Plus, RefreshCw, ShieldCheck, Sparkles, Sunrise, Target, X, XCircle } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../api';
import { formatTime } from '../format';
import type { ASelfConsoleResponse, ASelfOpcMove, ASelfOpcRun, KnowledgeSource, MemoryCandidate } from '../types';
import { RelationshipDesk } from './RelationshipDesk';
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
  const distillMutation = useMutation({ mutationFn: () => apiPost('/api/web/a-self/distill', {}), onSuccess: refresh });

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
        <button type="button" className="secondary-button" onClick={() => distillMutation.mutate()} disabled={distillMutation.isPending}><Sparkles size={16} className={distillMutation.isPending ? 'spin' : ''} /> 蒸馏人格</button>
        <button type="button" className="primary-button" onClick={() => setMemoryOpen(true)}><Plus size={16} /> 新增记忆</button>
        <button type="button" className="secondary-button" onClick={() => setDecisionOpen(true)}><Plus size={16} /> 记录决策</button>
      </div>
    </section>

    <div className="a-self-kpis">
      <Metric icon={Database} label="记忆条目" value={data.metrics.memories} hint={`${data.metrics.memoryCategories} 类资料`} />
      <Metric icon={Sparkles} label="待审候选" value={data.metrics.pendingMemoryCandidates} hint={`${data.metrics.memoryConflicts} 条冲突`} />
      <Metric icon={Target} label="决策日志" value={data.metrics.decisions} hint={`${data.metrics.decisionRules} 条规则`} />
      <Metric icon={Sunrise} label="OPC 运行" value={data.metrics.opcRuns} hint="早晚经营循环" />
    </div>

    <MemoryCandidateBoard candidates={data.memoryCandidates} sources={data.knowledgeSources} />

    <div className="a-self-grid">
      <section className="panel a-self-profile-card">
        <PanelHeader title="动态人格基因 A_profile" hint="由大模型从 Decision Log 与 Memory 中自动蒸馏提取" />
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

    <RelationshipDesk />

    <section className="panel">
      <PanelHeader title="经营行动台" hint="A- 按你的人格读真实经营数据后给出的可执行动作" />
      {data.opcRuns.length ? <OpcRunBoard runs={data.opcRuns} /> : (
        <EmptyState text="还没有经营循环记录。点上面的「早间扫描」或「晚间复盘」，A- 会读取 CRM、财务、任务和日程，按你的人格给出今天该做什么。" />
      )}
    </section>

    {memoryOpen ? <MemoryDialog onClose={() => setMemoryOpen(false)} onCreated={() => { setMemoryOpen(false); refresh(); }} /> : null}
    {decisionOpen ? <DecisionDialog onClose={() => setDecisionOpen(false)} onCreated={() => { setDecisionOpen(false); refresh(); }} /> : null}
  </div>;
}

function MemoryCandidateBoard({ candidates, sources }: { candidates: MemoryCandidate[]; sources: KnowledgeSource[] }) {
  const queryClient = useQueryClient();
  const actionable = candidates.filter((item) => ['pending', 'conflict'].includes(item.status));
  const review = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve_new' | 'reject' | 'keep_existing' }) =>
      apiPost<{ ok: boolean; candidate: MemoryCandidate; distilled: boolean; distillError?: string }>(
        `/api/web/a-self/memory-candidates/${encodeURIComponent(id)}/review`,
        { action }
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['a-self-console'] })
  });

  return (
    <section className="panel memory-lifecycle-panel">
      <div className="memory-lifecycle-heading">
        <div>
          <span className="eyebrow">MEMORY LIFECYCLE</span>
          <h2>资料不会直接改写人格</h2>
          <p>系统先提取候选、保留来源并检测冲突；只有你批准后，才写入长期记忆并重新蒸馏数字本人。</p>
        </div>
        <div className="memory-lifecycle-stats">
          <span><strong>{sources.length}</strong> 个来源</span>
          <span><strong>{actionable.length}</strong> 条待审</span>
          <span className={actionable.some((item) => item.status === 'conflict') ? 'attention' : ''}>
            <strong>{actionable.filter((item) => item.status === 'conflict').length}</strong> 条冲突
          </span>
        </div>
      </div>

      {actionable.length ? (
        <div className="memory-candidate-list">
          {actionable.slice(0, 12).map((candidate) => (
            <article key={candidate.id} className={candidate.status === 'conflict' ? 'is-conflict' : ''}>
              <header>
                <div>
                  <span className="memory-candidate-source">{candidate.source_channel || candidate.source_type || '资料'} · {candidate.source_title || candidate.source_id}</span>
                  <h3>{candidate.title}</h3>
                </div>
                <span className={`memory-candidate-status ${candidate.status}`}>
                  {candidate.status === 'conflict' ? <AlertTriangle size={13} /> : <Sparkles size={13} />}
                  {candidate.status === 'conflict' ? '发现冲突' : '等待审核'}
                </span>
              </header>
              <p>{truncateText(candidate.content, 300)}</p>
              {candidate.why ? <small><strong>为什么：</strong>{truncateText(candidate.why, 180)}</small> : null}
              {candidate.status === 'conflict' ? (
                <div className="memory-conflict-box">
                  <strong>现有记忆：{candidate.conflict_title || candidate.conflict_with_memory_id}</strong>
                  <p>{truncateText(candidate.conflict_content || '已有相同标题或内容。', 220)}</p>
                </div>
              ) : null}
              <footer>
                <span>{candidate.category} · 置信 {Math.round(Number(candidate.confidence || 0) * 100)}%</span>
                <div>
                  {candidate.status === 'conflict' ? (
                    <button type="button" className="ghost-button" onClick={() => review.mutate({ id: candidate.id, action: 'keep_existing' })} disabled={review.isPending}>
                      保留旧记忆
                    </button>
                  ) : null}
                  <button type="button" className="ghost-button danger" onClick={() => review.mutate({ id: candidate.id, action: 'reject' })} disabled={review.isPending}>
                    <XCircle size={14} /> 拒绝
                  </button>
                  <button type="button" className="primary-button" onClick={() => review.mutate({ id: candidate.id, action: 'approve_new' })} disabled={review.isPending}>
                    <CheckCircle2 size={14} /> {candidate.status === 'conflict' ? '仍批准为新记忆' : '批准并蒸馏'}
                  </button>
                </div>
              </footer>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="当前没有等待审核的记忆候选。你可以在工作台粘贴资料，或直接在飞书上传聊天记录、复盘和项目文件。" />
      )}
      {review.isError ? <ErrorPanel error={review.error} /> : null}
    </section>
  );
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

function OpcRunBoard({ runs }: { runs: ASelfOpcRun[] }) {
  const queryClient = useQueryClient();
  const [committed, setCommitted] = useState<Record<string, string>>({});

  const commit = useMutation({
    mutationFn: (payload: ASelfOpcMove & { key: string }) =>
      apiPost<{ ok: boolean; task: { id: string } }>('/api/web/a-self/commit-move', {
        title: payload.title,
        why: payload.why,
        suggestedAction: payload.suggestedAction,
        personaBasis: payload.personaBasis,
        kind: payload.kind,
        urgency: payload.urgency
      }),
    onSuccess: (result, payload) => {
      setCommitted((c) => ({ ...c, [payload.key]: result.task.id }));
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['overview'] });
    }
  });

  const latest = runs[0];
  const moves = extractMoves(latest);

  return (
    <div className="opc-board">
      <div className="opc-board-head">
        <div>
          <strong>{latest.title}</strong>
          <span>{latest.run_type === 'morning' ? '早间扫描' : latest.run_type === 'evening' ? '晚间复盘' : latest.run_type} · {formatTime(latest.created_at)}</span>
        </div>
        <StatusPill status={latest.status} />
      </div>
      {latest.company_state ? <p className="opc-board-state">{latest.company_state}</p> : null}

      {moves.length ? (
        <div className="opc-move-list">
          {moves.map((move, index) => {
            const key = `${latest.id}_${index}`;
            return (
              <article key={key} className={`opc-move opc-kind-${move.kind}`}>
                <header>
                  <strong>{move.title}</strong>
                  <div>
                    <span className={`opc-kind opc-kind-tag-${move.kind}`}>{kindLabel(move.kind)}</span>
                    <span className={`opc-urgency opc-urgency-${move.urgency}`}>{urgencyLabel(move.urgency)}</span>
                  </div>
                </header>
                <p className="opc-why">{move.why}</p>
                <p className="opc-action">{move.suggestedAction}</p>
                <p className="opc-basis"><Target size={13} /> {move.personaBasis}</p>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => commit.mutate({ ...move, key })}
                  disabled={commit.isPending || Boolean(committed[key])}
                >
                  {committed[key] ? '已建任务' : '转成任务'}
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <pre className="opc-raw">{truncateText(latest.recommendations || latest.market_scan || '暂无内容', 900)}</pre>
      )}

      {runs.length > 1 ? (
        <div className="opc-history">
          <span>历史循环</span>
          {runs.slice(1, 6).map((run) => (
            <article key={run.id}>
              <strong>{truncateText(run.title, 60)}</strong>
              <small>{run.run_type} · {formatTime(run.created_at)}</small>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function extractMoves(run: ASelfOpcRun): ASelfOpcMove[] {
  const raw = (run.metadata as { moves?: unknown } | undefined)?.moves;
  if (!Array.isArray(raw)) return [];
  return raw.filter((m): m is ASelfOpcMove =>
    Boolean(m) && typeof m === 'object' && typeof (m as ASelfOpcMove).title === 'string'
  );
}

function kindLabel(kind: string) {
  if (kind === 'revenue') return '挣钱';
  if (kind === 'relationship') return '关系';
  if (kind === 'risk') return '风险';
  return '效率';
}

function urgencyLabel(urgency: string) {
  if (urgency === 'now') return '立刻';
  if (urgency === 'today') return '今天';
  return '本周';
}
