# Exemplos de comunicação

Comunicados aprovados pelo PM, no formato atual. Seguir o tom, o nível de detalhe de
cada tamanho e a estrutura. A linha do ticket de melhoria é acrescentada pelo código e
não aparece aqui. No JSON, o título vai em `title`, o texto de "O que mudou" em
`summary`, o de "Na prática" em `in_practice` e os links em `links`, sem os rótulos.

## Exemplo 1 (tamanho M)

**📁 Exportar conversas para Excel (.xlsx)**
* **O que mudou:** Revisar o histórico de conversas de uma sequência dependia de pedir a planilha ao time técnico. Agora a tela de Conversas permite baixar em Excel (.xlsx) as conversas que estão filtradas na tela.
* **Na prática:** O arquivo sai com as conversas que batem com os filtros aplicados no momento (sequência, vendedor, canal, período, não lidas, com resposta do lead, lead engajado...) e vêm todas as conversas do filtro, não só as que aparecem na tela.
  - Aba "Leads": uma linha por lead e vendedor, com total de mensagens, quantas foram do lead e quantas do vendedor, data da primeira e da última mensagem, e um resumo da conversa (as duas primeiras e as duas últimas mensagens).
  - Aba "Vendedores": consolidado por vendedor, com quantidade de leads, total de mensagens, mensagens recebidas dos leads e mensagens enviadas.
  - Só entram na contagem as mensagens trocadas entre lead e vendedor. Eventos do sistema ficam de fora.
  - A exportação segue a mesma visibilidade da tela de Conversas: cada usuário só exporta o que já pode ver, e leads internos continuam restritos ao dono.

## Exemplo 2 (tamanho P)

**🤝 Respostas ao convite do LinkedIn podem não engajar o lead**
* **O que mudou:** A caixinha "Enviar convite" ganhou a opção avançada "Não engajar se o lead responder".
* **Na prática:** Com a chave ligada, uma resposta ao convite (até um "obrigado por conectar") não marca o lead como "Engajado" e ele segue para a próxima caixinha da sequência.

## Exemplo 3 (tamanho G)

**⚙️ Criar sequências com configurações padrão (Configuração Global)**
* **O que mudou:** Toda nova sequência começava com configurações genéricas, e cada usuário precisava ajustar as mesmas opções manualmente. Agora dá para definir uma configuração padrão, que é reaproveitada automaticamente em novas sequências e traz novas preferências para o envio de mensagens e para as notificações do Copilot.
* **Na prática:** A configuração reúne todo o conjunto de opções que já existia nas automações, seguindo a mesma lógica delas.
  - Configuração padrão para novas sequências: cada usuário define suas preferências e elas viram a base sempre que ele cria uma nova sequência.
  - Aplicação para todos os usuários: admins da workspace podem ativar "Habilitar configuração padrão para todos os usuários", e a configuração passa a valer como padrão para toda a equipe.
  - Notificações do Copilot para admins: com "Notificar admins da workspace", as notificações que antes iam só para o dono da sequência também chegam aos admins.
  - Envio para leads já engajados: dá para definir se a sequência pode mandar mensagem para leads já engajados em outra sequência. Por padrão, eles não recebem uma nova mensagem; ligando a opção, passam a receber.
  - O checkbox "Enviar se conversa ativa", que ficava nas caixinhas de ação e causava confusão, não existe mais em novas sequências. A regra agora fica centralizada nas configurações gerais da sequência.
