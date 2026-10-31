# Playbooks de roteamento

## Sumário

- [Conversa não permite responder](#conversa-não-permite-responder)
- [Sintoma visual ou ação no frontend](#sintoma-visual-ou-ação-no-frontend)
- [Ação LinkedIn falhou](#ação-linkedin-falhou)
- [Sequência não iniciou](#sequência-não-iniciou)
- [Email não enviou ou resposta não apareceu](#email-não-enviou-ou-resposta-não-apareceu)
- [WhatsApp Cloud falhou](#whatsapp-cloud-falhou)
- [Métricas ou histórico divergentes](#métricas-ou-histórico-divergentes)
- [Agente ou cadência do Hunter não agiu](#agente-ou-cadência-do-hunter-não-agiu)
- [Exportação ou sync com CRM falhou](#exportação-ou-sync-com-crm-falhou)
- [Login, acesso ou créditos incorretos](#login-acesso-ou-créditos-incorretos)
- [Análise de mercado travou ou falhou](#análise-de-mercado-travou-ou-falhou)
- [Enriquecimento travado ou com resultado errado](#enriquecimento-travado-ou-com-resultado-errado)
- [Tickets-modelo](#tickets-modelo)

## Conversa não permite responder

Começar no Hub quando a ação não produz request ou o bloqueio é visível na tela. Verificar regra do composer/botão, canal, conta, responsável, permissão, customer-service window, handler, payload e network. Expandir ao Engagement/canal se houve request ou se o estado vem da API.

Quando houver usuário e horário, consultar client session para confirmar rota, clique, request, erro e visibilidade da aba. Não interpretar múltiplos spans idênticos no mesmo milissegundo como múltiplos cliques humanos.

## Sintoma visual ou ação no frontend

Usar `hub-client-sessions-read` quando o ticket mencionar carregamento, modal, botão, navegação, formulário, erro visual, aba fechada/oculta ou divergência entre o que o usuário viu e o backend registrou.

Seguir:

1. localizar a sessão por e-mail/user/workspace e janela UTC;
2. confirmar a replay por `rum.sessionId`;
3. montar timeline de rota, visibilidade, interação, request e resposta HTTP;
4. identificar no Hub o handler e a API chamada;
5. seguir o request ao serviço dono e correlacionar logs/DB/callback;
6. declarar limitações de captura de canvas, iframe, vídeo e páginas externas.

Não usar ausência de replay como prova de ausência da ação. Não concluir sucesso pela resposta HTTP `2xx` quando o resultado funcional depende do corpo, callback ou estado persistido.

Se a consulta de client session falhar, registrar o erro específico e continuar pelo request/backend quando houver IDs, usuário ou janela. Se uma consulta backend falhar, continuar com client session, anexos e demais serviços independentes. Nunca resumir uma falha isolada como indisponibilidade geral da observabilidade.

## Ação LinkedIn falhou

Seguir: workflow/execution/lead/action run no Engagement → action job no LinkedIn API → publicação/consumo pelo worker → outcome/business failure/exception → webhook result → estado final no Engagement. Falha em todos os convites sugere fator compartilhado, mas deve ser provado.

Se o relato envolver conexão, login remoto, spinner, modal ou interação no browser, acrescentar client session do Hub no início da timeline e correlacionar seus requests/interações com os logs de login. Conteúdo do LinkedIn desenhado em canvas pode não estar visível, mas presença do canvas, cliques, polling e visibilidade da aba continuam úteis.

## Sequência não iniciou

Começar no Engagement: workflow ativo, timezone, weekdays, horas/minutos, start time, retorno do schedule, execução e guards. Consultar Scheduler se faltar disparo: schedule ativo, job, timezone/start date, consumo, histórico e `POST /sequence/execute/:workflowId`. Se a chamada chegou, continuar no Engagement.

## Email não enviou ou resposta não apareceu

Correlacionar Engagement e Mail: action run/event, conta, request, provider message ID, suppression/requeue, webhook Gmail/Outlook, lead check, retry de evento e atualização final.

## WhatsApp Cloud falhou

Correlacionar Engagement, WhatsApp Cloud e Meta: request, connection, dedup key, send request, mensagem/`wam_id`, erro Meta/template, webhook, callback delivery e estado final. Distinguir Cloud de WhatsApp Web legado.

## Métricas ou histórico divergentes

Começar no Engagement para fonte de verdade/agregação. Usar Hub para filtros/formatação. Consultar canal se a métrica depende de callback/status ausente.

## Agente ou cadência do Hunter não agiu

Começar em `hunter-backend` com `hunter-debug`. Com `workspace_id`, `sandbox` e janela UTC, estabelecer no DB o estado de `agent_jobs` (status, attempts, lock, erro), `account_plans`/`account_plan_steps` (`scheduled_for`, `executed_at`, `skip_reason`, falhas) e a configuração do specialist/campanha. Nos logs, confirmar enqueue/dequeue, processor, decisões/tool calls do agente, guards e retries.

Se o step delegou envio, seguir a fronteira: Engagement (`engagement-debug`), Mail, WhatsApp Cloud ou runner LinkedIn. Voltar pelo callback/webhook e verificar o estado final no Hunter. Para divergência com HubSpot/Salesforce, correlacionar `outbound_sync_jobs`, `crm_outbox_commands` e recibos de eventos CRM sem selecionar tokens.

Quando o incidente aparecer no serviço chamado (por exemplo, erro no WhatsApp Cloud), verificar se o Hunter é o produtor antes de atribuir a causa ao callee.

## Exportação ou sync com CRM falhou

Começar em `integrations` com `integrations-debug`. Estabelecer no DB o estado da exportação/sync e da conexão (token expirado, rate limit, mapeamento). Nos logs, confirmar a chamada ao provider e o erro retornado. Se o pedido de exportação, o histórico ou o status devolvido ao Hub divergirem do CRM, seguir ao `export-service`. Se os dados de origem estiverem errados, seguir ao `search-go-api`; se a falha for de auth/workspace, seguir ao `management-service`.

## Login, acesso ou créditos incorretos

Começar em `management-service` com `management-debug`. Verificar usuário, workspace (bloqueio, plano, feature flags) e ledger de créditos no DB; nos logs, usar janela curta em torno do request. Para débito/estorno originado em outro serviço (por exemplo enriquecimento), confirmar o produtor antes de atribuir a causa.

## Análise de mercado travou ou falhou

Começar em `market-analysis` com `market-analysis-debug`. Ler o estado do run no DB do Search (QUEUED/RUNNING, tentativas), a fila/DLQ no RabbitMQ, os manifests de entrada/saída no S3 e os logs do worker (incluindo restarts). Se o worker concluiu mas o run não mudou, verificar o callback no `search-go-api`.

## Tickets-modelo

### Ticket 1 — Tela de conversas não deixa responder LinkedIn

Roteamento inicial: `hub-driva` + client session quando houver usuário/horário. O bloqueio pode ser frontend. Se houver request, erro backend ou estado remoto, ampliar para Engagement e LinkedIn.

### Ticket 2 — Todos os convites LinkedIn falham sem motivo

Roteamento inicial: `engagement-service` + `linkedin-service`. Correlacionar sequência/action runs, job/worker/outcome e webhook de volta.

### Ticket 3 — Sequência não iniciou no horário

Roteamento inicial: `engagement-service`. Expandir para `scheduler-service` somente se não houver evidência suficiente de registro/disparo/chamada.
