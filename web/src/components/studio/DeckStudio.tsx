import { FormEvent, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ExternalLink, Presentation, Sparkles } from 'lucide-react';
import { apiPost } from '../../api';
import { ErrorPanel, PanelHeader } from '../ui';

type DeckSlide = {
  title: string;
  subtitle?: string;
  bullets: string[];
  speakerNotes?: string;
  layout?: string;
};

type DeckResponse = {
  ok: boolean;
  artifact: { id: string; title: string };
  plan: { deckTitle: string; deckSubtitle: string; slides: DeckSlide[] };
  previewUrl: string;
};

const audiences = ['投资人', '客户', '团队内部', '合作伙伴', '政府/机构'];
const styles = ['简洁商务', '融资路演', '科技感', '咨询公司风', '销售提案'];

export function DeckStudio() {
  const [topic, setTopic] = useState('');
  const [goal, setGoal] = useState('');
  const [audience, setAudience] = useState(audiences[0]);
  const [style, setStyle] = useState(styles[0]);
  const [slideCount, setSlideCount] = useState('10');
  const [material, setMaterial] = useState('');

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

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!topic.trim() || generate.isPending) return;
    generate.mutate();
  };

  const plan = generate.data?.plan;

  return (
    <section className="panel studio-panel">
      <PanelHeader title="演示文稿工作台" hint="生成真实可预览的幻灯片，不是任务描述" />

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
          <span>风格</span>
          <select value={style} onChange={(e) => setStyle(e.target.value)}>
            {styles.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>
          <span>页数</span>
          <select value={slideCount} onChange={(e) => setSlideCount(e.target.value)}>
            {['6', '8', '10', '12', '15', '20'].map((n) => <option key={n} value={n}>{n} 页</option>)}
          </select>
        </label>
        <label className="full">
          <span>素材（有真实数据请贴进来，避免模型编造）</span>
          <textarea rows={5} value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="粘贴产品资料、真实数据、必须包含的观点…" />
        </label>
        <div className="studio-actions">
          <button type="submit" disabled={generate.isPending || !topic.trim()}>
            <Sparkles size={16} className={generate.isPending ? 'spin' : ''} />
            {generate.isPending ? '生成中…' : '生成幻灯片'}
          </button>
          {generate.isPending ? <small>正在按你的人格和素材撰写每一页内容</small> : null}
        </div>
      </form>

      {generate.isError ? <ErrorPanel error={generate.error} /> : null}

      {plan ? (
        <div className="deck-result">
          <div className="deck-result-head">
            <div>
              <strong>{plan.deckTitle}</strong>
              <span>{plan.deckSubtitle} · {plan.slides.length} 页</span>
            </div>
            <a className="primary-button" href={generate.data!.previewUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={15} /> 打开幻灯片
            </a>
          </div>
          <div className="deck-slide-list">
            {plan.slides.map((slide, index) => (
              <article key={index} className={`deck-slide-card layout-${slide.layout ?? 'content'}`}>
                <header>
                  <Presentation size={14} />
                  <strong>{index + 1}. {slide.title}</strong>
                </header>
                {slide.subtitle ? <p className="deck-sub">{slide.subtitle}</p> : null}
                <ul>{(slide.bullets ?? []).map((b, i) => <li key={i}>{b}</li>)}</ul>
                {slide.speakerNotes ? <small className="deck-notes">备注：{slide.speakerNotes}</small> : null}
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
