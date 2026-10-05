# Organização compacta da fila

A fila atual é a primeira visualização em `/admin/controle`. Mostra somente os veículos presentes, de qualquer dia, mantendo as quatro etapas operacionais e a ordem de chegada.

## Cartões

- Fechados: placa, nome do cliente e botão **Ver mais**. Na fila de espera, aparece a posição original; uma previsão vencida pode receber um aviso discreto.
- Abertos: modelo, serviço, contato, datas, previsão, valores, observações, motivos e ações já existentes.
- Uma expansão por lista. A atualização periódica preserva a expansão se o atendimento continuar no mesmo estado; mudança de etapa ou remoção fecha os detalhes daquele registro.
- No celular, um seletor mostra uma etapa por vez, com sua quantidade. No computador, as quatro etapas ficam lado a lado quando houver espaço.
- Os pedidos pendentes ficam na seção recolhível **Solicitações para aprovar**, com contador e os mesmos cartões compactos.

## Consulta por período

**Por data** conserva os filtros de dia, semana, mês, intervalo e critério operacional. Os atendimentos aparecem numa lista compacta com identificação e status, evitando dez colunas de etapas.

A busca por placa ou nome do cliente e o filtro de status são aplicados no servidor antes da paginação. Os totais e o valor previsto do período recebem os mesmos filtros. A busca de placa aceita a identificação com ou sem hífen e trata símbolos como texto literal.

Na fila atual, a busca alcança todos os veículos presentes. Filtrar um veículo não altera sua posição real na fila. Os indicadores superiores continuam representando a presença e os pedidos da operação completa; o resultado da busca tem sua própria contagem.

## Verificação

Os testes de banco utilizam MongoDB temporário. A verificação de interface usa componentes reais com registros fictícios e respostas isoladas, sem gravar atendimentos no Atlas.

```text
npm run test:compact-queue
npm run test:flexible-queue
npm run test:operational-history
npm run typecheck
npm test
npm run build
```

As regras de serviço, pagamento, entrega, devolução, exclusão e auditoria continuam aplicadas pelo servidor. O item 10 excluído pelo usuário não faz parte desta mudança.

Resultado: **151 testes automatizados**, incluindo 11 cenários de histórico/busca e 25 cenários internos de API, aprovados. A interface passou em **15 cenários da fila compacta**, mais **9 de horários/fila** e **7 de histórico/devolução**. TypeScript, build de produção e inspeção de segredos também passaram. A inspeção não encontrou os segredos configurados nos arquivos públicos gerados; os arquivos locais privados de ambiente continuam fora do Git.

O teste visual usa 32 veículos presentes e 205 registros históricos. Conferidos os tamanhos 1440, 1201, 1024, 390 e 320 pixels, a navegação por teclado, as ações na expansão, a atualização periódica e a busca de um veículo fora da primeira página. Evidências: `../evidencias/fila-compacta/`.
