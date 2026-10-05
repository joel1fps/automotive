# Relatórios Excel do Automotive

O painel financeiro oferece dois downloads `.xlsx`, com nomes, ícones e estilos diferentes. A exportação XML foi retirada da interface e o endpoint público de exportação aceita somente Excel.

## Excel de faturamento

Abas: **Resumo**, **Entradas** e **Por serviço**. Inclui pagamentos, lançamentos avulsos, correções e estornos, respeitando período, categoria e forma de pagamento. Os ajustes preservam o lançamento original e entram com seu valor positivo ou negativo na data em que foram registrados.

O arquivo se chama `automotive-faturamento-INICIO-a-FIM.xlsx`.

## Excel completo

Inclui as três abas financeiras e acrescenta **Resumo de veículos** e **Veículos e serviços**. Ao abrir o arquivo no Excel, a aba **Veículos e serviços** já fica selecionada. A lista contém cliente, modelo, placa, serviço, categoria, status, situação do pagamento, orçamento, valor final, recebido líquido, saldo e datas de agendamento, entrada, início, conclusão, pagamento, entrega e devolução.

Inclui atendimentos sem pagamento e todos os status que correspondam ao critério e período escolhidos, inclusive cancelamentos, recusas, devoluções e registros excluídos da agenda ativa, identificados como históricos. Cancelamentos, recusas ou devoluções sem cobrança registrada apresentam saldo zero; o valor de referência fica preservado. Orçamentos e valores previstos não são adicionados ao faturamento recebido.

O arquivo se chama `automotive-completo-INICIO-a-FIM.xlsx`.

## Datas e filtros

Ambos usam os controles de dia, semana, mês ou período personalizado do painel. A exportação usa todo o período e não apenas a página da tabela visível.

O faturamento sempre considera a data de cada pagamento, lançamento ou ajuste. No Excel completo, a opção **Data dos veículos no Excel completo** permite selecionar data agendada (padrão), entrada, conclusão ou entrega/devolução. Uma receita e seu veículo podem pertencer a períodos diferentes; por isso as duas datas ficam explícitas no arquivo.

A categoria aplica-se às duas partes. A forma de pagamento filtra somente as abas financeiras: os veículos ainda sem pagamento continuam na lista completa. Na visualização de serviços realizados, o filtro de pagamento não fica ativo. O seletor do relatório em tela e seu critério de conclusão/entrega continuam independentes dos dois downloads e do critério dos veículos.

Datas operacionais usam `America/Fortaleza`. Valores monetários são células numéricas formatadas em reais. Textos de clientes permanecem texto, inclusive quando começam com `=`; não são convertidos em fórmulas.

## Proteção e limites

As duas exportações exigem administrador autorizado pelo servidor. A lista completa não inclui telefone, notas privadas ou tokens de acompanhamento. Não altera os atendimentos nem os lançamentos. Limites: 20 mil lançamentos financeiros e 20 mil atendimentos por arquivo, além de 5 exportações por administrador por minuto. Divida períodos maiores. Os botões bloqueiam downloads simultâneos e permitem tentar novamente após erro.

## Verificação local

`npm test` passou com 153 testes e verifica regras, planilhas Excel reais e os endpoints com banco temporário. Os testes do relatório completo incluem todos os status, 215 atendimentos para conferir exportação além da paginação, datas financeiras distintas das operacionais, ajustes, devoluções e ausência de campos privados. O build de produção e a verificação de segredos nos arquivos públicos também passaram.

`npm run test:finance-export` verifica 18 cenários no componente real com Chrome e respostas fictícias: os dois botões, filtros, nomes dos arquivos, bloqueio de downloads simultâneos, recuperação após erro, visualização de serviços e telas de 320 e 390 pixels. Evidências ficam na pasta externa `evidencias/exportacao-excel/`. Esse ensaio não acessa Clerk nem a base real.

Os guias anteriores que mencionam XML registram implementações históricas. Este documento descreve o comportamento atual.
