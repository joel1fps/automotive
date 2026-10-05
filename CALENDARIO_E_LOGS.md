# Calendário, horários livres, filas e exclusão auditada

## Uso

Os campos de data abrem um calendário branco com mês em português, navegação por setas, semana de domingo a sábado e dia selecionado em azul. Os valores continuam em YYYY-MM-DD, sem depender do fuso do navegador. O calendário respeita os limites de cada formulário e funciona por teclado e em diálogos.

Novas solicitações permitem qualquer horário futuro, inclusive madrugada, domingo e minutos fora da grade antiga. O horário é interpretado em America/Fortaleza. O cliente continua sujeito aos limites configurados de antecedência e agendamentos ativos. A aprovação abre um formulário com previsão de entrega obrigatória: ela deve ser futura e igual ou posterior à data/hora solicitada. Reagendar um atendimento confirmado também exige uma previsão válida. A aprovação e as mudanças de previsão ficam na auditoria.

Em **Controle**, **Por data** consulta dia, semana, mês ou período personalizado e mostra todas as etapas, incluindo solicitações, aprovados, entregues, recusados e cancelados. Atalhos permitem consultar hoje, amanhã, mês atual e próximo mês. Os registros são paginados sem truncar o histórico, e as contagens abrangem o período completo. A aba **Em atendimento** mantém os veículos que já chegaram de qualquer dia, ordenados pela chegada, até a entrega. Aprovar mantém o agendamento na data solicitada; registrar a chegada inclui o veículo na fila física.

Na conferência de leitura do banco de homologação em 04/10/2026, o atendimento confirmado citado na conversa estava agendado para **06/10/2026 às 11h**, e o atendimento de **05/10/2026 às 8h** estava entregue. Nenhuma data real foi alterada para ajustar a tela. As listas e os cartões agora destacam a previsão de entrega junto da data agendada.

Em **Agendamentos**, use **Excluir agendamento**, confira cliente, veículo e serviço, informe um motivo com 5 a 500 caracteres e confirme. A exclusão é lógica: retira o registro das listas, histórico visível ao cliente e fila, e revoga seu link. Pagamentos, pontos, cupons usados e datas históricas permanecem no financeiro e nas exportações. Uma exclusão não representa estorno.

A aba **Logs** mostra data, ação, responsável (nome e identificação Clerk), motivo e referência do atendimento. Exclusões preservam também cliente, serviço, veículo, data agendada e valor no momento da operação. O filtro permite consultar outras ações já auditadas; há paginação e atualização periódica.

## Proteções

- A API exige administrador validado no servidor e origem autorizada para excluir. Aceita somente o motivo; identidade, horário e campos da auditoria vêm do servidor.
- Exclusão, log, liberação de vaga/cupom reservado e revogação do link acontecem na mesma transação MongoDB. Falha no log reverte a operação.
- Repetições preservam a primeira exclusão e não duplicam o registro nem a liberação de vaga.
- Atendimentos excluídos não recebem novas alterações, notificações ou links e não entram nos limites de reservas ativas do cliente.
- As regras de horário, previsão e privilégios são verificadas no servidor. Alterar a interface ou enviar um corpo com identidade administrativa não autoriza a ação.
- Novos agendamentos livres não reservam as vagas da grade antiga. Reservas antigas conservam a liberação correta de suas vagas e cupons; os ajustes não reescrevem o histórico.
- Logs são consultáveis somente por administradores. A API não oferece criação, edição ou exclusão direta de logs. A resposta omite telefones, e-mails, observações privadas e tokens.
- Nenhum atendimento real foi excluído durante a implementação. Testes usam MongoDB temporário e dados fictícios no navegador.

## Arquivos e verificações

Calendário: src/components/ui/date-picker.tsx, date-picker.module.css, date-picker-calendar.ts.

Exclusão e logs: src/components/appointment-delete.tsx, audit-panel.tsx, src/lib/business.ts, db.ts, audit-labels.ts, src/app/api/[...path]/route.ts e filtros de fila/acompanhamento.

Horários e filas: src/components/ui/date-time-picker.tsx, src/lib/local-date-time.ts, business.ts, control.ts, src/components/booking-form.tsx, management-actions.tsx, admin-panels.tsx e operational-queue.tsx.

Testes: npm test, npm run typecheck, npm run build, npm run test:calendar-deletion, npm run test:flexible-queue, npm run test:finance-export e npm run test:secrets. Os testes de banco usam MongoDB temporário; a conferência visual usa os componentes reais com dados fictícios, sem login nem alterações na conta real.

Validação em 04/10/2026: 118 testes automatizados aprovados, incluindo a execução isolada de 19 cenários dos handlers reais da API. A interface passou em 9 cenários de horários/filas, 11 de calendário/exclusão/logs e 11 de exportação. A conferência visual verificou todos os dias do calendário em telas de 320/390 px e dentro dos formulários. Typecheck e build de produção passaram. A verificação do build não encontrou credenciais privadas expostas nem arquivos de ambiente privados rastreados no Git. O servidor local permaneceu disponível, e as APIs de fila/logs retornaram 401 sem autenticação.
