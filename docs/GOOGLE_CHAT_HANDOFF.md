# Google Chat dedicado — decisões e progresso

Atualizado em: 2026-08-28

## Objetivo

Migrar o agente do app genérico do Google Chat para um app dedicado e organizar toda
a interação operacional por ticket:

1. avisar, nos mesmos espaços que receberam o diagnóstico, quando alguém assumir
   um ticket;
2. manter diagnóstico, plano de ação, avisos e perguntas em uma thread própria do
   ticket, sem executar mudanças a partir da conversa.

## Decisões confirmadas

- O aviso de ticket assumido será enviado para cada `space` que recebeu o card de
  diagnóstico. Não haverá fan-out por membro nem DM individual para esse aviso.
- Cada `(ticket, space)` possui uma thread canônica; o mesmo ticket em outro espaço
  recebe outra thread porque threads não atravessam espaços.
- A conversa pode aprofundar hipóteses, avaliar alternativas técnicas e sugerir próximos
  passos usando a codebase, o histórico git e fontes operacionais disponíveis, sempre em
  modo somente leitura. A exceção explícita é uma resposta citando a mensagem de Ação
  técnica, que pode iniciar uma nova remediação após confirmação do mesmo usuário.
- Uma reorientação cria uma iteração auditável, abre PRs novos e só fecha PRs anteriores
  nos repositórios que receberam substitutos válidos. Falhas preservam os PRs existentes.
- O contexto vem da thread, não do usuário; qualquer participante da thread pode perguntar.
- Não há ativação, DM privada ou expiração de sessão.
- Comandos da primeira versão:
  - `/ajuda`
  - `/contexto`
  - `/encerrar`
- Qualquer outro texto não vazio será tratado como pergunta sobre o ticket. O diagnóstico
  existente é o ponto de partida; quando necessário, o Codex pode usar `$driva-debug` e
  outras skills somente leitura para buscar evidências adicionais.
- O histórico mantém no máximo 10 pares de mensagens por thread.
- Mensagens são limitadas a 4.000 caracteres e respostas do Codex têm timeout padrão
  de 10 minutos; ambos os valores são configuráveis por env.

## Migração do app

- Substituir o JSON apontado por `GOOGLE_APPLICATION_CREDENTIALS`, mantendo o mesmo
  caminho/mount se desejado.
- Em **Authentication Audience**, selecionar **HTTP endpoint URL**.
- Configurar `GOOGLE_CHAT_AUDIENCE` com a URL HTTPS exata do endpoint de
  interações, incluindo caminho e eventual barra final.
- Configurar `GOOGLE_CHAT_CALLER_EMAIL` com o **Service Account Email** exibido em
  Google Workspace Marketplace SDK → HTTP Deployments → Authorization Resource.
  Em deployments atuais, ele normalmente segue o formato
  `service-<project-number>@gcp-sa-gsuiteaddons.iam.gserviceaccount.com`.
- Revisar `GOOGLE_CHAT_VECTOR_SPACES_JSON` e adicionar o novo app a todos os espaços
  mantidos no mapeamento.
- No Google Cloud Console, habilitar interactive features, configurar conexão HTTP
  para `https://<host>/google-chat/events`, liberar a visibilidade aos usuários da
  Driva e habilitar eventos de mensagem nos espaços usados pelo agente.
- Manter `GOOGLE_CHAT_SKIP_AUTH=false` em produção.

## Progresso

- [x] Fluxo atual de envio, aprovação e assunção mapeado.
- [x] Decisões de produto registradas.
- [ ] Migrar/configurar as variáveis e credenciais no ambiente de produção.
- [x] Adicionar aviso idempotente de ticket assumido.
- [x] Remover o botão de conversa privada e vincular mensagens à thread do ticket.
- [x] Receber mensagens na thread e implementar comandos.
- [x] Executar perguntas de esclarecimento no Codex em modo somente leitura.
- [x] Persistir vínculo ticket-thread e histórico curto compartilhado.
- [x] Atualizar documentação de configuração do app.
- [x] Validar build.
- [ ] Realizar smoke test manual no novo Google Chat App.

## Implementação realizada

- `state/assumption-notifications.json` funciona como outbox por aprovação e espaço.
  O ClickUp permanece assumido mesmo que um aviso falhe, e somente destinos pendentes
  ou com falha são tentados novamente.
- `state/chat-ticket-threads.json` guarda um vínculo por `(ticket, space)`, com o
  `thread.name`, a chave determinística de fallback e o histórico curto compartilhado.
- Perguntas ao Codex são confirmadas imediatamente pelo webhook e respondidas depois
  por mensagem proativa, evitando manter a requisição do Google Chat aberta.
- Mensagens da mesma thread são processadas em ordem por uma fila em memória.
- O prompt de conversa é estritamente somente leitura. Ele pode aprofundar hipóteses,
  avaliar alternativas e sugerir próximos passos, mas o processo do Codex não recebe
  `GH_TOKEN` nem permissões de remediação e não executa alterações.
- Variáveis opcionais: `GOOGLE_CHAT_CONVERSATION_HISTORY_TURNS`,
  `GOOGLE_CHAT_CONVERSATION_MAX_MESSAGE_LENGTH` e
  `GOOGLE_CHAT_CONVERSATION_TIMEOUT_MINUTES`, além de
  `GOOGLE_CHAT_REORIENTATION_MAX_MESSAGE_LENGTH` e
  `GOOGLE_CHAT_REORIENTATION_CONFIRMATION_MINUTES` para novas orientações.

## Verificações realizadas

- `npm run build`: aprovado em 2026-08-28.
- `npm test`: 30 testes aprovados em 2026-08-28, incluindo roteamento, isolamento,
  ordenação e respostas na thread.

## Validação em produção — estado atual

### Configuração confirmada

- Projeto Google Cloud do app: `driva-ops-agent`.
- Project number observado no Console: `224800446049`.
- Google Chat API habilitada.
- Recursos interativos habilitados.
- Conexão por endpoint HTTP único.
- Callback público esperado:
  `https://automacoes.driva.io/driva-ops-agent/google-chat/events`.
- A rota pública foi testada sem token e respondeu `401` com
  `Google Chat request token is missing`. Isso confirma DNS, HTTPS, Nginx e o
  encaminhamento até o NestJS.
- O app foi criado como complemento do Google Workspace. Essa opção aparece marcada
  e bloqueada no Console depois da criação; não foi tomada a decisão de recriar o app
  ou mudar o modelo da integração por causa disso.

### Autenticação do callback

- A documentação atual do Google Chat diferencia dois modos de Authentication
  Audience: `HTTP endpoint URL` envia um ID token com a URL como `aud`, enquanto
  `Project Number` envia um JWT próprio.
- Para o servidor HTTP atual, o modo escolhido é `HTTP endpoint URL`.
- `GOOGLE_CHAT_AUDIENCE` deve ser exatamente igual à URL configurada no Console,
  sem adicionar ou remover barra final.
- `GOOGLE_CHAT_CALLER_EMAIL` deve corresponder ao Service Account Email exibido em
  Google Workspace Marketplace SDK → HTTP Deployments → Authorization Resource.

### Erros observados no Google Cloud Logging

Primeira tentativa do antigo botão `start_diagnosis_conversation`, em
`2026-08-03T20:55:52Z`:

```text
Can't post a reply. The Chat app didn't respond or its response was invalid.
```

Tentativa posterior, em `2026-08-03T21:09:05Z`:

```text
Can't post a reply. The Chat app doesn't have permission to post in this space.
The space might be blocked, or Chat apps may be blocked in this space.
```

Nos dois casos o log do Google identificou a função
`start_diagnosis_conversation`. Entretanto, não foi localizado o log correspondente
na aplicação Dokku. O NestJS não possui access log geral e erros ocorridos antes do
log de autenticação podem não aparecer como uma ação processada.

### Diagnóstico ainda pendente

O próximo passo é consultar o access log do Nginx imediatamente após um clique para
confirmar se o Google chamou o endpoint e qual status HTTP recebeu:

```bash
sudo grep -h '/driva-ops-agent/google-chat/events' /var/log/nginx/*access* |
  tail -n 20
```

Interpretação:

- nenhuma linha: o Google não disparou o endpoint configurado;
- `401`: audience, issuer ou caller ainda incompatível;
- `403`: bloqueio de acesso ou permissão;
- `404`: caminho configurado incorretamente;
- `500`: callback chegou, mas a aplicação lançou uma exceção;
- `200`: callback foi aceito e a investigação passa para o formato/permissão da
  resposta do Google Chat.

Esse erro pertence ao fluxo antigo de DM. O smoke test atual deve responder diretamente
na thread criada pelo card de diagnóstico.

## Validação manual planejada

1. Enviar um diagnóstico pelo novo app.
2. Clicar em `Assumir ticket` e confirmar o ClickUp e um único aviso em cada espaço.
3. Repetir o clique e confirmar que não há aviso duplicado.
4. Clicar em `Aprovar comentário no ClickUp` e confirmar o comportamento atual.
5. Confirmar que o diagnóstico e o plano de ação aparecem na mesma thread.
6. Enviar perguntas por usuários diferentes nessa thread e testar `/contexto`, `/ajuda` e `/encerrar`.
7. Confirmar que perguntas e alternativas sugeridas não modificam sistemas.
8. Confirmar que uma mensagem fora da thread do ticket não inicia uma investigação.
