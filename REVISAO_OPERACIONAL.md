# Revisão operacional do Automotive — 04/10/2026

Implementação local no repositório independente `joel1fps/automotive`. Servidor de validação: http://localhost:3000/admin/controle. Nenhum deploy ou alteração de projeto Vercel foi realizado nesta revisão.

## Problemas encontrados e resultado

| Impacto | Problema | Correção |
| --- | --- | --- |
| Alto | Cliente entrava sem nome completo/telefone; nome local era sobrescrito em cada acesso | Onboarding em `/cliente/perfil`, validação no servidor e sincronização Clerk preservando nome/telefone locais |
| Alto | “Fila” representava pedidos/agenda e incluía veículos já entregues | Fila física por `arrivedAt`, todos os dias, separada de aprovação e planejamento |
| Alto | Conclusão bloqueada antes do horário e permitida diretamente de confirmado | Transições compartilhadas; conclusão somente de `ready`, independente de horário |
| Alto | Receita ausente quando conclusão falhava; risco de efeito repetido | Receita, etapa, pontos, cupom, vaga e auditoria na mesma transação, com índice único por atendimento |
| Alto | Atendimento sem agendamento dependia de horário futuro | Entrada imediata, inclusive avulso com contato, sem consumir uma vaga da agenda |
| Médio | Contadores e telas permaneciam desatualizados | Invalidação global após alterações, atualização por foco e polling da fila; paginação corrigida |
| Médio | Ações administrativas duplicadas | Um componente de ações consumindo a máquina de estados do servidor |
| Médio | Financeiro sem placa/referência do serviço | Snapshot de placa, modelo, serviço e atendimento na receita e no Excel |
| Médio | Mesma placa podia duplicar veículos salvos | Atualização do veículo existente pela placa |
| Médio | Cortesias podiam afetar contagem de lavagens pagas | Valor zero/cupom não incrementam pontos nem lavagens pagas |
| Médio | Entrada avulsa era contada como agendamento | Contadores de agenda excluem encaixes; presença/entradas incluem todos |

## Regras adotadas

`pending → confirmed → arrived → in_progress → ready → completed → delivered`

- `pending` pertence à aprovação; `confirmed`, ao planejamento. A chegada insere o veículo na fila física.
- A fila contém `arrived`, `in_progress`, `ready` e `completed`, inclusive de dias anteriores. Ordenação por chegada e `_id` para desempate; posição não é persistida.
- `ready` significa trabalho terminado, pagamento pendente. `completed` significa pagamento registrado, entrega pendente. `delivered` encerra a presença física.
- Registrar pagamento exige `ready`; repetir uma transição aplicada retorna conflito 409 com mensagem clara. Requisições simultâneas não duplicam receita, pontos ou cupom.
- Cancelar/recusar libera vaga e cupom; reagendamento troca a reserva de forma atômica, somente antes da chegada. Conclusão libera a reserva da agenda, mantendo o veículo na fila até a entrega.
- Encaixe entra em `arrived` imediatamente e não reserva horário. Telefone avulso é opcional; avisos exigem contato válido.
- Somente lavagens elegíveis com valor positivo e sem cupom contam como lavagens pagas. A décima emite um prêmio; cortesia não gera outro ponto.
- Uma reserva de cupom válida é honrada no fechamento mesmo quando sua validade passa durante o atendimento, preservando a regra anterior.
- Datas de pagamento e filtros usam `America/Fortaleza`. Resumo, lista paginada e Excel recebem os mesmos limites/filtros.
- Nome e telefone do perfil são locais; identidade/e-mail e administração continuam controlados pelo Clerk e pelas regras do servidor. Perfil do administrador é opcional para acessar a gestão.
- Telefones são normalizados como `55 + DDD + número`, aceitando formatação e rejeitando entradas incompletas. Referência de formato: [Anatel](https://www.gov.br/anatel/pt-br/regulado/numeracao/codigos-nacionais/nono-digito).

## Banco e migração

Novos campos são opcionais e compatíveis com documentos antigos: `walkIn`, `guestPhone`, timestamps de aprovação/cancelamento/recusa, `slotReleasedAt`, snapshots financeiros e referências de auditoria. Acrescentados índices da fila e da auditoria por atendimento; mantido o índice único de receita por `appointmentId`.

`npm run migrate:operational` aceita somente `automotive_homologacao`. Cria índices sem removê-los, reconcilia contadores de vagas numa transação, marca reservas encerradas e enriquece recibos antigos sem alterar valor, pagamento ou data. Uma vaga legada desconhecida interrompe/reverte a migração, em vez de inventar uma associação.

Execução nesta base: **0 associações de vaga adicionadas, 0 contadores corrigidos, 0 reservas encerradas marcadas e 0 recibos enriquecidos**. Os dados existentes já não exigiam reparo. Nenhum cliente ou atendimento existente foi apagado. Horários antigos ausentes continuam indicados como não registrados; não foram inventados timestamps de chegada.

## Arquivos principais

- Servidor: `src/lib/business.ts`, `appointment-state.ts`, `control.ts`, `db.ts`, `validation.ts`, `finance.ts`, `auth.ts`, `access-policy.ts`, `profile.ts`, `profile-store.ts`, `operational-migration.ts`, `src/app/api/[...path]/route.ts`.
- Interface: `dashboard.tsx`, `operational-queue.tsx`, `management-actions.tsx`, `booking-form.tsx`, `finance-panel.tsx`, `profile-panel.tsx`, `src/lib/client-api.ts`, `catalog.ts`, `src/app/cliente/[[...path]]/page.tsx`, estilos administrativos em `globals.css`.
- Verificação: `tests/business.test.ts`, `profile.test.ts`, `migration.test.ts`, `api-access.test.ts`, `tests/fixtures/api-access.ts`, `scripts/verify-operational.ts`, `migrate-operational.ts`, `cleanup-operational-ui.ts`, scripts no `package.json`.

O desenho do site institucional foi preservado. `PROMPT_REVISAO_OPERACIONAL.md` já existia antes desta implementação; `next-env.d.ts` é gerado pelo Next.

## Validação e evidências

- TypeScript aprovado e build de produção aprovado.
- **48 testes aprovados**, sem falhas. O teste de autorização executa também cinco cenários internos com handlers/autorização reais, isolando somente o provedor externo Clerk: 26 combinações administrativas verificadas para 401/403, perfil próprio e rejeição de privilégios/IDs/e-mail alterados pelo cliente.
- MongoDB temporário em replica set: concorrência de vagas/cupons/conclusão, rollback de receita/pontos/prêmio/auditoria, FIFO fora da ordem da agenda e de dias anteriores, cancelamento/reagendamento, perfil e migração idempotente/reversível em falha.
- `npm run test:operational`: Clerk real reconheceu a identidade administrativa; MongoDB real confirmou perfil, fila, conclusão antecipada concorrente, fidelidade, cupom, filtros diário/mensal, XLSX, rollback e entrega. Registros identificados deste teste foram removidos.
- Navegador real com sessão Clerk existente, em **390×844 e 1440×900**: entrada avulsa → fila → início → pronto → fechamento em Pix → financeiro → entrega. O recibo de teste de R$ 42,50 apareceu com placa/referência nos filtros mensal e diário. O veículo saiu da fila após entrega. Perfil inválido foi rejeitado sem salvar dados pessoais. Sem transbordamento horizontal observado.
- A exportação acionada no painel respondeu HTTP 200. A captura automatizada do evento de download no navegador integrado expirou; o conteúdo XLSX e os filtros foram validados nos testes e no smoke com MongoDB real.

Evidências ficam em `../evidencias/revisao-operacional/`: `fila-desktop.jpg`, `fila-mobile.jpg`, `fechamento-mobile.jpg`, `financeiro-desktop.jpg`, `fila-apos-entrega.jpg`, `perfil-validacao.jpg`, `fila-final.jpg`, `smoke.json` e `browser-checks.json`. As imagens do fluxo mostram registros descartáveis identificados; eles foram removidos da base após a validação. `fila-final.jpg` mostra o painel limpo, pronto para validação humana.

## Limites desta validação

Não foram criadas novas contas externas para repetir cadastro Google/e-mail. Os dois caminhos usam o mesmo onboarding após o Clerk autenticar; os cenários de cliente foram cobertos por testes isolados, além do navegador com administrador real.

Não houve envio de e-mail ou WhatsApp. Envio real de e-mail depende da configuração do provedor já prevista no projeto. A aplicação usa Clerk de desenvolvimento neste teste local; produção e um projeto Vercel novo dependem da próxima decisão do usuário.

Não foi feito push/commit nem deploy. Segredos continuam nos arquivos locais ignorados; não foram incluídos no relatório ou nas evidências.

## Correção posterior: telefone avulso e erro genérico

A captura enviada pelo usuário mostrou `Invalid input` ao registrar um PPF com telefone de celular incompleto. A união de validação entre contato vazio e telefone válido ocultava a mensagem específica. A API agora preserva o erro em português; o formulário valida o contato antes de enviar, mostra a mensagem no campo e move o foco para ele. Contato vazio continua opcional; números válidos continuam normalizados, sem inventar dígitos.

Validação desta correção: 13 testes de domínio aprovados, incluindo duas regressões novas, TypeScript aprovado e reprodução no navegador com PPF. Nenhum atendimento foi criado na reprodução inválida. Evidência: `../evidencias/revisao-operacional/telefone-avulso-validacao.jpg`.
