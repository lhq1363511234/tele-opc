import { FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Sparkles, Upload } from 'lucide-react';
import { apiPost } from '../../api';
import { formatMoney } from '../../format';
import { ErrorPanel, PanelHeader } from '../ui';

type ParsedTxn = {
  direction: 'income' | 'expense';
  amount: number;
  counterparty?: string;
  category?: string;
  description: string;
  occurredAt?: string;
  confidence?: number;
};

type ParseResponse = {
  ok: boolean;
  currency: string;
  entries: ParsedTxn[];
  summary: { count: number; income: number; expense: number; net: number };
};

export function FinanceImportStudio() {
  const queryClient = useQueryClient();
  const [source, setSource] = useState('');
  const [currency, setCurrency] = useState('CNY');
  const [raw, setRaw] = useState('');
  const [entries, setEntries] = useState<ParsedTxn[]>([]);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [summary, setSummary] = useState<ParseResponse['summary'] | null>(null);

  const parse = useMutation({
    mutationFn: () => apiPost<ParseResponse>('/api/web/studio/finance-parse', {
      source: source.trim() || undefined,
      currency,
      raw: raw.trim()
    }),
    onSuccess: (result) => {
      setEntries(result.entries);
      setSummary(result.summary);
      setSelected(Object.fromEntries(result.entries.map((_, i) => [i, true])));
    }
  });

  const commit = useMutation({
    mutationFn: () => apiPost<{ ok: boolean; created: number }>('/api/web/studio/finance-commit', {
      currency,
      entries: entries.filter((_, i) => selected[i]).map((e) => ({
        direction: e.direction,
        amount: Number(e.amount),
        counterparty: e.counterparty,
        category: e.category,
        description: e.description
      }))
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['finance-dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['overview'] });
      void queryClient.invalidateQueries({ queryKey: ['analytics'] });
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
      <PanelHeader title="账单导入工作台" hint="粘贴流水，A- 自动分类，你确认后批量入账" />

      <form className="studio-form" onSubmit={onParse}>
        <label>
          <span>来源</span>
          <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="银行流水 / 支付宝账单 / 订阅账单" />
        </label>
        <label>
          <span>币种</span>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {['CNY', 'USD', 'HKD', 'EUR'].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="full">
          <span>流水内容（直接从账单复制粘贴）</span>
          <textarea rows={8} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="2026-07-02 支付宝-阿里云 -1280.00 云服务器续费…" />
        </label>
        <div className="studio-actions">
          <button type="submit" disabled={parse.isPending || !raw.trim()}>
            <Sparkles size={16} className={parse.isPending ? 'spin' : ''} />
            {parse.isPending ? '解析中…' : '解析并分类'}
          </button>
        </div>
      </form>

      {parse.isError ? <ErrorPanel error={parse.error} /> : null}

      {entries.length && summary ? (
        <div className="import-result">
          <div className="finance-summary-row">
            <article><span>笔数</span><strong>{summary.count}</strong></article>
            <article><span>收入</span><strong className="amount-income">{formatMoney(summary.income, currency)}</strong></article>
            <article><span>支出</span><strong className="amount-expense">{formatMoney(summary.expense, currency)}</strong></article>
            <article><span>净额</span><strong>{formatMoney(summary.net, currency)}</strong></article>
          </div>

          <div className="import-result-head">
            <strong>已选 {selectedCount} 条</strong>
            <button
              type="button"
              className="primary-button"
              onClick={() => commit.mutate()}
              disabled={commit.isPending || !selectedCount || commit.isSuccess}
            >
              <Upload size={15} />
              {commit.isSuccess ? `已入账 ${commit.data?.created} 条` : commit.isPending ? '入账中…' : `入账 ${selectedCount} 条`}
            </button>
          </div>

          <div className="import-table finance-table">
            {entries.map((entry, index) => (
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
                    <strong className={entry.direction === 'income' ? 'amount-income' : 'amount-expense'}>
                      {entry.direction === 'income' ? '+' : '-'}{formatMoney(entry.amount, currency)}
                    </strong>
                    {entry.category ? <span>{entry.category}</span> : null}
                    {typeof entry.confidence === 'number' && entry.confidence < 0.8 ? (
                      <em className="score-cold">待核对</em>
                    ) : null}
                  </div>
                  <p className="import-note">{entry.description}</p>
                  <small className="import-contact">
                    {[entry.counterparty, entry.occurredAt].filter(Boolean).join(' · ')}
                  </small>
                </div>
              </article>
            ))}
          </div>

          {commit.isSuccess ? (
            <p className="import-success"><CheckCircle2 size={15} /> 已入账，财务看板已更新。</p>
          ) : null}
          {commit.isError ? <ErrorPanel error={commit.error} /> : null}
        </div>
      ) : null}
    </section>
  );
}
