---
name: driva-debug
description: Orchestrate read-only debugging of Driva products and services by classifying tickets, locating repositories in the local repos workspace, discovering and using repository-specific debug/DB/log/client-session skills, and correlating UI session replays, database, logs, queues, callbacks, code, and git history across hub-driva, hunter-backend, engagement-service, integrations, export-service, management-service, search-go-api, market-analysis, enrichment-service, scheduler-service, mail-service, linkedin-service, whatsapp-service, whatsapp-cloud-service, and any newly discovered dependency. Use when asked to debug, investigate, diagnose, explain, triage, or find the root cause of a Driva product incident or support ticket, especially frontend behavior, CRM integrations/exports, auth/workspace/credits, search/lists, market analysis, Hunter prospecting agents/account plans/CRM sync, engagement, conversations, sequences, scheduling, email, LinkedIn, or WhatsApp behavior. Invoke with $driva-debug.
---

# Driva Debug

Orquestrar o diagnóstico ponta a ponta. Começar com uma hipótese de roteamento, mas ampliar o escopo sempre que a evidência revelar outro serviço, fila, callback ou dependência.

Ao abrir esta skill, definir `<skill-dir>` como o diretório absoluto que contém este
`SKILL.md`. Resolver todos os caminhos relativos desta skill, especialmente
`references/service-map.md` e `references/playbooks.md`, a partir de `<skill-dir>`,
nunca a partir do diretório de trabalho atual.

## Preparar o workspace

1. Localizar a raiz que contém os repositórios. Testar `./repos/hub-driva`, depois `./hub-driva`, e por fim buscar `hub-driva/hub-driva-context.md` com `rg --files -uu`.
2. Definir essa pasta como `<repos-root>`.
3. Ler `<repos-root>/hub-driva/hub-driva-context.md` para classificar área, fluxo e entidades. Tratar esse arquivo como contexto de roteamento, não como prova da causa.
4. Ler `<skill-dir>/references/service-map.md` para escolher os primeiros repositórios.
5. Descobrir skills locais antes de consultar DB ou logs:

```bash
rg --files -uu <repos-root> | rg '/\.(codex|agents|claude)/skills/[^/]+/SKILL\.md$'
```

6. Ler integralmente o `SKILL.md` de cada skill selecionada antes de usá-la. Preferir skills `.codex` ou `.agents` (ambas no formato Codex); usar uma skill `.claude` como instrução local quando não houver equivalente nessas pastas, adaptando somente nomes de ferramentas e preservando guardrails e wrappers.
7. Executar scripts de uma skill a partir da raiz do repositório ao qual ela pertence.

## Regras centrais

- Trabalhar em modo somente leitura por padrão.
- Não executar writes em banco, retries, requeues, restarts, deploys, migrations, alterações de status, login, envio de mensagens ou reprodução mutável sem pedido e autorização explícitos.
- Não abrir conversa real, responder contato, ativar sequência ou executar ação de canal apenas para reproduzir.
- Preferir contagens/existência antes de linhas; limitar resultados e redigir tokens, cookies, headers, payloads, corpos de mensagem, emails e telefones.
- Não concluir incidente de runtime apenas por leitura de código.
- Tratar DB como evidência do que persistiu; logs/traces como evidência do que o runtime tentou; código como comportamento esperado; git/PR como origem possível da mudança.
- Tratar client session como evidência do que o browser registrou: rota, visibilidade da aba, requests e interações. Não assumir que canvas, iframe, vídeo ou página externa foi visualmente capturada.
- Correlacionar ambos os lados de cada fronteira: produtor e consumidor, request e callback, enqueue e worker, scheduler e execução.
- Separar fato, inferência, hipótese descartada e lacuna.
- Nunca limitar a investigação à seleção inicial. Expandir quando aparecer identificador, URL, queue, service name, webhook, callback, client, env var ou erro de outra dependência.

### Isolar falhas de fonte

Tratar cada skill, wrapper e fonte como independente. Se uma consulta falhar:

1. registrar skill/fonte, comando seguro executado e mensagem de erro;
2. tentar no máximo uma correção read-only evidente, como ajustar cwd, janela ou schema conforme a própria skill;
3. continuar com todas as outras fontes elegíveis, sem abandonar DB, logs ou client session que não dependam da falha;
4. não transformar falha local do wrapper em evidência sobre produção;
5. declarar no diagnóstico somente a lacuna específica e reduzir a confiança apenas nas conclusões que dependiam dela.

Não afirmar “observabilidade indisponível” quando apenas uma skill falhou. Não substituir evidência runtime ausente por hipótese de código, comentário do ticket ou anexo.

## Fazer a triagem

Extrair do ticket:

- ambiente e janela temporal; converter horário local para UTC e declarar a conversão;
- comportamento esperado versus observado;
- URLs e IDs: workspace, user/client, sequence/workflow, execution, lead, event, action run/job, account/connection, message e trace/request;
- área do produto, tela, canal e ação;
- texto exato do erro e anexos;
- se o caso é histórico, ativo ou intermitente.

Produzir mentalmente um Context Pack com área, fluxo, entidades, evidências, repositórios iniciais, riscos de reprodução e incógnitas. Não exigir todos os campos antes de começar: pedir apenas o menor dado que bloquear o próximo passo.

### Avaliar client session

Considerar `hub-client-sessions-read` quando houver usuário/e-mail/workspace, janela temporal razoável e o relato envolver tela, navegação, carregamento, modal, clique, formulário, erro visual, aba fechada/oculta, request iniciado pelo browser ou divergência entre UI e backend.

Usar a client session quando ela puder responder pelo menos uma pergunta relevante: o usuário chegou à rota, iniciou a ação, recebeu o componente esperado, interagiu, deixou a aba, disparou request ou viu estado diferente do backend. Não consultá-la por rotina em incidentes exclusivamente backend sem sintoma ou decisão no cliente.

Quando elegível:

1. localizar `rum.sessionId` por usuário/workspace e janela UTC;
2. confirmar se existe replay em `hyperdx_sessions`;
3. resumir rotas, requests, visibilidade, erros e interações sem expor payloads sensíveis;
4. agrupar eventos duplicados no mesmo instante/alvo como uma interação provável, não como vários cliques humanos;
5. correlacionar timestamps e requests com a skill do backend responsável;
6. declarar o que a captura não permite observar, especialmente conteúdo desenhado em canvas.

## Escolher o ponto de entrada

- Usar `hub-driva` primeiro somente quando o sintoma puder ser exclusivamente frontend: renderização, botão desabilitado, modal, filtro, permissão/eligibilidade no cliente, payload do browser ou falha sem sinal backend.
- Para qualquer sintoma backend na área de Engajamento, começar em `engagement-service`.
- Para falhas de canal, começar em `engagement-service` para estabelecer intenção e estado; seguir ao serviço do canal e voltar pelo callback.
- Para sequência que não iniciou, verificar primeiro se o Engagement criou/ativou o schedule e a execução. Consultar `scheduler-service` quando faltar evidência de registro, disparo, fila, cron, timezone ou chamada de retorno.
- Para agentes de prospecção do Hunter (agent jobs, account plans/cadência, specialists/campanhas, sync CRM HubSpot/Salesforce, reply/meeting/result events), começar em `hunter-backend`. Quando o Hunter delegar envio ao Engagement, Mail, WhatsApp Cloud ou LinkedIn, seguir a fronteira e voltar pelo callback.
- Para exportação/sync com CRM (OAuth/token, rate limit, mapeamento de campos, ROI sync, eventos `crm_app`), começar em `integrations`. Para exportação de planilha, histórico de exportações, e-mail de conclusão ou o status/erro devolvido ao Hub por uma exportação, começar em `export-service`.
- Para login, sessão, acesso/bloqueio de workspace, feature flags, créditos, SSO e API keys, começar em `management-service`.
- Para busca, listas e contagens do produto de pesquisa, começar em `search-go-api`. Para análise de mercado (runs presos, manifests S3, callback ao Search), começar em `market-analysis` e voltar ao `search-go-api` pelo estado do run.
- Fora dessas áreas, usar o Hub para localizar a API e seguir ao backend descoberto; não presumir que os repositórios presentes formam toda a plataforma.

Consultar `<skill-dir>/references/playbooks.md` para roteamentos frequentes e os tickets-modelo.

## Investigar por fronteiras

1. Quando elegível, estabelecer o comportamento observado no browser com client session; estabelecer o estado no serviço de entrada com DB/logs usando skills locais.
2. Montar uma timeline UTC mínima.
3. Encontrar no código a fronteira: interação/rota do client, request, controller, queue, worker, webhook, callback ou evento.
4. Extrair a chave propagada (`rum.sessionId`, `trace_id`, `workflow_id`, `event_id`, `action_job_id`, `message_id`, `account_id`, etc.).
5. Consultar o serviço seguinte na mesma janela e com a mesma chave.
6. Verificar o retorno ao serviço anterior e o estado persistido após o retorno.
7. Repetir enquanto surgir nova fronteira plausível.
8. Parar uma ramificação quando houver sucesso dos dois lados ou quando ela não puder explicar o sintoma.

### Incidentes de runtime Kubernetes

Quando o alerta indicar pod, container, restart, probe, CrashLoopBackOff, OOM, eviction, CPU, memória, node ou rollout, usar `kubernetes-observability-read` como fonte inicial de contexto de infraestrutura. Em seguida, consultar a skill do serviço afetado (por exemplo, `engagement-debug` e `engagement-logs-read`) para explicar o que o processo estava fazendo. A skill Kubernetes não substitui a investigação da aplicação, e as skills da aplicação não substituem métricas/eventos do runtime.

Manter hipóteses abertas: não assumir CPU, OOM, probe ou rollout antes de comparar estado do pod, eventos, métricas, traces e logs na mesma janela UTC. Separar sempre o sintoma do alerta da causa confirmada.

### Regra de expansão dinâmica

Expandir imediatamente quando:

- request saiu do serviço atual, mas não há resultado local suficiente;
- resultado externo, webhook ou callback está ausente, atrasado ou falhou;
- DB contradiz runtime ou UI;
- fila publicou sem consumo, ou worker executou sem callback;
- erro nomeia serviço/provedor externo;
- código/config aponta para URL, queue ou service name ainda não investigado;
- skill local recomenda fonte em outro serviço.

Antes de consultar repositório novo, procurar contexto, README e skills; não inventar schema, comando ou observabilidade.

## Usar skills especializadas

- Em `hub-driva`, usar `hub-client-sessions-read` para sintomas frontend elegíveis e correlacionar o request observado com o backend; usar código do Hub para explicar regras e renderização, não como prova isolada do incidente.
- Em `engagement-service`, preferir `engagement-debug` e usar `engagement-db-read`/`engagement-logs-read` para evidência.
- Em `hunter-backend`, preferir `hunter-debug` e usar `hunter-db-read`/`hunter-logs-read` para evidência (skills em `.agents/skills`).
- Em `integrations`, preferir `integrations-debug` e usar `integrations-db-read`/`integrations-logs-read` (skills em `.agents/skills`).
- Em `export-service`, preferir `export-debug` e usar `export-db-read`/`export-logs-read` (skills em `.agents/skills`).
- Em `enrichment-service` não há skills; ler o código e buscar evidência pelo `search-go-api`.
- Em `management-service`, preferir `management-debug` e usar `management-db-read`/`management-logs-read` (skills em `.agents/skills`). Restringir consultas de log por janela curta; o volume é alto.
- Em `search-go-api`, preferir `search-go-debug` e usar `search-go-db-read`/`search-go-logs-read`/`search-go-rabbitmq-read` (skills em `.agents/skills`).
- Em `market-analysis`, preferir `market-analysis-debug` e usar `market-analysis-db-read`/`market-analysis-logs-read`/`market-analysis-s3-read` (skills em `.agents/skills`, scripts via `python3`).
- Em `linkedin-service/linkedin-api`, preferir `linkedin-debug`, `linkedin-db-read` e `linkedin-logs-read`.
- Em `whatsapp-cloud-service`, usar `whatsapp-cloud-db-read` quando DB for necessário; descobrir skills adicionais antes de improvisar acesso.
- Sem skill adequada, investigar read-only com README, estrutura, entidades, clients, controllers, logs disponíveis e git. Não acessar produção por cliente ad hoc sem caminho aprovado pelo repositório.
- Não duplicar detalhes de schema/sintaxe das skills especializadas; reler a fonte local atual.

## Validar hipótese e regressão

Formular hipóteses falsificáveis e buscar evidência contrária. Só declarar causa raiz quando a cadeia causal explicar o esperado, o observado e a timeline.

Quando a evidência apontar código/config/deploy:

1. usar `git blame`, `git log -- <file>`, `git log -L` e `git show` no repositório responsável;
2. consultar PR/GitHub quando disponível;
3. comparar mudança/deploy conhecido com a janela;
4. não chamar de regressão sem alinhamento entre runtime e histórico.

## Entregar o diagnóstico

Responder no idioma do usuário, liderando pela conclusão:

```markdown
Resumo: <causa confirmada/provável ou estado da investigação>

Escopo verificado:
- Ambiente, IDs, janela UTC e serviços

Timeline:
- <timestamp> — <fato> — <fonte/serviço>

Evidências:
- <DB: serviço, tabela/coleção, filtro ou tipo de registro e fato comprovado>
- <Logs/traces: serviço, janela, identificador/evento/mensagem e fato comprovado>
- <Client session/anexo/código/git: fonte específica e fato comprovado>

Fontes consultadas:
- <somente fontes acessadas com sucesso, separadas por serviço/repositório e contribuição>

Fontes indisponíveis:
- <somente falhas reais, separadas das evidências; omitir quando não houver>

Cadeia causal:
- <origem> → <handoff> → <falha> → <efeito visível>

Conclusão:
- Causa: ...
- Confiança: alta | média | baixa
- Lacunas: ...

Próximos passos:
- <ação mínima, serviço dono e forma de validar>
```

Evitar referências genéricas como “o banco” ou “os logs”. No diagnóstico técnico, nomear
as tabelas/coleções e os registros ou filtros relevantes, além dos eventos/mensagens de
log que sustentaram a conclusão. Fornecer detalhe suficiente para auditoria por outro
desenvolvedor, sem expor dados sensíveis, despejar queries completas ou listar ruído.

Se a evidência for insuficiente, informar exatamente qual elo não foi observado e pedir o menor ID ou intervalo necessário.
