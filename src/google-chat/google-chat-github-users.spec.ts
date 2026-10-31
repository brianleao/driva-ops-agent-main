import { expect, it } from 'vitest';
import {
  assignmentSummary,
  githubLoginForEmail,
} from './google-chat-github-users.js';

it('resolves the GitHub login ignoring e-mail case and surrounding spaces', () => {
  const map = JSON.stringify({ ' Rodrigo@Driva.io ': 'rodrigo-miranda18' });
  expect(githubLoginForEmail('rodrigo@driva.io ', map)).toBe(
    'rodrigo-miranda18',
  );
  expect(githubLoginForEmail('outra@driva.io', map)).toBe(null);
});

it('ignores a map that is not a JSON object', () => {
  expect(githubLoginForEmail('a@driva.io', 'a@driva.io:login')).toBe(null);
  expect(githubLoginForEmail('a@driva.io', '["a@driva.io"]')).toBe(null);
});

it('summarizes assigned and failed issues', () => {
  expect(assignmentSummary(null, [])).toBe(
    'Nenhum usuário do GitHub mapeado para esse e-mail; as issues seguem sem assignee.',
  );
  expect(assignmentSummary('dev', [])).toBe(
    'Nenhuma issue do GitHub vinculada a este incidente.',
  );
  expect(
    assignmentSummary('dev', [
      { repository: 'mail-service', url: 'u1', status: 'assigned' },
      { url: 'u2', status: 'failed' },
    ]),
  ).toBe(
    'Issues atribuídas a @dev: mail-service. Falha ao atribuir em u2; atribua manualmente.',
  );
});
