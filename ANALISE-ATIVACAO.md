# Análise para ativação — 3 de outubro de 2026

O aplicativo está na pasta `automotive/` do pacote local. Essa pasta será a raiz do repositório `joel1fps/automotive`, com `package.json` no primeiro nível. A arquitetura é Next.js 16.3.8, React 19, Node.js 24, Clerk e MongoDB/Mongoose. A Vercel atende às páginas e APIs Node deste projeto; não é uma exportação estática.

## Funcionalidades encontradas

- Institucional, serviços/preços, galeria, vídeos, contatos e privacidade.
- Cadastro, login por e-mail/Google e recuperação de senha pelo Clerk.
- Cliente: solicitar agendamento, consultar histórico e acompanhar fidelidade/cupons.
- Administrador: agenda, confirmação/cancelamento/reagendamento, etapas do atendimento, controle diário, clientes/permissões, serviços/imagens, bloqueios/capacidade, configurações e cupons.
- Financeiro: receita da conclusão, lançamentos manuais, filtros/resumos e exportação Excel.
- Comunicação: botões manuais para WhatsApp e envio por e-mail via Resend.

## Dependências para ativar o ambiente real

| Item | Configuração necessária |
|---|---|
| Clerk | Chaves publicável e secreta da mesma instância; e-mail/senha e Google habilitados; URLs e consentimento configurados no provedor |
| Administrador | E-mail principal verificado em `ADMIN_EMAILS`, ou papel concedido pelo servidor no Clerk |
| Atlas | URI com base explícita, usuário autorizado, replica set/transações e acesso de rede da máquina/Vercel |
| Webhook Clerk | `/api/webhooks/clerk`, eventos `user.created`, `user.updated`, `user.deleted` e `CLERK_WEBHOOK_SECRET` |
| Inicialização | Executar seed para catálogo, configurações e índices na base escolhida |
| Vercel | Importar GitHub, raiz do repositório, Next.js, Node 24, variáveis e novo deploy |
| URL | `NEXT_PUBLIC_SITE_URL` HTTPS correta para metadados, sitemap e robots |
| E-mails de serviço | Resend e `EMAIL_FROM` com remetente/domínio verificado |
| Produção Clerk | Domínio próprio e DNS; homologação `.vercel.app` pode começar com a instância de desenvolvimento |

O roteiro detalhado está em [VERCEL.md](VERCEL.md). `.env.local` fica fora do Git; os valores secretos são preenchidos no editor local e no painel da hospedagem.

## Correções realizadas nesta preparação

1. Remover todas as restrições de veículo de um serviço agora salva o array vazio, em vez de omitir a atualização e manter a restrição anterior.
2. Mudar dias, abertura, fechamento ou duração da grade agora é bloqueado enquanto existem reservas futuras ativas. Reservas e reagendamentos compartilham a proteção transacional contra alterações concorrentes da grade. A capacidade continua editável.
3. A política e os guias foram ajustados para Vercel; arquivos locais da Vercel e logs ficam fora do Git.
4. A navegação pública mostra Entrar e Criar conta para visitantes; usuários autenticados recebem Minha conta e o menu de perfil/saída do Clerk.
5. O ambiente local usa `localhost`, corrigindo um ciclo de requisições causado pela normalização de `127.0.0.1` no Next.js com o proxy Clerk. O matcher inclui `/__clerk/:path*`.

## Validação local

- Checagem TypeScript aprovada.
- Build de produção aprovado.
- 29 testes aprovados, incluindo concorrência, configurações, receita, fidelidade, cupons e Excel.
- Auditoria npm de produção: nenhuma vulnerabilidade conhecida reportada.
- Conferência no Chrome: 24 combinações de rota/tamanho aprovadas (320, 390, 768 e 1440 px), além de preços, mídias, galeria, mapa, navegação e proteção administrativa sem Clerk. Relatório e capturas estão na pasta externa `evidencias/ativacao-vercel/` do pacote local.
- Testes de banco utilizaram MongoDB temporário local, sem gravar no Atlas da operação.
- Clerk conectado à aplicação solicitada pelo usuário. Conferência real local: 21 verificações aprovadas, incluindo SDK, Google, login/cadastro, consentimento, recuperação e proteção administrativa em seis larguras. Nenhuma conta foi criada e nenhum e-mail foi enviado por esse diagnóstico. Evidências em `evidencias/clerk-setup/` do pacote local.

Sessão autenticada com usuário real, sincronização de webhook, conexão Atlas da Vercel e entrega de e-mails ainda precisam ser verificados depois de configurar as contas. Um build aprovado não confirma essas integrações externas.

## Pontos operacionais para revisar

- Os avisos são acionados pela equipe; WhatsApp abre texto pronto e não usa uma API de disparo automático.
- O aviso WhatsApp precisa de telefone cadastrado; o painel do administrador permite atualizá-lo.
- Serviços sem preço definido podem ser solicitados sob orçamento, sujeito à confirmação da equipe. Confira tipos de veículo, preços e elegibilidade de fidelidade no catálogo antes da abertura.
- O expediente público continua sendo segunda a sábado, 8h–17h. Alterações no painel afetam a agenda, mas os textos públicos de horário precisam ser atualizados também.
- Preencha o canal de privacidade e revise o texto pelo responsável. Configure o consentimento no Clerk também para Google, que pode criar contas pelo fluxo de login.
