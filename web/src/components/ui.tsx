import { Activity, CheckCircle2, Search, XCircle, ExternalLink } from 'lucide-react';
import type { AnyRecord } from '../types';

export function truncateText(value: unknown, maxLength: number) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function SimpleList({
  items,
  primary,
  meta,
  href
}: {
  items: AnyRecord[] | string[];
  primary: (item: any) => string;
  meta?: (item: any) => string;
  href?: (item: any) => string | null;
}) {
  if (!items.length) return <EmptyState text="暂无数据" />;
  return (
    <div className="simple-list">
      {items.map((item, index) => {
        const link = href ? href(item) : null;
        const content = (
          <>
            <strong title={primary(item)}>{primary(item)}</strong>
            {meta ? <span>{meta(item)}</span> : null}
            {link ? <ExternalLink className="list-link-icon" size={14} /> : null}
          </>
        );
        return link ? (
          <a href={link} key={typeof item === 'object' && item?.id ? item.id : index} className="list-item-link">
            {content}
          </a>
        ) : (
          <article key={typeof item === 'object' && item?.id ? item.id : index}>
            {content}
          </article>
        );
      })}
    </div>
  );
}

export function PanelHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <header className="panel-header">
      <h2>{title}</h2>
      {hint ? <span>{hint}</span> : null}
    </header>
  );
}

export function StatusPill({ status }: { status: string }) {
  const tone = status.includes('blocked') || status.includes('failed') || status.includes('approval')
    ? 'danger'
    : status.includes('running') || status.includes('queued')
      ? 'active'
      : status.includes('done') || status.includes('approved')
        ? 'done'
        : 'neutral';
  return <span className={`status-pill ${tone}`}>{status}</span>;
}

export function HealthPill({ label, ok }: { label: string; ok?: boolean }) {
  return (
    <span className={`health-pill ${ok ? 'ok' : 'bad'}`}>
      {ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
      {label}
    </span>
  );
}

export function LoadingPanel() {
  return (
    <section className="panel loading-panel">
      <Activity className="spin" size={22} />
      <span>加载控制台数据</span>
    </section>
  );
}

export function ErrorPanel({ error }: { error: unknown }) {
  return (
    <section className="panel error-panel">
      <XCircle size={22} />
      <strong>数据加载失败</strong>
      <span>{error instanceof Error ? error.message : 'unknown error'}</span>
    </section>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="empty-state">
      <Search size={18} />
      <span>{text}</span>
    </div>
  );
}
