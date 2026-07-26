import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, HeartHandshake, RefreshCw, Send } from 'lucide-react';
import { apiGet, apiPost } from '../api';
import { EmptyState, ErrorPanel, LoadingPanel, PanelHeader } from './ui';

type RelationshipPlay = {
  contactId: string;
  contactName: string;
  organization: string | null;
  relationshipState: string;
  risk: 'low' | 'medium' | 'high';
  intent: string;
  reasoning: string;
  personaBasis: string;
  nextAction: string;
  channel: string;
  draftMessage: string;
};

type RelationshipResponse = {
  ok: boolean;
  plays: RelationshipPlay[];
  usedLlm: boolean;
  personaAvailable: boolean;
};

const intentLabels: Record<string, string> = {
  revive: '唤醒',
  advance: '推进',
  nurture: '培育',
  close: '促成',
  protect: '保关系'
};

export function RelationshipDesk() {
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [committed, setCommitted] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['a-self-relationships'],
    queryFn: () => apiGet<RelationshipResponse>('/api/web/a-self/relationships?limit=6'),
    enabled,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000
  });

  const commit = useMutation({
    mutationFn: (play: RelationshipPlay) =>
      apiPost<{ ok: boolean; task: { id: string } }>('/api/web/a-self/commit-move', {
        title: `${intentLabels[play.intent] ?? play.intent}：${play.contactName}`,
        why: play.reasoning,
        suggestedAction: play.nextAction,
        personaBasis: play.personaBasis,
        kind: 'relationship',
        urgency: play.risk === 'high' ? 'now' : 'today',
        contactId: play.contactId,
        channel: play.channel,
        draftMessage: play.draftMessage
      }),
    onSuccess: (result, play) => {
      setCommitted((c) => ({ ...c, [play.contactId]: result.task.id }));
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['overview'] });
    }
  });

  const copyDraft = async (play: RelationshipPlay) => {
    try {
      await navigator.clipboard.writeText(play.draftMessage);
      setCopied(play.contactId);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  };

  return (
    <section className="panel relationship-desk">
      <PanelHeader
        title="人际关系作战台"
        hint={query.data?.usedLlm ? '由你的人格模型分析真实客户数据生成' : '点击生成，A- 会按你的人格逐个分析'}
      />

      <div className="relationship-desk-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            if (!enabled) setEnabled(true);
            else void query.refetch();
          }}
          disabled={query.isFetching}
        >
          <RefreshCw size={16} className={query.isFetching ? 'spin' : ''} />
          {query.isFetching ? '分析中…' : enabled ? '重新分析' : '让 A- 分析关系'}
        </button>
        {query.data && !query.data.personaAvailable ? (
          <small className="relationship-warn">人格未蒸馏，建议先点「蒸馏人格」</small>
        ) : null}
        {query.data && query.data.personaAvailable && !query.data.usedLlm ? (
          <small className="relationship-warn">模型不可用，当前是基础规则结果</small>
        ) : null}
      </div>

      {query.isFetching && !query.data ? <LoadingPanel /> : null}
      {query.isError ? <ErrorPanel error={query.error} /> : null}

      {query.data?.plays?.length ? (
        <div className="relationship-play-list">
          {query.data.plays.map((play) => (
            <article key={play.contactId} className={`relationship-play risk-${play.risk}`}>
              <header>
                <div>
                  <strong>{play.contactName}</strong>
                  {play.organization ? <span className="rel-org">{play.organization}</span> : null}
                </div>
                <div className="rel-tags">
                  <span className={`rel-intent rel-${play.intent}`}>{intentLabels[play.intent] ?? play.intent}</span>
                  <span className={`rel-risk rel-risk-${play.risk}`}>{play.risk}</span>
                  <span className="rel-channel">{play.channel}</span>
                </div>
              </header>

              <p className="rel-state">{play.relationshipState}</p>
              <p className="rel-reason">{play.reasoning}</p>
              <p className="rel-basis"><HeartHandshake size={13} /> {play.personaBasis}</p>

              {play.draftMessage ? (
                <div className="rel-draft">
                  <span>拟发送（你的语气）</span>
                  <p>{play.draftMessage}</p>
                </div>
              ) : null}

              <footer>
                <strong className="rel-next">{play.nextAction}</strong>
                <div className="rel-buttons">
                  {play.draftMessage ? (
                    <button type="button" className="secondary-button" onClick={() => void copyDraft(play)}>
                      <Copy size={14} /> {copied === play.contactId ? '已复制' : '复制草稿'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => commit.mutate(play)}
                    disabled={commit.isPending || Boolean(committed[play.contactId])}
                  >
                    <Send size={14} />
                    {committed[play.contactId] ? '已建任务' : '转成任务'}
                  </button>
                </div>
              </footer>
            </article>
          ))}
        </div>
      ) : null}

      {enabled && !query.isFetching && query.data && !query.data.plays.length ? (
        <EmptyState text="还没有可分析的联系人。先在 CRM 录入真实客户，A- 才能替你判断关系。" />
      ) : null}

      {!enabled ? (
        <EmptyState text="A- 会读取每个联系人的逾期跟进、机会阶段和互动记录，按你的价值排序决定先联系谁、怎么说。" />
      ) : null}
    </section>
  );
}
