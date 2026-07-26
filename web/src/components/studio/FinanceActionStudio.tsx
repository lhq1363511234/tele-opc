import { FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ShieldCheck, Sparkles } from 'lucide-react';
import { apiPost } from '../../api';
import { formatMoney } from '../../format';
import { ErrorPanel, PanelHeader } from '../ui';

type Proposal = {
  kind: 'transaction' | 'invoice' | 'subscription' | 'payment';
  direction?: 'income' | 'expense';
  amount: number;
  counterparty?: string;
  customerName?: string;
  vendorName?: string;
  category?: string;
  interval?: string;
  dueAt?: string;
  nextBillingAt?: string;
  description: string;
  requiresApproval: boolean;
  riskReason?: string;
  missing?: string[];
};

type Snapshot = {
  currency: string;
  monthlyIncome: number;
  monthlyExpenses: number;
  netCashflow: number;
  openInvoices: number;
  riskAlerts: Array<Record<string, any>>;
} | null;

type ActionResponse = { ok: boolean; currency: string; proposal: Proposal; snapshot: Snapshot };
type CommitResponse = { ok: boolean; mode: string; approval?: { id: string; prompt: string } };

const kindLabel: Record<Proposal['kind'], string> = {
  transaction: '记一笔收支',
  invoice: '给客户开票',
  subscription: '登记订阅',
  payment: '发起付款'
};

const examples = [
  '刚收到明道科技 30000 项目预付款',
  '给外包设计师转 12000 尾款',
  '阿里云每月 1280 云服务器续费',
  '给光年文化开一张 45000 的服务费发票，账期 30 天'
];

export function FinanceActionStudio() {
  const queryClient = useQueryClient();
  const [intent, setIntent] = useState('');
  const [currency, setCurrency] = useState('CNY');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>(null);

  const analyze = useMutation({
    mutationFn: () => apiPost<ActionResponse>('/api/web/studio/finance-action', {
      intent: intent.trim(),
      currency
    }),
    onSuccess: (result) => {
      setProposal(result.proposal);
      setSnapshot(result.snapshot);
      commit.reset();
    }
  });

  const commit = useMutation({
    mutationFn: () => apiPost<CommitResponse>('/api/web/studio/finance-action/commit', {
      currency,
      proposal: {
        kind: proposal!.kind,
        direction: proposal!.direction,
        amount: Number(proposal!.amount),
        counterparty: proposal!.counterparty || undefined,
        customerName: proposal!.customerName || undefined,
        vendorName: proposal!.vendorName || undefined,
        category: proposal!.category || undefined,
        interval: proposal!.interval || undefined,
        dueAt: proposal!.dueAt || undefined,
        nextBillingAt: proposal!.nextBillingAt || undefined,
        description: proposal!.description,
        requiresApproval: proposal!.requiresApproval
      }
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['finance-dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['approvals'] });
      void queryClient.invalidateQueries({ queryKey: ['overview'] });
    }
  });

  const onAnalyze = (event: FormEvent) => {
    event.preventDefault();
    if (!intent.trim() || analyze.isPending) return;
    analyze.mutate();
  };

  function patch(next: Partial<Proposal>) {
    setProposal((current) => (current ? { ...current, ...next } : current));
  }

  const needsApproval = Boolean(proposal && (proposal.requiresApproval || proposal.kind === 'payment'));

  return (
    <section className="panel studio-panel">
      <PanelHeader title="财务动作工作台" hint="一句话说清要做什么，A- 结合现金流判断是否需要审批" />

      <form className="studio-form" onSubmit={onAnalyze}>
        <label className="full">
          <span>要做什么</span>
          <textarea
            rows={3}
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            placeholder="例如：给外包设计师转 12000 尾款"
          />
        </label>
        <label>
          <span>币种</span>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {['CNY', 'USD', 'HKD', 'EUR'].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <div className="studio-actions">
          <button type="submit" disabled={analyze.isPending || !intent.trim()}>
            <Sparkles size={16} className={analyze.isPending ? 'spin' : ''} />
            {analyze.isPending ? '分析中…' : '生成提案'}
          </button>
        </div>
      </form>

      <div className="studio-examples">
        {examples.map((text) => (
          <button key={text} type="button" onClick={() => setIntent(text)}>{text}</button>
        ))}
      </div>

      {analyze.isError ? <ErrorPanel error={analyze.error} /> : null}

      {snapshot ? (
        <div className="finance-summary-row">
          <article><span>本月收入</span><strong className="amount-income">{formatMoney(snapshot.monthlyIncome, snapshot.currency)}</strong></article>
          <article><span>本月支出</span><strong className="amount-expense">{formatMoney(snapshot.monthlyExpenses, snapshot.currency)}</strong></article>
          <article><span>净现金流</span><strong>{formatMoney(snapshot.netCashflow, snapshot.currency)}</strong></article>
          <article><span>未结发票</span><strong>{snapshot.openInvoices}</strong></article>
        </div>
      ) : null}

      {proposal ? (
        <div className="proposal-card">
          <div className="proposal-head">
            <strong>{kindLabel[proposal.kind]}</strong>
            <span className={proposal.direction === 'income' ? 'amount-income' : 'amount-expense'}>
              {proposal.direction === 'income' ? '+' : '-'}{formatMoney(Number(proposal.amount) || 0, currency)}
            </span>
            {needsApproval ? <em className="badge-risk"><ShieldCheck size={13} /> 需审批</em> : <em className="badge-ok">可直接执行</em>}
          </div>

          <div className="proposal-fields">
            <label>
              <span>说明</span>
              <input value={proposal.description} onChange={(e) => patch({ description: e.target.value })} />
            </label>
            <label>
              <span>金额</span>
              <input
                type="number"
                value={proposal.amount}
                onChange={(e) => patch({ amount: Number(e.target.value) })}
              />
            </label>
            <label>
              <span>对方</span>
              <input
                value={proposal.counterparty ?? proposal.customerName ?? proposal.vendorName ?? ''}
                onChange={(e) => patch({
                  counterparty: e.target.value,
                  customerName: proposal.kind === 'invoice' ? e.target.value : proposal.customerName,
                  vendorName: proposal.kind === 'subscription' ? e.target.value : proposal.vendorName
                })}
              />
            </label>
            <label>
              <span>科目</span>
              <input value={proposal.category ?? ''} onChange={(e) => patch({ category: e.target.value })} />
            </label>
          </div>

          {proposal.riskReason ? (
            <p className="proposal-risk"><AlertTriangle size={14} /> {proposal.riskReason}</p>
          ) : null}

          {proposal.missing?.length ? (
            <p className="proposal-missing">还缺：{proposal.missing.join(' · ')}</p>
          ) : null}

          <div className="studio-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => commit.mutate()}
              disabled={commit.isPending || commit.isSuccess || !proposal.description.trim() || !(Number(proposal.amount) > 0)}
            >
              {commit.isSuccess
                ? commit.data?.mode === 'approval' ? '已提交审批' : '已入账'
                : commit.isPending
                  ? '提交中…'
                  : needsApproval ? '提交审批' : '确认入账'}
            </button>
          </div>

          {commit.isSuccess ? (
            <p className="import-success">
              <CheckCircle2 size={15} />
              {commit.data?.mode === 'approval'
                ? '已生成审批单，去 Approvals 页面确认后才会执行。'
                : '已写入财务账本，看板已刷新。'}
            </p>
          ) : null}
          {commit.isError ? <ErrorPanel error={commit.error} /> : null}
        </div>
      ) : null}
    </section>
  );
}
