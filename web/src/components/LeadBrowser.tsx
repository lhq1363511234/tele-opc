import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Building2, ChevronLeft, ChevronRight, Copy, Search } from 'lucide-react';
import { apiGet } from '../api';
import { EmptyState, ErrorPanel, LoadingPanel, PanelHeader } from './ui';

type LeadRow = {
  id: string;
  name: string;
  organization_name?: string | null;
  notes?: string | null;
  created_at: string;
};

type LeadListResponse = {
  ok: boolean;
  total: number;
  limit: number;
  offset: number;
  leads: LeadRow[];
};

const PAGE_SIZE = 25;

/** Pulls the score out of the note line the campaign writer produced. */
function scoreOf(notes: string | null | undefined) {
  const match = notes?.match(/评分依据（(\d{1,3})）/);
  return match ? Number(match[1]) : null;
}

function fieldOf(notes: string | null | undefined, label: string) {
  const match = notes?.match(new RegExp(`${label}：([^\\n]+)`));
  return match ? match[1].trim() : '';
}

export function LeadBrowser() {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['crm-lead-list', applied, page],
    queryFn: () =>
      apiGet<LeadListResponse>(
        `/api/web/crm/lead-list?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}${applied ? `&q=${encodeURIComponent(applied)}` : ''}`
      ),
    placeholderData: keepPreviousData
  });

  const total = query.data?.total ?? 0;
  const leads = query.data?.leads ?? [];
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  const copyOutreach = async (lead: LeadRow) => {
    const text = fieldOf(lead.notes, '触达话术');
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopiedId(lead.id);
    window.setTimeout(() => setCopiedId((current) => (current === lead.id ? null : current)), 1600);
  };

  return (
    <section className="panel">
      <PanelHeader title="全部线索" hint={`contacts.status = lead · 共 ${total} 条`} />

      <form
        className="lead-search"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(0);
          setApplied(search.trim());
        }}
      >
        <Search size={15} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜公司名、联系人或备注内容" />
        <button type="submit">搜索</button>
        {applied ? (
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              setSearch('');
              setApplied('');
              setPage(0);
            }}
          >
            清除
          </button>
        ) : null}
      </form>

      {query.isLoading ? <LoadingPanel /> : null}
      {query.isError ? <ErrorPanel error={query.error} /> : null}
      {!query.isLoading && !leads.length ? <EmptyState text={applied ? '没有匹配的线索' : '还没有线索'} /> : null}

      <div className="lead-list">
        {leads.map((lead) => {
          const score = scoreOf(lead.notes);
          const outreach = fieldOf(lead.notes, '触达话术');
          const signal = fieldOf(lead.notes, '信号');
          const source = fieldOf(lead.notes, '来源');
          const expanded = openId === lead.id;

          return (
            <article key={lead.id} className={expanded ? 'lead-row expanded' : 'lead-row'}>
              <button type="button" className="lead-row-head" onClick={() => setOpenId(expanded ? null : lead.id)}>
                <Building2 size={15} />
                <div className="lead-row-title">
                  <strong>{lead.organization_name || lead.name}</strong>
                  <span>{lead.name}</span>
                </div>
                {score !== null ? (
                  <em className={score >= 70 ? 'score-hot' : score >= 40 ? 'score-warm' : 'score-cold'}>{score}</em>
                ) : null}
              </button>

              {expanded ? (
                <div className="lead-row-body">
                  {signal ? <p className="lead-signal">{signal}</p> : null}
                  {outreach ? (
                    <div className="lead-outreach">
                      <p>{outreach}</p>
                      <button type="button" className="ghost-button" onClick={() => void copyOutreach(lead)}>
                        <Copy size={13} /> {copiedId === lead.id ? '已复制' : '复制话术'}
                      </button>
                    </div>
                  ) : null}
                  <pre className="lead-notes">{lead.notes}</pre>
                  {source ? (
                    <a className="lead-source" href={source} target="_blank" rel="noreferrer">
                      {source}
                    </a>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      {total > PAGE_SIZE ? (
        <div className="lead-pager">
          <button type="button" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            <ChevronLeft size={15} /> 上一页
          </button>
          <span>
            {page + 1} / {maxPage + 1}
          </span>
          <button type="button" disabled={page >= maxPage} onClick={() => setPage((p) => Math.min(maxPage, p + 1))}>
            下一页 <ChevronRight size={15} />
          </button>
        </div>
      ) : null}
    </section>
  );
}
