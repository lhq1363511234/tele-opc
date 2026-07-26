import PptxModule from 'pptxgenjs';

// pptxgenjs ships CJS; under NodeNext the callable class may sit on `.default`.
const PptxGenJS: any = typeof PptxModule === 'function' ? PptxModule : (PptxModule as any).default;

export type DeckMetric = { label: string; value: string; delta?: string };

export type DeckSlide = {
  title: string;
  subtitle?: string;
  bullets?: string[];
  metrics?: DeckMetric[];
  chart?: {
    type: 'bar' | 'line' | 'pie';
    categories: string[];
    series: Array<{ name: string; values: number[] }>;
  };
  table?: { headers: string[]; rows: string[][] };
  speakerNotes?: string;
  layout: 'cover' | 'agenda' | 'content' | 'metrics' | 'chart' | 'table' | 'quote' | 'closing';
};

export type DeckPlan = {
  deckTitle: string;
  deckSubtitle: string;
  slides: DeckSlide[];
};

export type DeckTheme = {
  id: string;
  label: string;
  bg: string;
  ink: string;
  muted: string;
  accent: string;
  accentSoft: string;
  coverBg: string;
  coverInk: string;
  titleFont: string;
  bodyFont: string;
};

export const DECK_THEMES: Record<string, DeckTheme> = {
  consulting: {
    id: 'consulting',
    label: '咨询公司风',
    bg: 'FFFFFF',
    ink: '14231D',
    muted: '6B7B73',
    accent: '1F7A55',
    accentSoft: 'E7F2EC',
    coverBg: '14231D',
    coverInk: 'FFFFFF',
    titleFont: 'Microsoft YaHei',
    bodyFont: 'Microsoft YaHei'
  },
  pitch: {
    id: 'pitch',
    label: '融资路演',
    bg: 'FFFFFF',
    ink: '111827',
    muted: '6B7280',
    accent: '4338CA',
    accentSoft: 'EEF0FE',
    coverBg: '1E1B4B',
    coverInk: 'FFFFFF',
    titleFont: 'Microsoft YaHei',
    bodyFont: 'Microsoft YaHei'
  },
  tech: {
    id: 'tech',
    label: '科技感',
    bg: '0B1220',
    ink: 'E6EDF7',
    muted: '93A4BC',
    accent: '38BDF8',
    accentSoft: '15304A',
    coverBg: '020617',
    coverInk: 'E6EDF7',
    titleFont: 'Microsoft YaHei',
    bodyFont: 'Microsoft YaHei'
  },
  minimal: {
    id: 'minimal',
    label: '简洁商务',
    bg: 'FAFAF8',
    ink: '1C1C1A',
    muted: '78786F',
    accent: 'B45309',
    accentSoft: 'FBF0DF',
    coverBg: '1C1C1A',
    coverInk: 'FAFAF8',
    titleFont: 'Microsoft YaHei',
    bodyFont: 'Microsoft YaHei'
  },
  sales: {
    id: 'sales',
    label: '销售提案',
    bg: 'FFFFFF',
    ink: '14231D',
    muted: '6B7B73',
    accent: 'B4453A',
    accentSoft: 'FBECEB',
    coverBg: '7F2D24',
    coverInk: 'FFFFFF',
    titleFont: 'Microsoft YaHei',
    bodyFont: 'Microsoft YaHei'
  }
};

export function resolveTheme(style: string): DeckTheme {
  const key = String(style || '').toLowerCase();
  if (DECK_THEMES[key]) return DECK_THEMES[key];
  if (/咨询|consult|mck|麦肯锡/.test(style)) return DECK_THEMES.consulting;
  if (/路演|融资|pitch|投资/.test(style)) return DECK_THEMES.pitch;
  if (/科技|tech|产品|dark/.test(style)) return DECK_THEMES.tech;
  if (/销售|提案|sales|客户/.test(style)) return DECK_THEMES.sales;
  return DECK_THEMES.minimal;
}

const W = 13.333;
const H = 7.5;
const MARGIN = 0.72;

export async function buildPptxBuffer(plan: DeckPlan, theme: DeckTheme): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.title = plan.deckTitle;

  plan.slides.forEach((slide, index) => {
    const s = pptx.addSlide();
    const isCover = slide.layout === 'cover';
    s.background = { color: isCover ? theme.coverBg : theme.bg };
    if (slide.speakerNotes) s.addNotes(slide.speakerNotes);

    if (isCover) {
      renderCover(s, slide, plan, theme);
      return;
    }

    renderHeader(s, slide, theme, index + 1, plan.slides.length);

    switch (slide.layout) {
      case 'metrics':
        renderMetrics(s, slide, theme);
        break;
      case 'chart':
        renderChart(pptx, s, slide, theme);
        break;
      case 'table':
        renderTable(s, slide, theme);
        break;
      case 'quote':
        renderQuote(s, slide, theme);
        break;
      case 'closing':
        renderClosing(s, slide, theme);
        break;
      default:
        renderBullets(s, slide, theme);
    }
  });

  const data = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
  return data;
}

function renderCover(s: any, slide: DeckSlide, plan: DeckPlan, theme: DeckTheme) {
  s.addShape('rect', {
    x: 0, y: H - 0.9, w: W, h: 0.9, fill: { color: theme.accent }
  });
  s.addShape('rect', { x: MARGIN, y: 2.3, w: 1.5, h: 0.08, fill: { color: theme.accent } });
  s.addText(plan.deckTitle || slide.title, {
    x: MARGIN, y: 2.55, w: W - MARGIN * 2, h: 1.5,
    fontSize: 40, bold: true, color: theme.coverInk, fontFace: theme.titleFont, valign: 'top'
  });
  const sub = slide.subtitle || plan.deckSubtitle;
  if (sub) {
    s.addText(sub, {
      x: MARGIN, y: 4.1, w: W - MARGIN * 2, h: 0.8,
      fontSize: 17, color: theme.coverInk, transparency: 25, fontFace: theme.bodyFont
    });
  }
  if (slide.bullets?.length) {
    s.addText(slide.bullets.slice(0, 3).join('    ·    '), {
      x: MARGIN, y: 5.0, w: W - MARGIN * 2, h: 0.6,
      fontSize: 13, color: theme.coverInk, transparency: 40, fontFace: theme.bodyFont
    });
  }
}

function renderHeader(s: any, slide: DeckSlide, theme: DeckTheme, page: number, total: number) {
  s.addShape('rect', { x: MARGIN, y: 0.62, w: 0.9, h: 0.06, fill: { color: theme.accent } });
  s.addText(slide.title, {
    x: MARGIN, y: 0.82, w: W - MARGIN * 2 - 1, h: 0.85,
    fontSize: 26, bold: true, color: theme.ink, fontFace: theme.titleFont, valign: 'top'
  });
  if (slide.subtitle) {
    s.addText(slide.subtitle, {
      x: MARGIN, y: 1.66, w: W - MARGIN * 2 - 1, h: 0.45,
      fontSize: 14, color: theme.muted, fontFace: theme.bodyFont
    });
  }
  s.addText(`${page} / ${total}`, {
    x: W - MARGIN - 1, y: 0.68, w: 1, h: 0.35,
    fontSize: 11, color: theme.muted, align: 'right', fontFace: theme.bodyFont
  });
}

function bodyTop(slide: DeckSlide) {
  return slide.subtitle ? 2.3 : 1.95;
}

function renderBullets(s: any, slide: DeckSlide, theme: DeckTheme) {
  const bullets = (slide.bullets ?? []).slice(0, 6);
  if (!bullets.length) return;
  const top = bodyTop(slide);
  const available = H - top - 0.7;
  const rowH = Math.min(0.92, available / bullets.length);

  bullets.forEach((text, i) => {
    const y = top + i * rowH;
    s.addShape('ellipse', {
      x: MARGIN + 0.05, y: y + rowH / 2 - 0.11, w: 0.22, h: 0.22,
      fill: { color: theme.accentSoft }, line: { color: theme.accent, width: 1 }
    });
    s.addText(String(i + 1), {
      x: MARGIN + 0.05, y: y + rowH / 2 - 0.11, w: 0.22, h: 0.22,
      fontSize: 9, bold: true, color: theme.accent, align: 'center', valign: 'middle', fontFace: theme.bodyFont
    });
    s.addText(text, {
      x: MARGIN + 0.45, y, w: W - MARGIN * 2 - 0.5, h: rowH,
      fontSize: 15, color: theme.ink, valign: 'middle', fontFace: theme.bodyFont
    });
  });
}

function renderMetrics(s: any, slide: DeckSlide, theme: DeckTheme) {
  const metrics = (slide.metrics ?? []).slice(0, 4);
  const top = bodyTop(slide);
  if (metrics.length) {
    const gap = 0.3;
    const cardW = (W - MARGIN * 2 - gap * (metrics.length - 1)) / metrics.length;
    metrics.forEach((metric, i) => {
      const x = MARGIN + i * (cardW + gap);
      s.addShape('roundRect', {
        x, y: top, w: cardW, h: 1.85, rectRadius: 0.08,
        fill: { color: theme.accentSoft }, line: { color: theme.accentSoft }
      });
      s.addText(metric.value, {
        x: x + 0.2, y: top + 0.28, w: cardW - 0.4, h: 0.8,
        fontSize: 30, bold: true, color: theme.accent, fontFace: theme.titleFont, valign: 'middle'
      });
      s.addText(metric.label, {
        x: x + 0.2, y: top + 1.08, w: cardW - 0.4, h: 0.4,
        fontSize: 12, color: theme.ink, fontFace: theme.bodyFont
      });
      if (metric.delta) {
        s.addText(metric.delta, {
          x: x + 0.2, y: top + 1.42, w: cardW - 0.4, h: 0.32,
          fontSize: 11, color: theme.muted, fontFace: theme.bodyFont
        });
      }
    });
  }

  const bullets = (slide.bullets ?? []).slice(0, 4);
  if (!bullets.length) return;
  const listTop = top + (metrics.length ? 2.15 : 0);
  const rowH = Math.min(0.72, (H - listTop - 0.6) / bullets.length);
  bullets.forEach((text, i) => {
    s.addText(`— ${text}`, {
      x: MARGIN, y: listTop + i * rowH, w: W - MARGIN * 2, h: rowH,
      fontSize: 14, color: theme.muted, valign: 'middle', fontFace: theme.bodyFont
    });
  });
}

function renderChart(pptx: any, s: any, slide: DeckSlide, theme: DeckTheme) {
  const top = bodyTop(slide);
  const chart = slide.chart;
  const hasBullets = Boolean(slide.bullets?.length);
  const chartW = hasBullets ? (W - MARGIN * 2) * 0.58 : W - MARGIN * 2;

  if (chart && chart.categories.length && chart.series.length) {
    const type = chart.type === 'line' ? pptx.ChartType.line : chart.type === 'pie' ? pptx.ChartType.pie : pptx.ChartType.bar;
    const data = chart.series.map((serie) => ({
      name: serie.name,
      labels: chart.categories,
      values: serie.values
    }));
    s.addChart(type, data, {
      x: MARGIN, y: top, w: chartW, h: H - top - 0.7,
      chartColors: [theme.accent, theme.muted, '9CA3AF', 'D1D5DB'],
      showLegend: chart.series.length > 1 || chart.type === 'pie',
      legendPos: 'b',
      legendColor: theme.muted,
      catAxisLabelColor: theme.muted,
      valAxisLabelColor: theme.muted,
      catAxisLabelFontSize: 11,
      valAxisLabelFontSize: 11,
      dataLabelColor: theme.ink,
      showValue: chart.type !== 'line',
      dataLabelFontSize: 10,
      barDir: 'col'
    });
  }

  if (hasBullets) {
    const listX = MARGIN + chartW + 0.4;
    const listW = W - MARGIN - listX;
    slide.bullets!.slice(0, 5).forEach((text, i) => {
      s.addText(`— ${text}`, {
        x: listX, y: top + i * 0.85, w: listW, h: 0.8,
        fontSize: 13, color: theme.ink, valign: 'top', fontFace: theme.bodyFont
      });
    });
  }
}

function renderTable(s: any, slide: DeckSlide, theme: DeckTheme) {
  const top = bodyTop(slide);
  const table = slide.table;
  if (!table || !table.headers.length) {
    renderBullets(s, slide, theme);
    return;
  }
  const rows = [
    table.headers.map((h) => ({
      text: h,
      options: { bold: true, color: 'FFFFFF', fill: { color: theme.accent }, fontSize: 13 }
    })),
    ...table.rows.slice(0, 8).map((row, ri) =>
      row.map((cell) => ({
        text: cell,
        options: {
          color: theme.ink,
          fontSize: 12,
          fill: { color: ri % 2 === 0 ? theme.bg : theme.accentSoft }
        }
      }))
    )
  ];
  s.addTable(rows, {
    x: MARGIN, y: top, w: W - MARGIN * 2,
    border: { type: 'solid', color: theme.accentSoft, pt: 1 },
    fontFace: theme.bodyFont,
    valign: 'middle',
    rowH: 0.42
  });
}

function renderQuote(s: any, slide: DeckSlide, theme: DeckTheme) {
  const top = bodyTop(slide);
  s.addShape('rect', { x: MARGIN, y: top, w: 0.06, h: H - top - 1.0, fill: { color: theme.accent } });
  const text = (slide.bullets ?? []).join('\n\n');
  s.addText(text, {
    x: MARGIN + 0.4, y: top, w: W - MARGIN * 2 - 0.4, h: H - top - 1.0,
    fontSize: 19, italic: true, color: theme.ink, valign: 'middle', fontFace: theme.bodyFont, lineSpacingMultiple: 1.3
  });
}

function renderClosing(s: any, slide: DeckSlide, theme: DeckTheme) {
  const top = bodyTop(slide);
  const bullets = (slide.bullets ?? []).slice(0, 4);
  bullets.forEach((text, i) => {
    const y = top + i * 0.95;
    s.addShape('roundRect', {
      x: MARGIN, y, w: W - MARGIN * 2, h: 0.78, rectRadius: 0.06,
      fill: { color: theme.accentSoft }, line: { color: theme.accentSoft }
    });
    s.addText(text, {
      x: MARGIN + 0.35, y, w: W - MARGIN * 2 - 0.7, h: 0.78,
      fontSize: 15, bold: i === 0, color: theme.ink, valign: 'middle', fontFace: theme.bodyFont
    });
  });
}

export function renderDeckHtml(plan: DeckPlan, theme: DeckTheme) {
  const esc = (s: string) =>
    String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)
    );
  const hex = (c: string) => `#${c}`;

  const slides = plan.slides
    .map((slide, index) => {
      const bullets = (slide.bullets ?? []).map((b) => `<li>${esc(b)}</li>`).join('');
      const metrics = (slide.metrics ?? [])
        .map((m) => `<div class="metric"><strong>${esc(m.value)}</strong><span>${esc(m.label)}</span>${m.delta ? `<em>${esc(m.delta)}</em>` : ''}</div>`)
        .join('');
      const table = slide.table
        ? `<table><thead><tr>${slide.table.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${slide.table.rows
            .map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`)
            .join('')}</tbody></table>`
        : '';
      const chart = slide.chart
        ? `<div class="chart">${slide.chart.categories
            .map((cat, i) => {
              const values = slide.chart!.series.map((serie) => Number(serie.values[i]) || 0);
              const max = Math.max(
                1,
                ...slide.chart!.series.flatMap((serie) => serie.values.map((v) => Number(v) || 0))
              );
              const bars = values
                .map((v) => `<i style="height:${Math.round((v / max) * 100)}%" title="${v}"></i>`)
                .join('');
              return `<div class="bar-group"><div class="bars">${bars}</div><span>${esc(cat)}</span></div>`;
            })
            .join('')}</div>`
        : '';
      return `
      <section class="slide slide-${slide.layout}">
        <div class="slide-index">${index + 1} / ${plan.slides.length}</div>
        <header><h2>${esc(slide.title)}</h2>${slide.subtitle ? `<p class="slide-sub">${esc(slide.subtitle)}</p>` : ''}</header>
        <div class="slide-body">
          ${metrics ? `<div class="metrics">${metrics}</div>` : ''}
          ${chart}
          ${table}
          ${bullets ? `<ul>${bullets}</ul>` : ''}
        </div>
        ${slide.speakerNotes ? `<div class="notes"><span>演讲备注</span>${esc(slide.speakerNotes)}</div>` : ''}
      </section>`;
    })
    .join('');

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(plan.deckTitle)}</title>
<style>
:root{--ink:${hex(theme.ink)};--muted:${hex(theme.muted)};--accent:${hex(theme.accent)};--soft:${hex(theme.accentSoft)};--bg:${hex(theme.bg)}}
*{box-sizing:border-box}
body{margin:0;padding:24px;background:#eef1ed;color:var(--ink);
font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;line-height:1.6}
.deck-head{max-width:960px;margin:0 auto 22px}
.deck-head h1{margin:0 0 6px;font-size:26px}
.deck-head p{margin:0;color:#6b7b73}
.slide{max-width:960px;margin:0 auto 18px;background:var(--bg);border-radius:12px;padding:32px 38px 46px;position:relative;box-shadow:0 1px 3px rgba(20,35,29,.08);aspect-ratio:16/9;overflow:hidden;display:flex;flex-direction:column}
.slide-index{position:absolute;top:18px;right:22px;font-size:12px;color:var(--muted)}
.slide header{flex:0 0 auto}
.slide-body{flex:1;display:flex;flex-direction:column;justify-content:center;gap:10px;min-height:0}
.slide h2{margin:0 0 10px;font-size:23px;line-height:1.35;padding-top:8px;border-top:3px solid var(--accent);display:inline-block}
.slide-sub{margin:0 0 4px;color:var(--muted);font-size:14px}
.slide ul{margin:0;padding-left:22px}
.slide li{margin:11px 0;font-size:15px;line-height:1.55}
.slide-cover{background:${hex(theme.coverBg)};color:${hex(theme.coverInk)};justify-content:center}
.slide-cover .slide-body{flex:0 0 auto;justify-content:flex-start}
.slide-cover ul{list-style:none;padding:0;display:flex;gap:18px;opacity:.65;font-size:13px}
.slide-cover h2{font-size:34px;border-top-color:var(--accent)}
.slide-closing ul{list-style:none;padding:0}
.slide-closing li{background:var(--soft);border-radius:9px;padding:14px 18px;margin:8px 0;font-size:15px}
.slide-closing li:first-child{font-weight:600}
.slide-cover .slide-sub,.slide-cover .slide-index{color:${hex(theme.coverInk)};opacity:.7}
.metrics{display:flex;gap:14px;margin:0 0 6px}
.metric{flex:1;background:var(--soft);border-radius:10px;padding:16px 18px}
.metric strong{display:block;font-size:28px;color:var(--accent);font-variant-numeric:tabular-nums}
.metric span{display:block;font-size:13px;margin-top:4px}
.metric em{display:block;font-style:normal;font-size:12px;color:var(--muted);margin-top:2px}
.chart{display:flex;align-items:flex-end;gap:18px;height:210px;margin:6px 0 26px;padding-bottom:22px;border-bottom:1px solid var(--soft)}
.bar-group{flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%;position:relative}
.bars{display:flex;gap:4px;align-items:flex-end;height:100%}
.bars i{flex:1;background:var(--accent);border-radius:3px 3px 0 0;min-height:3px}
.bars i:nth-child(2){background:var(--muted)}
.bar-group span{position:absolute;bottom:-20px;left:0;right:0;text-align:center;font-size:11px;color:var(--muted)}
table{width:100%;border-collapse:collapse;margin:0;font-size:13px}
th{background:var(--accent);color:#fff;padding:8px 10px;text-align:left}
td{padding:8px 10px;border-bottom:1px solid var(--soft)}
tr:nth-child(even) td{background:var(--soft)}
.slide-quote ul{list-style:none;padding-left:18px;border-left:3px solid var(--accent);font-style:italic;font-size:18px}
.notes{position:absolute;left:38px;right:38px;bottom:20px;padding-top:10px;border-top:1px dashed var(--soft);font-size:12px;color:var(--muted)}
.notes span{display:block;font-size:10px;letter-spacing:.05em;margin-bottom:3px;opacity:.8}
@media print{body{background:#fff;padding:0}.slide{page-break-after:always;box-shadow:none;margin:0;border-radius:0;max-width:none;aspect-ratio:auto;height:100vh}}
</style></head>
<body>
<div class="deck-head"><h1>${esc(plan.deckTitle)}</h1><p>${esc(plan.deckSubtitle)} · ${esc(theme.label)}</p></div>
${slides}
</body></html>`;
}
