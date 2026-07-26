import { FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BookOpen, CheckCircle2, Sparkles } from 'lucide-react';
import { apiPost } from '../../api';
import { ErrorPanel, PanelHeader } from '../ui';

type ParsedKnowledge = {
  category: string;
  title: string;
  content: string;
  why?: string;
  tags?: string[];
  confidence?: number;
};

type ParseResponse = { ok: boolean; items: ParsedKnowledge[]; count: number };

const categories = [
  { value: 'pricing', label: '定价规则' },
  { value: 'sop', label: 'SOP / 流程' },
  { value: 'contract', label: '合同条款' },
  { value: 'industry', label: '行业认知' },
  { value: 'preference', label: '个人偏好' },
  { value: 'sales', label: '销售话术' },
  { value: 'lesson', label: '踩坑教训' }
];

export function KnowledgeStudio() {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState('pricing');
  const [source, setSource] = useState('');
  const [raw, setRaw] = useState('');
  const [items, setItems] = useState<ParsedKnowledge[]>([]);
  const [selected, setSelected] = useState<Record<number, boolean>>({});

  const parse = useMutation({
    mutationFn: () => apiPost<ParseResponse>('/api/web/studio/knowledge-parse', {
      category,
      source: source.trim() || undefined,
      raw: raw.trim()
    }),
    onSuccess: (result) => {
      setItems(result.items);
      setSelected(Object.fromEntries(result.items.map((_, i) => [i, true])));
      commit.reset();
    }
  });

  const commit = useMutation({
    mutationFn: () => apiPost<{ ok: boolean; created: number }>('/api/web/studio/knowledge-commit', {
      source: source.trim() || undefined,
      items: items.filter((_, i) => selected[i]).map((item) => ({
        category: item.category || category,
        title: item.title,
        content: item.content,
        why: item.why || undefined,
        tags: item.tags ?? [],
        confidence: item.confidence
      }))
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['a-self'] });
      void queryClient.invalidateQueries({ queryKey: ['overview'] });
    }
  });

  const onParse = (event: FormEvent) => {
    event.preventDefault();
    if (!raw.trim() || parse.isPending) return;
    parse.mutate();
  };

  function patchItem(index: number, next: Partial<ParsedKnowledge>) {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...next } : item)));
  }

  const selectedCount = Object.values(selected).filter(Boolean).length;

  return (
    <section className="panel studio-panel">
      <PanelHeader title="知识蒸馏工作台" hint="粘贴原始资料，A- 提取成带「为什么」的记忆条目" />
      <p className="studio-hint">
        重点不是保存资料，而是保存判断依据。会议纪要、微信聊天、复盘笔记都可以直接粘进来。
      </p>

      <form className="studio-form" onSubmit={onParse}>
        <label>
          <span>归类</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        <label>
          <span>来源</span>
          <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="定价会 / 客户复盘 / 微信记录" />
        </label>
        <label className="full">
          <span>原始材料</span>
          <textarea
            rows={9}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="例如：我们的实施服务报价从 6 万起。低于 6 万基本都亏，因为交付要投入至少 3 周人力……"
          />
        </label>
        <div className="studio-actions">
          <button type="submit" disabled={parse.isPending || !raw.trim()}>
            <Sparkles size={16} className={parse.isPending ? 'spin' : ''} />
            {parse.isPending ? '蒸馏中…' : '蒸馏成知识条目'}
          </button>
        </div>
      </form>

      {parse.isError ? <ErrorPanel error={parse.error} /> : null}

      {items.length ? (
        <div className="import-result">
          <div className="import-result-head">
            <strong>提取出 {items.length} 条，已选 {selectedCount} 条</strong>
            <button
              type="button"
              className="primary-button"
              onClick={() => commit.mutate()}
              disabled={commit.isPending || !selectedCount || commit.isSuccess}
            >
              <BookOpen size={15} />
              {commit.isSuccess ? `已入库 ${commit.data?.created} 条` : commit.isPending ? '入库中…' : `存入记忆库 ${selectedCount} 条`}
            </button>
          </div>

          <div className="import-table knowledge-table">
            {items.map((item, index) => (
              <article key={index} className={selected[index] ? 'selected' : ''}>
                <label className="import-check">
                  <input
                    type="checkbox"
                    checked={Boolean(selected[index])}
                    onChange={(e) => setSelected((c) => ({ ...c, [index]: e.target.checked }))}
                  />
                </label>
                <div className="import-main">
                  <input
                    className="knowledge-title-input"
                    value={item.title}
                    onChange={(e) => patchItem(index, { title: e.target.value })}
                  />
                  <textarea
                    className="knowledge-content-input"
                    rows={3}
                    value={item.content}
                    onChange={(e) => patchItem(index, { content: e.target.value })}
                  />
                  {item.why ? <p className="knowledge-why"><span>为什么</span>{item.why}</p> : null}
                  <small className="import-contact">
                    {[item.category, ...(item.tags ?? [])].filter(Boolean).join(' · ')}
                    {typeof item.confidence === 'number' ? ` · 置信 ${Math.round(item.confidence * 100)}%` : ''}
                  </small>
                </div>
              </article>
            ))}
          </div>

          {commit.isSuccess ? (
            <p className="import-success"><CheckCircle2 size={15} /> 已存入记忆库，A- 的判断依据又多了一层。</p>
          ) : null}
          {commit.isError ? <ErrorPanel error={commit.error} /> : null}
        </div>
      ) : null}
    </section>
  );
}
