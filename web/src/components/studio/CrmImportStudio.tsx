import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Globe2, Link2, Radar, Sparkles, Upload } from 'lucide-react';
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
  website?: string;
  region?: string;
  businessLine?: string;
  buyingSignal?: string;
  approach?: string;
  sourceUrl?: string;
  sourceTitle?: string;
};

type DiscoverResponse = {
  ok: boolean;
  icpSummary: string;
  queries: string[];
  searched: number;
  leads: ParsedLead[];
};

const DISCOVER_HINTS = [
  '正在拆解你的客户画像…',
  '正在跑公开搜索…',
  '正在读取候选公司官网…',
  '正在对照画像逐条打分…',
  '快好了，正在整理切入话术…'
];

export function CrmImportStudio() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'paste' | 'discover'>('paste');
  const [source, setSource] = useState('');
  const [raw, setRaw] = useState('');
  const [icp, setIcp] = useState('');
  const [region, setRegion] = useState('');
  const [limit, setLimit] = useState(6);
  const [deepRead, setDeepRead] = useState(true);
  const [leads, setLeads] = useState<ParsedLead[]>([]);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [meta, setMeta] = useState<{ icpSummary: string; queries: string[]; searched: number } | null>(null);
  const [hintIndex, setHintIndex] = useState(0);

  const acceptLeads = (list: ParsedLead[]) => {
    setLeads(list);
    setSelected(Object.fromEntries(list.map((_, i) => [i, true])));
  };

  const parse = useMutation({
    mutationFn: () => apiPost<{ ok: boolean; leads: ParsedLead[]; count: number }>('/api/web/studio/crm-parse', {
      source: source.trim() || undefined,
      raw: raw.trim()
    }),
    onSuccess: (result) => {
      setMeta(null);
      acceptLeads(result.leads);
    }
  });

  const discover = useMutation({
    mutationFn: () => apiPost<DiscoverResponse>('/api/web/studio/crm-discover', {
      icp: icp.trim(),
      region: region.trim(),
      limit,
      deepRead
    }),
    onSuccess: (result) => {
      setMeta({ icpSummary: result.icpSummary, queries: result.queries, searched: result.searched });
      acceptLeads(result.leads);
    }
  });

  useEffect(() => {
    if (!discover.isPending) {
      setHintIndex(0);
      return;
    }
    const timer = window.setInterval(() => {
      setHintIndex((current) => Math.min(current + 1, DISCOVER_HINTS.length - 1));
    }, 22000);
    return () => window.clearInterval(timer);
  }, [discover.isPending]);

  const commit = useMutation({
    mutationFn: () => apiPost<{ ok: boolean; created: number; failed: unknown[] }>('/api/web/studio/crm-commit', {
      leads: leads
        .filter((_, i) => selected[i])
        .map((l) => ({
          name: l.name,
          organizationName: l.organizationName,
          interest: l.interest || l.businessLine,
          note: [
            l.note,
            l.buyingSignal ? `信号：${l.buyingSignal}` : '',
            l.approach ? `切入：${l.approach}` : '',
            l.email ? `邮箱：${l.email}` : '',
            l.phone ? `电话：${l.phone}` : '',
            l.scoreReason ? `评分依据：${l.scoreReason}` : '',
            l.sourceUrl ? `来源：${l.sourceUrl}` : ''
          ].filter(Boolean).join(' / ')
        }))
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['overview'] });
      void queryClient.invalidateQueries({ queryKey: ['crm'] });
    }
  });

  const onParse = (event: FormEvent) => {
    event.preventDefault();
    if (!raw.trim() || parse.isPending) return;
    commit.reset();
    parse.mutate();
  };

  const onDiscover = (event: FormEvent) => {
    event.preventDefault();
    if (icp.trim().length < 4 || discover.isPending) return;
    commit.reset();
    discover.mutate();
  };

  const switchMode = (next: 'paste' | 'discover') => {
    if (next === mode) return;
    setMode(next);
    setLeads([]);
    setSelected({});
    setMeta(null);
    commit.reset();
    parse.reset();
    discover.reset();
  };

  const selectedCount = Object.values(selected).filter(Boolean).length;
  const busy = parse.isPending || discover.isPending;

  return (
    <section className="panel studio-panel">
      <PanelHeader
        title="线索工作台"
        hint={mode === 'paste' ? '粘贴任意格式的名单，A- 解析、评分后你确认入库' : 'A- 去公开网络上找符合画像的真实公司，逐条打分给出切入点'}
      />

      <div className="segmented studio-tabs">
        <button type="button" className={mode === 'paste' ? 'active' : ''} onClick={() => switchMode('paste')}>
          <Upload size={14} /> 粘贴名单
        </button>
        <button type="button" className={mode === 'discover' ? 'active' : ''} onClick={() => switchMode('discover')}>
          <Radar size={14} /> 自动挖线索
        </button>
      </div>

      {mode === 'paste' ? (
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
      ) : (
        <form className="studio-form" onSubmit={onDiscover}>
          <label className="full">
            <span>理想客户画像（越具体越准）</span>
            <textarea
              rows={4}
              value={icp}
              onChange={(e) => setIcp(e.target.value)}
              placeholder="深圳的跨境电商品牌卖家，年 GMV 3000 万以上，正在建独立站或换 ERP，决策人是创始人或运营负责人"
            />
          </label>
          <label>
            <span>地域范围（可留空）</span>
            <input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="深圳 / 长三角 / 东南亚" />
          </label>
          <label>
            <span>目标条数</span>
            <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              {[4, 6, 8, 10, 12].map((n) => <option key={n} value={n}>{n} 条</option>)}
            </select>
          </label>
          <label className="checkbox-row full">
            <input type="checkbox" checked={deepRead} onChange={(e) => setDeepRead(e.target.checked)} />
            <span>深读官网正文（更准，但会慢 1-2 分钟）</span>
          </label>
          <div className="studio-actions">
            <button type="submit" disabled={discover.isPending || icp.trim().length < 4}>
              <Globe2 size={16} className={discover.isPending ? 'spin' : ''} />
              {discover.isPending ? '搜索中…' : '去公开网络挖线索'}
            </button>
            {discover.isPending ? <small className="studio-warn">{DISCOVER_HINTS[hintIndex]}（整个过程约 1-3 分钟，别关页面）</small> : null}
          </div>
        </form>
      )}

      {parse.isError ? <ErrorPanel error={parse.error} /> : null}
      {discover.isError ? <ErrorPanel error={discover.error} /> : null}

      {meta ? (
        <div className="discover-meta">
          <p><strong>画像理解：</strong>{meta.icpSummary}</p>
          <p className="discover-queries">
            <span>检索式：</span>
            {meta.queries.map((q) => <code key={q}>{q}</code>)}
          </p>
          <small>共读取 {meta.searched} 个公开来源</small>
        </div>
      ) : null}

      {leads.length ? (
        <div className="import-result">
          <div className="import-result-head">
            <strong>{mode === 'discover' ? '挖到' : '解析出'} {leads.length} 条，已选 {selectedCount} 条</strong>
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
                    <strong>{lead.organizationName || lead.name}</strong>
                    {lead.organizationName && lead.name !== lead.organizationName ? <span>{lead.name}</span> : null}
                    {lead.region ? <span>{lead.region}</span> : null}
                    {typeof lead.score === 'number' ? (
                      <em className={lead.score >= 70 ? 'score-hot' : lead.score >= 40 ? 'score-warm' : 'score-cold'}>
                        {lead.score}
                      </em>
                    ) : null}
                  </div>
                  {lead.businessLine || lead.interest ? (
                    <p className="import-interest">{lead.businessLine || lead.interest}</p>
                  ) : null}
                  <p className="import-note">{lead.note}</p>
                  {lead.buyingSignal ? <p className="lead-signal"><Sparkles size={12} /> {lead.buyingSignal}</p> : null}
                  {lead.approach ? <p className="lead-approach">切入点：{lead.approach}</p> : null}
                  {lead.scoreReason ? <small>{lead.scoreReason}</small> : null}
                  {lead.email || lead.phone ? (
                    <small className="import-contact">{[lead.email, lead.phone].filter(Boolean).join(' · ')}</small>
                  ) : null}
                  {lead.sourceUrl ? (
                    <a className="lead-source" href={lead.sourceUrl} target="_blank" rel="noreferrer">
                      <Link2 size={12} /> {lead.sourceTitle || lead.sourceUrl}
                    </a>
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
      ) : busy ? null : null}
    </section>
  );
}
