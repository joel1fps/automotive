# Ticker reutilizável — React + Motion

Implementação própria do comportamento solicitado, sem Motion+. Referência visual: https://motion.dev/examples/react-ticker.

Arquivos: `src/components/ticker.tsx`, `ticker.css` e `ticker-example.tsx`. O exemplo tem oito itens. No site, o componente exibe todos os dez extras existentes, sem cortar serviços para caber no exemplo.

## Usar em React + Vite

Em um projeto Vite com React e TypeScript, execute `npm install motion`. Copie os três arquivos para a mesma pasta. Importe `TickerExample` de `./components/ticker-example` e renderize `<TickerExample />` no App. O CSS é importado pelo componente. A diretiva `use client` é necessária no Next.js e inofensiva no Vite. Não há dependência de roteador, Next.js ou Motion+ nesses três arquivos.

## Props

| Prop | Padrão | Uso |
|---|---|---|
| items | obrigatória | Array de `{ id: string, content: ReactNode }`, com IDs únicos |
| velocity | 50 | Velocidade não negativa em px/s |
| direction | left | `left` ou `right` |
| gap | 24 | Espaçamento em pixels |
| hoverSlowdown | 0 | 0 pausa no hover; 0.2 mantém 20% da velocidade; 1 mantém a velocidade |
| label | Serviços em destaque | Nome acessível da seção |

A largura dos cards usa `--ticker-item-width` na classe `.ticker`. Ajuste o visual em `ticker.css`. O exemplo usa `.ticker-demo-card`, com estilo incluído. Use conteúdo sem IDs HTML fixos, pois haverá cópias visuais dos itens.

## Comportamento

`useAnimationFrame` atualiza `useMotionValue` em pixels/segundo. `wrap` reaproveita o offset na largura exata de um grupo, incluindo o espaço final. `ResizeObserver` mede cards/container e calcula quantas cópias cobrem a viewport. O número de cópias é recalculado em mudanças de tamanho ou conteúdo.

Hover desacelera/retoma suavemente; `whileHover` e `variants` ampliam o card a 1.08 e reduzem a opacidade dos demais. A máscara suaviza as bordas. Animação para fora da viewport e com aba oculta. Não há alteração animada de left/width.

O botão Pausar movimento oferece controle explícito. Com movimento reduzido ou foco de teclado nos cards, fica uma lista estática com rolagem horizontal. As cópias não repetem anúncios nem paradas de Tab; links nas cópias visuais continuam clicáveis com mouse/toque. Lista vazia não renderiza ticker.

## Projeto Automotive

Integrado à seção Proteção, brilho e acabamento em `public-site.tsx`, com velocidade 48 px/s e pausa no hover. A transição de portas foi restaurada na v7 e funciona junto com o ticker. O projeto principal continua Next.js; não foi migrado para Vite. As alterações anteriores da abertura com logo e botão único de retorno permanecem.

Verificação direcionada: `BASE_URL` deve apontar para o servidor local, e `node scripts/verify-ticker.mjs` executa o teste no Chromium do Playwright. Evidências em `../evidencias/versao-v6/`.
