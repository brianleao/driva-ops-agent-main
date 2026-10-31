import { expect, it } from 'vitest';
import { clickUpConfig } from '../config/clickup-config.js';
import { googleChatConfig } from '../config/google-chat-config.js';
import { runtimeConfig } from '../config/runtime-config.js';
import { GoogleChatMessengerService } from './google-chat-messenger.service.js';
import { GoogleChatThreadsService } from './google-chat-threads.service.js';
import { GoogleChatActionsService } from './google-chat-actions.service.js';
import { GoogleChatNotificationsService } from './google-chat-notifications.service.js';

class MemoryState {
  files = {};

  async read(name) {
    return this.files[name] || {};
  }

  async update(name, mutate) {
    const value = this.files[name] || {};
    mutate(value);
    this.files[name] = value;
    return value;
  }
}

async function serviceWithTicketThread(env = {}) {
  const state = new MemoryState();
  const config = googleChatConfig({
    GOOGLE_CHAT_ACTION_URL: 'https://ops.example.com/google-chat/events',
    ...env,
  });
  const messenger = new GoogleChatMessengerService(config);
  const threads = new GoogleChatThreadsService(state);
  const service = new GoogleChatNotificationsService(
    state,
    messenger,
    threads,
    new GoogleChatActionsService(
      state,
      {},
      {},
      messenger,
      config,
      clickUpConfig({}),
    ),
    config,
    runtimeConfig({}, process.cwd()),
  );
  await threads.bindTicketThread({
    space: 'spaces/AAA',
    threadName: 'spaces/AAA/threads/123',
    taskId: '42',
    ticketName: 'TICKET-42 — Falha no relatório',
    ticketUrl: 'https://app.clickup.com/t/42',
  });
  return { service, threads };
}

it('broadcasts a reoriented technical action to every space already bound to the ticket', async () => {
  // Arrange
  const { service, threads } = await serviceWithTicketThread();
  await threads.bindTicketThread({
    space: 'spaces/BBB',
    threadName: 'spaces/BBB/threads/456',
    taskId: '42',
    ticketName: 'TICKET-42 — Falha no relatório',
    ticketUrl: null,
  });
  const ticket = {
    id: '42',
    name: 'Falha no relatório',
    url: null,
    vectors: ['Sequências'],
  };
  const run = {
    ticket_id: '42',
    updated_at: '2026-08-31',
    finished_at: '2026-08-31',
    status: 'success',
    classification: 'bug',
    google_chat_space: 'spaces/AAA',
    remediation_iteration: 1,
    remediation_broadcast_to_bound_threads: true,
  };

  // Act
  const spaces = await service.resolveNotificationSpaces(
    ticket,
    run,
    'remediation',
  );

  // Assert
  expect(spaces.sort()).toStrictEqual(['spaces/AAA', 'spaces/BBB']);
});

it('routes incidents to the spaces mapped for the diagnosed vector', async () => {
  // Arrange
  const { service } = await serviceWithTicketThread({
    GOOGLE_CHAT_VECTOR_SPACES_JSON: JSON.stringify({
      Conexões: ['spaces/CONEXOES'],
    }),
  });
  const ticket = {
    id: 'grafana-abc',
    name: 'Falha no envio de e-mails',
    url: null,
    task_type: 'incident',
    vectors: ['Conexões'],
  };
  const run = {
    ticket_id: 'grafana-abc',
    updated_at: '2026-09-22',
    finished_at: '2026-09-22',
    status: 'diagnosed',
    classification: 'bug',
    diagnosed_vector: 'Conexões',
  };

  // Act
  const spaces = await service.resolveNotificationSpaces(
    ticket,
    run,
    'diagnosis',
  );

  // Assert
  expect(spaces).toStrictEqual(['spaces/CONEXOES']);
});
