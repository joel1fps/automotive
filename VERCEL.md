# Publicar Automotive no GitHub e na Vercel

O caminho principal é **GitHub → Vercel**, com Clerk para login, MongoDB Atlas para os dados e Resend para os avisos de serviço por e-mail. Este guia descreve a configuração necessária; a publicação e os testes com as contas reais ainda precisam ser concluídos.

## 1. Preparar o repositório

O destino é [joel1fps/automotive](https://github.com/joel1fps/automotive). O conteúdo desta pasta `automotive/` será a raiz do repositório: `package.json`, `package-lock.json`, `src/`, `public/` e esta documentação ficam no primeiro nível. Na Vercel, use a raiz padrão do repositório. A pasta externa do pacote contém materiais históricos e não é a raiz do aplicativo.

Mantenha `.env.local`, outros arquivos com credenciais, `node_modules/` e `.next/` fora do Git. `.env.example` contém apenas nomes e exemplos públicos. Insira senhas e chaves diretamente no editor local ou no painel da Vercel; não envie segredos pelo chat nem publique capturas dessas telas.

## 2. Separar homologação e produção

| Ambiente | Clerk | MongoDB | URL do site |
|---|---|---|---|
| Local | Chaves de desenvolvimento, `pk_test_` e `sk_test_` | Base de homologação | `http://localhost:3000` |
| Homologação na Vercel | Chaves de desenvolvimento da mesma instância | Base de homologação | URL estável escolhida em `.vercel.app` |
| Produção | Chaves de produção, `pk_live_` e `sk_live_` | Base da operação | Domínio próprio com HTTPS |

O Clerk aceita o domínio fornecido pela hospedagem, como `.vercel.app`, com chaves de desenvolvimento. Para a instância de produção, é necessário possuir um domínio e configurar seu DNS. Uma publicação na Vercel marcada como “Production” ainda pode ser uma homologação do negócio enquanto estiver usando chaves de teste. [Ambientes Clerk](https://clerk.com/docs/guides/development/managing-environments), [produção Clerk](https://clerk.com/docs/guides/development/deployment/production).

A primeira publicação deste projeto será a homologação em um projeto Vercel próprio, com URL `.vercel.app`, Clerk de desenvolvimento e `automotive_homologacao`. A abertura para clientes reais será uma etapa posterior: domínio/DNS, chaves Clerk de produção, webhook desse ambiente e base limpa da operação com usuário MongoDB exclusivo. O cluster Atlas pode ser o mesmo, desde que as bases e permissões estejam separadas; não copie os atendimentos e receitas de teste para a operação.

Usuários, senhas e IDs Clerk são separados por instância. Trocar de `pk_test_`/`sk_test_` para `pk_live_`/`sk_live_` não migra os usuários de teste; o administrador deverá criar sua conta na instância de produção e verificar o e-mail configurado em `ADMIN_EMAILS`. GitHub guarda o código, Vercel executa o aplicativo, Clerk guarda as identidades e Atlas guarda os dados operacionais. [Instâncias Clerk](https://clerk.com/docs/guides/development/managing-environments).

## 3. Configurar MongoDB Atlas

Crie um cluster que suporte transações e um usuário exclusivo da aplicação com acesso à base escolhida. O projeto precisa de **replica set ou cluster fragmentado**; MongoDB standalone não suporta suas transações. O Atlas atende a esse requisito. [Transações MongoDB](https://www.mongodb.com/docs/manual/core/transactions-production-consideration/).

Em `MONGODB_URI`, selecione explicitamente a base, por exemplo:

```text
mongodb+srv://USUARIO:SENHA@CLUSTER/automotive_homologacao?retryWrites=true&w=majority
```

Substitua os campos no editor e codifique caracteres especiais da senha para uma URI. Use outra base para a operação real. O usuário do banco é diferente da conta que acessa o painel Atlas. Autorize o IP da máquina local para executar o seed. [Conectar ao Atlas](https://www.mongodb.com/docs/atlas/connect-to-database-deployment/).

A rede da Vercel também precisa alcançar o Atlas. O IP do seu computador não é o IP do servidor. Para uma lista restrita de IPs, configure os recursos de saída estática disponíveis no plano da Vercel e autorize no Atlas os endereços fornecidos. Não habilite acesso de qualquer origem sem avaliar e aceitar essa configuração. A opção Static IPs tem disponibilidade e cobrança próprias. [Static IPs Vercel](https://vercel.com/docs/networking/static-ips).

Escolha a rede antes de publicar o sistema completo: IPs estáticos com lista restrita exigem recurso pago; liberar `0.0.0.0/0` no Atlas permite tentativas de conexão de qualquer IP e requer uma decisão explícita do responsável. A autenticação do banco continua obrigatória, mas essa liberação não equivale a uma lista restrita. Não compre recursos nem instale integrações Marketplace automaticamente: o projeto já usa Atlas diretamente por `MONGODB_URI`. [Lista de acesso Atlas](https://www.mongodb.com/docs/atlas/security/ip-access-list/).

Deixe `MONGODB_DNS_SERVERS` vazio na Vercel, a menos que uma falha de resolução DNS seja confirmada. Essa variável é um ajuste opcional do processo Node, principalmente para diagnóstico local.

## 4. Configurar Clerk e administrador

Habilite e-mail/senha e os provedores desejados no Clerk. O projeto usa `/entrar` e `/cadastro`. No ambiente de produção, configure as credenciais OAuth próprias do Google e os registros DNS solicitados pelo painel Clerk. Não misture a chave publicável de uma instância com a chave secreta de outra. [Produção Clerk](https://clerk.com/docs/guides/development/deployment/production).

Defina em `ADMIN_EMAILS` o e-mail principal **verificado** do administrador. Separe vários endereços por vírgula. Também é possível conceder `publicMetadata.role = "admin"` pelo painel ou Backend API do Clerk. Essa autorização é consultada pelo servidor.

Cadastre um endpoint Clerk em:

```text
https://SEU-DOMINIO/api/webhooks/clerk
```

Selecione `user.created`, `user.updated` e `user.deleted`. Copie o **Signing Secret desse endpoint** para `CLERK_WEBHOOK_SECRET`. Esse é o nome usado por este projeto, que passa `signingSecret` explicitamente ao verificador; não substitua por `CLERK_WEBHOOK_SIGNING_SECRET` apenas porque esse outro nome aparece nos exemplos do Clerk. Cada endpoint/instância tem seu segredo. [Webhooks Clerk](https://clerk.com/docs/guides/development/webhooks/syncing).

Depois da publicação, envie um evento de teste pelo Clerk e confira a entrega bem-sucedida e o usuário no banco correto. Se a URL de homologação exigir autenticação da própria Vercel, o webhook externo também será bloqueado: configure acesso adequado ao endpoint antes de testá-lo. [Acesso de automações a deploys protegidos](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation).

## 5. Importar o GitHub na Vercel

Confirme o plano da conta antes da publicação: Hobby é limitado a uso pessoal e não comercial. Para operar o site do lava-jato comercialmente, escolha um plano que permita esse uso, como Pro. Não iniciar assinatura, avaliação de plano pago ou recurso adicional sem autorização do responsável. O nome “homologação” não elimina as condições do plano. [Plano Hobby](https://vercel.com/docs/plans/hobby), [plano Pro](https://vercel.com/docs/plans/pro).

No painel da Vercel, importe `joel1fps/automotive` pela conta GitHub autorizada e confira:

| Configuração | Valor |
|---|---|
| Framework Preset | Next.js |
| Root Directory | Raiz do repositório |
| Node.js Version | 24.x |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | Padrão automático do Next.js; não sobrescrever |

O aplicativo usa Next.js 16 com APIs e autenticação no servidor. Não use exportação estática nem configure `out/` como saída. O `package.json` já declara Node 24. [Build Vercel](https://vercel.com/docs/builds/configure-a-build), [Node.js Vercel](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions), [Next.js na Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs).

Em **Settings → Environment Variables**, cadastre os valores para os ambientes apropriados:

| Variável | O que preencher |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Chave publicável da instância Clerk escolhida |
| `CLERK_SECRET_KEY` | Chave secreta da mesma instância |
| `CLERK_WEBHOOK_SECRET` | Signing Secret do endpoint desse ambiente |
| `MONGODB_URI` | URI Atlas com a base correta |
| `ADMIN_EMAILS` | E-mail(s) principal(is) verificado(s) do(s) administrador(es) |
| `NEXT_PUBLIC_SITE_URL` | URL HTTPS final do ambiente, sem barra no final |
| `ALLOWED_ORIGINS` | Aliases HTTPS adicionais autorizados, separados por vírgula, sem caminhos ou curingas. A URL do site e as URLs Vercel da implantação já são incluídas |
| `MAX_CLIENT_ACTIVE_BOOKINGS` | Máximo de agendamentos ativos de um cliente: padrão `5`; `0` desativa |
| `MAX_CLIENT_BOOKING_ADVANCE_DAYS` | Antecedência máxima para o cliente: padrão `90` dias; `0` desativa |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/entrar` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/cadastro` |
| `RESEND_API_KEY` | Chave de envio Resend, para ativar os avisos por e-mail |
| `EMAIL_FROM` | Remetente autorizado, como `Automotive <avisos@seu-dominio.com.br>` |

Copie também os contatos públicos de `.env.example` quando desejar personalizá-los: `NEXT_PUBLIC_WHATSAPP`, `NEXT_PUBLIC_INSTAGRAM`, `NEXT_PUBLIC_ADDRESS`, `NEXT_PUBLIC_MAP_URL` e `NEXT_PUBLIC_CONTACT_EMAIL`. O WhatsApp usa código de país e somente dígitos. Revise o canal de privacidade antes de abrir cadastros ao público.

Segredos nunca recebem o prefixo `NEXT_PUBLIC_`. Os valores públicos são incorporados durante o build: após qualquer mudança de configuração, publique um novo deploy. Use valores próprios para Preview e Production, principalmente banco e chaves Clerk. [Variáveis Vercel](https://vercel.com/docs/environment-variables), [variáveis Next.js](https://nextjs.org/docs/app/guides/environment-variables).

Para enviar avisos por Resend, verifique um domínio que você controla e use esse domínio em `EMAIL_FROM`. Os botões do administrador iniciam o envio; não há lembrete periódico automático. O aviso por WhatsApp abre uma conversa com texto pronto para a equipe enviar. [Domínios Resend](https://resend.com/docs/dashboard/domains/introduction).

## 6. Inicializar o banco e revisar a operação

Na raiz local do app, com Node 24:

```powershell
npm ci
Copy-Item .env.example .env.local
# Preencha .env.local no editor antes de continuar.
npm run seed
npm run typecheck
npm test
npm run build
```

Não execute `Copy-Item` sobre um `.env.local` já preenchido. `npm run seed` lê esse arquivo e, se existir, `.env.development.local`, que tem prioridade sobre ele. Variáveis já definidas no processo têm prioridade sobre ambos. O comando grava no banco indicado por `MONGODB_URI`; confira a base antes de executá-lo. O seed cria catálogo, configurações e índices sem duplicar serviços nem sobrescrever preços/configurações existentes. Execute-o como preparação do ambiente, não como parte automática do build Vercel.

Para conferir a conexão e as transações da base de testes, execute `npm run test:atlas`. Esse diagnóstico exige a base `automotive_homologacao`, verifica commit e rollback e remove somente os documentos criados pela própria execução. Não execute esse diagnóstico na base da operação.

Inicie o ambiente local com `npm run dev` e abra `http://localhost:3000`. O hostname `localhost` evita um ciclo de redirecionamento interno entre Next.js e Clerk observado quando o servidor usava `127.0.0.1`. Com o Clerk configurado e o servidor iniciado, `npm run test:clerk` verifica os formulários reais e a proteção administrativa sem cadastrar usuários ou enviar e-mails.

Após entrar como administrador, revise `/admin/configuracoes` e `/admin/servicos`, especialmente os preços por tipo de veículo. As novas solicitações usam horário flexível: o administrador aprova o atendimento e informa a previsão de entrega. O cadastro manual futuro também exige essa previsão; encaixes registram chegada imediata. A grade e as vagas existentes são mantidas para compatibilidade com reservas antigas, sem restringir os novos pedidos a um horário de funcionamento.

Moto e extras também podem ser solicitados online; valores “a partir de” e serviços sem preço definido ficam sob orçamento, sujeitos à avaliação e à confirmação da equipe. O WhatsApp é outra opção para consultar o serviço. O registro manual **Outros** permite descrição e valor acordados, sem cupom ou pontos de fidelidade.

## 7. Verificar a publicação real

Faça primeiro os ensaios em homologação, sem gerar receitas fictícias na base da operação:

- Cadastro, login por e-mail e Google, recuperação de senha e saída.
- Cliente sem acesso às páginas e APIs administrativas; administrador com acesso correto.
- Webhook Clerk com entrega bem-sucedida e dados sincronizados no banco esperado.
- Solicitação em horário flexível, confirmação com previsão de entrega, chegada, andamento, conclusão, pagamento e entrega; histórico por data e calendário completo.
- Financeiro com uma receita por fechamento, ajustes/estornos auditados e os dois relatórios Excel: faturamento e completo (faturamento mais clientes, veículos, serviços, valores e datas, inclusive atendimentos ainda não pagos). Confira separadamente a data financeira e o critério de data dos veículos; veja `EXPORTACAO_EXCEL.md`.
- Fidelidade e cupom com validade, placa e tipo de veículo corretos.
- Aviso manual por e-mail entregue e WhatsApp abrindo o contato esperado.
- Galeria, vídeos, navegação e formulários no celular; contatos e privacidade revisados.

Confira os logs da Vercel e as conexões Atlas após os testes. Um build aprovado, sozinho, não comprova que login, banco, webhook ou envio de e-mail estejam funcionando no ambiente publicado. Registre URL, ambiente e resultado das verificações antes de abrir a produção.

## 8. Segurança e desempenho antes de abrir ao público

Os painéis de clientes, catálogo, cupons, configurações e fila são carregados por demanda. O financeiro e sua biblioteca de gráficos também ficam separados do JavaScript inicial da área do cliente. A marca usada no login e no painel é um componente independente, sem importar a página pública inteira. Essas mudanças preservam as regras e a aparência das telas; a melhoria é na quantidade de código transferido antes de o usuário abrir cada funcionalidade.

Configure `NEXT_PUBLIC_SITE_URL` com a origem canônica HTTPS desse ambiente. Confira todas as origens legítimas usadas para entrar e fazer operações no site, incluindo o endereço estável de homologação e aliases próprios. A configuração de `authorizedParties` do Clerk deve aceitar somente essas origens; a lista não concede acesso administrativo. [Autorização de origens no Clerk](https://clerk.com/docs/guides/development/deployment/production#configure-authorizedparties-for-secure-request-authorization).

Revise a lista de administradores e ative MFA na conta administrativa antes da operação real. O Clerk oferece essa configuração; a disponibilidade em produção depende do plano. Proteja também as contas que controlam GitHub, Vercel, Clerk e Atlas. Nenhuma revisão de código elimina o risco de uma conta administrativa ou chave secreta comprometida. [Configuração de MFA no Clerk](https://clerk.com/docs/guides/configure/auth-strategies/sign-up-sign-in-options#multi-factor-authentication).

Escolha a região das funções próxima à região do Atlas, para reduzir o tempo das consultas e transações. Não escolha uma região apenas pela localização dos clientes: cada operação ainda precisa alcançar o banco. [Regiões e proximidade do banco na Vercel](https://vercel.com/docs/regions#compute-defaults).

O limite de requisições da aplicação usa MongoDB compartilhado e funciona entre instâncias da Vercel. Ele ainda exige uma consulta ao banco por tentativa: para reduzir volumetria e custo antes de chegar à aplicação, configure também limites na borda da Vercel. Considere separadamente os endpoints públicos de catálogo/horários, agendamentos e acompanhamento. O acompanhamento consulta a API periodicamente: o limite escolhido deve permitir seu uso normal, sem deixar consultas automatizadas sem controle. As regras e quotas disponíveis dependem do plano. [Vercel Firewall](https://vercel.com/docs/vercel-firewall), [limites de requisições na borda](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting).

Inclua nos testes de homologação publicada:

- Tentar acessar APIs administrativas sem sessão, com conta cliente e após revogar a função administrativa.
- Tentar enviar `role`, campos financeiros, operadores MongoDB e campos inesperados nos formulários de cliente; nenhuma alteração de autorização pode resultar disso.
- Validar login e formulários após aplicar a CSP, inclusive no celular, e investigar bloqueios sem liberar origens indiscriminadamente.
- Abrir um link de acompanhamento sem login, atualizar o atendimento, revogar e renovar o link, e verificar que o link anterior perdeu acesso.
- Conferir se segredos, tokens de acompanhamento e dados pessoais não aparecem em capturas, repositório, mensagens de erro ou logs de aplicação.
- Medir tempo das consultas, conexões Atlas, exportação Excel e consumo das funções com uma carga representativa.
- Confirmar backup e restauração dos dados da operação, atualizações de dependências e alerta de falhas de login/banco/webhook.

Ainda dependem de configuração nas contas e de verificação no ambiente hospedado: domínio e DNS de produção Clerk, chaves de produção, rede do Atlas, origens permitidas, MFA, regras de tráfego, entrega de e-mail e recuperação de dados. A revisão local e um build aprovado não atestam segurança absoluta nem substituem esse ensaio.

As páginas HTML usam CSP com nonce novo a cada requisição, compartilhado entre Next.js e Clerk, sem `unsafe-inline` ou `unsafe-eval` em scripts de produção. Isso exige renderização dinâmica; arquivos estáticos, imagens e chunks JavaScript continuam distribuídos pelo CDN. O modo local de desenvolvimento precisa de `unsafe-eval` para o depurador. Não cacheie HTML com nonce em uma camada adicional. [CSP e renderização dinâmica no Next.js](https://nextjs.org/docs/app/guides/content-security-policy).

A conexão MongoDB reutiliza o pool do processo, limitado a 10 conexões por instância, sem manter conexões ociosas indefinidamente. Em produção, a criação automática de índices está desativada: execute `npm run seed` contra a base correta antes de receber tráfego; esse comando cria índices adicionais explicitamente. Os índices únicos de receita/agendamento, identidade do envio (`Submission.key`), cupom e os demais índices de integridade são obrigatórios. O seed não apaga índices nem dados. Não o execute a cada build.

O cliente online fica limitado, por padrão, a 5 agendamentos ativos e 90 dias de antecedência. O limite é validado dentro da transação, inclusive em solicitações simultâneas. Atendimentos criados pelo administrador não recebem esses limites. Configure as duas variáveis caso a operação precise de outros valores. A exportação Excel permite até 20 mil lançamentos financeiros e, no relatório completo, até 20 mil atendimentos, com 5 exportações por administrador por minuto; períodos maiores devem ser divididos.

Para repetir o ensaio anônimo de segurança do build local, mantenha `npm run dev` na porta 3000 para o uso normal e inicie temporariamente o build em outra porta:

```powershell
npm run build
npm run test:secrets
npm run start -- --port 3025 --hostname localhost
# Em outro terminal:
npm run test:security
```

O script usa navegador isolado, verifica headers/CSP, login renderizado, APIs sem sessão, origem externa e webhook sem assinatura; não usa a sessão do administrador nem envia formulários de autenticação. Para outro endereço, configure `BASE_URL`. O fluxo completo autenticado continua fazendo parte do ensaio de homologação publicada.
