# Mapa de serviços Driva

## Sumário

- [Visão geral](#visão-geral)
- [hub-driva](#hub-driva)
- [hunter-backend](#hunter-backend)
- [engagement-service](#engagement-service)
- [scheduler-service](#scheduler-service)
- [integrations](#integrations)
- [export-service](#export-service)
- [management-service](#management-service)
- [search-go-api](#search-go-api)
- [market-analysis](#market-analysis)
- [enrichment-service](#enrichment-service)
- [linkedin-service](#linkedin-service)
- [mail-service](#mail-service)
- [whatsapp-cloud-service](#whatsapp-cloud-service)
- [whatsapp-service](#whatsapp-service)
- [Como ampliar o mapa](#como-ampliar-o-mapa)

## Visão geral

```text
hub-driva
    |
    v
engagement-service -----> mail-service -----------+
    |                    (eventos/callbacks)       |
    +-------------------> linkedin-api -> worker --+
    |                    (resultado/webhook)       |
    +-------------------> whatsapp-cloud-service --+
    |                    (status/inbound callback) |
    +-------------------> whatsapp-service         |
    |                                               |
    +<---------------- scheduler-service            |
                         POST sequence/execute      |
                                                    v
                                         engagement-service
```

O diagrama é inicial, não uma lista fechada. Confirmar cada fronteira no código atual e seguir dependências adicionais.

## hub-driva

Frontend React e superfície do produto. Usar para UI, modais, filtros, ações bloqueadas antes do request, payload/query params e regras implementadas no cliente. Não torná-lo ponto obrigatório para incidentes backend. Ler `hub-driva/hub-driva-context.md`.

O ClickStack recebe traces RUM e client sessions do Hub. Para sintomas visuais ou comportamentais com usuário/workspace e janela temporal, usar `.codex/skills/hub-client-sessions-read` para localizar `rum.sessionId`, confirmar replay e correlacionar rota/interação/request com o backend. A replay pode não capturar pixels de canvas, vídeo, iframe cross-origin ou página externa; usar esses dados como evidência complementar.

Fronteira recomendada quando elegível:

```text
relato/anexo → client session → request do browser → serviço responsável → persistência/callback
```

## hunter-backend

CRM B2B agent-first (NestJS, Prisma/PostgreSQL, Redis/BullMQ, Socket.IO): agentes de IA planejam e executam prospecção; humanos supervisionam e assumem conversas. Cobre agent jobs, account plans e steps de cadência, specialists/campaign teams, conversas, reply/meeting/result events e sync CRM (HubSpot/Salesforce).

Relações confirmadas no código (confirmar a implementação usada em cada caso):

- delega envio de sequência ao Engagement via `ENGAGEMENT_API_URL` (`src/engagement`) e expõe `internal/engagement/*` para contexto de contato e specialists; fila `engagement-opt-out-sync`;
- envia email via `MAIL_SERVICE_URL` (`src/mail-delivery`) e recebe webhooks do Mail (fila `mail-service-webhook`);
- chama WhatsApp Cloud via `WHATSAPP_CLOUD_SERVICE_BASE_URL` (`src/agents/integrations/whatsapp-cloud.service.ts`);
- executa ações LinkedIn por runner próprio (`src/linkedin-runner`, `LINKEDIN_CLOUD_BROWSER_URL`), não necessariamente pelo `linkedin-service`;
- recebe eventos CRM em `internal/crm-events`.

Hunter é produtor nessas chamadas: incidentes abertos no serviço chamado podem ter origem aqui. Jobs BullMQ repetíveis/cron frequentemente logam sem `TraceId`; pivotar por janela em `otel_traces`. Nos logs, `ServiceName = hunter-backend`. Sempre escopar por `workspace_id` e `sandbox`.

Skills conhecidas em `.agents/skills` (espelho em `.claude/skills`): `hunter-debug`, `hunter-db-read`, `hunter-logs-read`.

## engagement-service

Núcleo da área de Engajamento: sequências/workflows, execuções, progresso, conversas, métricas e integrações.

Relações confirmadas:

- gerencia agendas via `SCHEDULER_BASE_URL`;
- integra com email;
- envia ações LinkedIn e recebe resultados/webhooks;
- envia via WhatsApp Cloud e recebe status/inbound;
- contém caminhos legados/diretos de LinkedIn e WhatsApp: confirmar qual implementação o caso usa.

Ponto de entrada padrão para Engajamento backend. Skills conhecidas: `.codex/skills/engagement-debug`, `engagement-db-read` e `engagement-logs-read`.

## scheduler-service

Persiste schedules, registra jobs BullMQ/Redis e dispara sequências. Engagement gerencia a agenda no Scheduler; o Scheduler consome `campaignQueue` e chama `POST /sequence/execute/:workflowId` no Engagement via `SA_URL`.

Verificar schedule/active, `startTime`, weekdays, hours, minutes, timezone, job scheduler/delayed, `schedule_run_history`, chamada HTTP e retries. Se a chamada chegou ao Engagement, retornar a ele.

## integrations

Exportações e sync com CRMs: OAuth/expiração de token, rate limit de provider, mapeamento de campos/valores, scheduler de ROI sync e entrega de eventos `crm_app`. Correlaciona com o export-service e o `search-go-api` (origem dos dados exportados) e depende do `management-service` para auth.

Nos logs, `ServiceName = integrations` (o `crm-service` é relacionado). Skills em `.agents/skills`: `integrations-debug`, `integrations-db-read`, `integrations-logs-read`.

## export-service

API e worker Go de exportações: planilhas (XLSX), exportações para CRM, histórico de exportações, snapshots/sync de CRM ROI e e-mails de conclusão. Recebe pedidos do Hub, chama o `integrations` para o CRM, o `search-go-api` para os dados e o `management-service` para auth. Estado no Postgres de exports.

Nos logs, `ServiceName = export-service` por padrão (pode ser sobrescrito por `OTEL_SERVICE_NAME`; descobrir os valores reais). Skills em `.agents/skills`: `export-debug`, `export-db-read`, `export-logs-read`.

## management-service

Auth e autorização: login/sessão, current-user, acesso e bloqueio de workspace, feature flags, créditos (ledger e legado), crons (reset de créditos, churn, alerta de créditos esgotados), SSO enterprise e API keys. Consumido pelo Hub e pelo `integrations`; incidentes nesses consumidores podem ter origem aqui.

Nos logs, `ServiceName = management`; o volume é alto, então usar janelas curtas. Skills em `.agents/skills`: `management-debug`, `management-db-read`, `management-logs-read`.

## search-go-api

API de busca e listas (Go): pesquisa, listas, contagens, auditoria e filas RabbitMQ. Guarda o estado dos runs de análise de mercado consumidos pelo `market-analysis`.

Skills em `.agents/skills`: `search-go-debug`, `search-go-db-read`, `search-go-logs-read`, `search-go-rabbitmq-read`.

## market-analysis

Worker de market intelligence: consome runs via RabbitMQ, lê/escreve manifests no S3, executa clustering/profiling e devolve o resultado por callback ao Search. Estado do run fica no DB do `search-go-api`.

Nos logs, `ServiceName` em `market-analysis-worker`, `search-go-api-market-analysis-worker` ou `search-go-worker-market-analysis`. Skills em `.agents/skills` (scripts via `python3`): `market-analysis-debug`, `market-analysis-db-read`, `market-analysis-logs-read`, `market-analysis-s3-read`.

## enrichment-service

Worker Python (asyncio) que consome jobs de enriquecimento de contatos/empresas do RabbitMQ (fila `hub_enrichment_v2` e afins) e chama provedores externos; HTTP FastAPI é secundário. Estado no Postgres e resultados grandes no S3. O `search-go-api` publica os jobs e guarda o estado da lista/leads.

Sem skills próprias: ler o código (`src/`, `CONTEXT.md`, `CLAUDE.md`) e buscar evidência pelos logs/DB do `search-go-api`. Referências a Elasticsearch/ClickHouse no código são legado morto.

## linkedin-service

`linkedin-api` gerencia contas, action jobs, filas, listener, resultados e webhooks; `linkedin-worker` executa ações por conta usando sessão/browser.

Fluxo: Engagement cria intenção → API persiste/publica job → worker executa → API persiste outcome → webhook retorna ao Engagement. Distinguir business failure de exceção técnica.

Skills conhecidas em `linkedin-api/.claude/skills`: `linkedin-debug`, `linkedin-db-read`, `linkedin-logs-read`.

## mail-service

Gerencia envio/recebimento, contas Gmail/Outlook, watchers, suppressions e eventos ao Engagement. Retorna bounce, reply, email regular, estado de conta e callbacks `EMAIL_SENT`, `EMAIL_NOT_FOUND`, `REQUEUE`, `SEND_EMAIL_ERROR`.

Correlacionar event/action run, conta, provider message ID, webhook/watch, retry e callback `/email-events`.

## whatsapp-cloud-service

Gerencia conexão WhatsApp Business Cloud, envio, templates, webhooks Meta, mensagens e callbacks.

Fluxo: Engagement envia request → serviço persiste request/mensagem → Meta envia status/inbound → serviço persiste webhook/callback → URL específica do request ou fallback ao Engagement. Também registra opt-out no Engagement.

Correlacionar execution/event/workflow/lead, connection, dedup key, message ID, `wam_id` e callback result. Skill conhecida: `.claude/skills/whatsapp-cloud-db-read`.

## whatsapp-service

Integração WhatsApp Web legada via whatsmeow, QR/SSE, JIDs, envio/recebimento e validação. Confirmar se o fluxo usa legado ou Cloud. Não usar banco de produção em teste local: a documentação alerta que isso pode desconectar dispositivos.

## Como ampliar o mapa

1. Localizar client/config/env/controller.
2. Identificar direção, endpoint/queue e chave de correlação.
3. Encontrar o repositório por nome, URL ou service name.
4. Descobrir README, contexto e skills.
5. Quando houver sintoma frontend elegível, verificar client session antes ou em paralelo à fronteira HTTP.
6. Investigar produtor e consumidor.
7. Nunca usar este mapa para ignorar uma nova fronteira.
