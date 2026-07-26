import { ChangeEvent, DragEvent, FormEvent, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileSpreadsheet, Sparkles, Upload } from 'lucide-react';
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

type SheetInfo = { sheetName: string; rows: number; headers: string[] };

type ParseResponse = {
  ok: boolean;
  currency: string;
  entries: ParsedTxn[];
  summary: { count: number; income: number; expense: number; net: number };
  sheets?: SheetInfo[];
};

const ACCEPT = '.xlsx,.xls,.csv';
const MAX_BYTES = 8 * 1024 * 1024;

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

export function FinanceImportStudio() {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'file' | 'paste'>('file');
  const [source, setSource] = useState('');
  const [currency, setCurrency] = useState('CNY');
  const [raw, setRaw] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [entries, setEntries] = useState<ParsedTxn[]>([]);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [summary, setSummary] = useState<ParseResponse['summary'] | null>(null);
  const [sheets, setSheets] = useState<SheetInfo[]>([]);

  const accept = (result: ParseResponse) => {
    setEntries(result.entries);
    setSummary(result.summary);
    setSheets(result.sheets ?? []);
    setSelected(Object.fromEntries(result.entries.map((_, i) => [i, true])));
  };

  const parse = useMutation({
    mutationFn: () => apiPost<ParseResponse>('/api/web/studio/finance-parse', {
      source: source.trim() || undefined,
      currency,
      raw: raw.trim()
    }),
    onSuccess: accept
  });

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('未选择文件');
      const contentBase64 = await readAsBase64(file);
      return apiPost<ParseResponse>('/api/web/studio/finance-upload', {
        filename: file.name,
        contentBase64,
        currency
      });
    },
    onSuccess: accept
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

  const pickFile = (next: File | null | undefined) => {
    if (!next) return;
    const lower = next.name.toLowerCase();
    if (!['.xlsx', '.xls', '.csv'].some((ext) => lower.endsWith(ext))) {
      setFileError('只支持 .xlsx / .xls / .csv');
      return;
    }
    if (next.size > MAX_BYTES) {
      setFileError('文件超过 8MB，先拆分或另存为 CSV');
      return;
    }
    setFileError('');
    setFile(next);
    commit.reset();
    upload.reset();
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    pickFile(event.dataTransfer.files?.[0]);
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => pickFile(event.target.files?.[0]);

  const onParse = (event: FormEvent) => {
    event.preventDefault();
    if (!raw.trim() || parse.isPending) return;
    commit.reset();
    parse.mutate();
  };

  const onUpload = (event: FormEvent) => {
    event.preventDefault();
    if (!file || upload.isPending) return;
    upload.mutate();
  };

  const switchMode = (next: 'file' | 'paste') => {
    if (next === mode) return;
    setMode(next);
    setEntries([]);
    setSummary(null);
    setSheets([]);
    setSelected({});
    commit.reset();
    parse.reset();
    upload.reset();
  };

  const selectedCount = Object.values(selected).filter(Boolean).length;

  return (
    <section className="panel studio-panel">
      <PanelHeader
        title="账单导入工作台"
        hint={mode === 'file' ? '直接上传银行/支付宝导出的表格，A- 自动识别表头并分类' : '粘贴流水，A- 自动分类，你确认后批量入账'}
      />

      <div className="segmented studio-tabs">
        <button type="button" className={mode === 'file' ? 'active' : ''} onClick={() => switchMode('file')}>
          <FileSpreadsheet size={14} /> 上传表格
        </button>
        <button type="button" className={mode === 'paste' ? 'active' : ''} onClick={() => switchMode('paste')}>
          <Sparkles size={14} /> 粘贴文本
        </button>
      </div>

      {mode === 'file' ? (
        <form className="studio-form" onSubmit={onUpload}>
          <label className="full">
            <span>币种</span>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {['CNY', 'USD', 'HKD', 'EUR'].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label
            className={dragging ? 'full file-drop dragging' : 'full file-drop'}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <input ref={fileInput} type="file" accept={ACCEPT} onChange={onFileChange} hidden />
            <FileSpreadsheet size={22} />
            {file ? (
              <>
                <strong>{file.name}</strong>
                <small>{(file.size / 1024).toFixed(0)} KB · 点击可重新选择</small>
              </>
            ) : (
              <>
                <strong>拖入或点击选择账单文件</strong>
                <small>支持 .xlsx / .xls / .csv，最大 8MB。表头不规范、有合计行也能读。</small>
              </>
            )}
          </label>
          <div className="studio-actions">
            <button type="submit" disabled={upload.isPending || !file}>
              <Upload size={16} className={upload.isPending ? 'spin' : ''} />
              {upload.isPending ? '解析中…' : '上传并解析'}
            </button>
            {fileError ? <small className="studio-warn">{fileError}</small> : null}
          </div>
        </form>
      ) : (
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
      )}

      {parse.isError ? <ErrorPanel error={parse.error} /> : null}
      {upload.isError ? <ErrorPanel error={upload.error} /> : null}

      {sheets.length ? (
        <div className="sheet-meta">
          {sheets.map((sheet) => (
            <span key={sheet.sheetName}>
              <strong>{sheet.sheetName}</strong> · {sheet.rows} 行 · 表头：{sheet.headers.filter(Boolean).slice(0, 6).join(' / ')}
            </span>
          ))}
        </div>
      ) : null}

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
