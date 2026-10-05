# Revisão de segurança e preparo para Vercel — 04/10/2026

A revisão foi aplicada ao projeto local independente em `automotive/`. Não houve publicação, push, alteração de permissões reais, mudança de chaves ou mudança de configuração do Atlas. Os testes de negócio e autorização usam MongoDB temporário; o teste do build usa navegador anônimo e não cria atendimentos nem contas.

Não foi encontrada uma escalada de privilégio demonstrável nas rotas atuais. Isso não constitui garantia de segurança absoluta: revisão de código, dependências e testes cobrem os cenários descritos, não todas as formas possíveis de ataque nem contas/segredos comprometidos.

## Administração e isolamento entre clientes

`requireActor` verifica a sessão Clerk e consulta a identidade atual no servidor. Só concede administração por `publicMetadata.role` retornada pelo Clerk ou e-mail principal **verificado** na lista `ADMIN_EMAILS`. `unsafeMetadata`, estado React, localStorage, payload de formulário, headers falsificados e o papel do documento MongoDB não concedem acesso. A identidade retornada precisa corresponder ao ID da sessão.

Todas as famílias administrativas passam por essa verificação, incluindo financeiro, exportação, clientes/permissões, fila, catálogo, configurações e links de acompanhamento. Páginas administrativas também verificam acesso no servidor. A autorização não depende apenas de esconder botões nem da execução do Proxy. Remover a permissão no Clerk bloqueia a próxima chamada; não há cache global de privilégios.

Perfil, histórico, fidelidade, agendamentos e cupons do cliente usam seu usuário autenticado. Operadores MongoDB e IDs de outros usuários não se tornam filtros ou atualizações autorizados. Booking, veículo, transições, perfil, pontos e lançamentos sensíveis rejeitam campos extras; formulários administrativos que incluem metadados persistidos continuam usando uma lista explícita de campos graváveis.

## Problemas corrigidos e proteções adicionadas

| Caso | Resultado |
|---|---|
| Descrições financeiras `__proto__`, `constructor`, `toString` | Agrupamentos usam dicionários sem protótipo; descrições permanecem texto literal |
| Nomes herdados na rota pública | `/constructor` e `/__proto__` retornam 404 |
| Veículos adicionados por agendamentos | Lista de conveniência mantém no máximo os 20 veículos mais recentes, sem duplicar placa |
| Requisições de outros sites/subdomínios | Origem exata e Fetch Metadata verificados antes de operações; ausência sem comprovação também é negada |
| Origens de sessões Clerk | `authorizedParties` usa configuração do servidor e URLs da própria implantação; headers do visitante não ampliam a lista |
| Corpo grande sem tamanho declarado | Leitura por stream cancela ao atingir 300 mil bytes; tamanho declarado, tipo JSON, UTF-8 e sintaxe também validados |
| Webhook Clerk falsificado | Só evento com assinatura verificada pode sincronizar identidade; corpo recebe o mesmo limite |
| Consumo de Backend API Clerk | Rate limit compartilhado é aplicado depois do JWT e antes de consultar a identidade; tentativas administrativas negadas também contam |
| Scripts inseridos no HTML | CSP com nonce criptográfico diferente por requisição e `strict-dynamic`; scripts de produção não liberam inline genérico ou eval |
| Frames, objetos e informações de resposta | `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `object-src 'none'`, `base-uri 'self'`, `nosniff`, Permissions/Referrer policies e retirada de `X-Powered-By` |
| Cache de dados privados | APIs, cliente, administrador e acompanhamento ficam privados e sem armazenamento; respostas 401/403 limpam dados exibidos pelo hook |
| Ocupação abusiva da agenda | Padrão de 5 reservas ativas e 90 dias de antecedência por cliente, conferido dentro da transação; administrador isento |
| Exportação pesada | Até 20 mil lançamentos por arquivo e 5 exportações por minuto por administrador, com erro explícito para dividir período |

Executar JavaScript no próprio console do navegador continua possível: o usuário controla seu próprio navegador. A proteção relevante é que isso não muda autorização ou dados no servidor. CSP reduz injeção de código no HTML; não se apresenta como mecanismo para bloquear DevTools.

Links de acompanhamento continuam usando token de 256 bits, hash de pesquisa, campos ocultos nas consultas usuais, projeção e DTO públicos restritos. Nenhum endpoint público modifica o atendimento ou revela dados financeiros internos. Revogação e renovação retiram imediatamente o acesso do token anterior. Mensagens de erro não imprimem URI MongoDB, senhas ou stack traces. Só `.env.example`, sem segredos, está rastreado pelo Git.

## Desempenho

- Marca isolada: painéis e autenticação deixam de carregar a página pública inteira por causa do logo.
- Financeiro/Recharts, formulários e seções administrativas carregam por demanda; componentes de apresentação compartilhados eliminam dependência circular.
- Configurações e catálogo já inicializados são lidos sem repetir upserts/bulkWrites. Sincronização da identidade local não grava quando e-mail e papel permanecem iguais.
- Financeiro seleciona apenas os campos necessários ao resumo e consulta o período anterior em paralelo.
- Polling não inicia atualização por intervalo/foco se já houver requisição em andamento; abas ocultas ou desconectadas não disparam esse polling. Recuperação da rede atualiza novamente.
- Pool MongoDB reutilizado com máximo de 10 conexões por instância, mínimo zero, descarte de ociosas e limite de espera. Em produção, índices são criados explicitamente pelo seed antes do tráfego, em vez de a cada instância nova.

Nonce exige renderização dinâmica do HTML; esse é um custo consciente da política de scripts. Não foi realizado benchmark de carga na Vercel nem medida comparativa de bytes/latência; as otimizações acima foram verificadas estrutural e funcionalmente.

## Evidências

- `npm audit --json`: zero vulnerabilidades conhecidas nas dependências instaladas em 04/10/2026.
- `npm run test:secrets`: compara os valores privados configurados internamente com o build público e arquivos candidatos ao Git, sem imprimir valores. Nenhuma exposição encontrada; arquivos privados de ambiente permanecem ignorados. A comparação de valores completos é uma verificação adicional, não detecta todos os vazamentos possíveis, como fragmentos transformados ou segredos de serviços não configurados.
- `npm test`: **83 testes aprovados**; o teste de handlers inclui **13 cenários internos** adicionais, com provider isolado e regras reais do servidor/MongoDB.
- TypeScript e build de produção aprovados com Next.js 16.3.8.
- `npm run test:security`: **11 cenários aprovados no build real**, incluindo nonce coerente/novo, bloqueio de script inserido no HTML, login Clerk renderizado, celular 390 px, três APIs administrativas com 401 mesmo com header falso, origem externa com 403, webhook sem assinatura e rotas inválidas com 404.
- Nenhum erro de execução no navegador desse ensaio. A única violação CSP registrada foi o bloqueio esperado do script de ataque simulado.
- Evidências em `../evidencias/seguranca/security-smoke.json`, `login-producao.png` e `ultima-tela-mobile.png`. O login desse build continua usando a instância Clerk de **desenvolvimento**; não equivale a validar uma instância Clerk de produção.

A conexão com o navegador do aplicativo Codex estava indisponível neste turno; o ensaio visual usou Chromium isolado. Não houve ensaio visual com a sessão real de administrador nesta execução. As APIs administrativas foram validadas por testes reais com identidade Clerk simulada, e o fluxo operacional completo já tinha sido validado localmente na revisão anterior.

## Antes de abrir o ambiente publicado

Siga `VERCEL.md` para publicar na sua própria conta. Ainda precisam ser configurados/confirmados no ambiente hospedado: URL/origens corretas, variáveis de ambiente separadas, rede Atlas e usuário restrito, seed/índices, webhook, MFA do administrador, backup/restauração, e-mail quando utilizado, limites na borda Vercel e ensaio autenticado completo. O limite MongoDB não substitui a proteção na borda contra tráfego volumétrico e custo de requisições. Não foi configurado WAF nem backup por esta revisão de código.

A homologação em `.vercel.app` pode continuar usando Clerk de desenvolvimento. Para ativar a instância Clerk de produção, configure seu domínio próprio e DNS. Revise os administradores e proteja também GitHub, Vercel, Atlas e Clerk; quem obtiver as credenciais dessas contas pode alterar o sistema fora das proteções da aplicação.

Fontes oficiais consultadas: [correções Next.js de setembro de 2026](https://nextjs.org/blog/september-2026-security-release), [CSP Next.js](https://nextjs.org/docs/app/guides/content-security-policy), [origens autorizadas Clerk](https://clerk.com/docs/reference/nextjs/clerk-middleware), [produção Clerk](https://clerk.com/docs/guides/development/deployment/production), [headers confiáveis Vercel](https://vercel.com/docs/headers/request-headers) e [limites na borda Vercel](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting).
