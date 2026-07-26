import { FormEvent, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BarChart3, Download, ExternalLink, Presentation, Sparkles, Table2 } from 'lucide-react';
import { apiDownload, apiGet, apiPost } from '../../api';
import { ErrorPanel, PanelHeader } from '../ui';

type DeckSlide = {
  title: string;
  subtitle?: string;
  bullets?: string[];
  metrics?: Array<{ label: string; value: string; delta?: string }>;
  chart?: { type: string; categories: string[]; series: Array<{ name: string; values: number[] }> };
  table?: { headers: string[]; rows: string[][] };
  speakerNotes?: string;
  layout: string;
};

type DeckResponse = {
  ok: boolean;
  artifact: { id: string; title: string };
  plan: { deckTitle: string; deckSubtitle: string; slides: DeckSlide[] };
  theme: { id: string; label: string; accent: string };
  previewUrl: string;
  downloadUrl: string;
};

type ThemeOption = { id: string; label: string; accent: string; cover: string };

const audiences = ['投资人', '客户', '团队内部', '合作伙伴', '政府/机构'];

const layoutLabel: Record<string, string> = {
  cover: '封面',
  agenda: '议程',
  content: '观点',
  metrics: '数据卡',
  chart: '图表',
  table: '对比表',
  quote: '金句',
  closing: '行动'
};

export function DeckStudio() {
  const [topic, setTopic] = useState('');
  const [goal, setGoal] = useState('');
  const [audience, setAudience] = useState(audiences[0]);
  const [style, setStyle] = useState('minimal');
  const [slideCount, setSlideCount] = useState('10');
  const [material, setMaterial] = useState('');

  const themes = useQuery({
    queryKey: ['deck-themes'],
    queryFn: () => apiGet<{ ok: boolean; themes: ThemeOption[] }>('/api/web/studio/deck/themes')
  });

  const generate = useMutation({
    mutationFn: () =>
      apiPost<DeckResponse>('/api/web/studio/deck', {
        topic: topic.trim(),
        goal: goal.trim() || undefined,
        audience,
        style,
        slideCount: Number(slideCount),
        material: material.trim() || undefined
      })
  });

  const download = useMutation({
    mutationFn: () => apiDownload(generate.data!.downloadUrl, `${generate.data!.plan.deckTitle || 'deck'}.pptx`)
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!topic.trim() || generate.isPending) return;
    generate.mutate();
  };

  const plan = generate.data?.plan;
  const themeList = themes.data?.themes ?? [];

  return (
    <section className="panel studio-panel">
      <PanelHeader title="演示文稿工作台" hint="生成可下载的 .pptx，含图表、数据卡和对比表" />

      <form className="studio-form" onSubmit={onSubmit}>
        <label className="full">
          <span>主题</span>
          <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="例如：Tele-OPC OS 产品与融资故事" />
        </label>
        <label className="full">
          <span>这份 PPT 要达成什么</span>
          <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="例如：让投资人愿意约下一次深聊" />
        </label>
        <label>
          <span>受众</span>
          <select value={audience} onChange={(e) => setAudience(e.target.value)}>
            {audiences.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label>
          <span>页数</span>
          <select value={slideCount} onChange={(e) => setSlideCount(e.target.value)}>
            {['6', '8', '10', '12', '15', '20'].map((n) => <option key={n} value={n}>{n} 页</option>)}
          </select>
        </label>
        <label className="full">
          <span>视觉风格</span>
          <div className="theme-picker">
            {themeList.map((theme) => (
              <button
                key={theme.id}
                type="button"
                className={theme.id === style ? 'theme-chip active' : 'theme-chip'}
                onClick={() => setStyle(theme.id)}
              >
                <i style={{ background: theme.cover }}>
                  <em style={{ background: theme.accent }} />
                </i>
                {theme.label}
              </button>
            ))}
          </div>
        </label>
        <label className="full">
          <span>素材（有真实数据请贴进来，模型会做成图表而不是编造）</span>
          <textarea rows={5} value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="粘贴产品资料、真实数据、必须包含的观点…" />
        </label>
        <div className="studio-actions">
          <button type="submit" disabled={generate.isPending || !topic.trim()}>
            <Sparkles size={16} className={generate.isPending ? 'spin' : ''} />
            {generate.isPending ? '生成中…' : '生成幻灯片'}
          </button>
          {generate.isPending ? <small>正在为每一页挑选版式并撰写内容</small> : null}
        </div>
      </form>

      {generate.isError ? <ErrorPanel error={generate.error} /> : null}

      {plan ? (
        <div className="deck-result">
          <div className="deck-result-head">
            <div>
              <strong>{plan.deckTitle}</strong>
              <span>{plan.deckSubtitle} · {plan.slides.length} 页 · {generate.data!.theme.label}</span>
            </div>
            <div className="deck-result-actions">
              <a className="ghost-button" href={generate.data!.previewUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={15} /> 网页预览
              </a>
              <button type="button" className="primary-button" onClick={() => download.mutate()} disabled={download.isPending}>
                <Download size={15} /> {download.isPending ? '导出中…' : '下载 PPTX'}
              </button>
            </div>
          </div>
          {download.isError ? <ErrorPanel error={download.error} /> : null}

          <div className="deck-slide-list">
            {plan.slides.map((slide, index) => (
              <article key={index} className={`deck-slide-card layout-${slide.layout}`}>
                <header>
                  <Presentation size={14} />
                  <strong>{index + 1}. {slide.title}</strong>
                  <em className="layout-tag">{layoutLabel[slide.layout] ?? slide.layout}</em>
                </header>
                {slide.subtitle ? <p className="deck-sub">{slide.subtitle}</p> : null}

                {slide.metrics?.length ? (
                  <div className="deck-metrics">
                    {slide.metrics.map((metric, i) => (
                      <div key={i}>
                        <strong>{metric.value}</strong>
                        <span>{metric.label}</span>
                        {metric.delta ? <em>{metric.delta}</em> : null}
                      </div>
                    ))}
                  </div>
                ) : null}

                {slide.chart ? (
                  <p className="deck-asset"><BarChart3 size={13} /> {slide.chart.type} 图 · {slide.chart.categories.join(' / ')}</p>
                ) : null}
                {slide.table ? (
                  <p className="deck-asset"><Table2 size={13} /> 对比表 · {slide.table.headers.join(' / ')}</p>
                ) : null}

                {slide.bullets?.length ? <ul>{slide.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul> : null}
                {slide.speakerNotes ? <small className="deck-notes">备注：{slide.speakerNotes}</small> : null}
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
