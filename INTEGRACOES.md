# Integrações do Automotive

A publicação principal é **GitHub + Vercel**, seguindo [VERCEL.md](VERCEL.md). O aplicativo mantém o site e suas APIs no mesmo projeto Next.js. As contas, domínio, variáveis e testes do ambiente publicado ainda precisam ser conectados e verificados.

## Serviços e configuração

| Serviço | Função | Configuração necessária |
|---|---|---|
| GitHub | Versionar o código e fornecer a origem do deploy | Repositório [joel1fps/automotive](https://github.com/joel1fps/automotive), com o conteúdo do app na raiz |
| Vercel | Hospedar Next.js, páginas, APIs e mídias públicas | Preset Next.js, Node 24, `npm ci`, `npm run build`, variáveis e domínio |
| Clerk | Login, cadastro, recuperação de senha e identidade | Instância, chaves correspondentes, provedores de login, domínio e webhook |
| MongoDB Atlas | Clientes, agendamentos, capacidade, financeiro, fidelidade e auditoria | Cluster com transações, base, usuário do banco, URI e rede autorizada |
| Resend | Avisos de serviço por e-mail acionados pelo administrador | Chave de envio e remetente de domínio verificado |
| WhatsApp | Atendimento público e avisos preparados para envio pela equipe | Número público do negócio; telefone do cliente cadastrado para o aviso |

As mídias em `public/` acompanham o deploy. Nesta arquitetura não é necessário Firebase Auth, Firestore ou Firebase Storage.

## Variáveis e segredos

Use [.env.example](.env.example) como lista de variáveis. Para desenvolvimento, crie `.env.local` e preencha diretamente no editor. Para publicação, insira os valores no painel da Vercel por ambiente. Não envie senhas, chaves secretas, URI autenticada ou arquivos `.env.local` pelo chat, por capturas ou por commits.

`MONGODB_URI`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET` e `RESEND_API_KEY` são segredos do servidor. `NEXT_PUBLIC_*` é público e entra no build; não use esse prefixo para credenciais. Depois de alterar variáveis na hospedagem, faça um novo deploy. [Variáveis Vercel](https://vercel.com/docs/environment-variables), [variáveis Next.js](https://nextjs.org/docs/app/guides/environment-variables).

`ADMIN_EMAILS` aceita endereços separados por vírgula. O acesso depende do e-mail principal verificado no Clerk ou de `publicMetadata.role = "admin"` definido por um meio autorizado. O servidor consulta esses dados; uma alteração no navegador não concede o papel.

## Clerk: ambiente e sincronização

Homologação em `.vercel.app` usa chaves de desenvolvimento. Para produção Clerk, providencie domínio próprio, acesso ao DNS e as credenciais OAuth de produção dos provedores habilitados. Use chave publicável e chave secreta da mesma instância. [Ambientes Clerk](https://clerk.com/docs/guides/development/managing-environments), [produção Clerk](https://clerk.com/docs/guides/development/deployment/production).

O endpoint é `/api/webhooks/clerk`, com os eventos `user.created`, `user.updated` e `user.deleted`. Defina o Signing Secret do endpoint em **`CLERK_WEBHOOK_SECRET`**. O código passa essa variável explicitamente ao verificador; os exemplos oficiais que usam `CLERK_WEBHOOK_SIGNING_SECRET` não alteram o nome esperado pelo aplicativo. O webhook sincroniza cadastros/alterações e remove os contatos da conta excluída, preservando o histórico operacional. Confirme a entrega pelo painel Clerk após o deploy. [Webhooks Clerk](https://clerk.com/docs/guides/development/webhooks/syncing).

## MongoDB: transações, seed e rede

O banco precisa suportar transações: use replica set ou cluster fragmentado, como Atlas. A URI deve selecionar a base, e o usuário do banco precisa das permissões de leitura e gravação dessa base. Use bases distintas para homologação e operação. [Transações MongoDB](https://www.mongodb.com/docs/manual/core/transactions-production-consideration/).

`npm run seed` lê `.env.local` e cria catálogo, configurações e índices. É idempotente e preserva preços/configurações existentes; confira o nome da base antes de executá-lo. Não coloque o seed no comando de build da Vercel. Revise horários, duração, capacidade e catálogo no painel após inicializar.

A lista de acesso do Atlas precisa permitir a máquina do seed e a rede do servidor publicado. Para Vercel, escolha a estratégia de rede descrita em [VERCEL.md](VERCEL.md); não trate o IP local como IP do deploy. [Conexão Atlas](https://www.mongodb.com/docs/atlas/connect-to-database-deployment/).

Se a resolução SRV do Atlas falhar na máquina local, `MONGODB_DNS_SERVERS` aceita IPs separados por vírgula e ajusta o resolvedor do processo Node. Deixe vazio no servidor se a resolução padrão funcionar.

## Avisos por e-mail e WhatsApp

Configure `RESEND_API_KEY` e `EMAIL_FROM` para ativar o botão de aviso por e-mail no painel. O remetente precisa pertencer a um domínio verificado no Resend, por exemplo `Automotive <avisos@seu-dominio.com.br>`. O envio usa o status atual do agendamento e registra auditoria. Esses avisos são manuais; não há rotina automática de lembretes. [Domínios Resend](https://resend.com/docs/dashboard/domains/introduction).

O aviso por WhatsApp utiliza o telefone cadastrado do cliente e abre `wa.me` com o texto preparado. A equipe conclui o envio no WhatsApp. Esse fluxo não usa uma API de disparo automático.

## Firebase App Hosting: alternativa histórica

O arquivo `apphosting.yaml` foi preparado para uma hospedagem alternativa em Firebase App Hosting. Ele não é lido pela Vercel. Se esse caminho for retomado, revise o YAML, os segredos, as variáveis adicionais, a rede Atlas e o domínio de acordo com as contas reais antes da publicação. O Firebase App Hosting exige um projeto com faturamento habilitado e configuração própria de acesso aos segredos. [Início no App Hosting](https://firebase.google.com/docs/app-hosting/get-started), [configuração App Hosting](https://firebase.google.com/docs/app-hosting/configure).

O roteiro atual e a verificação das funcionalidades publicadas estão em [VERCEL.md](VERCEL.md). Um resultado local ou relatório histórico do pacote não confirma integração em produção.
