# Prompt para revisão e correção completa do Automotive

Você está trabalhando no projeto local:

`C:\Users\JoelF\Desktop\automotive-site-final-v16\automotive`

Repositório GitHub deste projeto independente:

`https://github.com/joel1fps/automotive`

Este projeto foi copiado de outro sistema, mas agora é independente. Não vincule, não publique e não altere nenhum projeto Vercel antigo. Faça todo o trabalho localmente. Só prepare uma nova publicação quando os fluxos locais estiverem aprovados e o usuário indicar explicitamente um projeto Vercel novo e próprio.

## Contexto técnico atual

- Next.js 16.3.8, React 19, TypeScript, Clerk, MongoDB Atlas/Mongoose.
- Clerk local já está conectado à aplicação `Automotive`, ID `app_3KD4BJsbjaotQ1jYJc0TSgfxAGr`.
- MongoDB local já está conectado à base exclusiva de homologação `automotive_homologacao` por um usuário restrito.
- `ADMIN_EMAILS` contém o e-mail principal verificado do administrador no ambiente local; configure esse valor diretamente no arquivo privado, sem publicá-lo.
- Não leia, imprima, copie ou versione segredos de `.env*`. Esses arquivos devem continuar ignorados pelo Git.
- Antes de editar, leia as instruções do repositório, confira `git status` e preserve alterações existentes que não pertençam à tarefa.
- O projeto deve continuar funcionando em `http://localhost:3000`.

## Objetivo

Faça uma revisão funcional completa e implemente uma operação coerente para clientes e administradores. O resultado precisa funcionar como um sistema real de lava-jato: cadastro completo do cliente, fila operacional por ordem de chegada, acompanhamento das etapas do veículo, conclusão do serviço em qualquer horário quando o trabalho realmente terminou, lançamento financeiro confiável e histórico auditável.

Não entregue apenas um diagnóstico ou plano. Investigue, implemente, migre dados de forma segura, teste os fluxos completos e deixe o sistema pronto para o usuário validar localmente.

## Problemas já confirmados no código

### 1. Não existe uma fila operacional real

A tela de controle atual separa “solicitações para aprovar” e “carros do dia”, mas isso não constitui uma fila. Os carros do dia são ordenados pelo horário agendado, e o endpoint `status=active` inclui inclusive registros `completed` e `delivered`.

Implemente uma fila operacional clara no painel administrativo:

- Solicitações `pending` continuam em uma área separada de aprovação; elas ainda não estão na fila física.
- Ao registrar a chegada, o veículo entra em “Aguardando atendimento”.
- A fila deve ser ordenada por `arrivedAt` crescente, que representa a ordem real de chegada, independentemente do horário agendado.
- Exiba pelo menos as colunas/etapas: Aguardando, Em atendimento, Pronto para retirada e Pagamento/entrega pendente.
- Mostre placa, modelo, cliente, telefone/WhatsApp, serviço, horário agendado, horário de chegada e tempo esperando/em atendimento.
- As ações de mudança de etapa devem aparecer no próprio cartão/linha e atualizar todas as contagens e listas envolvidas.
- Veículos entregues, cancelados e recusados devem sair da fila ativa, mas permanecer no histórico.
- Evite criar um número de posição persistente se a posição puder ser derivada de `arrivedAt`; se houver necessidade de prioridade ou reordenação manual, implemente isso explicitamente, com auditoria e testes.
- A fila deve considerar veículos que chegaram em dias anteriores e ainda não foram entregues.
- Mantenha a agenda do dia como visão de planejamento, separada da fila física da operação.

### 2. Cadastro inicial incompleto e telefone ausente

Hoje `requireActor()` cria/atualiza o usuário usando nome e e-mail do Clerk. O telefone é opcional no banco, não existe perfil editável para o próprio cliente e somente o administrador consegue preencher o telefone na aba Clientes. Isso quebra o aviso por WhatsApp e deixa o cadastro incompleto.

Implemente onboarding e perfil do cliente:

- No primeiro acesso autenticado de um cliente, se o perfil obrigatório estiver incompleto, redirecione para uma tela própria, por exemplo `/cliente/perfil` ou `/cliente/completar-cadastro`.
- Solicite nome completo e telefone/WhatsApp com DDD. Use validação brasileira consistente: aceite entrada formatada, normalize antes de armazenar e rejeite números incompletos.
- Não considere e-mail ou nome de usuário do Clerk como nome completo válido quando o Clerk não fornecer um nome real.
- O cliente não deve conseguir agendar enquanto o telefone obrigatório estiver ausente ou inválido.
- Depois do onboarding, o cliente deve conseguir editar o próprio nome e telefone em “Meu perfil”.
- Não permita que o cliente altere papel administrativo, pontos, cupons ou dados de outros usuários.
- Preserve o e-mail verificado do Clerk como identidade; não crie uma segunda autenticação.
- Garanta que o botão de WhatsApp do administrador use o telefone normalizado do perfil.
- Se o cadastro vier por Google ou e-mail/senha, o comportamento deve ser o mesmo.
- Defina uma estratégia clara para o administrador: não bloqueie o acesso administrativo existente por falta de telefone pessoal, mas permita que ele complete o perfil se desejar.

Crie endpoints autenticados de perfil próprio com validação server-side, em vez de reutilizar endpoints administrativos.

### 3. Máquina de estados contraditória

O sistema atual espalha ações entre `dashboard.tsx`, `management-actions.tsx` e `business.ts`. Há duas interfaces administrativas com ações semelhantes. O servidor aceita `complete` a partir de `confirmed` ou `ready`, apesar de a mensagem dizer “Marque como pronto antes de concluir”.

Centralize e documente uma única máquina de estados:

`pending -> confirmed -> arrived -> in_progress -> ready -> completed -> delivered`

Regras esperadas:

- `pending`: solicitação aguardando aprovação.
- `confirmed`: horário aprovado, veículo ainda não chegou.
- `arrived`: veículo presente e aguardando na fila.
- `in_progress`: serviço iniciado.
- `ready`: serviço terminado, aguardando fechamento/pagamento.
- `completed`: valor final e pagamento registrados; veículo pode aguardar retirada.
- `delivered`: veículo entregue e atendimento encerrado.
- `rejected` e `cancelled`: estados finais fora da fila.

Cada transição deve ser validada no servidor. Repetições devem ser idempotentes ou retornar conflito claro. Registre timestamps das etapas e mantenha as regras de cupom, fidelidade, vaga e auditoria transacionais.

### 4. O administrador não consegue concluir antes do horário agendado

Em `src/lib/business.ts`, a ação `complete` possui a regra:

`appointment.scheduledAt <= new Date()`

Isso é incorreto para a operação: um veículo pode chegar cedo e o serviço pode terminar antes do horário marcado.

Corrija da seguinte forma:

- Remova a dependência entre conclusão e horário agendado.
- A conclusão deve depender da etapa operacional, não do relógio. Exija `ready` para concluir.
- O administrador deve poder registrar chegada, iniciar, marcar como pronto e concluir mesmo antes do horário agendado.
- Não permita pular silenciosamente de `confirmed` para `completed`.
- Se houver necessidade real de atalho, mostre confirmação explícita e execute as transições intermediárias com timestamps e auditoria; não esconda inconsistência de estado.

### 5. Financeiro não recebe os lançamentos do serviço

Atualmente a receita só é criada durante `complete`. Como a conclusão pode falhar pela restrição de horário, o lançamento não existe e o painel financeiro parece não encontrar os dados.

Garanta que:

- Ao concluir um serviço, a atualização do agendamento e a criação da transação aconteçam na mesma transação MongoDB.
- A transação seja idempotente por `appointmentId`; repetir a requisição nunca pode duplicar receita, cupom ou ponto.
- O registro financeiro use a data real da conclusão/pagamento em `America/Fortaleza`, não o horário agendado.
- Valor final, forma de pagamento, cliente, placa, serviço, categoria e referência ao agendamento apareçam de forma rastreável.
- Depois da conclusão, o painel financeiro mostre imediatamente o lançamento no período correto.
- Filtros diário, semanal, mensal e personalizado, paginação, resumo e Excel usem exatamente a mesma consulta e limites de datas.
- Cupom gere valor zero sem somar pontos indevidos.
- Serviços manuais e lançamentos avulsos continuem funcionando.
- Erros da API sejam claros na interface, sem deixar o administrador pensando que a ação foi concluída quando falhou.

## Auditoria adicional obrigatória

Além dos itens acima, revise todo o projeto em busca de inconsistências relacionadas. Preste atenção especial a:

- duplicação entre a tela geral de agendamentos e o painel de controle;
- uso do termo `active` incluindo estados que já deveriam estar fora da fila;
- contadores “Para lavar”, “Veículos no lava-jato”, “Prontos” e “A receber” e se refletem os estados corretos;
- atualização das telas após uma ação, evitando dados antigos até recarregar manualmente;
- cliente sem telefone, nome real ou veículo salvo;
- agendamento manual de cliente cadastrado e cliente avulso;
- chegada de veículo sem agendamento e entrada imediata na fila;
- cancelamento, recusa, reagendamento e liberação correta da vaga/cupom;
- notificações por WhatsApp/e-mail apenas em estados coerentes;
- comportamento mobile e acessibilidade das novas telas;
- timezone `America/Fortaleza` em datas, filtros e tempos da fila;
- autorização server-side de todas as ações administrativas;
- mensagens de erro, estados vazios, loading e prevenção de duplo clique.

Liste os demais problemas encontrados, classifique por impacto e corrija os que afetarem o fluxo operacional principal. Não faça uma reescrita visual arbitrária do site institucional.

## Banco e migração

- Avalie quais novos campos e índices são necessários, por exemplo timestamps operacionais, índice da fila por status/`arrivedAt` e campos do perfil.
- Prefira migrações idempotentes ou compatibilidade com documentos existentes; não apague a base.
- Não use `dropDatabase`, não remova clientes/agendamentos existentes e não altere a base fora de `automotive_homologacao`.
- Dados antigos sem telefone devem cair no onboarding na próxima entrada do cliente.
- Dados antigos com estados válidos devem continuar legíveis.

## Testes obrigatórios

Mantenha os testes existentes e acrescente testes que provem, no mínimo:

1. Primeiro login de cliente sem telefone exige completar perfil.
2. Nome e WhatsApp válidos são salvos; telefone inválido é rejeitado.
3. Cliente só altera o próprio perfil e não ganha permissão administrativa.
4. Dois veículos que chegam fora da ordem dos horários aparecem pela ordem de `arrivedAt`.
5. Veículo entregue sai da fila ativa.
6. Serviço pode ser concluído antes do horário agendado depois de passar por `arrived -> in_progress -> ready`.
7. Não é possível concluir diretamente de `confirmed`.
8. Conclusão cria exatamente uma transação financeira, mesmo com requisições concorrentes ou repetidas.
9. Valor, pagamento, pontos e cupom permanecem consistentes em commit e rollback.
10. Lançamento aparece nos filtros financeiro diário/mensal e no Excel.
11. Cancelamento/reagendamento continua liberando vaga e reserva de cupom corretamente.
12. APIs administrativas continuam retornando 401/403 para usuários sem permissão.

Depois rode:

- checagem TypeScript;
- suíte completa de testes;
- build de produção;
- teste real no navegador em desktop e celular;
- smoke test com Clerk e MongoDB locais, usando dados de teste identificáveis e removendo somente esses dados ao terminar.

Não envie e-mail, WhatsApp nem crie contas externas durante testes automatizados. Não altere integrações externas sem autorização.

## Forma de trabalho e entrega

- Comece reproduzindo os problemas e registrando a causa no código.
- Faça mudanças pequenas e coerentes, com regras de negócio no servidor e interface consumindo essas regras.
- Evite lógica de estado duplicada em componentes diferentes.
- Não pare após implementar a primeira correção; percorra o fluxo completo cliente -> aprovação -> chegada -> fila -> serviço -> conclusão -> financeiro -> entrega.
- Ao terminar, apresente: problemas encontrados, decisões de negócio adotadas, arquivos alterados, migração aplicada, testes executados, evidências do navegador e limitações restantes.
- Deixe o servidor local pronto para validação humana.
- Não faça deploy. Ao final, pergunte ao usuário somente se ele quer criar e publicar em um projeto Vercel novo e independente.
