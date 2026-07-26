import { FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Sparkles, Upload } from 'lucide-react';
import { apiPost } from '../../api';
import { ErrorPanel, PanelHeader } from '../ui';

type ParsedLead = {
  name: string;
  organizationName?: string;
  email?: string;
  phone?: string;
  interest?: string;
  note: string;
  score?: number;
  scoreReason?: string;
};

export function CrmImportStudio() {
  const queryClient = useQueryClient();
  const [source, setSource] = useState('');
  const [raw, setRaw] = useState('');
  const [leads, setLeads] = useState<ParsedLead[]>([]);
  const [selected, setSelected] = useState<Record<number, boolean>>({});

  const parse = useMutation({
    mutationFn: () => apiPost<{ ok: boolean; leads: ParsedLead[]; count: number }>('/api/web/studio/crm-parse', {
      source: source.trim() || undefined,
      raw: raw.trim()
    }),
    onSuccess: (result) => {
      setLeads(result.leads);
      setSelected(Object.fromEntries(result.leads.map((_, i) => [i, true])));
    }
  });

  const commit = useMutation({
    mutationFn: () => apiPost<{ ok: boolean; created: number; failed: unknown[] }>('/api/web/studio/crm-commit', {
      leads: leads
        .filter((_, i) => selected[i])
        .map((l) => ({
          name: l.name,
          organizationName: l.organizationName,
          interest: l.interest,
          note: [l.note, l.email ? `邮箱：${l.email}` : '', l.phone ? `电话：${l.phone}` : '', l.scoreReason ? `评分依据：${l.scoreReason}` : '']
            .filter(Boolean).join(' / ')
        }))
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['overview'] });
    }
  });

  const onParse = (event: FormEvent) => {
    event.preventDefault();
    if (!raw.trim() || parse.isPending) return;
    parse.mutate();
  };

  const selectedCount = Object.values(selected).filter(Boolean).length;

  return (
    <section className="panel studio-panel">
      <PanelHeader title="线索导入工作台" hint="粘贴任意格式的名单，A- 解析、评分后你确认入库" />

      <form className="studio-form" onSubmit={onParse}>
        <label className="full">
          <span>来源</span>
          <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="展会名单 / 社群活动 / 微信聊天记录" />
        </label>
        <label className="full">
          <span>原始内容（任意格式，一行一个人或一段描述都行）</span>
          <textarea rows={8} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="张伟 - 云图科技 CTO，说他们内容团队人力扛不住，预算大概10万…" />
        </label>
        <div className="studio-actions">
          <button type="submit" disabled={parse.isPending || !raw.trim()}>
            <Sparkles size={16} className={parse.isPending ? 'spin' : ''} />
            {parse.isPending ? '解析中…' : '解析并评分'}
          </button>
        </div>
      </form>

      {parse.isError ? <ErrorPanel error={parse.error} /> : null}

      {leads.length ? (
        <div className="import-result">
          <div className="import-result-head">
            <strong>解析出 {leads.length} 条，已选 {selectedCount} 条</strong>
            <button
              type="button"
              className="primary-button"
              onClick={() => commit.mutate()}
              disabled={commit.isPending || !selectedCount || commit.isSuccess}
            >
              <Upload size={15} />
              {commit.isSuccess ? `已导入 ${commit.data?.created} 条` : commit.isPending ? '导入中…' : `导入 ${selectedCount} 条到 CRM`}
            </button>
          </div>

          <div className="import-table">
            {leads.map((lead, index) => (
              <article key={index} className={selected[index] ? 'selected' : ''}>
                <label className="import-check">
                  <input
                    type="checkbox"
                    checked={Boolean(selected[index])}
                    onChange={(e) => setSelected((c) => ({ ...c, [index]: e.target.checked }))}
                  />
                </label>
                <div className="import-main">
                  <div className="import-title">
                    <strong>{lead.name}</strong>
                    {lead.organizationName ? <span>{lead.organizationName}</span> : null}
                    {typeof lead.score === 'number' ? (
                      <em className={lead.score >= 70 ? 'score-hot' : lead.score >= 40 ? 'score-warm' : 'score-cold'}>
                        {lead.score}
                      </em>
                    ) : null}
                  </div>
                  {lead.interest ? <p className="import-interest">{lead.interest}</p> : null}
                  <p className="import-note">{lead.note}</p>
                  {lead.scoreReason ? <small>{lead.scoreReason}</small> : null}
                  {lead.email || lead.phone ? (
                    <small className="import-contact">{[lead.email, lead.phone].filter(Boolean).join(' · ')}</small>
                  ) : null}
                </div>
              </article>
            ))}
          </div>

          {commit.isSuccess ? (
            <p className="import-success"><CheckCircle2 size={15} /> 已写入 CRM，可到 CRM 页面查看跟进任务。</p>
          ) : null}
          {commit.isError ? <ErrorPanel error={commit.error} /> : null}
        </div>
      ) : null}
    </section>
  );
}
