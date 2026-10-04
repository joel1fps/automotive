# 🚗 Automotive — Lava a Jato e Serviços
### Especificação completa do site profissional de Lavagem Estética Automotiva

> Documento-guia para desenvolvimento. Contém identidade visual, stack, módulos, regras de negócio, modelo de dados, animações e roadmap.

---

## 1. Visão Geral

| Item | Definição |
|---|---|
| **Projeto** | Site + sistema de agendamento e gestão para lava a jato / estética automotiva |
| **Marca** | Automotive — Lava a Jato e Serviços |
| **Objetivo** | Site institucional premium + plataforma de agendamentos, fidelidade e financeiro |
| **Perfis de acesso** | Visitante, Cliente, Administrador |
| **Autenticação** | Clerk (e-mail + Login com Google) |
| **Banco de dados** | MongoDB |
| **Animações** | Motion (https://motion.dev/) |

---

## 2. Identidade Visual

Cores extraídas dos materiais enviados (logo e tabela de preços).

### 2.1 Paleta

| Papel | Cor | HEX |
|---|---|---|
| Azul petróleo (fundo hero / degradê claro) | 🟦 | `#037C9B` |
| Azul petróleo médio | 🟦 | `#007193` |
| Azul profundo (degradê escuro) | 🟦 | `#033B5C` |
| Azul noturno (fim do degradê) | 🟦 | `#02394E` |
| Azul royal da tabela de preços (seções, cards) | 🟦 | `#1D3E85` |
| Azul vibrante do logo (detalhes, CTAs) | 🟦 | `#1F4FC4` *(confirmar no arquivo vetorial)* |
| Preto principal | ⬛ | `#0B0C10` |
| Branco | ⬜ | `#FFFFFF` |

### 2.2 Tokens CSS sugeridos

```css
:root {
  --brand-teal-400: #037c9b;
  --brand-teal-500: #007193;
  --brand-teal-800: #033b5c;
  --brand-teal-900: #02394e;
  --brand-blue-600: #1d3e85;
  --brand-blue-500: #1f4fc4;
  --ink-900: #0b0c10;
  --white: #ffffff;

  --gradient-hero: radial-gradient(120% 100% at 50% 0%, #037c9b 0%, #033b5c 55%, #0b0c10 100%);
  --gradient-cta: linear-gradient(135deg, #1f4fc4 0%, #037c9b 100%);
}
```

### 2.3 Tipografia

- **Títulos:** fonte condensada, pesada e em caixa alta, seguindo o estilo da tabela de preços (ex.: *Bebas Neue*, *Anton* ou *Oswald*).
- **Logo/subtítulos:** letras largas com espaçamento (tracking) generoso, como em "LAVA A JATO E SERVIÇOS" (ex.: *Orbitron* ou *Rajdhani* para detalhes).
- **Corpo:** *Inter* ou *Manrope*.

### 2.4 Direção de arte

- Tema **escuro premium** com degradês azul-petróleo → preto.
- Logo (silhueta de carro com "swoosh" azul) como elemento recorrente: marca d'água, loader e divisores.
- Cards com efeito **glassmorphism** sobre o fundo azul.
- Fotos reais de carros brilhando, gotas d'água, espuma e reflexos (aplicar overlay azul).
- Assets recebidos: `AUTOMOTIVE.png` (logo em fundo petróleo), `BRENDA 01.png` (logo em alta resolução com fundo transparente), `logos fundo preto e fundo branco.pdf` (variações) e a tabela de preços.

---

## 3. Stack Tecnológica

| Camada | Tecnologia |
|---|---|
| Framework | **Next.js (App Router) + TypeScript** |
| Estilo | Tailwind CSS + shadcn/ui |
| Animações | **Motion** (`motion/react`) |
| Autenticação | **Clerk** (`@clerk/nextjs`) com provedor Google |
| Banco de dados | **MongoDB** (Atlas) + **Mongoose** |
| Validação | Zod + React Hook Form |
| Datas | date-fns (fuso `America/Fortaleza`) |
| Gráficos | Recharts |
| Exportação Excel | ExcelJS (`.xlsx` gerado no servidor) |
| Deploy | Vercel + MongoDB Atlas |
| Notificações (opcional) | WhatsApp (link `wa.me` ou API) e e-mail (Resend) |

### Variáveis de ambiente

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/entrar
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/cadastro
MONGODB_URI=
CLERK_WEBHOOK_SECRET=
ADMIN_EMAILS=email1@exemplo.com
```

---

## 4. Animações (referência: motion.dev)

Objetivo: sensação de site de marca premium, fluido e vivo, sem prejudicar performance.

### 4.1 Animações globais

| Efeito | Onde | API do Motion |
|---|---|---|
| **Loader de entrada** com o carro sendo "desenhado" (path do logo) | Abertura do site | `pathLength` animado em SVG |
| **Transições de página** suaves | Entre rotas | `AnimatePresence` + `layout` |
| **Cursor customizado** com brilho azul | Desktop | `useMotionValue` + `useSpring` |
| **Barra de progresso de scroll** | Topo | `useScroll` + `scaleX` |
| **Menu animado** com stagger | Header/mobile | `variants` + `staggerChildren` |

### 4.2 Animações por seção

| Seção | Animação |
|---|---|
| **Hero** | Título com revelação por palavra/letra (stagger), carro entrando com parallax, gotas d'água e partículas flutuando |
| **Antes e Depois** | Slider de comparação arrastável (`drag`) com revelação por `clip-path` |
| **Serviços** | Cards com `whileHover` (elevação + brilho), entrada em cascata com `whileInView` |
| **Tabela de preços** | Números contando (count-up) ao entrar na tela; cards que trocam de tamanho de veículo com `layoutId` |
| **Fidelidade** | Selos/carimbos que "carimbam" com spring; barra de progresso preenchendo |
| **Depoimentos** | Carrossel com `drag` e inércia |
| **Números** | Contadores (carros lavados, clientes, anos) com `useInView` |
| **Rodapé/CTA** | Botão magnético (segue o cursor) e onda azul animada |

### 4.3 Painéis (Cliente/Admin)

- Listas com `layout` (reordenação animada ao aceitar/recusar agendamento).
- Modais com `AnimatePresence` (entrada e saída).
- Gráficos do financeiro animando ao carregar.
- Feedback de sucesso (check animado) ao confirmar ações.
- Skeleton loading com shimmer azul.

### 4.4 Regras de performance e acessibilidade

- Animar apenas `transform` e `opacity` sempre que possível.
- Respeitar `prefers-reduced-motion` (`useReducedMotion`).
- Usar `LazyMotion` para reduzir o bundle.
- Meta: Lighthouse ≥ 90 em Performance.

---

## 5. Arquitetura de Rotas

```
/                       → Home (institucional)
/servicos               → Serviços e tabela de preços
/galeria                → Antes e depois
/contato                → Localização, WhatsApp, horários
/entrar  /cadastro      → Clerk (e-mail + Google)

/cliente                → Painel do cliente
/cliente/agendar        → Solicitar agendamento
/cliente/fidelidade     → Progresso de fidelidade e cupons
/cliente/historico      → Meus agendamentos

/admin                  → Dashboard
/admin/agendamentos     → Aceitar, recusar, adicionar, concluir
/admin/clientes         → Lista e fidelidade
/admin/servicos         → Catálogo e preços
/admin/financeiro       → Faturamento, lançamentos, exportação
/admin/cupons           → Cupons emitidos e usados
```

---

## 6. Autenticação e Perfis (Clerk)

### 6.1 Login

- Login com **e-mail/senha** e **Google** (OAuth).
- Ao criar o usuário, um **webhook do Clerk** cria o documento `User` no MongoDB.

### 6.2 Controle de acesso (RBAC)

| Perfil | Como é definido |
|---|---|
| **Cliente** | Padrão para qualquer novo cadastro (`publicMetadata.role = "client"`) |
| **Administrador** | `publicMetadata.role = "admin"`, atribuído manualmente no dashboard do Clerk (ou por e-mail em `ADMIN_EMAILS`) |

- `middleware.ts` protege `/cliente/*` (logado) e `/admin/*` (somente admin).
- **Toda API valida o papel no servidor.** Não confiar apenas na ocultação de telas.
- Cliente que tentar acessar `/admin` é redirecionado.

---

## 7. Módulo Cliente

O cliente tem acesso **somente** a:

1. **Solicitar agendamento**
   - Escolher tipo de veículo: Carro pequeno, SUV ou Caminhonete.
   - Escolher serviço, data e horário disponível.
   - Informar modelo e placa do veículo e observações.
   - Se tiver cupom disponível, pode aplicá-lo.
   - O pedido entra como **Pendente** até o admin aceitar.
2. **Ver fidelidade**: quantas lavagens faltam para a lavagem grátis, com barra de progresso animada (ex.: "7/10 — faltam 3").
3. **Ver o status dos seus pedidos** (pendente, confirmado, concluído, recusado).

O cliente **não** vê financeiro, outros clientes nem configurações.

---

## 8. Módulo Administrador

### 8.1 Agendamentos

- Lista e calendário (dia/semana) com filtros por status.
- **Aceitar** ou **recusar** solicitações (com motivo opcional).
- **Adicionar agendamento manualmente** (cliente que ligou ou veio no balcão), escolhendo um cliente cadastrado ou informando um nome avulso.
- **Concluir** o serviço, registrando forma de pagamento e valor final.
- Reagendar e cancelar.
- Bloqueio de horários e configuração de capacidade por horário.

### 8.2 Clientes

- Lista com busca, veículos, histórico e progresso de fidelidade.
- Ajuste manual de pontos, com registro de motivo.

### 8.3 Catálogo de serviços

- CRUD de serviços e preços por tipo de veículo.
- Ativar/desativar serviços.

---

## 9. Sistema de Fidelidade

### Regra de negócio

> **A cada 10 lavagens concluídas, o cliente ganha 1 cupom de Lavagem Simples Básica gratuita.**

- O contador só avança quando o admin marca o agendamento como **Concluído** (evita fraude).
- Ao atingir 10, o sistema gera automaticamente um **cupom** e zera o ciclo (o excedente é mantido: 11ª lavagem = 1/10 no novo ciclo).
- O cupom é de uso único, vinculado ao cliente, e válido para a categoria **Lavagem Simples** do tamanho do veículo dele.
- Uma lavagem paga com cupom **não** conta como ponto no ciclo seguinte.
- Sugestão: cupom com validade configurável (ex.: 90 dias), definida pelo admin.
- O cliente vê: progresso atual, cupons disponíveis e cupons usados.

### Fluxo

```
Admin conclui agendamento
   └─► loyaltyCount += 1
        └─► se loyaltyCount ≥ 10
             ├─► cria Coupon (status: available)
             ├─► loyaltyCount -= 10
             └─► notifica o cliente
```

---

## 10. Módulo Financeiro (somente Admin)

### 10.1 Visões

- **Diário**, **Semanal** e **Mensal**, com seletor de período.
- Cards de resumo: faturamento total, nº de serviços, ticket médio, comparativo com o período anterior.
- Gráficos: linha (evolução), barras (por serviço) e pizza (formas de pagamento).
- Lista de entradas com filtros.

### 10.2 Entradas

- **Automáticas:** todo agendamento concluído gera uma entrada com o valor cobrado.
- **Lançamentos avulsos (serviços diversos):** o admin registra serviços fora da tabela padrão, como **PPF**, vitrificação, película, polimento técnico e higienização completa.
  - Campos: descrição, categoria, cliente (opcional), valor, forma de pagamento, data e observação.
- Lavagens pagas com cupom entram com valor **R$ 0,00** (e ficam identificadas como "cortesia fidelidade").

### 10.3 Exportação para Excel

- Botão **"Exportar Excel (.xlsx)"** respeitando o período e os filtros da tela.
- Planilha com:
  - **Aba "Resumo":** totais por dia, semana ou mês.
  - **Aba "Entradas":** data, cliente, serviço, categoria, forma de pagamento e valor.
  - **Aba "Por serviço":** total agrupado por serviço.
- Valores formatados em moeda (R$) e cabeçalho com as cores da marca.

---

## 11. Catálogo Inicial de Serviços (tabela de preços informada)

### Lavagens

| Veículo | Lavagem Externa | Lavagem Simples | Lavagem Completa / Polimento |
|---|---|---|---|
| **Carro pequeno** | R$ 30,00 | R$ 50,00 | R$ 60,00 |
| **SUV** | R$ 40,00 | R$ 65,00 | R$ 75,00 |
| **Caminhonete** | R$ 50,00 | R$ 80,00 | R$ 90,00 |

### Outros serviços (valor sob consulta / lançamento avulso)

- Higienização completa
- Higienização de motor
- Hidratação de bancos de couro
- Revitalização de farol
- Polimento técnico e comercial
- Vitrificação
- Película
- PPF

> **Aviso legal (exibir no site e no agendamento):** *"Não nos responsabilizamos por qualquer objeto de valor deixado dentro do veículo."*

---

## 12. Modelo de Dados (MongoDB / Mongoose)

```ts
// users
{
  _id, clerkId: string (unique), name, email, phone,
  role: "client" | "admin",
  loyaltyCount: number,        // 0–9 no ciclo atual
  totalWashes: number,
  vehicles: [{ model, plate, type: "small" | "suv" | "pickup" }],
  createdAt, updatedAt
}

// services
{
  _id, name, category: "wash" | "extra",
  prices: { small: number, suv: number, pickup: number } | null,
  countsForLoyalty: boolean,   // true nas lavagens
  active: boolean
}

// appointments
{
  _id, userId | null, guestName?, vehicle: { model, plate, type },
  serviceId, scheduledAt: Date,
  status: "pending" | "confirmed" | "completed" | "rejected" | "cancelled",
  createdBy: "client" | "admin",
  couponId?: ObjectId,
  finalPrice?: number, paymentMethod?: "pix" | "cash" | "card",
  notes, rejectionReason?, completedAt?
}

// coupons
{
  _id, userId, type: "simple_wash_free",
  status: "available" | "used" | "expired",
  issuedAt, expiresAt?, usedAt?, usedInAppointmentId?
}

// transactions  (financeiro)
{
  _id, date: Date, description, category: string,
  source: "appointment" | "manual",
  appointmentId?, userId?, amount: number,
  paymentMethod, createdBy: adminClerkId
}

// settings
{ loyaltyTarget: 10, couponValidityDays, openingHours, slotDuration, capacityPerSlot }
```

**Índices:** `users.clerkId`, `appointments.scheduledAt + status`, `transactions.date`, `coupons.userId + status`.

---

## 13. Endpoints da API

| Método | Rota | Acesso | Função |
|---|---|---|---|
| POST | `/api/webhooks/clerk` | Clerk | Sincronizar usuário |
| GET | `/api/slots?date=` | Logado | Horários livres |
| POST | `/api/appointments` | Cliente | Solicitar agendamento |
| GET | `/api/appointments/me` | Cliente | Meus agendamentos |
| GET | `/api/loyalty/me` | Cliente | Progresso e cupons |
| GET | `/api/admin/appointments` | Admin | Listar/filtrar |
| POST | `/api/admin/appointments` | Admin | Criar manualmente |
| PATCH | `/api/admin/appointments/:id` | Admin | Aceitar, recusar, concluir |
| GET/POST | `/api/admin/transactions` | Admin | Entradas e lançamentos |
| GET | `/api/admin/finance/summary?range=day\|week\|month` | Admin | Resumo financeiro |
| GET | `/api/admin/finance/export?from=&to=` | Admin | Baixar `.xlsx` |
| CRUD | `/api/admin/services`, `/api/admin/clients` | Admin | Gestão |

---

## 14. Estrutura de Seções da Home

1. **Hero:** logo, frase de impacto, botões "Agendar agora" e "Ver serviços".
2. **Diferenciais:** produtos premium, equipe treinada, rapidez, cuidado.
3. **Serviços:** cards animados.
4. **Tabela de preços:** alternância Carro pequeno / SUV / Caminhonete.
5. **Antes e depois:** slider interativo.
6. **Programa de fidelidade:** "A cada 10 lavagens, 1 grátis".
7. **Depoimentos.**
8. **FAQ.**
9. **Contato:** mapa, horário, WhatsApp e Instagram.
10. **Rodapé:** logo, links e aviso legal.

---

## 15. Requisitos Não Funcionais

- **Responsivo mobile-first** (maior parte dos clientes acessará pelo celular).
- **SEO local:** metadados, schema `LocalBusiness`, Open Graph.
- **Segurança:** validação com Zod em todas as rotas, checagem de papel no servidor, rate limit nos endpoints públicos.
- **LGPD:** política de privacidade e consentimento no cadastro.
- **Acessibilidade:** contraste adequado sobre o azul, foco visível, `aria-labels`.
- **Fuso horário:** todas as datas tratadas no fuso local do estabelecimento.

---

## 16. Roadmap de Desenvolvimento

| Fase | Entrega |
|---|---|
| **1. Base** | Projeto Next.js, Tailwind, tokens de marca, Clerk (e-mail + Google), MongoDB, webhook, RBAC |
| **2. Site institucional** | Home, serviços, preços, galeria, contato, com todas as animações |
| **3. Agendamento** | Slots, solicitação do cliente, painel admin (aceitar/adicionar/concluir) |
| **4. Fidelidade** | Contador, geração de cupom, tela do cliente |
| **5. Financeiro** | Entradas automáticas, lançamentos avulsos (PPF etc.), gráficos, exportação Excel |
| **6. Polimento** | Notificações, SEO, testes, performance, deploy |

---

## 17. Critérios de Aceite

- [ ] Login com Google e e-mail funcionando via Clerk.
- [ ] Admin e cliente enxergam telas diferentes; cliente não acessa rotas `/admin` nem as APIs de admin.
- [ ] Cliente solicita agendamento; admin aceita, recusa ou cria agendamentos.
- [ ] A 10ª lavagem concluída gera 1 cupom de lavagem simples e reinicia o ciclo.
- [ ] Cliente vê quantas lavagens faltam para a grátis.
- [ ] Financeiro mostra faturamento diário, semanal e mensal, apenas para o admin.
- [ ] Admin lança serviços avulsos (ex.: PPF) e eles entram no faturamento.
- [ ] Exportação `.xlsx` com resumo, entradas e total por serviço.
- [ ] Identidade visual fiel às cores e ao logo fornecidos.
- [ ] Animações do Motion fluidas, com fallback para `prefers-reduced-motion`.

---

## 18. Pendências / a definir

- Confirmar o **HEX exato do azul do logo** com o arquivo vetorial.
- Definir **horário de funcionamento**, duração por serviço e capacidade por horário.
- Definir **validade do cupom** de fidelidade.
- Informar endereço, WhatsApp, Instagram e fotos reais para galeria e "antes e depois".
- Definir se o cupom vale para qualquer tamanho de veículo ou apenas para o veículo cadastrado.
- Definir preços (ou "sob consulta") para os serviços extras.
