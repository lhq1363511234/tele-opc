import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Copy, Send, Sparkles } from 'lucide-react';
import { apiGet, apiPost } from '../../api';
import { ErrorPanel, PanelHeader } from '../ui';

type MailDraftResponse = {
  ok: boolean;
  draft: { subject: string; body: string; needsOwnerInput: string[]; reasoning: string };
  personaApplied: boolean;
};

type SmtpStatus = { ok: boolean; smtp: { configured: boolean; from?: string; transportReady?: boolean } };

const tones = ['专业简洁', '温和礼貌', '销售推进', '正式商务', '朋友式直接'];

export function MailStudio() {
  const [recipient, setRecipient] = useState('');
  const [goal, setGoal] = useState('');
  const [tone, setTone] = useState(tones[0]);
  const [context, setContext] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [to, setTo] = useState('');
  const [copied, setCopied] = useState(false);

  const smtp = useQuery({
    queryKey: ['smtp-status'],
    queryFn: () => apiGet<SmtpStatus>('/api/web/mail/smtp-status')
  });

  const draft = useMutation({
    mutationFn: () =>
      apiPost<MailDraftResponse>('/api/web/studio/mail-draft', {
        recipient: recipient.trim(),
        goal: goal.trim(),
        tone,
        context: context.trim() || undefined
      })
  });

  const send = useMutation({
    mutationFn: () => apiPost<{ ok: boolean; messageId?: string }>('/api/web/mail/send', {
      to: to.trim(),
      subject: subject.trim(),
      text: body
    })
  });

  useEffect(() => {
    if (draft.data?.draft) {
      setSubject(draft.data.draft.subject);
      setBody(draft.data.draft.body);
    }
  }, [draft.data]);

  const onGenerate = (event: FormEvent) => {
    event.preventDefault();
    if (!recipient.trim() || !goal.trim() || draft.isPending) return;
    draft.mutate();
  };

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${body}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const smtpReady = Boolean(smtp.data?.smtp?.transportReady);
  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to.trim());

  return (
    <section className="panel studio-panel">
      <PanelHeader
        title="邮件工作台"
        hint={smtpReady ? `SMTP 已就绪 · 发件人 ${smtp.data?.smtp?.from ?? ''}` : 'SMTP 未配置，只能生成草稿'}
      />

      <form className="studio-form" onSubmit={onGenerate}>
        <label>
          <span>收件人是谁</span>
          <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="陈立 / 星海传媒 内容负责人" />
        </label>
        <label>
          <span>语气</span>
          <select value={tone} onChange={(e) => setTone(e.target.value)}>
            {tones.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="full">
          <span>这封邮件要达成什么</span>
          <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="跟进预算对齐进展，争取约一次 15 分钟通话" />
        </label>
        <label className="full">
          <span>背景（越具体，邮件越像你写的）</span>
          <textarea rows={4} value={context} onChange={(e) => setContext(e.target.value)} placeholder="上次沟通内容、对方顾虑、必须提到的点…" />
        </label>
        <div className="studio-actions">
          <button type="submit" disabled={draft.isPending || !recipient.trim() || !goal.trim()}>
            <Sparkles size={16} className={draft.isPending ? 'spin' : ''} />
            {draft.isPending ? '撰写中…' : '用我的语气写'}
          </button>
          {draft.data && !draft.data.personaApplied ? <small className="studio-warn">人格未蒸馏，用的是通用语气</small> : null}
        </div>
      </form>

      {draft.isError ? <ErrorPanel error={draft.error} /> : null}

      {subject || body ? (
        <div className="mail-editor">
          <label>
            <span>主题</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </label>
          <label>
            <span>正文（可直接编辑）</span>
            <textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
          </label>

          {draft.data?.draft?.needsOwnerInput?.length ? (
            <div className="mail-needs-input">
              <AlertTriangle size={15} />
              <div>
                <strong>需要你确认后再发</strong>
                <ul>{draft.data.draft.needsOwnerInput.map((n, i) => <li key={i}>{n}</li>)}</ul>
              </div>
            </div>
          ) : null}

          <div className="mail-send-row">
            <label>
              <span>发送到</span>
              <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@company.com" />
            </label>
            <div className="mail-send-buttons">
              <button type="button" className="secondary-button" onClick={() => void copyAll()}>
                <Copy size={15} /> {copied ? '已复制' : '复制'}
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => send.mutate()}
                disabled={!smtpReady || !emailValid || !subject.trim() || send.isPending || send.isSuccess}
              >
                <Send size={15} />
                {send.isSuccess ? '已发送' : send.isPending ? '发送中…' : '发送邮件'}
              </button>
            </div>
          </div>

          {!smtpReady ? <small className="studio-warn">SMTP 未就绪，无法直接发送，可先复制。</small> : null}
          {send.isError ? <ErrorPanel error={send.error} /> : null}
        </div>
      ) : null}
    </section>
  );
}
