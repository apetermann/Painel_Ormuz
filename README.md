# Painel Ormuz

Acompanhamento diário do choque energético de 2026 e do repasse para custo no Brasil. Página estática publicada no GitHub Pages; os dados são coletados todo dia às 19h (Brasília) por um GitHub Action e gravados em `data/`.

## Como funciona

```
GitHub Actions (seg 19h) ─►  scripts/atualizar.mjs  ──►  data/leituras.json  ──►  index.html (gráficos)
                              │ EIA API        Brent, crack NY, estoques, SPR, refino e consumo EUA
                              │ Banco Central  câmbio PTAX
                              │ Claude + busca web   demais indicadores e varredura de notícias
```

- A coleta roda **uma vez por semana, nas segundas às 19h**, e é **gratuita**: só EIA e Banco Central. Como cada execução baixa o histórico inteiro, as séries diárias chegam completas.
- A **busca web é a única etapa que custa** e está desligada no agendamento. Ela roda quando você usa *Run workflow* (o botão **Atualizar agora** da página). Para voltar ao semanal automático, crie a variável `PAINEL_BUSCA` com valor `auto`.
- **Fontes oficiais** (EIA e Banco Central) trazem o histórico desde janeiro de 2025 já na primeira coleta, então esses gráficos têm tendência desde o primeiro dia.
- **Indicadores sem API** (crack europeu, seguro, travessias, ureia, diesel na bomba, refino e vendas no Brasil etc.) são buscados na web pelo Claude, com a data de referência do número. É a única etapa que consome tokens, e por isso roda uma vez por semana; se uma execução escorregar de dia, a seguinte repõe, porque o critério é ter passado seis dias da última busca, não ser segunda.
- Cada ponto guarda a **fonte** (`eia`, `bcb`, `ia`, `manual`, `doc`). Valor revisado não é sobrescrito em silêncio: a mudança fica em `correcoes` dentro de `leituras.json`.
- A aba **Coleta** mostra o diagnóstico de cada execução, incluindo a resposta bruta da busca.

## Configuração (uma vez)

1. **Pages:** em *Settings → Pages*, em *Source* escolha **GitHub Actions**.
2. **Chaves** em *Settings → Secrets and variables → Actions → New repository secret*:
   - `EIA_API_KEY`: gratuita, em <https://www.eia.gov/opendata/register.php>. Sem ela o script usa a chave de demonstração, que é limitada e costuma falhar.
   - `ANTHROPIC_API_KEY`: habilita a busca web e o briefing. Sem ela só os indicadores de API oficial são atualizados.
3. Opcional, em *Variables*: `PAINEL_MODELO` para trocar o modelo (padrão `claude-haiku-4-5`, o mais barato; `claude-sonnet-5` acerta mais número e data, pelo dobro; `claude-opus-5` é o mais caro) e `PAINEL_BUSCA=auto` para religar a busca semanal automática.
4. Rode a primeira coleta em *Actions → Atualizar painel → Run workflow*.

## Uso no dia a dia

| Quero | Como |
|---|---|
| Lançar um valor à mão | *Actions → Atualizar painel → Run workflow* e preencha `lancamentos`, ex.: `diesel=6.52@2026-09-15; ureia=610` |
| Atualizar um marco | Edite `estado`, `situacao` e `atualizado_em` em `data/marcos.json` |
| Mudar faixa de alerta | Edite `data/indicadores.json` e registre a faixa anterior em `data/faixas-historico.json` |
| Reativar indicador aposentado | Devolva a definição de `data/aposentados.json` para `indicadores.json`, a série para `leituras.json` e o gatilho para `gatilhos.json` |
| Criar gatilho | Acrescente em `data/gatilhos.json`, condições por indicador ou marco, com persistência opcional em dias |
| Buscar os indicadores que dependem de web | Botão **Atualizar agora** na página, ou *Run workflow*: é a única execução que gera custo, cerca de US$ 0,30 a 0,80 |
| Comparar custo entre modelos | *Run workflow* e escolha o modelo no campo `modelo`; a aba **Coleta** mostra o modelo e os tokens de cada execução |
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
data/aposentados.json        indicadores e gatilhos retirados, com série preservada
scripts/atualizar.mjs        coleta
docs/                        especificação e análise (só na cópia local, fora do Git)
legacy/painel-ormuz.html     protótipo original, referência de comportamento
```

## Ressalvas

Indicadores marcados como fonte única ou divergente devem ser lidos como ordem de grandeza. Em Ormuz, qualquer contagem é piso, porque parte da frota transita com transponder desligado. Faixas marcadas como provisórias foram calibradas por julgamento, sem histórico. O painel direciona atenção e dispara revisões; não serve para precificar negócio.
