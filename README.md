# Automotive — Lava a Jato e Serviços

Site institucional e sistema de agendamentos, operação, financeiro e fidelidade com Next.js 16, Clerk e MongoDB Atlas. O destino do código é [joel1fps/automotive](https://github.com/joel1fps/automotive), com publicação pela Vercel. Consulte [VERCEL.md](VERCEL.md) para configurar e validar o ambiente real e [INTEGRACOES.md](INTEGRACOES.md) para entender cada serviço.

O institucional funciona com os contatos registrados nos materiais, mesmo sem `.env.local`. Abertura de contas, painel e agendamento online exigem Clerk e Atlas. Enquanto isso, o acesso direciona ao atendimento pelo WhatsApp. A publicação e as verificações com contas reais ainda precisam ser concluídas; este README não certifica um deploy em produção.

Projeto criado a partir de `SPEC-SITE-AUTOMOTIVE.md` e das quatro artes de `site.zip`. O ZIP original não continha código. As referências originais foram preservadas em `reference/`.

**Regra confirmada pelo usuário:** cupom válido por **30 dias**, de uso único e vinculado à **mesma placa e ao mesmo tipo de veículo**. A cada 10 lavagens concluídas sem cupom, uma Lavagem Simples grátis. A cortesia não soma pontos.

## Executar o site

Requer Node.js 24 e npm.

```powershell
npm ci
npm run dev
```

Abra `http://localhost:3000`. O institucional funciona sem contas externas. O catálogo inicial é apresentado publicamente, mas os painéis e as APIs privadas permanecem fechados até configurar a autenticação e o banco. Não existe login de demonstração nem bypass de administrador.

No Windows, `INICIAR-SITE.cmd` instala as dependências e prepara/inicia o build local de produção. Para testar o login Clerk, prefira `npm run dev` em `http://localhost:3000`, endereço utilizado na configuração local.

## Configurar o sistema real

1. Copie `.env.example` para `.env.local` e preencha os valores diretamente no editor. Na Vercel, use **Settings → Environment Variables**. Nunca compartilhe esse arquivo, envie segredos pelo chat ou faça commit das chaves.
2. Crie uma aplicação no Clerk. Habilite e-mail/senha e Google nas configurações de login. Configure os termos/política de privacidade e o consentimento de cadastro no Clerk, incluindo o fluxo Google. Para homologação em `.vercel.app`, use chaves de desenvolvimento. Produção Clerk exige domínio próprio, DNS e credenciais OAuth próprias. Veja os [ambientes Clerk](https://clerk.com/docs/guides/development/managing-environments).
3. Defina um administrador com `publicMetadata.role = "admin"` no Clerk, ou liste seu e-mail verificado em `ADMIN_EMAILS`. Dados enviados pelo navegador não concedem administração.
4. Crie um MongoDB Atlas e coloque sua URI em `MONGODB_URI`. **Transações exigem replica set**; o Atlas atende a esse requisito. Não use MongoDB standalone.
5. Crie o webhook Clerk `/api/webhooks/clerk`, com os eventos `user.created`, `user.updated` e `user.deleted`. Defina o Signing Secret do endpoint em `CLERK_WEBHOOK_SECRET`, nome usado explicitamente pelo projeto. A assinatura é verificada antes de qualquer gravação. Para testar o webhook localmente, use um túnel configurado por você.
6. Inicialize catálogo, configurações e índices:

```powershell
npm run seed
```

O seed é idempotente e não sobrescreve preços editados pelo administrador.

7. Novas solicitações usam data e horário livres, sem restrição por expediente ou capacidade de slots. O administrador decide a aprovação e informa a previsão de entrega; agendamentos manuais futuros também exigem essa previsão. As configurações de grade, duração e capacidade em `/admin/configuracoes` permanecem para compatibilidade com reservas antigas. O seed preserva configurações existentes.
8. Confira endereço, WhatsApp e Instagram, já preenchidos em `.env.example` e usados como padrão do institucional. Defina o canal de privacidade e o domínio real. Use WhatsApp com código de país. Essas variáveis públicas não devem conter segredos.
9. Para os avisos de serviço por e-mail, configure `RESEND_API_KEY` e `EMAIL_FROM`, com remetente de um domínio verificado no Resend. O envio é acionado manualmente pelo administrador. O aviso por WhatsApp abre a conversa com texto pronto para a equipe enviar. Veja [domínios Resend](https://resend.com/docs/dashboard/domains/introduction).

As lavagens, motos, ozônio, película e demais extras ativos podem ser solicitados online, respeitando os tipos de veículo configurados. Serviços sem preço definido ou anunciados “a partir de” ficam sob orçamento, com valor confirmado pela equipe; o WhatsApp também está disponível para consultar o serviço. O administrador pode registrar serviços à parte no agendamento manual em **Outros**, informando descrição e valor, sem cupom ou fidelidade. A opção Outros é exclusiva do administrador. O seed insere serviços sem duplicar slugs nem alterar registros existentes; em banco antigo, renomeie a película para Window Blue no painel.

O acompanhamento segue seis etapas: solicitado, aprovado, veículo recebido, serviço em andamento, serviço pronto e veículo entregue. Marcar como pronto registra a conclusão do trabalho e pode ocorrer antes da previsão. O recebimento é registrado separadamente, com valor e forma de pagamento; a entrega registra a saída. A fila atual mostra os veículos presentes por ordem de chegada, e o histórico permite consultar dia, semana, mês ou intervalo por data agendada, entrada, conclusão ou entrega/devolução. Cada atendimento pode ter um link seguro de acompanhamento sem login, administrado e revogável pelo painel.

## Publicar na Vercel

Consulte [VERCEL.md](VERCEL.md): raiz do GitHub, Node 24, `npm ci`, `npm run build`, ambientes, rede Atlas, variáveis, domínio Clerk, webhook, Resend, seed e verificação após publicação. Use o preset Next.js e sua saída padrão para preservar as APIs e o processamento no servidor. O `apphosting.yaml` é uma alternativa histórica para Firebase App Hosting, descrita em [INTEGRACOES.md](INTEGRACOES.md).

A primeira publicação será uma homologação independente em `.vercel.app`, usando Clerk de desenvolvimento e a base de testes. Para abrir a operação real, configure domínio próprio, instância Clerk de produção e uma base limpa com credenciais próprias. GitHub recebe somente código e arquivos públicos; usuários, agendamentos e receitas continuam no Clerk e no Atlas. Não transfira registros de teste para a operação. As instâncias Clerk têm usuários e IDs separados; trocar as chaves não migra contas automaticamente.

## Conteúdo real da galeria e avaliações

O pacote contém as artes recebidas, cinco vídeos publicados e dois pares antes/depois. Depoimentos continuam sem dados: o site convida o cliente a compartilhar sua experiência pelo WhatsApp, sem inventar avaliações. O vídeo 03 e artes com preços antigos ficam em `reference/midias-nao-publicadas/`, fora da pasta pública.

Para adicionar pares reais, salve imagens em `public/gallery/` e edite `public/gallery.json`:

```json
[
  {
    "before": "/gallery/veiculo-antes.webp",
    "after": "/gallery/veiculo-depois.webp",
    "title": "Lavagem completa",
    "description": "Descrição do trabalho realizado, com autorização do cliente."
  }
]
```

O comparador da maçaneta funciona com mouse, toque e teclado: antes à esquerda, depois à direita. O farol usa dois enquadramentos da foto original, lado a lado, limitados a 400 px por foto; não usa os recortes antigos nem ampliação artificial. Use somente arquivos locais ou configure explicitamente domínios autorizados em `next.config.ts` para imagens externas.

Em `public/testimonials.json`, adicione somente avaliações reais autorizadas:

```json
[{ "name": "Nome autorizado", "quote": "Avaliação real do cliente.", "date": "Setembro de 2026" }]
```

## Rotas e organização

- Público: `/`, `/servicos`, `/galeria`, `/contato`, `/privacidade`, `/entrar`, `/cadastro`.
- Cliente: `/cliente`, `/cliente/agendar`, `/cliente/fidelidade`, `/cliente/historico`.
- Admin: `/admin`, `/admin/controle`, `/admin/agendamentos`, `/admin/clientes`, `/admin/servicos`, `/admin/financeiro`, `/admin/cupons`, `/admin/configuracoes`.
- API: todos os endpoints da especificação são despachados por `src/app/api/[...path]/route.ts`, com validação e checagem de acesso no servidor. A exclusão de serviço desativa o registro, preservando histórico financeiro. Clientes são criados por cadastro Clerk e podem ter telefone/veículos atualizados; não se apaga histórico fiscal pelo painel.
- Domínio e transações: `src/lib/business.ts`.
- Financeiro e Excel: `src/lib/finance.ts`.
- Schemas: `src/lib/db.ts` e `src/lib/validation.ts`.
- Interface: `src/components/`.

O Next.js 16 chama o middleware de `proxy.ts`. A proteção principal também é executada nos layouts, páginas privadas e APIs. Consulte a [documentação do Next.js](https://nextjs.org/docs/app/getting-started/proxy) e a [integração Clerk](https://clerk.com/docs/reference/nextjs/clerk-middleware).

## Garantias implementadas

- Novas solicitações aceitam horário livre e dependem da aprovação administrativa; reservas antigas mantêm controle transacional das vagas.
- Agendamento cliente inicia pendente; agendamento manual inicia confirmado.
- Recusa/cancelamento liberam a vaga e o cupom reservado.
- Serviço pronto, recebimento e entrega têm datas separadas. Receita, fidelidade e consumo do cupom são registrados na transação de fechamento financeiro, que não pode gerar uma segunda receita para o mesmo atendimento.
- Cupom é reservado exclusivamente, deve pertencer ao cliente, ter placa/tamanho compatíveis e continuar válido no horário solicitado.
- Receitas de cortesia são zero, mesmo que a requisição tente enviar outro valor.
- Ajustes de fidelidade exigem motivo e são auditados. Ajustes não geram cupons; emissão acontece ao concluir lavagens.
- Catálogo/preço e elegibilidade são fotografados no agendamento para manter o histórico após edições.
- Datas de agendamento e financeiro usam `America/Fortaleza`.
- **Excel de faturamento** contém Resumo, Entradas e Por serviço. **Excel completo** acrescenta Resumo de veículos e Veículos e serviços, abrindo diretamente na lista de clientes e carros. O período e a categoria valem para ambos; a forma de pagamento filtra as abas financeiras. O critério de data dos veículos é separado da data financeira e inclui atendimentos sem pagamento. Veja [EXPORTACAO_EXCEL.md](EXPORTACAO_EXCEL.md).
- Valores financeiros são somados em centavos.
- Role é calculada a partir dos dados Clerk consultados no servidor; nunca de `unsafeMetadata` ou do corpo do pedido.
- Rate limiting persistente em MongoDB, com expiração automática por índice TTL.

## Verificar

```powershell
npm run typecheck
npm test
npm run build
```

Os testes de integração usam MongoDB temporário, sem tocar no Atlas. A primeira execução baixa um binário MongoDB, pode exigir acesso à rede e usa espaço adicional no disco.

Para repetir a conferência do navegador, inicie o build em outra janela com `npm run start -- --port 3025`, instale o Chromium com `npx playwright install chromium` caso necessário e execute `npm run test:ui`. A URL pode ser definida por `BASE_URL`. O script registra as evidências no caminho configurado em `scripts/verify-ui.mjs`.

A aprovação de build/testes locais deve ser registrada na execução atual; ela não substitui a verificação do ambiente publicado com Clerk, Atlas e Resend. A política de privacidade continua precisando dos dados e da revisão do responsável antes da abertura pública dos cadastros. As animações do institucional estão descritas em [COVERFLOW.md](COVERFLOW.md) e [TICKER.md](TICKER.md); os relatórios externos ao app pertencem ao pacote histórico da entrega.
