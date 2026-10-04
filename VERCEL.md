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

## 3. Configurar MongoDB Atlas

Crie um cluster que suporte transações e um usuário exclusivo da aplicação com acesso à base escolhida. O projeto precisa de **replica set ou cluster fragmentado**; MongoDB standalone não suporta suas transações. O Atlas atende a esse requisito. [Transações MongoDB](https://www.mongodb.com/docs/manual/core/transactions-production-consideration/).

Em `MONGODB_URI`, selecione explicitamente a base, por exemplo:

```text
mongodb+srv://USUARIO:SENHA@CLUSTER/automotive_homologacao?retryWrites=true&w=majority
```

Substitua os campos no editor e codifique caracteres especiais da senha para uma URI. Use outra base para a operação real. O usuário do banco é diferente da conta que acessa o painel Atlas. Autorize o IP da máquina local para executar o seed. [Conectar ao Atlas](https://www.mongodb.com/docs/atlas/connect-to-database-deployment/).

A rede da Vercel também precisa alcançar o Atlas. O IP do seu computador não é o IP do servidor. Para uma lista restrita de IPs, configure os recursos de saída estática disponíveis no plano da Vercel e autorize no Atlas os endereços fornecidos. Não habilite acesso de qualquer origem sem avaliar e aceitar essa configuração. A opção Static IPs tem disponibilidade e cobrança próprias. [Static IPs Vercel](https://vercel.com/docs/networking/static-ips).

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

Não execute `Copy-Item` sobre um `.env.local` já preenchido. `npm run seed` lê esse arquivo e grava no banco indicado por `MONGODB_URI`; confira a base antes de executá-lo. O seed cria catálogo, configurações e índices sem duplicar serviços nem sobrescrever preços/configurações existentes. Execute-o como preparação do ambiente, não como parte automática do build Vercel.

Após entrar como administrador, revise `/admin/configuracoes` e `/admin/servicos`. Os padrões são segunda a sábado, 8h às 17h, slots de 60 minutos e capacidade de um veículo. Confirme duração/capacidade reais e os preços por tipo de veículo. A alteração da grade, dos dias, dos horários de abertura/fechamento ou da duração é bloqueada enquanto existirem reservas futuras ativas; a capacidade continua editável. Planeje essas mudanças antes de abrir a agenda.

Moto e extras também podem ser solicitados online; valores “a partir de” e serviços sem preço definido ficam sob orçamento, sujeitos à avaliação e à confirmação da equipe. O WhatsApp é outra opção para consultar o serviço. O registro manual **Outros** permite descrição e valor acordados, sem cupom ou pontos de fidelidade.

## 7. Verificar a publicação real

Faça primeiro os ensaios em homologação, sem gerar receitas fictícias na base da operação:

- Cadastro, login por e-mail e Google, recuperação de senha e saída.
- Cliente sem acesso às páginas e APIs administrativas; administrador com acesso correto.
- Webhook Clerk com entrega bem-sucedida e dados sincronizados no banco esperado.
- Solicitação, confirmação, andamento, conclusão e cancelamento de agendamentos; horários/capacidade corretos.
- Financeiro com uma receita por conclusão e exportação Excel coerente.
- Fidelidade e cupom com validade, placa e tipo de veículo corretos.
- Aviso manual por e-mail entregue e WhatsApp abrindo o contato esperado.
- Galeria, vídeos, navegação e formulários no celular; contatos e privacidade revisados.

Confira os logs da Vercel e as conexões Atlas após os testes. Um build aprovado, sozinho, não comprova que login, banco, webhook ou envio de e-mail estejam funcionando no ambiente publicado. Registre URL, ambiente e resultado das verificações antes de abrir a produção.
