# CoverflowCarousel

Componente React/TypeScript próprio, com Motion, sem Motion+. Referência visual: https://motion.dev/examples/react-carousel-coverflow.

Arquivos: `src/components/coverflow-carousel.tsx` e `coverflow-carousel.css`. Usáveis também em React + Vite com `npm install motion`; não dependem do roteador nem de Next.js. O projeto Automotive mantém Next.js.

## Exemplo

```tsx
import { CoverflowCarousel } from './components/coverflow-carousel';

const items = [
  { id: 'polimento', title: 'Polimento', content: <img src='/polimento.webp' alt='Polimento' draggable={false} /> },
  { id: 'higienizacao', title: 'Higienização', content: <img src='/higienizacao.webp' alt='Higienização' draggable={false} /> },
  { id: 'lavagem', title: 'Lavagem', content: <img src='/lavagem.webp' alt='Lavagem' draggable={false} /> },
];

export default function Example() {
  return <CoverflowCarousel items={items} itemWidth={360} gap={24} maxRotate={45} sideScale={0.8} />;
}
```

`items` recebe IDs únicos, título e conteúdo visual não interativo (o card já é um botão). `itemWidth` é a largura máxima em pixels; no celular ela se ajusta a 72% da viewport do carrossel. `gap` é a separação lógica entre itens antes da sobreposição. `maxRotate` controla a rotação dos vizinhos, e `sideScale` sua escala.

Um único MotionValue em pixels controla a posição. Cada card deriva seu offset fracionário com useTransform; rotação, escala, translação de sobreposição, opacidade e ordem visual derivam desse offset. Não há estado React nem medições de layout por frame. ResizeObserver mede apenas redimensionamentos.

Arraste em x com limites e elasticidade; ao soltar, a velocidade é projetada e o índice mais próximo recebe snap por spring (300/30). É snap de posição transformada, não CSS scroll-snap, pois não existe rolagem nativa nesse track. Setas, teclado (←, →, Home, End) e clique nos cards laterais também centralizam. Movimento reduzido remove rotação e spring, mantendo escala/posição.

Integrado a Cada detalhe, um serviço, com as seis artes originais. Portas entre páginas e ticker da outra seção preservados. Nenhuma sombra que segue o ponteiro foi reintroduzida.
