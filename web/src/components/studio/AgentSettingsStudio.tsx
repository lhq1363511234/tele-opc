import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Cpu, Save, ShieldCheck } from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '../../api';
import { ErrorPanel, PanelHeader } from '../ui';

type PermissionRule = {
  id: string;
  level: number;
  action_type: string;
  automation_mode: string;
  requires_approval: boolean;
  description: string;
  examples: string[];
};

type SettingsResponse = {
  ok: boolean;
  ai: {
    provider: string;
    model: string;
    agentEnabled: boolean;
    baseUrlConfigured: boolean;
    apiKeyConfigured: boolean;
  };
  persona: {
    displayName: string;
    status: string;
    confidence: number;
    boundaries: string[];
    valuesOrder: string[];
  } | null;
  permissions: PermissionRule[];
  preferences: Array<{ id: string; content: string; importance: string; scope: string; createdAt: string }>;
};

const modes: Array<{ value: string; label: string; hint: string }> = [
  { value: 'auto', label: '全自动', hint: '直接执行，不打扰你' },
  { value: 'reviewable_auto', label: '先做后报', hint: '执行后留痕，可回溯' },
  { value: 'semi_auto', label: '出草稿等确认', hint: '生成结果，你点了才发出去' },
  { value: 'human_required', label: '必须本人', hint: 'A- 只能分析和起草' }
];

const scopes: Array<{ value: string; label: string; placeholder: string }> = [
  { value: 'model', label: '模型偏好', placeholder: '例如：写代码用 Claude，写商务内容用当前默认模型' },
  { value: 'communication', label: '沟通风格', placeholder: '例如：对客户邮件不超过 5 句，不写客套开场' },
  { value: 'skill', label: 'Skill 偏好', placeholder: '例如：PPT 用融资路演风格，先讲问题再讲方案' },
  { value: 'operating', label: '经营原则', placeholder: '例如：单笔支出超过 1 万必须先看现金流' }
];

const levelLabel: Record<number, string> = { 1: 'Level 1 · 自动', 2: 'Level 2 · 半自动', 3: 'Level 3 · 必须本人' };

export function AgentSettingsStudio() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['agent-settings'],
    queryFn: () => apiGet<SettingsResponse>('/api/web/studio/agent-settings')
  });

  const [scope, setScope] = useState('operating');
  const [content, setContent] = useState('');
  const [importance, setImportance] = useState('normal');

  const updateRule = useMutation({
    mutationFn: (params: { id: string; automationMode: string }) =>
      apiPatch<{ ok: boolean }>(`/api/web/studio/agent-settings/permissions/${params.id}`, {
        automationMode: params.automationMode,
        requiresApproval: params.automationMode === 'semi_auto' || params.automationMode === 'human_required'
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agent-settings'] });
      void queryClient.invalidateQueries({ queryKey: ['a-self'] });
    }
  });

  const addPreference = useMutation({
    mutationFn: () => apiPost<{ ok: boolean }>('/api/web/studio/agent-settings/preferences', {
      scope,
      content: content.trim(),
      importance
    }),
    onSuccess: () => {
      setContent('');
      void queryClient.invalidateQueries({ queryKey: ['agent-settings'] });
    }
  });

  const onAdd = (event: FormEvent) => {
    event.preventDefault();
    if (!content.trim() || addPreference.isPending) return;
    addPreference.mutate();
  };

  if (query.isError) return <ErrorPanel error={query.error} />;
  const data = query.data;
  const activeScope = scopes.find((s) => s.value === scope);

  return (
    <section className="panel studio-panel">
      <PanelHeader title="A- 行为设置" hint="模型状态、授权边界、长期偏好，改了立刻对所有 Agent 生效" />

      {data ? (
        <>
          <div className="finance-summary-row">
            <article><span>推理模型</span><strong>{data.ai.model}</strong></article>
            <article>
              <span>通道</span>
              <strong className={data.ai.apiKeyConfigured && data.ai.baseUrlConfigured ? 'amount-income' : 'amount-expense'}>
                {data.ai.apiKeyConfigured && data.ai.baseUrlConfigured ? '已连通' : '未配置'}
              </strong>
            </article>
            <article><span>Agent</span><strong>{data.ai.agentEnabled ? '已开启' : '已关闭'}</strong></article>
            <article>
              <span>人格置信度</span>
              <strong>{data.persona ? `${Math.round(data.persona.confidence * 100)}%` : '未蒸馏'}</strong>
            </article>
          </div>

          <div className="settings-block">
            <h4><ShieldCheck size={15} /> 授权边界</h4>
            <p className="studio-hint">决定 A- 在每类动作上能走多远。越靠下越危险，Level 3 永远需要你本人确认。</p>
            <div className="permission-list">
              {data.permissions.map((rule) => (
                <article key={rule.id} className={`permission-row level-${rule.level}`}>
                  <div className="permission-meta">
                    <strong>{rule.action_type}</strong>
                    <em>{levelLabel[rule.level] ?? `Level ${rule.level}`}</em>
                    <p>{rule.description}</p>
                    {rule.examples?.length ? <small>{rule.examples.join(' · ')}</small> : null}
                  </div>
                  <div className="permission-control">
                    <select
                      value={rule.automation_mode}
                      disabled={rule.level >= 3 || updateRule.isPending}
                      onChange={(e) => updateRule.mutate({ id: rule.id, automationMode: e.target.value })}
                    >
                      {modes.map((mode) => (
                        <option key={mode.value} value={mode.value}>{mode.label}</option>
                      ))}
                    </select>
                    <small>
                      {rule.level >= 3
                        ? '不可放开'
                        : modes.find((m) => m.value === rule.automation_mode)?.hint ?? ''}
                    </small>
                  </div>
                </article>
              ))}
            </div>
            {updateRule.isError ? <ErrorPanel error={updateRule.error} /> : null}
          </div>

          <div className="settings-block">
            <h4><Cpu size={15} /> 长期偏好</h4>
            <p className="studio-hint">写进去的规则会进入每次 Agent 的上下文，不是摆设。</p>
            <form className="studio-form" onSubmit={onAdd}>
              <label>
                <span>类别</span>
                <select value={scope} onChange={(e) => setScope(e.target.value)}>
                  {scopes.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </label>
              <label>
                <span>强度</span>
                <select value={importance} onChange={(e) => setImportance(e.target.value)}>
                  <option value="normal">建议</option>
                  <option value="high">重要</option>
                  <option value="critical">硬约束</option>
                </select>
              </label>
              <label className="full">
                <span>规则</span>
                <textarea
                  rows={3}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={activeScope?.placeholder}
                />
              </label>
              <div className="studio-actions">
                <button type="submit" disabled={addPreference.isPending || !content.trim()}>
                  <Save size={15} />
                  {addPreference.isPending ? '保存中…' : '写入偏好'}
                </button>
              </div>
            </form>
            {addPreference.isSuccess ? (
              <p className="import-success"><CheckCircle2 size={15} /> 已生效，下次 Agent 运行就会读到。</p>
            ) : null}
            {addPreference.isError ? <ErrorPanel error={addPreference.error} /> : null}

            <div className="preference-list">
              {data.preferences.length ? data.preferences.map((item) => (
                <article key={item.id}>
                  <span className={`pref-badge pref-${item.importance}`}>{item.scope}</span>
                  <p>{item.content}</p>
                </article>
              )) : <p className="studio-hint">还没有写入任何偏好。</p>}
            </div>
          </div>

          {data.persona?.boundaries.length ? (
            <div className="settings-block">
              <h4>不可越界（来自人格档案）</h4>
              <ul className="boundary-list">
                {data.persona.boundaries.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </div>
          ) : null}
        </>
      ) : (
        <p className="studio-hint">加载中…</p>
      )}
    </section>
  );
}
