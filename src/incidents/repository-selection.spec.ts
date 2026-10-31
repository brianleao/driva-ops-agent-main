import { expect, it } from 'vitest';
import {
  incidentActionRepositories,
  selectIncidentRepositories,
  githubSlug,
} from './repository-selection.js';

it('selects the exact repository from the object included in diagnosis context', () => {
  // Arrange
  const candidate = { name: 'mail-service', path: '/repos/mail-service' };
  const context = { repositories: [candidate], service_map: 'map' };
  // Act
  const selected = selectIncidentRepositories(
    { repositories: ['mail-service'], confidence: 'high' },
    context,
  );
  // Assert
  expect(selected).toStrictEqual([{ ...candidate, role: null, scope: null }]);
});

it('selects every affected repository keeping the role and scope of each one', () => {
  // Arrange
  const context = {
    repositories: [
      { name: 'mail-service', path: '/repos/mail-service' },
      { name: 'engagement-service', path: '/repos/engagement-service' },
    ],
  };
  const action = {
    confidence: 'high',
    repositories: [
      {
        name: 'engagement-service',
        role: 'origem',
        scope: 'Gera o link com sufixo inválido',
      },
      {
        name: 'mail-service',
        role: 'consumidor',
        scope: 'Rejeita o parâmetro com 5xx',
      },
    ],
  };
  // Act
  const selected = selectIncidentRepositories(action, context);
  // Assert
  expect(
    selected.map((entry) => [entry.name, entry.path, entry.role, entry.scope]),
  ).toStrictEqual([
    [
      'engagement-service',
      '/repos/engagement-service',
      'origem',
      'Gera o link com sufixo inválido',
    ],
    [
      'mail-service',
      '/repos/mail-service',
      'consumidor',
      'Rejeita o parâmetro com 5xx',
    ],
  ]);
});

it('normalizes legacy string repositories and drops duplicates before selection', () => {
  // Act / Assert
  expect(
    incidentActionRepositories({
      repositories: [
        'mail-service',
        'mail-service',
        { name: 'mail-service', role: 'origem' },
        {},
        7,
      ],
    }),
  ).toStrictEqual([{ name: 'mail-service' }]);
});

for (const names of [['mail'], ['../mail-service']]) {
  it(`rejects ambiguous or unavailable repositories: ${names}`, () => {
    // Arrange
    const context = { repositories: [{ name: 'mail-service' }] };
    // Act
    const selected = selectIncidentRepositories(
      { repositories: names, confidence: 'high' },
      context,
    );
    // Assert
    expect(selected).toStrictEqual([]);
  });
}

it('keeps the repositories that exist when the model also names one that is unavailable', () => {
  // Arrange
  const context = { repositories: [{ name: 'mail-service' }] };
  // Act
  const selected = selectIncidentRepositories(
    { repositories: ['mail-service', 'invented'], confidence: 'high' },
    context,
  );
  // Assert
  expect(selected).toStrictEqual([
    { name: 'mail-service', role: null, scope: null },
  ]);
});

it('insufficient confidence cannot select an automatic issue target', () => {
  // Arrange
  const context = { repositories: [{ name: 'mail-service' }] };
  // Act
  const selected = selectIncidentRepositories(
    { repositories: ['mail-service'], confidence: 'medium' },
    context,
  );
  // Assert
  expect(selected).toStrictEqual([]);
});

it('derives the GitHub slug from supported remotes without accepting lookalike hosts', () => {
  // Arrange
  const remotes = [
    'git@github.com:org/repo.git',
    'https://github.com/org/repo.git',
    'ssh://git@github.com/org/repo',
  ];
  // Act / Assert
  for (const remote of remotes) expect(githubSlug(remote)).toBe('org/repo');
  expect(githubSlug('https://evilgithub.com/org/repo')).toBe(null);
});
