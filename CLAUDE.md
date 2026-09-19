# Painel Ormuz

Instrumento de acompanhamento do choque energético de 2026, voltado a
decisões de originação de bioinsumos industriais. Site estático no GitHub
Pages, dados coletados diariamente por GitHub Actions.

## Antes de codar
Leia docs/especificacao.md (só na cópia local, fora do Git). A seção 8 lista erros já cometidos.
docs/handoff-claude-code.md descreve uma arquitetura Next.js + SQLite que foi
substituída pela versão estática atual, porque GitHub Pages não roda servidor.

## Princípios
- Cada indicador existe para testar uma afirmação de
  docs/analise-choque-energetico.md. Indicador que não responde a nenhuma
  pergunta do documento não entra.
- Dado, faixa e texto de interpretação são coisas separadas, com ciclos de
  vida diferentes. Faixa se recalibra, texto se reescreve, série não se toca.
- Faixa alterada gera registro em data/faixas-historico.json.
- Correção de valor fica registrada (leituras.json → correcoes).
- Fonte única ou divergente é sinalizada na interface. Ordem de grandeza não
  se apresenta como medida.
- Estoque e fluxo nunca dividem a mesma série. Estoque se mede como desvio
  contra a média sazonal, não volume absoluto.

## Comandos
npm run atualizar · npm run atualizar:sem-ia · npm run servir
