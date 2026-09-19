# Painel Ormuz

Acompanhamento diário do choque energético de 2026 e do repasse para custo no Brasil. Página estática publicada no GitHub Pages; os dados são coletados todo dia às 19h (Brasília) por um GitHub Action e gravados em `data/`.

## Como funciona

```
GitHub Actions (19h)  ──►  scripts/atualizar.mjs  ──►  data/leituras.json  ──►  index.html (gráficos)
                              │ EIA API        Brent, crack NY, estoques, SPR, refino e consumo EUA
                              │ Banco Central  câmbio PTAX
                              │ Claude + busca web   demais indicadores e varredura de notícias
```

- **Fontes oficiais** (EIA e Banco Central) trazem o histórico desde janeiro de 2025 já na primeira coleta, então esses gráficos têm tendência desde o primeiro dia.
- **Indicadores sem API** (crack europeu, seguro, travessias, ureia, diesel na bomba, refino e vendas no Brasil etc.) são buscados na web pelo Claude uma vez por dia, com a data de referência do número. A série desses indicadores cresce a cada coleta.
- Cada ponto guarda a **fonte** (`eia`, `bcb`, `ia`, `manual`, `doc`). Valor revisado não é sobrescrito em silêncio: a mudança fica em `correcoes` dentro de `leituras.json`.
- A aba **Coleta** mostra o diagnóstico de cada execução, incluindo a resposta bruta da busca.

## Configuração (uma vez)

1. **Pages:** em *Settings → Pages*, em *Source* escolha **GitHub Actions**.
2. **Chaves** em *Settings → Secrets and variables → Actions → New repository secret*:
   - `EIA_API_KEY`: gratuita, em <https://www.eia.gov/opendata/register.php>. Sem ela o script usa a chave de demonstração, que é limitada e costuma falhar.
   - `ANTHROPIC_API_KEY`: habilita a busca web e o briefing. Sem ela só os indicadores de API oficial são atualizados.
3. Opcional, em *Variables*: `PAINEL_MODELO` para trocar o modelo (padrão `claude-opus-5`; `claude-sonnet-5` custa menos).
4. Rode a primeira coleta em *Actions → Atualizar painel → Run workflow*.

## Uso no dia a dia

| Quero | Como |
|---|---|
| Lançar um valor à mão | *Actions → Atualizar painel → Run workflow* e preencha `lancamentos`, ex.: `diesel=6.52@2026-09-15; ureia=610` |
| Atualizar um marco | Edite `estado`, `situacao` e `atualizado_em` em `data/marcos.json` |
| Mudar faixa de alerta | Edite `data/indicadores.json` e registre a faixa anterior em `data/faixas-historico.json` |
| Criar gatilho | Acrescente em `data/gatilhos.json`, condições por indicador ou marco, com persistência opcional em dias |
| Levar séries para planilha | Botão **Baixar CSV** na página (separador `;`, decimal com vírgula) |
| Ver localmente | `npm install`, depois `npm run atualizar:sem-ia` e `npm run servir`, e abra <http://localhost:8080> |

## Estrutura

```
index.html, assets/          página e gráficos (Chart.js)
data/indicadores.json        definição, faixas e textos de cada indicador
data/leituras.json           séries (gerado pela coleta)
data/marcos.json             marcos com estado
data/gatilhos.json           gatilhos avaliados na página
data/eventos.json            eventos marcados nos gráficos
data/briefings.json          varredura diária de notícias (gerado)
data/execucoes.json          diagnóstico das coletas (gerado)
scripts/atualizar.mjs        coleta
docs/                        especificação e análise (só na cópia local, fora do Git)
legacy/painel-ormuz.html     protótipo original, referência de comportamento
```

## Ressalvas

Indicadores marcados como fonte única ou divergente devem ser lidos como ordem de grandeza. Em Ormuz, qualquer contagem é piso, porque parte da frota transita com transponder desligado. Faixas marcadas como provisórias foram calibradas por julgamento, sem histórico. O painel direciona atenção e dispara revisões; não serve para precificar negócio.
