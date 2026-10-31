# Driva Debug Runner — contexto para retomada

Data da conversa: 21/07/2026  
Status: planejamento concluído; implementação ainda não iniciada.

## Objetivo

Criar um runner pequeno e independente que consulte tickets do ClickUp usando um filtro específico, leia os metadados dos tickets e execute a skill `$driva-debug` por meio do Codex CLI.

A prioridade é ter um MVP funcionando em aproximadamente uma hora. A solução deve ser simples, direta e fácil de deixar rodando 24/7 em um servidor Linux.

## Contexto importante

O diretório usado durante a conversa foi:

```text
/home/rodrigo-miranda/Documents/projects/driva-ops-agent/repos
```

Esse diretório está sendo usado somente porque contém os repositórios necessários para os diagnósticos e a skill orquestradora:

```text
.codex/skills/driva-debug/SKILL.md
```

Não usar, alterar ou integrar o projeto NestJS que existe ou existia na pasta pai. Ele foi considerado por engano em um momento da conversa e não faz parte desta implementação.

Também não usar Claude Agent SDK nem ChatGPT Desktop. A execução deve usar o Codex CLI.

## Solução escolhida

Criar um novo diretório standalone, em um caminho ainda a ser informado pelo usuário.

Estrutura mínima sugerida:

```text
driva-debug-runner/
├── runner.mjs
├── prompt.md
├── package.json
├── .env.example
├── .gitignore
├── state/
├── results/
└── systemd/
    ├── driva-debug-runner.service
    └── driva-debug-runner.timer
```

Usar Node.js nativo, preferencialmente sem dependências externas. O `fetch` nativo do Node deve ser usado para acessar a API do ClickUp.

Fluxo:

```text
systemd timer ou execução manual
    → runner Node.js
    → API do ClickUp
    → filtro e limite
    → deduplicação
    → codex exec
    → $driva-debug
    → diagnóstico salvo localmente
```

## Comportamento do runner

Em cada execução:

1. Carregar as configurações sem imprimir secrets.
2. Consultar uma List do ClickUp pela API oficial.
3. Filtrar por status, tags e campos personalizados configurados.
4. Ordenar os tickets de forma determinística, preferencialmente pelos mais antigos.
5. Processar no máximo a quantidade configurada; padrão sugerido: três tickets.
6. Obter título, descrição, URL, data de atualização, comentários relevantes e demais metadados disponíveis.
7. Ignorar versões de tickets já analisadas.
8. Executar os tickets sequencialmente para evitar diagnósticos simultâneos pesados.
9. Invocar explicitamente `$driva-debug` usando o Codex CLI.
10. Salvar o ticket normalizado, o diagnóstico e os metadados da execução.
11. Marcar o ticket como processado somente quando o Codex terminar com sucesso.
12. Processar novamente um ticket quando seu `updated_at` mudar.

## Deduplicação

Usar inicialmente um arquivo JSON simples:

```text
state/processed.json
```

A identidade de uma análise será:

```text
ticket_id + updated_at
```

Com isso:

- ticket novo: processar;
- ticket sem novas atualizações: ignorar;
- ticket atualizado: processar novamente;
- execução com erro: não registrar como concluída.

## Execução do Codex CLI

Comando-base esperado:

```bash
codex exec --ephemeral --sandbox read-only -
```

O processo deve executar com o diretório de trabalho configurado como:

```text
/home/rodrigo-miranda/Documents/projects/driva-ops-agent/repos
```

Isso garante que o Codex consiga acessar a skill e os repositórios usados pelo diagnóstico.

Prompt-base:

```markdown
Use $driva-debug para investigar o ticket abaixo.

Trabalhe exclusivamente em modo somente leitura.
Não altere banco, filas, serviços, tickets, mensagens, sequências ou canais.

Dados normalizados do ticket:
<dados do ticket>
```

## Resultados

Salvar cada execução em:

```text
results/<ticket-id>/
├── ticket.json
├── diagnosis.md
└── run.json
```

O `run.json` deve conter pelo menos:

- ticket ID;
- `updated_at` analisado;
- início e término;
- status;
- exit code;
- caminho do diagnóstico;
- mensagem de erro sanitizada, quando houver.

## Configuração

Criar um `.env.example` semelhante a:

```env
CLICKUP_API_TOKEN=
CLICKUP_LIST_ID=
CLICKUP_STATUSES=
CLICKUP_TAGS=
CLICKUP_MAX_TICKETS=3
CLICKUP_POLL_INTERVAL_MINUTES=15
DRIVA_REPOS_DIR=/home/rodrigo-miranda/Documents/projects/driva-ops-agent/repos
```

O token real não deve ser enviado no chat, versionado ou exibido nos logs. O usuário colocará o token diretamente no `.env` local.

Se o filtro depender de campos personalizados, criar variáveis adicionais depois que seus IDs e valores forem informados.

## Segurança e escopo do MVP

- Acesso somente leitura ao ClickUp.
- Não comentar nos tickets.
- Não alterar status, tags ou campos.
- Não escrever em bancos da Driva.
- Não executar retries, requeues, deploys ou restarts.
- Não reproduzir ações reais de email, LinkedIn ou WhatsApp.
- Não registrar tokens, headers ou dados sensíveis desnecessários.
- O runner será não assistido; permissões necessárias devem estar configuradas previamente.

## Verificação simples

O usuário não quer testes automatizados nem um processo burocrático. Fazer somente uma validação manual curta:

1. Executar `node runner.mjs --dry-run` para listar o que seria processado sem chamar o Codex.
2. Executar `node runner.mjs --max-tickets=1` para processar um único ticket.
3. Confirmar que o filtro selecionou o ticket correto.
4. Confirmar que `$driva-debug` foi executada.
5. Confirmar que o diagnóstico foi salvo.
6. Confirmar que o token não apareceu nos logs.
7. Executar novamente e confirmar que a mesma versão foi ignorada.
8. Confirmar que uma execução com erro não marca o ticket como concluído.

## Agendamento 24/7

Depois do smoke check, criar um `systemd service` e um `systemd timer`.

O timer pode executar a cada 15 minutos. O serviço deve impedir execuções sobrepostas e usar um usuário sem privilégios administrativos.

Comandos esperados após instalar as unidades:

```bash
sudo systemctl enable --now driva-debug-runner.timer
systemctl list-timers driva-debug-runner.timer
journalctl -u driva-debug-runner.service -f
```

## Estimativa da implementação

- estrutura e configuração: 5 minutos;
- cliente e filtro ClickUp: 10 minutos;
- deduplicação: 5 minutos;
- integração com `codex exec`: 15 minutos;
- persistência dos resultados: 5 minutos;
- smoke check: 10 minutos;
- systemd: 10 minutos.

## Fora do escopo inicial

- projeto NestJS existente;
- Claude Agent SDK;
- ChatGPT Desktop;
- comentários ou alterações no ClickUp;
- banco de dados;
- painel web;
- Docker;
- Slack;
- processamento paralelo;
- retries sofisticados;
- testes automatizados.

## Informações que ainda faltam

Antes de implementar, perguntar ao usuário:

```text
Diretório absoluto onde o runner deve ser criado:
Link ou ID da List do ClickUp:
Status aceitos:
Tags exigidas:
Campo personalizado e valor, se houver:
Frequência desejada:
Máximo de tickets por execução:
```

Também verificar no host:

```bash
node --version
codex --version
```

Confirmar que o Codex CLI está autenticado e consegue executar `$driva-debug` dentro do diretório `repos`.

## Próximo passo

Obter as informações pendentes do ClickUp e o diretório de destino. Em seguida, criar o runner standalone, configurar o `.env`, fazer um dry-run e processar no máximo um ticket antes de ativar o timer.

## Prompt curto para retomar em outra sessão

```markdown
Quero retomar a implementação do Driva Debug Runner.

Leia o arquivo DRIVA_DEBUG_RUNNER_HANDOFF.md.
Use exclusivamente Codex CLI e não toque no projeto NestJS da pasta pai.
Quero um MVP standalone, pequeno, somente leitura, sem testes automatizados e funcionando rapidamente.
```
