// Painel Ormuz: página estática que lê os JSON de data/ e desenha as séries.
'use strict';

const COR = { ok: '#1F6F52', atencao: '#B0761A', alerta: '#A81E68', tinta: '#12303B', fraca: '#5C7885', linha: '#C3D3DA' };
const PRIORIDADE_FONTE = { manual: 0, eia: 1, bcb: 1, ia: 2, doc: 3 };
const NOME_FONTE = { manual: 'lançamento manual', eia: 'EIA', bcb: 'Banco Central', ia: 'busca web', doc: 'documento de análise' };
const ROT_CONF = { alta: 'Fonte primária', media: 'Fonte secundária', baixa: 'Fonte única ou divergente' };
const ROT_NIVEL = { ok: 'Normal', atencao: 'Atenção', alerta: 'Alerta', vazio: 'Sem dado', neutro: 'Acompanhamento' };

let CFG, GRUPOS, TODOS, PORID, SERIES = {}, RAW, MARCOS, GATILHOS, EVENTOS, BRIEF, EXEC;
let janela = 90;
const graficos = [];

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ms = iso => Date.parse(iso + 'T12:00:00Z');
const hojeIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const somaDias = (iso, n) => { const t = new Date(iso + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const difDias = (a, b) => Math.round((ms(a) - ms(b)) / 864e5);
const dataBr = iso => { const [a, m, d] = iso.split('-'); return `${d}/${m}/${a.slice(2)}`; };
const dataCurta = t => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', timeZone: 'UTC' }).replace('.', '');

function fmt(v, casas) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (casas === undefined) { const a = Math.abs(v); casas = a < 10 ? 2 : a < 200 ? 1 : 0; }
  return v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}
const sinal = v => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v));

async function carregar(arq, padrao) {
  try { const r = await fetch('data/' + arq, { cache: 'no-cache' }); if (!r.ok) throw 0; return await r.json(); }
  catch { return padrao; }
}

// Uma série por indicador: um ponto por data, escolhendo a fonte mais confiável quando há mais de uma.
function montarSeries() {
  for (const [id, pts] of Object.entries(RAW.series || {})) {
    const porData = new Map();
    for (const p of pts) {
      const ja = porData.get(p.d);
      if (!ja || (PRIORIDADE_FONTE[p.f] ?? 9) < (PRIORIDADE_FONTE[ja.f] ?? 9)) porData.set(p.d, p);
    }
    SERIES[id] = [...porData.values()].sort((a, b) => a.d < b.d ? -1 : 1);
  }
}
const serie = id => SERIES[id] || [];
const ultimo = id => serie(id).at(-1) || null;
function valorEm(id, dia) {
  const s = serie(id);
  for (let i = s.length - 1; i >= 0; i--) if (s[i].d <= dia) return s[i];
  return null;
}

function nivel(item, v) {
  if (item.dir === 'acompanhamento') return v === null || v === undefined ? 'vazio' : 'neutro';
  if (v === null || v === undefined || !Number.isFinite(v)) return 'vazio';
  if (item.dir === 'alta-ruim') return v < item.t1 ? 'ok' : v <= item.t2 ? 'atencao' : 'alerta';
  if (item.dir === 'baixa-ruim') return v > item.t1 ? 'ok' : v >= item.t2 ? 'atencao' : 'alerta';
  if (v < item.e1 || v > item.e2) return 'alerta';
  if (v < item.t1 || v > item.t2) return 'atencao';
  return 'ok';
}

// Faixas de nível em unidades do eixo y, para sombrear o fundo do gráfico.
function faixas(item) {
  const INF = 1e12;
  if (item.dir === 'alta-ruim') return [[-INF, item.t1, 'ok'], [item.t1, item.t2, 'atencao'], [item.t2, INF, 'alerta']];
  if (item.dir === 'baixa-ruim') return [[item.t1, INF, 'ok'], [item.t2, item.t1, 'atencao'], [-INF, item.t2, 'alerta']];
  if (item.dir === 'dois-lados') return [[-INF, item.e1, 'alerta'], [item.e1, item.t1, 'atencao'], [item.t1, item.t2, 'ok'], [item.t2, item.e2, 'atencao'], [item.e2, INF, 'alerta']];
  return [];
}

// ---------- plugins de gráfico ----------
const pluginFaixas = {
  id: 'faixas',
  beforeDatasetsDraw(ch, _a, op) {
    if (!op || !op.item) return;
    const { ctx, chartArea: ca, scales: { y } } = ch;
    ctx.save();
    for (const [lo, hi, n] of faixas(op.item)) {
      const y1 = Math.max(ca.top, Math.min(ca.bottom, y.getPixelForValue(hi)));
      const y2 = Math.max(ca.top, Math.min(ca.bottom, y.getPixelForValue(lo)));
      if (y2 - y1 < 0.5) continue;
      ctx.fillStyle = n === 'ok' ? 'rgba(31,111,82,.07)' : n === 'atencao' ? 'rgba(176,118,26,.11)' : 'rgba(168,30,104,.10)';
      ctx.fillRect(ca.left, y1, ca.right - ca.left, y2 - y1);
    }
    ctx.restore();
  }
};
const pluginEventos = {
  id: 'eventos',
  afterDatasetsDraw(ch, _a, op) {
    if (!op || !op.lista) return;
    const { ctx, chartArea: ca, scales: { x } } = ch;
    ctx.save();
    ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.textBaseline = 'top';
    for (const ev of op.lista) {
      const px = x.getPixelForValue(ms(ev.d));
      if (px < ca.left || px > ca.right) continue;
      ctx.strokeStyle = 'rgba(18,48,59,.35)';
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(px, ca.top); ctx.lineTo(px, ca.bottom); ctx.stroke();
      if (op.rotulos) {
        ctx.fillStyle = 'rgba(18,48,59,.7)';
        ctx.save(); ctx.translate(px + 3, ca.top + 2); ctx.fillText(ev.curto, 0, 0); ctx.restore();
      }
    }
    ctx.restore();
  }
};

function recorte(s, dias) {
  if (!dias) return s;
  const corte = somaDias(hojeIso(), -dias);
  const i = s.findIndex(p => p.d >= corte);
  if (i === -1) return s.length ? [s.at(-1)] : [];
  return s.slice(Math.max(0, i - 1)); // mantém o ponto anterior para a linha começar na borda
}
function limitesX(dias, s) {
  const fim = ms(hojeIso());
  if (dias) return { min: ms(somaDias(hojeIso(), -dias)), max: fim };
  return { min: s.length ? ms(s[0].d) : fim - 90 * 864e5, max: fim };
}
function limitesY(item, vals) {
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const amp = (hi - lo) || Math.abs(hi) * 0.1 || 1;
  for (const m of [item.t1, item.t2, item.e1, item.e2]) {
    if (m === undefined) continue;
    if (m > lo - amp * 1.5 && m < hi + amp * 1.5) { lo = Math.min(lo, m); hi = Math.max(hi, m); }
  }
  const folga = (hi - lo) * 0.1 || 1;
  // sugestão, não limite fixo: deixa o Chart.js arredondar para valores legíveis no eixo
  return { suggestedMin: lo - folga, suggestedMax: hi + folga };
}

const eixoX = (dias, s) => ({
  type: 'linear', ...limitesX(dias, s),
  grid: { display: false },
  ticks: { maxTicksLimit: 5, maxRotation: 0, color: COR.fraca, font: { size: 10 }, callback: v => dataCurta(v) },
});
const tooltipBase = {
  backgroundColor: '#12303B', titleFont: { size: 11 }, bodyFont: { size: 12 }, padding: 8, displayColors: false,
  callbacks: { title: it => it.length ? dataBr(new Date(it[0].parsed.x).toISOString().slice(0, 10)) : '' },
};

function graficoIndicador(canvas, item) {
  const completo = serie(item.id);
  const s = recorte(completo, janela);
  if (!s.length) return semDado(canvas, 'Sem lançamentos ainda. A curva aparece conforme a coleta diária avança.');
  if (janela && s.at(-1).d < somaDias(hojeIso(), -janela))
    return semDado(canvas, `Último dado em ${dataBr(s.at(-1).d)}, fora do período escolhido. Amplie o período para ver a série.`);
  const poucos = s.length < 40;
  const cores = s.map(p => { const n = nivel(item, p.v); return n === 'neutro' || n === 'vazio' ? COR.tinta : COR[n]; });
  const ch = new Chart(canvas, {
    type: 'line',
    data: { datasets: [{
      data: s.map(p => ({ x: ms(p.d), y: p.v, f: p.f })),
      borderColor: COR.tinta, borderWidth: 1.6, tension: 0, stepped: false,
      pointRadius: poucos ? 3 : 0, pointHoverRadius: 4, pointBackgroundColor: cores, pointBorderColor: cores,
    }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      scales: {
        x: eixoX(janela, completo),
        y: { ...limitesY(item, s.map(p => p.v)), grid: { color: 'rgba(18,48,59,.06)' }, ticks: { maxTicksLimit: 4, color: COR.fraca, font: { size: 10 }, callback: v => fmt(v) } },
      },
      plugins: {
        legend: { display: false },
        faixas: { item },
        eventos: { lista: EVENTOS, rotulos: false },
        tooltip: { ...tooltipBase, callbacks: { ...tooltipBase.callbacks,
          label: c => `${fmt(c.parsed.y)} ${item.unidade} · ${NOME_FONTE[c.raw.f] || c.raw.f}` } },
      },
    },
    plugins: [pluginFaixas, pluginEventos],
  });
  graficos.push(ch);
}
function semDado(canvas, txt) {
  const d = document.createElement('div');
  d.className = 'sem-dado';
  d.textContent = txt;
  canvas.replaceWith(d);
}

// ---------- divergência cru x derivado ----------
function graficoDivergencia() {
  const brent = serie('brent'), ny = serie('crackny'), nwe = serie('crack');
  const b = recorte(brent, janela), c = recorte(ny, janela), e = recorte(nwe, janela);
  const cv1 = $('#g-divergencia'), cv2 = $('#g-spread');
  if (!b.length && !c.length) { semDado(cv1, 'Sem dados de Brent e crack ainda.'); semDado(cv2, ''); return; }
  const pt = s => s.map(p => ({ x: ms(p.d), y: p.v, f: p.f }));
  const base = s => s.length > 30 ? 0 : 2.5;
  graficos.push(new Chart(cv1, {
    type: 'line',
    data: { datasets: [
      { label: 'Brent (US$/bbl, eixo esquerdo)', data: pt(b), yAxisID: 'y', borderColor: COR.tinta, borderWidth: 1.8, pointRadius: base(b) },
      { label: 'Crack diesel NY (US$/bbl, eixo direito)', data: pt(c), yAxisID: 'y2', borderColor: COR.alerta, borderWidth: 1.8, pointRadius: base(c) },
      { label: 'Crack diesel NW Europa (busca web)', data: pt(e), yAxisID: 'y2', borderColor: COR.atencao, backgroundColor: COR.atencao, borderWidth: 1.4, borderDash: [4, 3], pointRadius: 3 },
    ].filter(d => d.data.length) },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      scales: {
        x: eixoX(janela, brent),
        y: { position: 'left', grid: { color: 'rgba(18,48,59,.06)' }, ticks: { color: COR.tinta, font: { size: 10 } }, title: { display: true, text: 'Brent', color: COR.tinta, font: { size: 11 } } },
        y2: { position: 'right', grid: { display: false }, ticks: { color: COR.alerta, font: { size: 10 } }, title: { display: true, text: 'Crack de diesel', color: COR.alerta, font: { size: 11 } } },
      },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 14, font: { size: 11 }, color: COR.tinta } },
        eventos: { lista: EVENTOS, rotulos: true },
        tooltip: { ...tooltipBase, displayColors: true, callbacks: { ...tooltipBase.callbacks, label: c => `${c.dataset.label.split(' (')[0]}: ${fmt(c.parsed.y)}` } },
      },
    },
    plugins: [pluginEventos],
  }));

  // Crack como % do Brent: torna a divergência mensurável.
  const mb = new Map(brent.map(p => [p.d, p.v]));
  const razaoTodo = ny.filter(p => mb.has(p.d)).map(p => ({ d: p.d, v: p.v / mb.get(p.d) * 100 }));
  const razao = recorte(razaoTodo, janela);
  const preGuerra = razaoTodo.filter(p => p.d < '2026-02-28');
  const mediaPre = preGuerra.length ? preGuerra.reduce((a, p) => a + p.v, 0) / preGuerra.length : null;
  if (!razao.length) { semDado(cv2, 'A razão aparece quando houver Brent e crack na mesma data.'); }
  else graficos.push(new Chart(cv2, {
    type: 'line',
    data: { datasets: [
      { label: 'Crack NY em % do Brent', data: razao.map(p => ({ x: ms(p.d), y: p.v })), borderColor: COR.alerta, backgroundColor: 'rgba(168,30,104,.08)', fill: true, borderWidth: 1.6, pointRadius: razao.length > 30 ? 0 : 2.5 },
      ...(mediaPre ? [{ label: 'Média antes da guerra', data: [{ x: limitesX(janela, brent).min, y: mediaPre }, { x: ms(hojeIso()), y: mediaPre }], borderColor: COR.fraca, borderDash: [5, 4], borderWidth: 1.2, pointRadius: 0 }] : []),
    ] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      scales: {
        x: eixoX(janela, brent),
        y: { grid: { color: 'rgba(18,48,59,.06)' }, ticks: { color: COR.fraca, font: { size: 10 }, callback: v => fmt(v, 0) + '%' } },
      },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 14, font: { size: 11 }, color: COR.tinta } },
        eventos: { lista: EVENTOS, rotulos: false },
        tooltip: { ...tooltipBase, callbacks: { ...tooltipBase.callbacks, label: c => `${c.dataset.label}: ${fmt(c.parsed.y, 1)}%` } },
      },
    },
    plugins: [pluginEventos],
  }));

  // Correlação das variações diárias nos últimos 60 pregões: quanto menor, mais descolados.
  const pares = [];
  const cm = new Map(ny.map(p => [p.d, p.v]));
  const datas = brent.map(p => p.d).filter(d => cm.has(d)).slice(-61);
  for (let i = 1; i < datas.length; i++) pares.push([mb.get(datas[i]) - mb.get(datas[i - 1]), cm.get(datas[i]) - cm.get(datas[i - 1])]);
  const r = correlacao(pares);
  const ult = razaoTodo.at(-1);
  $('#stats-divergencia').innerHTML = `
    <span>crack em % do Brent<b>${ult ? fmt(ult.v, 1) + '%' : '—'}</b></span>
    <span>média antes da guerra<b>${mediaPre ? fmt(mediaPre, 1) + '%' : '—'}</b></span>
    <span>correlação das variações diárias, 60 pregões<b>${r === null ? '—' : fmt(r, 2)}</b></span>
    <span>última data comum<b>${ult ? dataBr(ult.d) : '—'}</b></span>`;
}
function correlacao(pares) {
  if (pares.length < 10) return null;
  const n = pares.length, mx = pares.reduce((a, p) => a + p[0], 0) / n, my = pares.reduce((a, p) => a + p[1], 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pares) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

// ---------- cartões ----------
function variacaoDesde(s, dias) {
  if (s.length < 2) return null;
  const corte = somaDias(s.at(-1).d, -dias);
  const antes = s.filter(p => p.d <= corte);
  if (!antes.length) return null;
  return s.at(-1).v - antes.at(-1).v;
}
function defasagem(item, p) {
  if (!p) return null;
  const dias = difDias(hojeIso(), p.d);
  const limite = ['eia', 'bcb'].includes(item.origem) && !['spr', 'distdesvio', 'crudesvio', 'refinoeua', 'demdistdesvio'].includes(item.id) ? 7 : 45;
  return { dias, velho: dias > limite };
}

function cartao(item) {
  const s = serie(item.id);
  const u = s.at(-1) || null;
  const n = nivel(item, u?.v);
  const ant = s.length > 1 ? s.at(-2) : null;
  const d = u && ant ? u.v - ant.v : null;
  const idade = defasagem(item, u);
  const rec = recorte(s, janela).filter(p => !janela || p.d >= somaDias(hojeIso(), -janela));
  const vals = rec.map(p => p.v);
  const v30 = variacaoDesde(s, 30);
  const conf = item.confianca === 'alta' ? '' : item.confianca;

  const el = document.createElement('article');
  el.className = `ind ${n}`;
  el.innerHTML = `
    <div class="ind-topo">
      <div class="ind-nome">${esc(item.nome)}<small>${esc(item.dica)}</small></div>
      <div>
        <div class="ind-val ${n}" title="${ROT_NIVEL[n]}">${fmt(u?.v)}<span class="u">${esc(item.unidade)}</span></div>
        <span class="delta">${d === null ? (u ? 'em ' + dataBr(u.d) : '') : `<span class="${d > 0 ? 'sobe' : d < 0 ? 'desce' : ''}">${sinal(d)}</span> desde ${dataBr(ant.d)}`}</span>
      </div>
    </div>
    <div class="grafico"><canvas aria-label="Série de ${esc(item.nome)}"></canvas></div>
    <div class="ind-rodape">
      <span>${u ? `${dataBr(u.d)}${idade?.velho ? ` · <b style="color:${COR.atencao}">há ${idade.dias} dias</b>` : ''}` : 'sem dado'}</span>
      <span>
        <span class="selo ${conf}">${ROT_CONF[item.confianca]}</span>
        ${item.provisoria ? '<span class="selo prov" title="Faixa de alerta calibrada por julgamento, sem histórico">faixa provisória</span>' : ''}
      </span>
    </div>
    <details>
      <summary>Leitura e fonte</summary>
      <div class="stats">
        <span>30 dias<b>${v30 === null ? '—' : sinal(v30)}</b></span>
        <span>mín. no período<b>${vals.length ? fmt(Math.min(...vals)) : '—'}</b></span>
        <span>máx. no período<b>${vals.length ? fmt(Math.max(...vals)) : '—'}</b></span>
        <span>pontos<b>${rec.length}</b></span>
      </div>
      <p class="det-txt" style="margin-top:10px"><b>Faixa:</b> ${descFaixa(item)}</p>
      <p class="det-txt"><b>Referência do documento:</b> ${esc(item.ref)}</p>
      <p class="det-txt"><b>Como ler:</b> ${esc(item.leitura)}</p>
      <p class="det-txt fonte"><b>Fonte:</b> <a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.fonte)}</a>${u ? ` · último ponto via ${NOME_FONTE[u.f] || u.f}` : ''}</p>
    </details>`;
  // setTimeout e não requestAnimationFrame: rAF não dispara em aba de fundo, e os cartões ficariam vazios
  setTimeout(() => graficoIndicador(el.querySelector('canvas'), item), 0);
  return el;
}
function descFaixa(i) {
  if (i.dir === 'alta-ruim') return `normal abaixo de ${fmt(i.t1)}, alerta acima de ${fmt(i.t2)}`;
  if (i.dir === 'baixa-ruim') return `normal acima de ${fmt(i.t1)}, alerta abaixo de ${fmt(i.t2)}`;
  if (i.dir === 'dois-lados') return `normal entre ${fmt(i.t1)} e ${fmt(i.t2)}, alerta abaixo de ${fmt(i.e1)} ou acima de ${fmt(i.e2)}`;
  return 'sem faixa de alerta, apenas acompanhamento';
}

function renderGrupos() {
  const cont = $('#grupos');
  cont.innerHTML = '';
  for (const g of GRUPOS) {
    const sec = document.createElement('section');
    sec.className = 'grupo';
    sec.innerHTML = `<h2>${esc(g.grupo)}</h2><p>${esc(g.desc)}</p><div class="cartoes"></div>`;
    const grade = sec.querySelector('.cartoes');
    g.itens.forEach(i => grade.appendChild(cartao(i)));
    cont.appendChild(sec);
  }
}

// Leitura agregada ponderada pelo peso de cada indicador (seção 7.4 da especificação).
function renderLeitura() {
  let al = 0, at = 0, nAl = 0, nAt = 0, preench = 0, total = 0;
  for (const i of TODOS) {
    if (i.dir === 'acompanhamento') continue;
    total++;
    const n = nivel(i, ultimo(i.id)?.v);
    if (n === 'vazio') continue;
    preench++;
    if (n === 'alerta') { al += i.peso ?? 1; nAl++; }
    if (n === 'atencao') { at += i.peso ?? 1; nAt++; }
  }
  let txt = 'Normalizando';
  if (!preench) txt = 'Sem dados';
  else if (al >= 4) txt = 'Reescalada';
  else if (al >= 2 || at >= 5) txt = 'Tensão elevada';
  else if (al > 0 || at > 0) txt = 'Instabilidade lateral';
  $('#leitura-val').textContent = txt;
  $('#leitura-det').textContent = `${nAl} em alerta (peso ${fmt(al, 1)}), ${nAt} em atenção (peso ${fmt(at, 1)}), ${preench} de ${total} com dado.`;
  const em = RAW.atualizado_em ? new Date(RAW.atualizado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : '—';
  $('#atualizacao').innerHTML = `última coleta<br>${em}`;
}

// ---------- gatilhos ----------
function avaliarCond(c, dia) {
  if (c.marco) {
    const m = MARCOS.find(x => x.id === c.marco);
    return { ok: !!m && m.estado === c.estado, txt: `marco “${m?.titulo || c.marco}” = ${c.estado.replace(/_/g, ' ')} (hoje: ${(m?.estado || '?').replace(/_/g, ' ')})`, marco: true };
  }
  const ids = c.ind.split('|');
  let p = null, id = ids[0];
  for (const cand of ids) { const q = valorEm(cand, dia); if (q && difDias(dia, q.d) <= 30) { p = q; id = cand; break; } }
  const item = PORID[id];
  const ok = !!p && (c.op === '<' ? p.v < c.v : c.op === '>' ? p.v > c.v : c.op === '<=' ? p.v <= c.v : c.op === '>=' ? p.v >= c.v : p.v === c.v);
  return { ok, txt: `${item?.nome || id} ${c.op} ${fmt(c.v)} ${item?.unidade || ''} (${p ? 'agora ' + fmt(p.v) + ' em ' + dataBr(p.d) : 'sem dado recente'})` };
}
function avaliarGatilho(g) {
  const hoje = hojeIso();
  const conds = g.conds.map(c => avaliarCond(c, hoje));
  const todas = conds.every(c => c.ok), alguma = conds.some(c => c.ok);
  // dias seguidos com todas as condições verdadeiras (ou alguma, para armado)
  const seguidos = teste => { let n = 0; for (let k = 0; k < 400; k++) { const d = somaDias(hoje, -k); if (!teste(g.conds.map(c => avaliarCond(c, d)))) break; n++; } return n; };
  let estado = 'inativo', dias = 0;
  if (todas) {
    dias = seguidos(cs => cs.every(c => c.ok));
    estado = dias >= (g.dias || 0) ? 'disparado' : 'armado';
  } else if (alguma) { estado = 'armado'; dias = seguidos(cs => cs.some(c => c.ok)); }
  return { estado, dias, conds };
}
function renderGatilhos() {
  const ordem = { disparado: 0, armado: 1, inativo: 2 };
  const lista = GATILHOS.map(g => ({ g, r: avaliarGatilho(g) })).sort((a, b) => ordem[a.r.estado] - ordem[b.r.estado]);
  $('#gatilhos').innerHTML = lista.map(({ g, r }) => `
    <article class="gatilho ${r.estado} ${g.falseamento ? 'falseamento' : ''}">
      <div class="gat-topo"><h3>${esc(g.nome)}${g.novo ? ' <span class="selo prov">novo</span>' : ''}</h3>
        <span class="estado ${r.estado}">${r.estado}${r.estado !== 'inativo' ? ` · ${r.dias >= 400 ? 'mais de um ano' : r.dias + (r.dias === 1 ? ' dia' : ' dias')}` : ''}</span></div>
      <ul class="conds">${r.conds.map(c => `<li class="${c.ok ? 'sim' : ''}">${esc(c.txt)}</li>`).join('')}
        ${g.dias ? `<li class="${r.estado === 'disparado' ? 'sim' : ''}">persistência de ${g.dias} dias</li>` : ''}</ul>
      <p><b>Ação:</b> ${esc(g.acao)}</p>
    </article>`).join('');
  const f = lista.find(x => x.g.falseamento && x.r.estado === 'disparado');
  const av = $('#aviso-falseamento');
  if (f) { av.hidden = false; av.innerHTML = `<b>Critério de falseamento disparado</b>${esc(f.g.acao)}`; }
  const nDisp = lista.filter(x => x.r.estado === 'disparado').length;
  $('#aba-gatilhos').textContent = nDisp ? `Gatilhos e marcos (${nDisp})` : 'Gatilhos e marcos';
}
function renderMarcos() {
  $('#marcos').innerHTML = MARCOS.map(m => `
    <article class="marco">
      <h3>${esc(m.titulo)} <span>${esc((m.estado || '').replace(/_/g, ' '))} · ${m.atualizado_em ? dataBr(m.atualizado_em) : ''}</span></h3>
      <p class="sit">${esc(m.situacao)}</p>
      <p>${esc(m.desc)}</p>
    </article>`).join('');
}

// ---------- briefing e coleta ----------
function renderBriefings() {
  const dias = Object.keys(BRIEF.dias || {}).sort().reverse();
  if (!dias.length) { $('#briefings').innerHTML = '<p class="vazio-txt">Nenhuma varredura ainda. O histórico se acumula a cada coleta diária.</p>'; return; }
  $('#briefings').innerHTML = dias.map(d => {
    const b = BRIEF.dias[d];
    const hora = b.em ? new Date(b.em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : '';
    const sinais = (b.sinais || []).map(s => {
      const rel = String(s.relevancia || 'medio').toLowerCase();
      const cls = rel === 'alto' ? 'alto' : rel === 'baixo' ? 'baixo' : 'medio';
      return `<article class="sinal ${cls}"><h4>${esc(s.titulo || 'Sem título')}</h4><p>${esc(s.dado)}</p>
        ${s.implicacao ? `<p>O que muda: ${esc(s.implicacao)}</p>` : ''}
        <div class="sinal-meta"><span>Fonte: <b>${esc(s.fonte || 'não informada')}</b></span><span>Frente: <b>${esc(s.frente)}</b></span><span>Relevância: <b>${esc(rel)}</b></span></div></article>`;
    }).join('');
    return `<section class="dia"><div class="dia-cab"><h3>${dataBr(d)}</h3><span>${(b.sinais || []).length} sinais · ${hora}</span></div>
      ${sinais || '<p class="vazio-dia">Nenhum sinal que altere as conclusões do documento.</p>'}</section>`;
  }).join('');
}
function renderExecucoes() {
  const lista = EXEC.execucoes || [];
  if (!lista.length) { $('#execucoes').innerHTML = '<p class="vazio-txt">Nenhuma coleta registrada.</p>'; return; }
  $('#execucoes').innerHTML = lista.slice(0, 15).map(e => `
    <article class="exec"><h3>${new Date(e.em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</h3>
      <table>${e.etapas.map(et => `<tr><td>${esc(et.etapa)}</td><td class="st-${esc(et.status)}">${esc(et.status)}</td>
        <td>${et.itens} itens${et.motivo ? ' · parada: ' + esc(et.motivo) : ''}${et.modelo ? ' · ' + esc(et.modelo) : ''}${et.tokens ? ` · ${fmt(et.tokens.entrada / 1000, 0)} mil tokens de entrada` : ''}<br>${(et.detalhe || []).map(esc).join('<br>')}
        ${et.bruto ? `<details><summary>resposta bruta</summary><pre>${esc(et.bruto)}</pre></details>` : ''}</td></tr>`).join('')}</table>
    </article>`).join('');
}

// ---------- exportação ----------
function baixarCsv() {
  const linhas = [['indicador', 'nome', 'unidade', 'data', 'valor', 'fonte']];
  for (const i of TODOS) for (const p of (RAW.series[i.id] || [])) linhas.push([i.id, i.nome, i.unidade, p.d, String(p.v).replace('.', ','), p.f]);
  const csv = '﻿' + linhas.map(l => l.map(c => /[;"\n]/.test(c) ? `"${String(c).replace(/"/g, '""')}"` : c).join(';')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `painel-ormuz-series-${hojeIso()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- navegação ----------
function redesenhar() {
  graficos.splice(0).forEach(g => g.destroy());
  for (const id of ['g-divergencia', 'g-spread']) {
    const antigo = document.getElementById(id) || null;
    if (!antigo) {
      // o canvas pode ter sido trocado por aviso de sem dado; recria
      const alvo = id === 'g-divergencia' ? document.querySelector('.grafico.grande') : document.querySelector('.grafico.medio');
      alvo.innerHTML = `<canvas id="${id}"></canvas>`;
    }
  }
  graficoDivergencia();
  renderGrupos();
}
function trocarAba(qual) {
  for (const k of ['painel', 'gatilhos', 'brief', 'exec']) {
    $('#aba-' + k).setAttribute('aria-selected', k === qual);
    $('#vista-' + k).hidden = k !== qual;
  }
  try { localStorage.setItem('painel-aba', qual); } catch {}
}

async function iniciar() {
  const [cfg, raw, marcos, gat, ev, brief, exec] = await Promise.all([
    carregar('indicadores.json', { grupos: [] }), carregar('leituras.json', { series: {} }),
    carregar('marcos.json', { marcos: [] }), carregar('gatilhos.json', { gatilhos: [] }),
    carregar('eventos.json', { eventos: [] }), carregar('briefings.json', { dias: {} }),
    carregar('execucoes.json', { execucoes: [] }),
  ]);
  CFG = cfg; GRUPOS = cfg.grupos; TODOS = GRUPOS.flatMap(g => g.itens); PORID = Object.fromEntries(TODOS.map(i => [i.id, i]));
  RAW = raw; MARCOS = marcos.marcos; GATILHOS = gat.gatilhos; EVENTOS = ev.eventos; BRIEF = brief; EXEC = exec;
  montarSeries();

  try { const j = parseInt(localStorage.getItem('painel-janela'), 10); if (!isNaN(j)) janela = j; } catch {}
  document.querySelectorAll('#periodo button').forEach(b => b.setAttribute('aria-pressed', parseInt(b.dataset.dias, 10) === janela));

  renderLeitura();
  graficoDivergencia();
  renderGrupos();
  renderMarcos();
  renderGatilhos();
  renderBriefings();
  renderExecucoes();

  $('#periodo').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    janela = parseInt(b.dataset.dias, 10);
    document.querySelectorAll('#periodo button').forEach(x => x.setAttribute('aria-pressed', x === b));
    try { localStorage.setItem('painel-janela', janela); } catch {}
    redesenhar();
  });
  for (const k of ['painel', 'gatilhos', 'brief', 'exec']) $('#aba-' + k).addEventListener('click', () => trocarAba(k));
  $('#btn-csv').addEventListener('click', baixarCsv);
  $('#btn-pdf').addEventListener('click', () => window.print());
  try { const a = localStorage.getItem('painel-aba'); if (a && a !== 'painel') trocarAba(a); } catch {}
}

document.addEventListener('DOMContentLoaded', () => {
  if (!window.Chart) { $('#leitura-val').textContent = 'Erro ao carregar a biblioteca de gráficos'; return; }
  iniciar();
});
