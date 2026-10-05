# Acompanhamento público e exportação por veículo — 04/10/2026

Implementado e validado localmente no Automotive independente. Servidor em http://localhost:3000. Nenhum deploy ou push foi realizado.

## Como usar

Na fila ou em Agendamentos, abra **Detalhes / acompanhamento** do atendimento. Clique em **Gerar link de acompanhamento**, depois em **Copiar link**. O mesmo painel permite renovar/revogar o endereço e informar uma previsão de conclusão em horário de Fortaleza.

O cliente abre `/acompanhar/<token>` sem conta ou login. A página mostra somente modelo, placa, serviço, horário, previsão e seis etapas operacionais. Atualiza a cada dez segundos, também ao retomar o foco/conexão; consultas são suspensas enquanto a aba está oculta. Falhas temporárias mantêm o último dado com aviso. Links inválidos/revogados limpam os dados da tela.

`completed` é fechamento administrativo e permanece como **Serviço concluído** na página pública; `delivered` muda para **Veículo entregue**. Cancelamento/recusa são mostrados sem publicar motivos internos. Timestamps antigos ausentes continuam explícitos, sem horários inventados.

O link usa a origem do site aberto pelo administrador. Neste ambiente, `localhost` funciona apenas na máquina que executa o servidor. O envio para clientes externos depende da futura publicação do projeto próprio.

## Excel

O formato existente foi mantido: **Excel/XLSX**. Na aba **Entradas**, as dez colunas anteriores continuam nas mesmas posições. Acrescentadas agenda, entrada do veículo, início do serviço, conclusão, pagamento, saída e status. Cliente, modelo, placa e serviço usam o recibo original; registros antigos recuperam dados do atendimento/cliente quando necessário.

A saída é consultada no atendimento atual, portanto entregas posteriores ao pagamento aparecem na próxima exportação. Registros sem chegada/entrega e lançamentos manuais continuam exportáveis, com informações ausentes indicadas. Filtros continuam baseados na data do pagamento e usam `America/Fortaleza`; valores e limites do financeiro foram preservados.

## XML por dia, semana ou mês

Em **Financeiro**, selecione **Diário**, **Semanal**, **Mensal** ou **Personalizado**, informe a data de referência ou o intervalo e clique em **Exportar XML**. A semana vai de segunda-feira a domingo; o mês inclui o mês completo da data selecionada. Categoria e forma de pagamento também se aplicam à exportação.

O arquivo contém todas as entradas dos filtros, incluindo registros de outras páginas da tabela: cliente, serviço, modelo, placa, valor em reais, pagamento, categoria, origem, referência do atendimento, agendamento, entrada, início, conclusão, pagamento, saída e status. O nome do arquivo indica as datas inicial e final. **Exportar Excel** continua disponível.

O período usa a data do pagamento ou lançamento, como o financeiro. Datas operacionais vêm do atendimento atual; campos que ainda não foram registrados ficam vazios no XML. Os metadados informam o fuso de Fortaleza e os limites do período. A exportação exige administrador validado no servidor e mantém as mesmas restrições do Excel.

Validação desta atualização: 89 testes automatizados, TypeScript e build de produção aprovados. A fixture dos handlers inclui 15 cenários de autorização e integração. O comando `npm run test:finance-export` verificou 11 cenários do componente real com dados fictícios, incluindo downloads XML/Excel, filtros, recuperação de erro e telas de 390 e 320 px. Evidências em `../evidencias/exportacao-xml/`.

## Implementação e proteção dos dados

- Tokens criptograficamente aleatórios de 32 bytes, consulta por SHA-256 e índice único esparso. Token e hash são excluídos das consultas comuns. O token original permanece num campo restrito para o administrador recuperar/copiar seu link ativo; somente a API administrativa dedicada o retorna.
- Geração idempotente, renovação, revogação e previsão com transações e auditoria. A auditoria não contém tokens. Renovação/revogação invalidam imediatamente o endereço anterior no servidor; a página aberta recebe a mudança na próxima consulta.
- API pública exclusivamente GET, DTO com lista explícita de campos permitidos, sem nome/contato do cliente, identidade, notas, valores, pagamento, cupons ou informações de outros atendimentos. Escritas públicas retornam 405; gerenciamento requer administrador verificado no servidor.
- Respostas sem cache, sem indexação e sem envio de referrer; limite de consultas por IP. Clerk não é carregado nem exigido nessas rotas públicas. URLs de acompanhamento são omitidas dos logs de acesso do servidor de desenvolvimento.
- Campos novos opcionais e índice aditivo, sem necessidade de alterar documentos antigos ou apagar dados.

Arquivos principais: `src/lib/tracking.ts`, `tracking-state.ts`, `db.ts`, `finance.ts`, `src/app/api/[...path]/route.ts`, `src/app/acompanhar/[token]/page.tsx`, `src/components/tracking-admin.tsx`, `vehicle-tracking.tsx`, módulos CSS correspondentes, `management-actions.tsx`, `providers.tsx`, `src/proxy.ts`, `robots.ts` e `next.config.ts`.

## Validação

- **70 testes aprovados**, incluindo tokens exclusivos, concorrência, revogação, rotação, restrição dos dados, transações/rollback, estados e cinco regressões da exportação. Os handlers reais também passaram sete cenários internos com Clerk isolado, incluindo 30 combinações administrativas para 401/403 e leitura pública sem identidade.
- TypeScript e build de produção aprovados.
- Navegador com Clerk administrativo real e MongoDB de homologação: criação manual, geração/cópia, previsão, início, conclusão, pagamento, renovação, revogação, entrega e consulta pelo histórico. Página pública acompanhou alterações sem recarregar. Cópia correspondeu ao endereço visível. Nenhum erro de console nas abas novas.
- Layout público em 1440×900 e 390×844 sem transbordamento horizontal observado; controles administrativos conferidos no celular.
- HTTP sem cookies/login confirmou leitura pública e ausência de campos privados. XLSX gerado com dados reais de homologação confirmou cliente, valor de R$ 12,34, entrada e saída do atendimento identificado `TRK1A23`.
- Apenas esse atendimento descartável e seu recibo/auditorias foram removidos ao terminar. Registros criados pelo usuário foram preservados. Nenhum e-mail/WhatsApp enviado, nenhuma conta externa criada.

Evidências em `../evidencias/acompanhamento/`: `publico-desktop.jpg`, `publico-mobile.jpg`, `admin-link.jpg`, `admin-mobile.jpg`, `link-anterior-revogado.jpg`, `entrega-desktop.jpg`, `browser-checks.json` e `smoke.json`. Os links fotografados pertenciam exclusivamente ao teste removido.
