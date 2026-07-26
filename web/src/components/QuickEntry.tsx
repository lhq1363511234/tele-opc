import { FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { apiPost } from '../api';
import { ErrorPanel } from './ui';

export type QuickEntryField = {
  id: string;
  label: string;
  type?: 'text' | 'textarea' | 'select' | 'number' | 'datetime-local';
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  defaultValue?: string;
  required?: boolean;
};

export type QuickEntryConfig = {
  title: string;
  hint: string;
  submitLabel: string;
  endpoint: string;
  fields: QuickEntryField[];
  buildBody: (values: Record<string, string>) => unknown;
  invalidateKeys: string[];
  successText: string;
};

export function QuickEntry({ config }: { config: QuickEntryConfig }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(config.fields.map((f) => [f.id, f.defaultValue ?? f.options?.[0]?.value ?? '']))
  );

  const submit = useMutation({
    mutationFn: () => apiPost<{ ok: boolean }>(config.endpoint, config.buildBody(values)),
    onSuccess: () => {
      config.invalidateKeys.forEach((key) => {
        void queryClient.invalidateQueries({ queryKey: [key] });
      });
      setValues(Object.fromEntries(config.fields.map((f) => [f.id, f.defaultValue ?? f.options?.[0]?.value ?? ''])));
    }
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (submit.isPending) return;
    submit.mutate();
  };

  const missing = config.fields.some((f) => f.required && !values[f.id]?.trim());

  return (
    <section className="panel quick-entry-panel">
      <div className="quick-entry-head">
        <div>
          <strong>{config.title}</strong>
          <span>{config.hint}</span>
        </div>
        <button type="button" className="ghost-button" onClick={() => setOpen((v) => !v)}>
          <Plus size={16} />
          {open ? '收起' : config.submitLabel}
        </button>
      </div>

      {open ? (
        <form className="quick-entry-form" onSubmit={onSubmit}>
          {config.fields.map((field) => (
            <label key={field.id} className={field.type === 'textarea' ? 'full' : undefined}>
              <span>{field.label}</span>
              {field.type === 'textarea' ? (
                <textarea
                  rows={3}
                  value={values[field.id] ?? ''}
                  placeholder={field.placeholder}
                  onChange={(e) => setValues((c) => ({ ...c, [field.id]: e.target.value }))}
                />
              ) : field.type === 'select' ? (
                <select
                  value={values[field.id] ?? ''}
                  onChange={(e) => setValues((c) => ({ ...c, [field.id]: e.target.value }))}
                >
                  {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input
                  type={field.type ?? 'text'}
                  value={values[field.id] ?? ''}
                  placeholder={field.placeholder}
                  onChange={(e) => setValues((c) => ({ ...c, [field.id]: e.target.value }))}
                />
              )}
            </label>
          ))}
          <div className="quick-entry-actions">
            <button type="submit" disabled={submit.isPending || missing}>
              {submit.isPending ? '提交中…' : config.submitLabel}
            </button>
            {submit.isSuccess ? <small className="quick-entry-ok">{config.successText}</small> : null}
          </div>
        </form>
      ) : null}

      {submit.isError ? <ErrorPanel error={submit.error} /> : null}
    </section>
  );
}
