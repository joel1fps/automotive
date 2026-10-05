# Correções de lógica e operação — 04/10/2026

Implementação local das propostas aprovadas pelo usuário. O item 10, sobre faltas e desistências, foi excluído desta entrega. Os limites atuais de solicitações, o cancelamento administrativo e a validade dos cupons continuam com as regras existentes; não foram criados cancelamento pelo cliente, status de falta ou expiração automática de agendamentos.

## Resultado das propostas

| Item | Correção implementada | Comportamento esperado |
| --- | --- | --- |
| 1 | Pesquisa de cliente limpa a seleção anterior | Digitar outra busca não mantém o ID do cliente selecionado anteriormente. |
| 2 | Edição de cliente protegida durante o envio | O diálogo não troca de cliente enquanto salva; a resposta é aplicada somente ao cliente correspondente. Nome, telefone e veículos refletem o que foi salvo. |
| 3 | Previsão obrigatória para agendamento manual futuro | Administrador informa a entrega prevista ao cadastrar ou aprovar. Encaixes continuam registrando a chegada imediatamente. Validação também ocorre no servidor. |
| 4 | Calendário consulta todos os registros do período | Contagens por dia são calculadas antes da paginação. Clicar em um dia abre a lista completa daquele dia, mantendo o status escolhido. |
| 5 | Identificação estável dos envios e auditoria atômica | Repetir o mesmo envio após perder a resposta retorna o resultado anterior. Agendamento, cupom manual e lançamento manual não são duplicados. Dados alterados exigem outra identificação. Cupom e log são gravados na mesma transação. |
| 6 | Relatórios de recebimentos e serviços separados | Serviços realizados podem ser filtrados pela conclusão ou entrega, mesmo sem pagamento. XML e Excel trazem cliente, veículo, valores, situação do pagamento e datas operacionais. Recebimentos continuam usando a data financeira. |
| 7 | Detalhes e históricos atualizados periodicamente | Detalhes de acompanhamento consultam uma única fonte, a cada 10 segundos. Agenda e histórico do cliente atualizam a cada 30 segundos e após alterações/foco. Falhas de consulta ficam visíveis. |
| 8 | Cupom validado para a data solicitada | O cliente só recebe a opção de um cupom válido para o veículo e a data do atendimento. O servidor mantém a validação. |
| 9 | Correção e estorno financeiro com motivo e histórico | O recebimento original permanece intacto. Um ajuste assinado registra a diferença, o responsável e o motivo; relatórios mostram o valor líquido. Repetir a operação não repete o ajuste. |
| 11 | Exclusão exige que o veículo tenha saído | Veículos recebidos, em serviço, prontos ou pagos ainda no local não podem desaparecer pela exclusão. Antes do pagamento, a opção de devolução exige motivo e registra a saída sem inventar conclusão ou recebimento. Após pagamento, registra-se a entrega. |
| 12 | Histórico com critério de data explícito | O administrador consulta dia, semana, mês ou intervalo pela data agendada, chegada, conclusão ou entrega/devolução. Lista e contadores do período usam o mesmo critério; a fila física mostra os veículos presentes de qualquer dia. |

## Regras financeiras e de fidelidade

- Correção recebe o novo valor líquido desejado; estorno integral leva esse valor a zero. O ajuste usa a data atual e preserva valor e data do recebimento original.
- Uma correção entre dois valores positivos preserva a contribuição de fidelidade. Estorno integral remove uma contribuição; uma posterior correção positiva a recompõe uma única vez.
- Uma recompensa ainda válida, livre e não utilizada pode ser revogada pelo estorno. Cupons utilizados ou reservados permanecem preservados. Quando não há recompensa livre a revogar, o próximo crédito elegível regulariza a contribuição removida antes de gerar novos pontos. Esse ajuste interno não representa uma cobrança ao cliente.
- Cupons vencidos produzem o mesmo resultado, independentemente de uma tela já ter atualizado seu status para expirado.
- Recebimentos de cortesia vinculados a cupom não recebem correção financeira. Um recebimento gratuito sem cupom pode ter seu valor corrigido; se ficar positivo, passa a ser classificado como pago.
- O relatório de serviços mantém o histórico de trabalho concluído mesmo após exclusão lógica da agenda. Valores sob orçamento sem definição continuam indicados como pendentes, sem inventar preço.

## Preparação e validação

Os testes de banco desta entrega usam replica sets MongoDB temporários. Os testes de interface usam componentes reais e respostas fictícias em navegador isolado. Nenhuma receita, cliente ou atendimento de teste foi gravado no Atlas nesta entrega. Não houve push ou deploy.

As novas operações dependem do índice único de `Submission.key`, além dos índices de receita, cupom e auditoria já existentes. O seed já cria os índices de todos os modelos; em produção, ele deve ser executado uma vez contra a base correta antes de receber tráfego, conforme `VERCEL.md`. Não executá-lo automaticamente em cada build.

Comandos de verificação local:

```text
npm test
npm run typecheck
npm run test:approved-ui
npm run test:operational-history
npm run test:finance-export
npm run test:calendar-deletion
npm run test:flexible-queue
npm run build
npm run test:secrets
```

Os scripts `test:operational` e `test:atlas` usam a homologação real e não fazem parte desta rodada de testes isolados.

Resultado desta entrega: **148 testes automatizados aprovados**, incluindo um teste integrado com **25 cenários de API**; **52 cenários de interface isolados** e **11 cenários de segurança no build de produção** aprovados. TypeScript e build de produção passaram. A inspeção verificou **59 arquivos públicos do build**, sem segredos expostos, e nenhum arquivo privado de ambiente rastreado pelo Git.

O servidor local foi reiniciado após as alterações dos modelos e permanece em `http://localhost:3000`. O teste anônimo das novas rotas confirma que continuam exigindo autenticação; as verificações com administrador e cliente usaram handlers reais com identidade Clerk isolada.

Evidências de interface ficam em `../evidencias/correcoes-aprovadas`, `../evidencias/historico-devolucao` e `../evidencias/exportacao-xml`, com registros fictícios.
