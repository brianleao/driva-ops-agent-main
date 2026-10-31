# Deploy Dokku — handoff

Atualizado em 2026-10-03 (America/Sao_Paulo).

## Objetivo

Publicar o `driva-ops-agent` na máquina de automações gerenciada por Dokku. A aplicação deve executar em um único container, acessar os repositórios privados, chamar o Codex por meio do proxy LLM interno da Driva, notificar o Google Chat e, quando autorizado pelo diagnóstico, criar branches e PRs sem merge ou deploy.

## Decisões tomadas

- Manter apenas uma instância (`web=1`), pois cron, fila e locks não são distribuídos.
- Persistir `/app/repos`, `/app/state` e `/app/results`.
- Não persistir todo o `CODEX_HOME`: o `config.toml` é imutável e vai na imagem; a chave do proxy entra por variável.
- Usar `CODEX_MODEL=gpt-5.6-sol`, sobrescrevível sem rebuild.
- Usar `GITHUB_AUTH_MODE=app` em produção com um GitHub App da organização, instalado somente nos repositórios necessários e sem permissões de merge, deploy, administração ou bypass. Manter `GITHUB_AUTH_MODE=static` com `GH_TOKEN` apenas como rollback temporário.
- Executar como usuário não-root. A imagem aceita `APP_UID`/`APP_GID`; produção usa o padrão `10001`, desenvolvimento pode usar o UID/GID local.
- O cron começa desligado com `DIAGNOSIS_CRON_ENABLED=false` e só será habilitado após os testes no Dokku.
- O subprocesso Codex recebe uma allowlist de variáveis. Diagnóstico não recebe credenciais do GitHub; remediação recebe somente a configuração necessária para os helpers renováveis.
- Não montar Docker socket e não usar container privilegiado.

## Implementação já realizada

### Container

- `Dockerfile` multi-stage baseado em Node 24.14.1 Bookworm, fixado para atender
  o `engine-strict` do `hub-driva`; npm também está fixado em 11.11.0.
- Ferramentas instaladas e fixadas:
  - Node 24.14.1
  - npm 11.11.0
  - pnpm 10.33.0
  - Go 1.25.5
  - Codex CLI 0.146.0
  - GitHub CLI 2.96.0
  - Git, build-essential, curl, jq, openssh-client e certificados
- Usuário não-root `app`.
- O Dockerfile reutiliza UID/GID já existentes (necessário porque a imagem Node já possui UID/GID 1000).
- `.dockerignore` exclui `.env`, credenciais, `repos`, `state`, `results`, `node_modules` e `dist`.

### Codex

- `docker/codex/config.toml` contém:
  - provider `driva_proxy`
  - `base_url = "http://vpn-driva.netbird.driva.io:8317/v1"`
  - `wire_api = "responses"`
  - `env_key = "DRIVA_PROXY_API_KEY"`
  - modelo padrão `gpt-5.6-sol`
  - perfil `driva-debug-read-network`, copiado da configuração de projeto necessária pelo diagnóstico
- MCPs e credenciais pessoais do `~/.codex/config.toml` não foram copiados.
- `src/runner.js` passa `--model "$CODEX_MODEL"` quando configurado.
- `src/runner.js` não herda mais todo o `process.env`; usa allowlist.

### GitHub/Git

- `GITHUB_AUTH_MODE=app` usa JWT e tokens renováveis da instalação; `static` usa `GH_TOKEN` somente para desenvolvimento local e rollback.
- O entrypoint reescreve remotes GitHub SSH para HTTPS de forma transparente:
  - `git@github.com:` -> `https://github.com/`
  - `ssh://git@github.com/` -> `https://github.com/`
- O credential helper `/app/dist/github/git-credential-app.js` fornece uma credencial atual a cada autenticação HTTPS e não persiste tokens de instalação.
- Remediações usam `/app/github-bin/gh`, wrapper que renova a credencial antes de executar o `gh` real.
- Nome/e-mail Git são configurados por `GIT_AUTHOR_*` e `GIT_COMMITTER_*`; essa identidade de commit é independente da identidade do App bot.
- `GITHUB_DDS_TOKEN` permanece separado e atende somente o GitHub Packages do `hub-driva`.

### Aplicação

- `DIAGNOSIS_CRON_ENABLED` foi adicionado. Qualquer valor diferente de `true` impede o cron de enfileirar diagnósticos.
- Após o fast-forward dos repositórios, o runner sincroniza dependências somente quando
  o lockfile muda ou a instalação está ausente. Fingerprints e caches ficam em `/app/state`.
  São suportados npm, pnpm e Go; `--sync-dependencies-only` permite preparar sem diagnosticar.
- O runner inicializa os submódulos `linkedin-api`, `linkedin-worker` e
  `agentic-extension` do `linkedin-service`, troca cada um para `main` e os sincroniza
  como repositórios independentes. O repositório pai permanece na lista de ignore.
- Instalações de dependências rodam em um sandbox Bubblewrap separado: somente o projeto
  atual, o cache persistente e `/tmp` são graváveis, e `/app/secrets` fica mascarado.
- `GET /health` continua sendo o liveness público simples.
- `GET /health/dependencies` foi adicionado e exige `Authorization: Bearer $DIAGNOSIS_API_KEY`.
- O health detalhado verifica versões/binários, modo de autenticação do GitHub, emissão da credencial, identidade da instalação, acesso aos repositórios, volumes graváveis, quantidade de repositórios e presença das configurações do proxy, GitHub Packages, ClickUp e Google sem expor credenciais.
- `.env.example` foi atualizado com `CODEX_HOME`, `CODEX_MODEL`, `DRIVA_PROXY_API_KEY` e `DIAGNOSIS_CRON_ENABLED`.

### Calibração da manutenção de storage

A entrega deve chegar com `STORAGE_MAINTENANCE_ENABLED=false`. Não configure limites por estimativa e não habilite o cron antes da primeira execução manual.

1. Após o deploy autorizado, acompanhe os eventos `storage_maintenance_*` nos logs do Dokku:

   ```bash
   dokku logs driva-ops-agent -t
   ```

2. Em outro terminal, execute primeiro o inventário sem mutação:

   ```bash
   dokku run driva-ops-agent npm run storage-maintenance -- --dry-run
   ```

3. Revise os bytes de estado autoritativo, cache por ecossistema, repositórios, dependências, worktrees e a lista completa de ações planejadas. Confirme que nenhum caminho em `results/`, `secrets/`, JSON autoritativo de `state/` ou clone inteiro aparece como alvo.
4. Com autorização específica para a limpeza, execute:

   ```bash
   dokku run driva-ops-agent npm run storage-maintenance -- --execute
   ```

5. Registre `dependencyCacheBytesBefore`, `dependencyCacheBytesAfter`, `bytesReclaimed`, duração de cada ação, duração da sincronização e status final. Depois de um reset coordenado, rode um diagnóstico controlado e confirme que a sincronização de dependências e o runner continuam funcionando.
6. Escolha `STORAGE_DEPENDENCY_CACHE_HIGH_MB` acima do tamanho estável observado e `STORAGE_DEPENDENCY_CACHE_TARGET_MB` abaixo do high, mas compatível com o resultado pós-poda. Só então configure os dois limites e habilite `STORAGE_MAINTENANCE_ENABLED=true`.
7. Inspecione a primeira execução automática nos logs. Para rollback operacional, defina `STORAGE_MAINTENANCE_ENABLED=false`; isso desliga novos ticks sem alterar caches ou estado.

O cron usa `STORAGE_MAINTENANCE_CRON=43 3 * * *` por padrão. Antes de medir ou alterar caches e worktrees, o processo adquire o lease exclusivo `state/repo-sync.lock` e confirma que não há leitores ativos em `state/repo-readers`; conflito causa skip seguro, não limpeza concorrente.

## Testes locais concluídos

- `npm run check` passou.
- Build NestJS/TypeScript passou.
- `bash -n docker/entrypoint.sh` passou.
- `git diff --check` passou.
- Build completo da imagem Docker passou.
- Imagens locais existentes: `driva-ops-agent:local` e `driva-ops-agent:dev`.
- Imagem `:dev` construída com UID/GID local e bind mounts graváveis.
- `/health` retornou 200.
- `/health/dependencies` retornou 401 sem token e funcionou com token.
- Autenticação do GitHub e conversão SSH -> HTTPS funcionaram.
- O Codex conseguiu chamar o proxy com `gpt-5.6-sol`.
- Diagnóstico real do ticket `86aju105k` com `remediation=plan` concluiu com sucesso após corrigir DNS do proxy.
- Notificação pendente foi enviada com sucesso ao Google Chat usando `node dist/notify.js` após corrigir o mount da service account.

## Problemas encontrados e soluções

### 1. Git SSH dentro do container

Erro: `Host key verification failed` durante `git fetch`.

Causa: remotes SSH e autenticação disponível somente via `GH_TOKEN`/HTTPS.

Solução permanente: regras `url.https://github.com/.insteadOf` no entrypoint.

### 2. DNS NetBird dentro do Docker

Erro do Codex: `stream disconnected before completion` ao chamar `/v1/responses`.

Causa confirmada: o host resolvia `vpn-driva.netbird.driva.io`, mas o container não. A rota direta até o IP NetBird funcionava.

Solução local usada:

```bash
DRIVA_PROXY_IP="$(getent ahostsv4 vpn-driva.netbird.driva.io | awk 'NR == 1 { print $1 }')"
docker run --add-host "vpn-driva.netbird.driva.io:$DRIVA_PROXY_IP" ...
```

No Dokku será necessário configurar a mesma entrada com opção Docker `--add-host` ou corrigir o DNS NetBird para containers. Não colocar o IP fixo no `config.toml` sem necessidade.

O ClickStack usado pelas skills de logs e client sessions apresentou o mesmo problema de DNS no container. O host resolvia `clickstack.prod.driva.io` para um IP NetBird e o container alcançava esse IP diretamente na porta 443, mas não resolvia o hostname (`ENOTFOUND`). A solução local equivalente é:

```bash
CLICKSTACK_IP="$(getent ahostsv4 clickstack.prod.driva.io | awk 'NR == 1 { print $1 }')"
docker run --add-host "clickstack.prod.driva.io:$CLICKSTACK_IP" ...
```

Após adicionar essa entrada, um novo diagnóstico do ticket `86ajpm997` consultou com sucesso:

- logs/traces do `engagement-service` no ClickStack;
- client session do `hub-driva`, incluindo replay e requests HTTP da janela investigada.

O PostgreSQL do Engagement é um caso diferente: o wrapper usa diretamente `100.90.115.221:5432`, portanto a falha `connect ENETUNREACH` não é DNS. Em testes manuais posteriores, host e container alcançaram a porta e `SELECT 1` funcionou, mas um novo diagnóstico voltou a receber `ENETUNREACH` imediatamente. Tratar como conectividade NetBird intermitente ou específica desse peer/ACL/rota. Na máquina Dokku, validar repetidamente host e container, confirmar que o peer está conectado e revisar políticas NetBird; não adicionar `--add-host` para esse IP.

### 3. Credencial Google montada como diretório

Erro: `/app/secrets/google-credentials.json does not exist, or it is not a file`.

Causa: `-v` recebeu um caminho relativo e o Docker criou um volume nomeado/diretório.

Solução validada: resolver o arquivo com `realpath` e usar bind mount explícito:

```bash
GOOGLE_CREDS_PATH="$(realpath google-aplication-credentials.json)"
--mount "type=bind,src=$GOOGLE_CREDS_PATH,dst=/app/secrets/google-credentials.json,readonly"
-e GOOGLE_APPLICATION_CREDENTIALS=/app/secrets/google-credentials.json
```

No Dokku, montar sempre um caminho absoluto do host para esse arquivo.

### 4. Bubblewrap

O Codex emitiu aviso de que `bubblewrap` não estava no PATH e usou a cópia bundled. A cópia bundled existe, mas o perfil seccomp padrão do Docker bloqueou a criação do user namespace necessário ao sandbox.

Isso foi confirmado no ticket `86ajpm997`: leitura da skill, `sed`, `rg`, código, Git, wrappers de banco/logs/client sessions e visualização local do anexo falharam com:

```text
bwrap: No permissions to create a new namespace
```

O host está corretamente configurado (`kernel.unprivileged_userns_clone=1` e `user.max_user_namespaces` maior que zero). Dentro do container comum, `unshare --user true` falhou; em um container com `--security-opt seccomp=unconfined`, funcionou. Portanto, instalar somente o pacote `bubblewrap` não resolve o bloqueio.

Solução validada para local e Dokku: instalar `bubblewrap` na imagem com bit setuid e iniciar o container com as opções de segurança/capabilities usadas pelo devcontainer seguro oficial do Codex:

```text
--security-opt seccomp=unconfined
--security-opt apparmor=unconfined
--cap-add SYS_ADMIN
--cap-add SYS_CHROOT
--cap-add SETUID
--cap-add SETGID
--cap-add SYS_PTRACE
--cap-add NET_ADMIN
--cap-add NET_RAW
```

O Dockerfile instala o pacote `bubblewrap` e executa `chmod u+s /usr/bin/bwrap`. A cópia bundled do Codex não era setuid e falhou mesmo com capabilities adicionais. A combinação completa acima foi validada com `system_bwrap_ok`/`official_caps_bwrap_ok`.

Isso não equivale a `--privileged`, mas remove os filtros seccomp e AppArmor padrão desse container e adiciona capabilities relevantes. O `bwrap` do Codex continua responsável pelo sandbox interno do diagnóstico. Depois do deploy inicial, pode-se substituir os modos `unconfined` por perfis customizados mínimos.

Validação básica obrigatória dentro do container:

```bash
sh -c 'unshare --user true && echo namespace_ok'
```

Esperado: `namespace_ok`. O pacote `bubblewrap` já está instalado na imagem e disponível em `/usr/bin/bwrap` com bit setuid.

Validação efetiva do sandbox:

```bash
bwrap --ro-bind / / --proc /proc --dev /dev true && echo bwrap_ok
```

Esperado: `bwrap_ok`. Somente `unshare --user true` não é suficiente: no ticket `86ajpm997`, esse teste passou após liberar seccomp, mas o diagnóstico ainda falhou em `bwrap: Failed to make / slave: Permission denied` ao tentar configurar mount propagation.

O ticket `86ajpm997` também revelou um problema de qualidade: a execução foi marcada como `success` porque a resposta estruturada estava válida, apesar de todas as fontes técnicas terem ficado indisponíveis. Como melhoria posterior, adicionar um gate para não considerar operacionalmente bem-sucedido um diagnóstico que não acessou skill/código e nenhuma fonte operacional independente.

## Credenciais necessárias (não registrar valores)

- `DRIVA_PROXY_API_KEY`
- `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID` e `GITHUB_APP_ORGANIZATION`
- Arquivo PEM do GitHub App montado somente leitura em `GITHUB_APP_PRIVATE_KEY_FILE`
- `GH_TOKEN` somente durante compatibilidade/rollback em `GITHUB_AUTH_MODE=static`
- `CLICKUP_API_TOKEN`
- `DIAGNOSIS_API_KEY`
- Credenciais read-only `SALES_POSTGRESQL_*` usadas pela skill do Engagement
- Credenciais `CLICKHOUSE_*` usadas pelas skills de logs e client sessions
- `GITHUB_DDS_TOKEN`, token dedicado somente leitura para instalar o pacote privado
  `@driva-tecnologia/driva-design-system` usado pelo `hub-driva`
- `GOOGLE_APPLICATION_CREDENTIALS=/app/secrets/google-credentials.json`
- Arquivo JSON da service account montado somente leitura
- `GOOGLE_CLOUD_PROJECT_NUMBER` ou `GOOGLE_CHAT_AUDIENCE`
- `GOOGLE_CHAT_VECTOR_SPACES_JSON`
- `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL`

## Cutover para GitHub App

### 1. Confirmar o App no GitHub

O App deve pertencer à organização `Driva-tecnologia` e estar instalado com **Only select repositories**. Inclua todos os repositórios configurados no agente e os repositórios privados usados como submódulos, inclusive os submódulos do LinkedIn.

Permissões de repositório:

- Metadata: read-only;
- Contents: read and write;
- Pull requests: read and write;
- Issues: read and write;
- Actions: read-only;
- Checks: read-only;
- Workflows, Administration, Deployments e Environments: no access;
- branch protection e rulesets: sem bypass.

### 2. Montar o PEM somente leitura

Não materialize o PEM com `dokku config:set`, não o copie para a imagem e não o grave em `.env`, `state/` ou `results/`. No host Dokku, prepare um arquivo protegido e monte-o como read-only:

```bash
sudo install -d -m 0700 /var/lib/dokku/data/storage/driva-ops-agent/secrets
# 10001:10001 são APP_UID:APP_GID padrão da imagem; ajuste se o build usar overrides.
sudo install -o 10001 -g 10001 -m 0400 <github-app-private-key.pem> \
  /var/lib/dokku/data/storage/driva-ops-agent/secrets/github-app-private-key.pem

dokku storage:mount automacoes-driva \
  /var/lib/dokku/data/storage/driva-ops-agent/secrets/github-app-private-key.pem:/app/secrets/github-app-private-key.pem:ro
```

Confirme o mount antes do cutover:

```bash
dokku storage:report automacoes-driva
dokku run automacoes-driva sh -lc \
  'test -r /app/secrets/github-app-private-key.pem && test ! -w /app/secrets/github-app-private-key.pem'
```

### 3. Configurar e reiniciar

Use valores operacionais reais somente no host. `GITHUB_APP_INSTALLATION_ID` é opcional; quando ausente, o agente descobre a instalação pela organização.

```bash
dokku config:set --no-restart automacoes-driva \
  GITHUB_AUTH_MODE=app \
  GITHUB_APP_ID=<app-id> \
  GITHUB_APP_CLIENT_ID=<client-id> \
  GITHUB_APP_ORGANIZATION=Driva-tecnologia \
  GITHUB_APP_HEALTH_REPOSITORY=mail-service \
  GITHUB_APP_PRIVATE_KEY_FILE=/app/secrets/github-app-private-key.pem \
  GITHUB_APP_TOKEN_REFRESH_SKEW_SECONDS=300 \
  GIT_AUTHOR_NAME=<service-name> \
  GIT_AUTHOR_EMAIL=<service-email> \
  GIT_COMMITTER_NAME=<service-name> \
  GIT_COMMITTER_EMAIL=<service-email>

dokku ps:restart automacoes-driva
```

Não configure nem persista token de instalação. Mantenha `GITHUB_DDS_TOKEN` inalterado: ele continua sendo necessário para o pacote privado do `hub-driva`.

### 4. Validar antes de remover o rollback

1. Inspecione o health detalhado. O bloco `githubAuth` deve mostrar `mode: app`, `installationId`, `expiresAt` e `repositoryAccess: true`; nenhum token, JWT, Authorization header ou conteúdo do PEM pode aparecer:

   ```bash
   curl -fsS https://automacoes.driva.io/driva-ops-agent/health/dependencies \
     -H "Authorization: Bearer $DIAGNOSIS_API_KEY" | jq .checks
   ```

2. Sincronize todos os repositórios e dependências. Esse passo também valida acesso aos submódulos privados:

   ```bash
   dokku run automacoes-driva node dist/runner.js --sync-dependencies-only
   ```

3. Confirme que os repositórios esperados e os submódulos do LinkedIn foram incluídos em **Only select repositories**. Se o sync indicar `Repository not found`, corrija a seleção do App antes de prosseguir.
4. Execute uma remediação automática controlada para um ticket elegível, sem notificação:

   ```bash
   dokku run automacoes-driva node dist/runner.js \
     --ticket-id=<clickup-ticket-id> --force --no-notify --remediation=auto
   ```

5. No GitHub, confirme que push, PR, comentários e eventuais issues aparecem como o App bot; confirme separadamente que o commit usa a identidade de serviço configurada em `GIT_AUTHOR_*`/`GIT_COMMITTER_*`.
6. Verifique leitura de checks e Actions, reaproveitamento de PR e ausência de merge ou deploy.
7. Somente depois de uma remediação App-mode bem-sucedida, remova o token estático de rollback:

   ```bash
   dokku config:unset --no-restart automacoes-driva GH_TOKEN
   dokku ps:restart automacoes-driva
   ```

### 5. Rollback estático

Se o App falhar durante o cutover, restaure temporariamente o modo estático com o token previamente retido e reinicie. Esse `GH_TOKEN` é um token estático de rollback, não um token de instalação:

```bash
dokku config:set --no-restart automacoes-driva \
  GITHUB_AUTH_MODE=static \
  GH_TOKEN=<rollback-static-token>
dokku ps:restart automacoes-driva
```

Repita o health, o sync-only e uma operação controlada. O rollback não exige migração de estado. Não altere nem remova `GITHUB_DDS_TOKEN`.

## Deploy Dokku realizado

- Host com Dokku 0.35.18 e Docker 28.0.4.
- App `driva-ops-agent`, builder Dockerfile, `web=1` e porta `31987:3000`.
- Aplicação publicada em `https://automacoes.driva.io/driva-ops-agent` pelo Nginx externo.
- Callback público: `POST /driva-ops-agent/google-chat/events`; as demais rotas do
  subpath permitem somente `10.0.2.0/24` e `100.90.0.0/16`.
- Mounts persistentes confirmados em deploy e one-off/run:
  - `/var/lib/dokku/data/storage/driva-ops-agent/repos:/app/repos`
  - `/var/lib/dokku/data/storage/driva-ops-agent/state:/app/state`
  - `/var/lib/dokku/data/storage/driva-ops-agent/results:/app/results`
  - JSON Google protegido em `/app/secrets/google-credentials.json:ro`
- Entradas Docker atuais:
  - `vpn-driva.netbird.driva.io:100.90.152.121`
  - `clickstack.prod.driva.io:100.90.186.242`
- Opções seccomp/AppArmor e todas as capabilities da seção Bubblewrap configuradas para
  `deploy` e `run`.
- Validado no container e em one-off: `namespace_ok`, `bwrap_ok`, Codex/proxy, GitHub,
  ClickStack e rota até `100.90.115.221:5432`.
- `/health` está `ok`; `/health/dependencies` chegou a `ok` após provisionar os sete
  repositórios. A credencial Google e as variáveis obrigatórias foram reconhecidas.
- O cron continua intencionalmente desligado: `DIAGNOSIS_CRON_ENABLED=false`.
- O plugin externo `connect-n8n` está quebrado/sem `plugin.toml` e gera warning/panic em
  alguns comandos globais do Dokku, mas não impediu os deploys desta app.

## Diagnósticos de validação até agora

O diagnóstico do ticket `86ajmv812` no Dokku isolou duas falsas indisponibilidades
causadas pelo perfil `driva-debug-read-network`, não pela infraestrutura subjacente:

- `/app/codex/skills/driva-debug/references/` existia no container, mas `/app/codex`
  não estava liberado no filesystem do sandbox;
- o container acessava `100.90.115.221:5432` e o wrapper retornava `SELECT 1`, mas o
  cliente PostgreSQL abria TCP bruto dentro do perfil com allowlist/proxy.

`docker/codex/config.toml` agora libera `/app/codex` para leitura. Após confirmar que a
allowlist de domínios não atende clientes TCP PostgreSQL, o perfil read-only passou a
usar rede completa, sem a tabela `network.domains`. O subprocesso continua sem
`GH_TOKEN`, com filesystem somente leitura e credenciais operacionais read-only.

Uma validação posterior mostrou que remover somente `network.domains` não bastava:
`features.network_proxy = true` continuava isolando TCP bruto e também cancelava as
consultas HTTP ao ClickHouse quando não havia allowlist. A feature foi removida; o
perfil mantém `network.enabled = true` para rede direta dentro do sandbox read-only.

O ticket `86aju105k` confirmou que o Go 1.25.5 estava completo no container, mas a
execução sandboxada via `go run` recebia apenas o binário reduzido porque
`/usr/local/go` não estava legível e `GOROOT` não era preservado pelo runner. A imagem
agora declara `GOROOT=/usr/local/go`, o perfil libera essa árvore como read-only e a
allowlist do subprocesso preserva `GOROOT`. Ainda é necessário validar o wrapper
`whatsapp-cloud-db-read` dentro de um diagnóstico depois do redeploy.

O `go run` também exige escrita temporária mesmo para um wrapper read-only. O perfil
agora permite escrita somente em `/tmp` e `/app/state/dependency-cache`; o subprocesso
usa `GOCACHE=/app/state/dependency-cache/go-build` e
`GOMODCACHE=/app/state/dependency-cache/go-mod`. Repositórios e fontes permanecem
read-only durante o diagnóstico.

O mesmo ticket mostrou que permitir `100.90.115.221` como domínio não tornou o cliente
`pg` compatível com o proxy do sandbox: a conexão TCP bruta falhou imediatamente com
`ENETUNREACH`, embora o wrapper funcionasse fora do Codex. Foi adotado conscientemente
o perfil read-only com rede sem allowlist. Não tratar essa falha como instabilidade do
banco ou do NetBird.

Para evitar colisão entre os nomes genéricos `POSTGRES_*` usados pelas skills, o runner
materializa arquivos `.env` com modo `0600`, após o sync dos repositórios/dependências e
antes do diagnóstico. As fontes são variáveis prefixadas do Dokku:

- `LINKEDIN_DATABASE_URL` -> `linkedin-api/.env` como `DATABASE_URL`;
- `MAIL_POSTGRES_*` -> `mail-service/.env` como `POSTGRES_*`;
- `WHATSAPP_CLOUD_POSTGRES_*` -> `whatsapp-cloud-service/.env` como `POSTGRES_*`.

Um grupo parcialmente configurado interrompe o runner com os nomes ausentes. Quando um
grupo inteiro está ausente, o runner preserva qualquer arquivo existente e registra
somente que a fonte não foi configurada. Valores nunca são escritos em logs.

As tentativas do ticket `86ajpm997` anteriores ao bootstrap completo devem ser
desconsideradas como validação operacional. Elas revelaram, em sequência:

- ausência inicial da skill orquestradora `driva-debug` na imagem;
- referências `service-map.md`/`playbooks.md` resolvidas pelo diretório errado;
- variáveis read-only de PostgreSQL/ClickStack fora da allowlist do Codex;
- `pg` e ferramentas de teste ausentes nos repositórios;
- Node/npm incompatíveis com o `engine-strict` do `hub-driva`;
- falta do token dedicado `GITHUB_DDS_TOKEN` para o GitHub Packages;
- submódulos do `linkedin-service` não inicializados.

Todos esses pontos receberam correções commitadas. O sync de dependências finalmente
avançou pelos projetos, mas a validação seguinte parou porque `scheduler-service/yarn.lock`
apareceu modificado no volume. Ainda é necessário confirmar se foi um artefato isolado ou
se algum lifecycle/install volta a alterá-lo.

## Estado atual do worktree

Todas as alterações de aplicação/deploy estão commitadas até `01ef910`. O worktree raiz
mantém apenas artefatos que não devem entrar em commit:

- `state/diagnosis.lock/owner.json` removido pelo funcionamento normal do lock;
- repositórios operacionais não rastreados sob `repos/`.

Commits recentes relevantes:

- `01ef910` — inicialização/sync dos submódulos do LinkedIn;
- `c4ab4c5` — token dedicado do pacote privado do Hub;
- `d5c824a` — Node 24.14.1/npm 11.11.0;
- `aad1637` — sync de dependências por fingerprint com sandbox;
- `a50c494` — resolução das referências da skill;
- `f846df4` — allowlist das credenciais read-only;
- `eef5c7c` — skill `driva-debug` empacotada na imagem.

## Próximos passos

1. Na máquina Dokku, conferir `git status --short` em `/app/repos/scheduler-service`.
   Se continuar sendo **somente** `yarn.lock`, restaurar exclusivamente esse arquivo:

   ```bash
   dokku enter driva-ops-agent web bash -lc '
     cd /app/repos/scheduler-service
     git restore --source=HEAD --worktree -- yarn.lock
     git status --short
   '
   ```

2. Executar novamente o bootstrap:

   ```bash
   dokku run driva-ops-agent node dist/runner.js --sync-dependencies-only
   ```

   Se `yarn.lock` voltar a mudar, não restaurar de novo: capturar
   `git diff -- yarn.lock` e identificar qual install/lifecycle o altera.

3. Confirmar que `/app/state/dependency-fingerprints.json` lista todos os projetos e
   executar o bootstrap uma segunda vez; o esperado é `Dependencies ready` sem installs.
4. Validar diretamente as fontes antes de novo ticket:
   - referências da `driva-debug` presentes;
   - `engagement-db-read` com `SELECT 1`;
   - `engagement-logs-read` com `SHOW DATABASES`;
   - `hub-client-sessions-read` com `SHOW DATABASES`.
5. Repetir `86ajpm997` com `force=true`, `notify=false`, `remediation=plan`. Confirmar
   acesso real a skill, referências, código/Git, DB, logs e client session. Se o banco
   falhar com `ENETUNREACH`, testar imediatamente host/container até
   `100.90.115.221:5432` e revisar peer/ACL/rota NetBird.
6. Executar diagnóstico com `notify=true` e validar Google Chat.
7. Executar ticket controlado com `remediation=auto`; validar testes, branch, commit,
   push e PR, sem merge.
8. Reiniciar/redeployar e confirmar persistência de repos, fingerprints/cache, state e results.
9. Habilitar por último `DIAGNOSIS_CRON_ENABLED=true` e observar ao menos duas execuções.
10. Hardening posterior: trocar modos `unconfined` por perfis mínimos, reduzir escopo do
    token GitHub/bot e adicionar gate contra falso sucesso sem fontes técnicas.

## Comando inicial para a próxima sessão

Pedir para ler este arquivo e continuar em **Próximos passos**, começando pela verificação
do `scheduler-service/yarn.lock`. O usuário executa todos os comandos na máquina Dokku; o
assistente apenas prepara/revisa os comandos e resultados.
