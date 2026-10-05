# Primeira publicação própria do Automotive

Data: 5 de outubro de 2026. Este documento registra homologação online; a configuração da operação real continua separada.

## Endereços e conexão

- GitHub: https://github.com/joel1fps/automotive, branch `main`.
- Site próprio: https://automotive-sigma.vercel.app.
- Projeto Vercel: `automotive`, na conta do proprietário. Não utiliza o projeto anterior recebido como referência.
- GitHub conectado à Vercel para futuras publicações. A configuração `vercel.json` mantém as funções na região `gru1` (São Paulo), próxima ao Atlas.
- Clerk: nossa instância Development do aplicativo Automotive.
- MongoDB: nossa base `automotive_homologacao`, no cluster `automotive`, com usuário restrito à base e ao cluster.

Local e Vercel compartilham atualmente usuários de teste, atendimentos, catálogo e financeiro de homologação. Alterações feitas em um aparecem no outro. Não tratar os dados de teste como receitas da operação real.

As chaves Clerk, a URI MongoDB e a lista administrativa foram cadastradas diretamente nas variáveis protegidas da Vercel, após autorização. Valores não constam neste documento nem no GitHub. A URL canônica e o alias automático do próprio projeto estão configurados nas origens autorizadas.

O webhook da instância Clerk Development está configurado para `https://automotive-sigma.vercel.app/api/webhooks/clerk`, somente com `user.created`, `user.updated` e `user.deleted`. Seu segredo de assinatura está cadastrado como Secret nas variáveis Production e Preview da Vercel. Essas alterações de configuração exigem uma nova publicação para entrar em vigor.

O catálogo e os índices necessários foram preparados de forma idempotente, sem sobrescrever preços ou limpar registros existentes. Nenhuma regra de rede do Atlas foi alterada durante a publicação; a conta já tinha uma entrada permitindo conexões de qualquer origem, ainda exigindo credenciais do banco.

## Verificação realizada

- 153 testes locais aprovados, com banco temporário.
- Build local e build Vercel aprovados.
- Verificação de segredos: nenhum segredo encontrado nos arquivos de código ou JavaScript público examinados.
- Página e login publicados respondendo HTTP 200.
- Catálogo publicado carregando 14 serviços pelo MongoDB.
- API administrativa sem sessão respondendo HTTP 401.
- 11 cenários de segurança aprovados no navegador contra a URL publicada, incluindo CSP, login Clerk, celular, assinatura de webhook ausente e acesso administrativo negado.

O ensaio online não criou usuários, atendimentos ou lançamentos fictícios. A validação autenticada de uma operação completa pelo proprietário ainda precisa ser feita no site publicado.

## Pendências antes da operação real

- Confirmar um domínio próprio e seu DNS, criar/configurar Clerk Production e usar uma base de operação separada, com usuário restrito e índices preparados. Usuários e identidades de desenvolvimento não são automaticamente usuários da instância de produção.
- Revisar o plano Vercel para uso comercial; nenhum plano pago ou cobrança adicional foi contratado nesta publicação.
- Configurar Resend e remetente de domínio verificado caso os avisos por e-mail sejam usados. WhatsApp continua como envio manual iniciado pelo painel.
- Executar a validação autenticada dos fluxos de agendamento, fila, conclusão, pagamento, entrega, fidelidade, acompanhamento e Excel no ambiente final.

Referências: [Clerk na Vercel](https://clerk.com/docs/guides/development/deployment/vercel), [ambientes Clerk](https://clerk.com/docs/guides/development/managing-environments), [plano Hobby](https://vercel.com/docs/plans/hobby), [configuração de regiões](https://vercel.com/docs/project-configuration/vercel-json#regions). O guia completo de configuração é `VERCEL.md`.
