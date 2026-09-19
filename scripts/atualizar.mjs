// Atualização diária do Painel Ormuz.
// Roda no GitHub Actions (ver .github/workflows/atualizar.yml) ou localmente:
//   node scripts/atualizar.mjs            coleta tudo
//   node scripts/atualizar.mjs --sem-ia   só APIs oficiais (EIA, BCB), sem custo
//
// Variáveis de ambiente:
//   EIA_API_KEY          chave gratuita da EIA (https://www.eia.gov/opendata/register.php); sem ela usa DEMO_KEY
//   ANTHROPIC_API_KEY    habilita a busca web das cotações sem API e a varredura de notícias
//   PAINEL_MODELO        modelo Claude (padrão claude-opus-5)
//   PAINEL_LANCAMENTOS   lançamentos manuais: "diesel=6.52@2026-09-15; ureia=610"

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DADOS = path.join(RAIZ, 'data');
const ARG = new Set(process.argv.slice(2));

const INICIO_HIST = '2025-01-01';   // início das séries exibidas
const INICIO_BASE = '2019-06-01';   // histórico extra para a média de 5 anos
const EIA_KEY = (process.env.EIA_API_KEY || '').trim() || 'DEMO_KEY';
const MODELO = process.env.PAINEL_MODELO || 'claude-opus-5';

// Valores registrados no documento de análise, usados como ponto de partida das séries sem API.
const SEMENTES = [
  ['refinorussia', '2026-07-05', 3.91],
  ['coberturadiesel', '2026-05-31', 27],
  ['travessias', '2026-08-23', 3],
  ['babmandeb', '2026-07-20', 41],
  ['babmandeb', '2026-07-21', 29],
  ['venezuela', '2026-08-31', 1.23],
  ['ureia', '2026-03-31', 491.7],
  ['importdiesel', '2026-03-31', -31],
];

// ---------- utilidades ----------
const lerJson = async (arq, padrao) => {
  try { return JSON.parse(await fs.readFile(path.join(DADOS, arq), 'utf8')); }
  catch { return padrao; }
};
const gravarJson = (arq, obj) => fs.writeFile(path.join(DADOS, arq), JSON.stringify(obj, null, 1) + '\n');
const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const arred = (v, c = 2) => Math.round(v * 10 ** c) / 10 ** c;
const somaDias = (iso, n) => { const t = new Date(iso + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const espera = ms => new Promise(r => setTimeout(r, ms));

const HOJE = hojeSP();
const config = await lerJson('indicadores.json', { grupos: [] });
const INDICADORES = config.grupos.flatMap(g => g.itens);
const PORID = Object.fromEntries(INDICADORES.map(i => [i.id, i]));

const leituras = await lerJson('leituras.json', { series: {}, correcoes: [] });
leituras.series ||= {};
leituras.correcoes ||= [];
const execucao = { em: new Date().toISOString(), data: HOJE, etapas: [] };

// Grava um ponto. Um ponto por (indicador, data, fonte). Mudança de valor fica registrada em correcoes.
function registrar(id, d, v, f) {
  if (!PORID[id] || !Number.isFinite(v)) return false;
  const s = (leituras.series[id] ||= []);
  const ja = s.find(p => p.d === d && p.f === f);
  if (ja) {
    if (ja.v === v) return false;
    leituras.correcoes.push({ id, d, f, de: ja.v, para: v, em: execucao.em });
    ja.v = v;
    return true;
  }
  s.push({ d, v, f });
  return true;
}

// ---------- EIA ----------
const cacheEia = new Map();
function eia(serie, inicio) {
  const k = serie + '|' + inicio;
  if (!cacheEia.has(k)) cacheEia.set(k, buscarEia(serie, inicio));
  return cacheEia.get(k);
}
let eiaBloqueada = false;
async function buscarEia(serie, inicio) {
  const url = `https://api.eia.gov/v2/seriesid/${serie}?api_key=${EIA_KEY}&start=${inicio}&length=5000`;
  for (let tentativa = 0; tentativa < 3 && !eiaBloqueada; tentativa++) {
    const r = await fetch(url);
    const j = await r.json().catch(() => ({}));
    if (j.error?.code === 'OVER_RATE_LIMIT' || r.status === 429) {
      if (tentativa === 2) eiaBloqueada = true; // não insiste nas séries seguintes
      await espera(10000 * (tentativa + 1));
      continue;
    }
    if (!r.ok || !j.response) throw new Error(`EIA ${serie}: HTTP ${r.status} ${JSON.stringify(j.error || '').slice(0, 200)}`);
    return j.response.data
      .map(p => ({ d: p.period, v: Number(p.value) }))
      .filter(p => p.d >= inicio && Number.isFinite(p.v))
      .sort((a, b) => a.d < b.d ? -1 : 1);
  }
  throw new Error(`EIA ${serie}: limite de requisições. Configure EIA_API_KEY.`);
}

// Desvio percentual contra a média da mesma semana nos cinco anos anteriores.
function desvio5anos(serie) {
  const mapa = new Map(serie.map(p => [p.d, p.v]));
  const achar = d => {
    for (const k of [0, -7, 7, -1, 1, -2, 2, -3, 3]) { const v = mapa.get(somaDias(d, k)); if (v !== undefined) return v; }
    return undefined;
  };
  const out = [];
  for (const p of serie) {
    if (p.d < INICIO_HIST) continue;
    const anteriores = [1, 2, 3, 4, 5].map(k => achar(somaDias(p.d, -364 * k))).filter(v => v !== undefined);
    if (anteriores.length < 5) continue;
    const media = anteriores.reduce((a, b) => a + b, 0) / 5;
    out.push({ d: p.d, v: arred((p.v / media - 1) * 100, 1) });
  }
  return out;
}
const mediaMovel = (serie, n) => serie.map((p, i) => i < n - 1 ? null :
  { d: p.d, v: serie.slice(i - n + 1, i + 1).reduce((a, q) => a + q.v, 0) / n }).filter(Boolean);

async function etapaEIA() {
  const et = { etapa: 'eia', status: 'ok', itens: 0, detalhe: [] };
  const passos = {
    brent: async () => (await eia('PET.RBRTE.D', INICIO_HIST)).map(p => ({ d: p.d, v: arred(p.v) })),
    crackny: async () => {
      const brent = new Map((await eia('PET.RBRTE.D', INICIO_HIST)).map(p => [p.d, p.v]));
      const ulsd = await eia('PET.EER_EPD2DXL0_PF4_Y35NY_DPG.D', INICIO_HIST);
      return ulsd.filter(p => brent.has(p.d)).map(p => ({ d: p.d, v: arred(p.v * 42 - brent.get(p.d)) }));
    },
    distdesvio: async () => desvio5anos(await eia('PET.WDISTUS1.W', INICIO_BASE)),
    crudesvio: async () => desvio5anos(await eia('PET.WCESTUS1.W', INICIO_BASE)),
    spr: async () => (await eia('PET.WCSSTUS1.W', INICIO_HIST)).map(p => ({ d: p.d, v: arred(p.v / 1000, 1) })),
    refinoeua: async () => (await eia('PET.WPULEUS3.W', INICIO_HIST)).map(p => ({ d: p.d, v: p.v })),
    demdistdesvio: async () => desvio5anos(mediaMovel(await eia('PET.WDIUPUS2.W', INICIO_BASE), 4)),
  };
  for (const [id, fn] of Object.entries(passos)) {
    try {
      const pts = await fn();
      let n = 0;
      for (const p of pts) if (registrar(id, p.d, p.v, 'eia')) n++;
      et.itens++;
      et.detalhe.push(`${id}: ${pts.length} pontos, ${n} novos ou revisados, último ${pts.at(-1)?.d} = ${pts.at(-1)?.v}`);
    } catch (e) {
      et.status = 'parcial';
      et.detalhe.push(`${id}: FALHOU ${e.message}`);
    }
  }
  return et;
}

// ---------- Banco Central ----------
async function etapaBCB() {
  const et = { etapa: 'bcb', status: 'ok', itens: 0, detalhe: [] };
  // PTAX de venda. Olinda é a via principal; a SGS (série 1) é reserva, porque bloqueia com frequência.
  const mdY = iso => { const [a, m, d] = iso.split('-'); return `${m}-${d}-${a}`; };
  const olinda = async () => {
    const url = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?@dataInicial='${mdY(INICIO_HIST)}'&@dataFinalCotacao='${mdY(HOJE)}'&$format=json&$select=cotacaoVenda,dataHoraCotacao`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('Olinda HTTP ' + r.status);
    return (await r.json()).value.map(p => ({ d: p.dataHoraCotacao.slice(0, 10), v: p.cotacaoVenda }));
  };
  const sgs = async () => {
    const [a, m, d] = INICIO_HIST.split('-'), [a2, m2, d2] = HOJE.split('-');
    const r = await fetch(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.1/dados?formato=json&dataInicial=${d}/${m}/${a}&dataFinal=${d2}/${m2}/${a2}`);
    const t = await r.text();
    if (!r.ok || !t.startsWith('[')) throw new Error('SGS HTTP ' + r.status);
    return JSON.parse(t).map(p => { const [dd, mm, aa] = p.data.split('/'); return { d: `${aa}-${mm}-${dd}`, v: Number(p.valor) }; });
  };
  try {
    let pts;
    try { pts = await olinda(); } catch (e) { et.detalhe.push(e.message + ', tentando SGS'); pts = await sgs(); }
    // Olinda pode trazer mais de um boletim por dia; fica o último (fechamento).
    pts = [...new Map(pts.map(p => [p.d, p])).values()];
    let n = 0;
    for (const p of pts) if (registrar('cambio', p.d, p.v, 'bcb')) n++;
    et.itens = 1;
    et.detalhe.push(`cambio: ${pts.length} pontos, ${n} novos, último ${pts.at(-1)?.d} = ${pts.at(-1)?.v}`);
  } catch (e) { et.status = 'falhou'; et.detalhe.push('cambio: ' + e.message); }
  return et;
}

// ---------- Claude com busca web ----------
async function perguntarClaude(pedido) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  const messages = [{ role: 'user', content: pedido }];
  let resp;
  // pause_turn: o laço de busca do servidor atingiu o limite; reenviar para ele continuar.
  for (let i = 0; i < 5; i++) {
    resp = await client.beta.messages.create({
      model: MODELO,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 25 }],
      messages,
    });
    if (resp.stop_reason !== 'pause_turn') break;
    messages.splice(1, messages.length - 1, { role: 'assistant', content: resp.content });
  }
  const texto = resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  return { texto, stop: resp.stop_reason, uso: resp.usage };
}

function montarPedidoCotacoes(ids) {
  const linhas = ids.map(id => { const i = PORID[id]; return `"${id}": ${i.nome}. ${i.dica}. Unidade: ${i.unidade}. Fonte preferida: ${i.fonte}.`; });
  return `Você é um assistente de dados de mercado. Hoje é ${HOJE}. Pesquise na web o valor mais recente publicado para cada item abaixo e devolva SOMENTE um objeto JSON, sem markdown, sem texto antes ou depois.

Chaves:
${linhas.join('\n')}

Para cada valor encontrado, inclua também a chave "<id>_data" com a data a que o número se refere (não a data da notícia), no formato "AAAA-MM-DD"; para dado mensal use o primeiro dia do mês de referência.

REGRAS DE SAÍDA, siga à risca:
- Inclua APENAS as chaves cujo valor você realmente encontrou em fonte publicada. Omita as demais, não escreva null. Não estime nem interpole.
- Valores são números puros, sem unidade, sem aspas, sem separador de milhar, ponto decimal. Percentuais como número (−12,5% vira -12.5).
- Variações "contra o ano anterior" são em percentual.
- Não escreva nenhum texto fora do objeto.
- Priorize nesta ordem, caso o espaço acabe: ${ids.join(', ')}.
Exemplo: {"crack":38.2,"crack_data":"2026-09-18","venezuela":1.25,"venezuela_data":"2026-08-01"}`;
}

// Extrai pares "chave": número mesmo de JSON incompleto ou truncado.
function extrairNumeros(texto) {
  const limpo = texto.replace(/```json|```/g, '');
  const valores = {}, datas = {};
  for (const m of limpo.matchAll(/"([a-z]+)"\s*:\s*(-?\d+(?:\.\d+)?)/g)) valores[m[1]] = parseFloat(m[2]);
  for (const m of limpo.matchAll(/"([a-z]+)_data"\s*:\s*"(\d{4}-\d{2}(?:-\d{2})?)"/g)) datas[m[1]] = m[2].length === 7 ? m[2] + '-01' : m[2];
  return { valores, datas };
}

async function etapaCotacoes() {
  const et = { etapa: 'cotacoes', status: 'ok', itens: 0, detalhe: [] };
  const ids = INDICADORES.filter(i => i.origem === 'ia').map(i => i.id);
  try {
    const { texto, stop, uso } = await perguntarClaude(montarPedidoCotacoes(ids));
    et.motivo = stop;
    et.bruto = texto.slice(0, 4000);
    et.tokens = uso && { entrada: uso.input_tokens, saida: uso.output_tokens };
    if (stop === 'refusal') throw new Error('modelo recusou o pedido');
    const { valores, datas } = extrairNumeros(texto);
    const limite = somaDias(HOJE, -150);
    for (const id of ids) {
      const v = valores[id];
      if (!Number.isFinite(v)) continue;
      const i = PORID[id];
      const amp = i.max - i.min;
      if (v < i.min - amp || v > i.max + amp) { et.detalhe.push(`${id}: ${v} rejeitado, fora da escala plausível`); continue; }
      let d = datas[id] || HOJE;
      if (d > HOJE || d < limite) d = HOJE;
      registrar(id, d, v, 'ia');
      et.itens++;
      et.detalhe.push(`${id}: ${v} (${d})`);
    }
    if (!et.itens) et.status = 'vazio';
    else if (stop === 'max_tokens') et.status = 'parcial';
  } catch (e) { et.status = 'falhou'; et.detalhe.push(e.message); }
  return et;
}

const PEDIDO_BRIEF = () => `Você é analista de inteligência de mercado de energia e bioinsumos. Hoje é ${HOJE}. Faça uma varredura das notícias das últimas 24 a 48 horas e devolva SOMENTE um objeto JSON, sem markdown, sem texto antes ou depois.

Contexto: acompanhamos o choque energético iniciado com o fechamento do Estreito de Ormuz em fevereiro de 2026. A tese central é que petróleo cru e diesel se descolaram, e que a escassez migrou do recurso para a capacidade de conversão.

Busque sinais nestas sete frentes:
1. Fluxo físico e segurança marítima: travessias em Ormuz, Bab el-Mandeb, seguro de guerra, seguro de atracação, ataques a navios em trânsito ou atracados, ameaças a portos do Kuwait, Bahrein, Catar e Arábia Saudita, escolta naval, ataques a infraestrutura energética, extensão geográfica do conflito para fora do Golfo
2. Refino e destilados: refinarias russas, embargo russo de diesel, estoques de destilado, margens de refino, capacidade de refino, consumo de diesel
3. Governança da oferta: OPEP, saídas de membros, Venezuela, Aramco, capacidade ociosa, decisões de produção
4. Eletricidade e data centers: turbinas a gás, preço de capacidade, leilões, curtailment no Brasil, Redata, PL 278/2026
5. Carbono e regulação: CBAM, SBCE, preço de certificado, EU ETS, mercado voluntário
6. Bioinsumos: biocarbono, biochar, HVO, biometano, pellets, offtakes, entrada de tradings globais, preço de matéria-prima
7. Brasil: imposto de exportação de petróleo, CNPE, mistura de biocombustíveis, ANP, preço, refino, importação e vendas de diesel, fertilizantes

Regras rígidas:
- Só inclua o que muda alguma conclusão ou número. Notícia genérica de contexto não entra.
- Cite sempre a FONTE PRIMÁRIA (Bloomberg, Reuters, EIA, AIE, ANP, agência oficial), nunca o agregador que republicou.
- Se não encontrar nada relevante, devolva a lista vazia. Dia sem sinal é resultado válido.
- Máximo de TRÊS sinais, os mais relevantes. Cada campo em no máximo 25 palavras.
- Não escreva nada fora do objeto JSON.

Formato:
{"sinais":[{"titulo":"","fonte":"","dado":"","implicacao":"","frente":"","relevancia":"alto|medio|baixo"}]}`;

function extrairSinais(texto) {
  const limpo = texto.replace(/```json|```/g, '').trim();
  const i0 = limpo.indexOf('{'), i1 = limpo.lastIndexOf('}');
  if (i0 >= 0 && i1 > i0) {
    try { const o = JSON.parse(limpo.slice(i0, i1 + 1)); if (Array.isArray(o.sinais)) return o.sinais.slice(0, 3); } catch { /* recuperação parcial abaixo */ }
  }
  const out = [];
  for (const m of limpo.matchAll(/\{[^{}]*"titulo"[^{}]*\}/g)) { try { out.push(JSON.parse(m[0])); } catch {} if (out.length === 3) break; }
  return out;
}

async function etapaBriefing() {
  const et = { etapa: 'briefing', status: 'ok', itens: 0, detalhe: [] };
  try {
    const { texto, stop } = await perguntarClaude(PEDIDO_BRIEF());
    et.motivo = stop;
    et.bruto = texto.slice(0, 4000);
    if (stop === 'refusal') throw new Error('modelo recusou o pedido');
    const sinais = extrairSinais(texto);
    const b = await lerJson('briefings.json', { dias: {} });
    b.dias[HOJE] = { sinais, em: new Date().toISOString() };
    const chaves = Object.keys(b.dias).sort();
    while (chaves.length > 120) delete b.dias[chaves.shift()];
    await gravarJson('briefings.json', b);
    et.itens = sinais.length;
    et.detalhe.push(sinais.length ? `${sinais.length} sinais` : 'dia sem sinal');
  } catch (e) { et.status = 'falhou'; et.detalhe.push(e.message); }
  return et;
}

// ---------- lançamentos manuais ----------
function etapaManual() {
  const txt = (process.env.PAINEL_LANCAMENTOS || '').trim();
  if (!txt) return null;
  const et = { etapa: 'manual', status: 'ok', itens: 0, detalhe: [] };
  for (const parte of txt.split(/[;\n]+/).map(s => s.trim()).filter(Boolean)) {
    const m = parte.match(/^([a-z]+)\s*=\s*(-?[\d.,]+)\s*(?:@\s*(\d{4}-\d{2}-\d{2}))?$/);
    if (!m || !PORID[m[1]]) { et.status = 'parcial'; et.detalhe.push(`não reconhecido: ${parte}`); continue; }
    const v = parseFloat(m[2].replace(',', '.'));
    registrar(m[1], m[3] || HOJE, v, 'manual');
    et.itens++;
    et.detalhe.push(`${m[1]} = ${v} (${m[3] || HOJE})`);
  }
  return et;
}

// ---------- execução ----------
for (const [id, d, v] of SEMENTES) {
  if (!(leituras.series[id] || []).some(p => p.d === d)) registrar(id, d, v, 'doc');
}

execucao.etapas.push(await etapaEIA());
execucao.etapas.push(await etapaBCB());
const manual = etapaManual();
if (manual) execucao.etapas.push(manual);

if (ARG.has('--sem-ia')) {
  execucao.etapas.push({ etapa: 'cotacoes', status: 'pulado', itens: 0, detalhe: ['--sem-ia'] });
} else if (!process.env.ANTHROPIC_API_KEY) {
  execucao.etapas.push({ etapa: 'cotacoes', status: 'pulado', itens: 0, detalhe: ['ANTHROPIC_API_KEY não configurada'] });
} else {
  execucao.etapas.push(await etapaCotacoes());
  execucao.etapas.push(await etapaBriefing());
}

for (const s of Object.values(leituras.series)) s.sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : a.f < b.f ? -1 : 1);
leituras.correcoes = leituras.correcoes.slice(-500);
leituras.atualizado_em = execucao.em;
await gravarJson('leituras.json', leituras);

const hist = await lerJson('execucoes.json', { execucoes: [] });
hist.execucoes.unshift(execucao);
hist.execucoes = hist.execucoes.slice(0, 60);
await gravarJson('execucoes.json', hist);

for (const et of execucao.etapas) {
  console.log(`[${et.etapa}] ${et.status} · ${et.itens} itens${et.motivo ? ' · stop ' + et.motivo : ''}`);
  for (const l of et.detalhe) console.log('   ' + l);
}
if (execucao.etapas.every(e => e.status === 'falhou')) process.exit(1);
