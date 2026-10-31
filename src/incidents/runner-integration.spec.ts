import { expect, it, onTestFinished } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  ensureIncidentIssues,
  incidentIssueIdentity,
  incidentRecurrenceCoverage,
  linkedIncidentPullRequests,
  openIncidentPullRequests,
  processIncident,
} from '../runner.js';

async function addRepository(directory, name, slug) {
  const repo = path.join(directory, name);
  await mkdir(repo);
  execFileSync('git', ['init', '--quiet', repo]);
  execFileSync('git', [
    '-C',
    repo,
    'remote',
    'add',
    'origin',
    `git@github.com:example/${slug}.git`,
  ]);
  return { name, path: repo };
}

function runnerDependencies(github = async () => '') {
  return {
    github,
    ensureGitHubAccess: async () => undefined,
  };
}

async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), 'incident-test-'));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const { path: repo } = await addRepository(
    directory,
    'mail-service',
    'mail-service',
  );
  return {
    directory,
    config: { reposDir: directory, repositorySyncTimeoutMs: 10000 },
    ticket: {
      id: 'grafana-fixture',
      name: 'Failure',
      remediation_mode: 'auto',
      incident: { fingerprint: 'abc' },
      repository_candidates: {
        repositories: [{ name: 'mail-service', path: repo }],
        service_map: '',
      },
    },
    output: {
      vector: 'Conexões',
      technicalDiagnosis: 'Verified evidence',
      engineeringAction: { repositories: ['mail-service'], confidence: 'high' },
    },
  };
}

it('issue creation resolves a real Git origin and persists the result for retries', async () => {
  // Arrange
  const { directory, config, ticket, output } = await setup();
  const calls = [];
  const github = async (args) => {
    calls.push(args);
    return args[1] === 'list'
      ? '[]'
      : 'https://github.com/example/mail-service/issues/1';
  };
  // Act
  const [issue] = await ensureIncidentIssues(
    config,
    directory,
    ticket,
    output,
    github,
  );
  const retry = await ensureIncidentIssues(
    config,
    directory,
    ticket,
    output,
    github,
  );
  // Assert
  expect(retry).toStrictEqual([issue]);
  expect(calls.filter((args) => args[1] === 'create').length).toBe(1);
  expect(issue.repository).toBe('example/mail-service');
  const create = calls.find((args) => args[1] === 'create');
  expect(
    await readFile(create[create.indexOf('--body-file') + 1], 'utf8'),
  ).toMatch(/incident-fingerprint:abc/);
  expect(issue.reused).toBe(false);
});

it('opens one issue per affected repository, each scoped to its own role', async () => {
  // Arrange
  const { directory, config, ticket, output } = await setup();
  const engagement = await addRepository(
    directory,
    'engagement-service',
    'engagement-service',
  );
  const calls = [];
  let created = 0;
  const github = async (args) => {
    calls.push(args);
    return args[1] === 'list'
      ? '[]'
      : `https://github.com/example/issues/${++created}`;
  };
  const action = {
    confidence: 'high',
    repositories: [
      {
        name: 'mail-service',
        role: 'consumidor',
        scope: 'Rejeita o parâmetro com 5xx',
      },
      {
        name: 'engagement-service',
        role: 'origem',
        scope: 'Gera o link com sufixo inválido',
      },
    ],
  };
  const candidates = {
    repositories: [...ticket.repository_candidates.repositories, engagement],
    service_map: '',
  };
  // Act
  const issues = await ensureIncidentIssues(
    config,
    directory,
    { ...ticket, repository_candidates: candidates },
    { ...output, engineeringAction: action },
    github,
  );
  // Assert
  expect(issues.map((issue) => issue.repository)).toStrictEqual([
    'example/mail-service',
    'example/engagement-service',
  ]);
  const bodies = await Promise.all(
    calls
      .filter((args) => args[1] === 'create')
      .map((args) => readFile(args[args.indexOf('--body-file') + 1], 'utf8')),
  );
  expect(bodies[0]).toMatch(/Rejeita o parâmetro com 5xx/);
  expect(bodies[0]).toMatch(
    /Outros repositórios afetados[\s\S]*engagement-service/,
  );
  expect(bodies[1]).toMatch(/Gera o link com sufixo inválido/);
  expect(calls.filter((args) => args[1] === 'comment').length).toBe(2);
  expect(
    JSON.parse(
      await readFile(path.join(directory, 'github-issues.json'), 'utf8'),
    ).map((issue) => issue.name),
  ).toStrictEqual(['mail-service', 'engagement-service']);
});

it('recovers an issue created before a local persistence failure', async () => {
  // Arrange
  const { directory, config, ticket, output } = await setup();
  const github = async (args) =>
    args[1] === 'list'
      ? JSON.stringify([
          {
            url: 'https://github.com/example/mail-service/issues/2',
            body: '<!-- incident-fingerprint:abc -->',
          },
        ])
      : '';
  // Act
  const [issue] = await ensureIncidentIssues(
    config,
    directory,
    ticket,
    output,
    github,
  );
  // Assert
  expect(issue.url).toMatch(/issues\/2$/);
});

it('a new firing of the same fingerprint reuses the open issue instead of opening another one', async () => {
  // Arrange
  const { directory, config, ticket, output } = await setup();
  const calls = [];
  const github = async (args) => {
    calls.push(args);
    return args[1] === 'list'
      ? JSON.stringify([
          {
            url: 'https://github.com/example/mail-service/issues/7',
            body: '<!-- incident-fingerprint:abc -->',
          },
        ])
      : '';
  };
  // Act
  const [issue] = await ensureIncidentIssues(
    config,
    directory,
    { ...ticket, id: 'grafana-second-firing' },
    output,
    github,
  );
  // Assert
  expect(issue.reused).toBe(true);
  expect(issue.url).toMatch(/issues\/7$/);
  expect(calls.filter((args) => args[1] === 'create').length).toBe(0);
  const comment = calls.find((args) => args[1] === 'comment');
  expect(comment[comment.indexOf('--body') + 1]).toMatch(
    /grafana-second-firing/,
  );
  expect(calls.find((args) => args[1] === 'list').includes('open')).toBe(true);
});

it('an incident without a fingerprint keeps deduplicating by incident id', () => {
  // Act / Assert
  expect(
    incidentIssueIdentity({ id: 'grafana-fixture', incident: {} }),
  ).toStrictEqual({
    key: 'grafana-fixture',
    marker: '<!-- incident:grafana-fixture -->',
  });
  expect(
    incidentIssueIdentity({
      id: 'grafana-fixture',
      incident: { fingerprint: 'abc' },
    }),
  ).toStrictEqual({ key: 'abc', marker: '<!-- incident-fingerprint:abc -->' });
});

it('recurrence discovery collects PRs linked to reused incident issues only', async () => {
  // Arrange
  const { config } = await setup();
  const issues = [
    {
      name: 'mail-service',
      repository: 'example/mail-service',
      url: 'https://github.com/example/mail-service/issues/7',
      reused: true,
    },
    {
      name: 'engagement-service',
      repository: 'example/engagement-service',
      url: 'https://github.com/example/engagement-service/issues/8',
      reused: false,
    },
  ];
  const viewed = [];
  const github = async (args) => {
    viewed.push(args[2]);
    return JSON.stringify({
      comments: [
        { body: 'Comentário manual do time' },
        {
          body: 'PRs de remediação vinculados a este incidente:\nhttps://github.com/example/mail-service/pull/12\nhttps://github.com/example/mail-service/pull/12',
        },
        {
          body: 'PRs de remediação vinculados a este incidente:\nhttps://github.com/example/mail-service/pull/15',
        },
      ],
    });
  };
  // Act
  const linked = await linkedIncidentPullRequests(config, github, issues);
  // Assert
  expect(linked).toStrictEqual([
    {
      url: 'https://github.com/example/mail-service/pull/12',
      repository: 'mail-service',
    },
    {
      url: 'https://github.com/example/mail-service/pull/15',
      repository: 'mail-service',
    },
  ]);
  expect(viewed).toStrictEqual([
    'https://github.com/example/mail-service/issues/7',
  ]);
});

it('only open PRs count as recurrence coverage', async () => {
  // Arrange
  const { config } = await setup();
  const github = async (args) =>
    args[2].endsWith('/pull/12') ? 'OPEN' : 'MERGED';
  // Act
  const open = await openIncidentPullRequests(config, github, [
    {
      url: 'https://github.com/example/mail-service/pull/12',
      repository: 'mail-service',
    },
    {
      url: 'https://github.com/example/mail-service/pull/9',
      repository: 'mail-service',
    },
  ]);
  // Assert
  expect(open).toStrictEqual([
    {
      url: 'https://github.com/example/mail-service/pull/12',
      repository: 'mail-service',
    },
  ]);
});

it('incident recurrence coverage requires an open PR for every selected repository', () => {
  // Arrange
  const selected = [
    { name: 'mail-service' },
    { name: 'linkedin-service/linkedin-api' },
  ];
  const mailPull = {
    url: 'https://github.com/example/mail-service/pull/1',
    repository: 'mail-service',
  };
  const linkedinPull = {
    url: 'https://github.com/example/linkedin-api/pull/2',
    repository: 'example/linkedin-api',
  };
  // Act / Assert
  expect(incidentRecurrenceCoverage(selected, [mailPull])).toStrictEqual({
    covered: ['mail-service'],
    uncovered: ['linkedin-service/linkedin-api'],
    fullyCovered: false,
  });
  expect(
    incidentRecurrenceCoverage(selected, [mailPull, linkedinPull]).fullyCovered,
  ).toBe(true);
  expect(incidentRecurrenceCoverage([], [mailPull]).fullyCovered).toBe(false);
});

it('a repeated firing with every repository covered reuses the open PR instead of remediating again', async () => {
  // Arrange
  const { directory, config } = await setup();
  const id = 'grafana-recurrence-' + path.basename(directory);
  const results = path.resolve('results', id);
  onTestFinished(() => rm(results, { recursive: true, force: true }));
  const fixture = path.resolve(
    'src/incidents/fixtures/codex-response-correction-required.js',
  );
  await chmod(fixture, 0o755);
  Object.assign(config, {
    codexBin: fixture,
    codexTimeoutMs: 10000,
    diagnosisVectors: [{ name: 'Conexões', description: 'Channels' }],
  });
  const issueUrl = 'https://github.com/example/mail-service/issues/7';
  const prUrl = 'https://github.com/example/mail-service/pull/12';
  const commands = [];
  const github = async (args) => {
    commands.push(args.join(' '));
    if (args[0] === 'issue' && args[1] === 'list')
      return JSON.stringify([
        { url: issueUrl, body: `<!-- incident:${id} -->` },
      ]);
    if (args[0] === 'issue' && args[1] === 'view')
      return JSON.stringify({
        comments: [
          { body: `PRs de remediação vinculados a este incidente:\n${prUrl}` },
        ],
      });
    if (args[0] === 'pr' && args[1] === 'view') return 'OPEN';
    return '';
  };
  // Act
  await processIncident(
    config,
    {
      incidentId: id,
      title: 'Failure',
      status: 'firing',
      receivedAt: '2026-09-15T12:00:00Z',
      annotations: {},
      labels: {},
    },
    '{{TICKET_JSON}}',
    { remediation: 'auto', notify: false },
    runnerDependencies(github),
  );
  // Assert
  const remediation = JSON.parse(
    await readFile(path.join(results, 'remediation.json')),
  );
  expect(remediation.recurrence_reused).toBe(true);
  expect(remediation.status).toBe('PR_OPENED');
  expect(remediation.pull_requests).toStrictEqual([
    { repository: 'mail-service', url: prUrl, depends_on: [] },
  ]);
  expect(
    JSON.parse(await readFile(path.join(results, 'run.json')))
      .remediation_status,
  ).toBe('PR_OPENED');
  expect(remediation.reason).toMatch(new RegExp(prUrl));
  expect(
    await readFile(path.join(directory, 'captured-prompt.txt'), 'utf8'),
  ).toMatch(/repository_candidates/);
  expect(
    await readFile(path.join(directory, 'captured-prompt.txt'), 'utf8'),
  ).not.toMatch(/subagente de remediação/);
  expect(
    commands.some((command) => command.includes('O alerta voltou a disparar')),
  ).toBe(true);
  expect(
    commands.some(
      (command) =>
        command.startsWith('issue comment') && command.includes(prUrl),
    ),
  ).toBe(false);
});

it('a repeated firing without an open PR remediates from scratch, without recurrence constraints', async () => {
  // Arrange
  const { directory, config } = await setup();
  const id = 'grafana-merged-' + path.basename(directory);
  const results = path.resolve('results', id);
  onTestFinished(() => rm(results, { recursive: true, force: true }));
  const fixture = path.resolve(
    'src/incidents/fixtures/codex-response-correction-required.js',
  );
  await chmod(fixture, 0o755);
  Object.assign(config, {
    codexBin: fixture,
    codexTimeoutMs: 10000,
    diagnosisVectors: [{ name: 'Conexões', description: 'Channels' }],
  });
  const issueUrl = 'https://github.com/example/mail-service/issues/7';
  const prUrl = 'https://github.com/example/mail-service/pull/12';
  const github = async (args) => {
    if (args[0] === 'issue' && args[1] === 'list')
      return JSON.stringify([
        { url: issueUrl, body: `<!-- incident:${id} -->` },
      ]);
    if (args[0] === 'issue' && args[1] === 'view')
      return JSON.stringify({
        comments: [
          { body: `PRs de remediação vinculados a este incidente:\n${prUrl}` },
        ],
      });
    if (args[0] === 'pr' && args[1] === 'view') return 'MERGED';
    return '';
  };
  // Act
  await processIncident(
    config,
    {
      incidentId: id,
      title: 'Failure',
      status: 'firing',
      receivedAt: '2026-09-15T12:00:00Z',
      annotations: {},
      labels: {},
    },
    '{{TICKET_JSON}}',
    { remediation: 'auto', notify: false },
    runnerDependencies(github),
  );
  // Assert
  const prompt = await readFile(
    path.join(directory, 'captured-prompt.txt'),
    'utf8',
  );
  expect(prompt).toMatch(/subagente de remediação/);
  expect(prompt).toMatch(
    /PRs de remediação já abertos para este problema, quando houver:\s*null/,
  );
  const remediation = JSON.parse(
    await readFile(path.join(results, 'remediation.json')),
  );
  expect(remediation.recurrence_reused).toBe(undefined);
});

it('GitHub failure remains visible and is not persisted as success', async () => {
  // Arrange
  const { directory, config, ticket, output } = await setup();
  // Act / Assert
  await expect(
    ensureIncidentIssues(config, directory, ticket, output, async () => {
      throw new Error('GitHub unavailable');
    }),
  ).rejects.toThrow(/unavailable/);
  await expect(
    readFile(path.join(directory, 'github-issues.json')),
  ).rejects.toMatchObject({ code: 'ENOENT' });
});

it('runner writes incident diagnosis and vector without requiring ClickUp or opening an issue in none mode', async () => {
  // Arrange
  const { directory, config } = await setup();
  const id = 'grafana-test-' + path.basename(directory);
  const results = path.resolve('results', id);
  onTestFinished(() => rm(results, { recursive: true, force: true }));
  const fixture = path.resolve('src/incidents/fixtures/codex-response.js');
  await chmod(fixture, 0o755);
  Object.assign(config, {
    codexBin: fixture,
    codexTimeoutMs: 10000,
    diagnosisVectors: [{ name: 'Conexões', description: 'Channels' }],
  });
  // Act
  await processIncident(
    config,
    {
      incidentId: id,
      title: 'Failure',
      status: 'firing',
      receivedAt: '2026-09-15T12:00:00Z',
      annotations: {},
      labels: {},
    },
    '{{TICKET_JSON}}',
    { remediation: 'none', notify: false },
    runnerDependencies(),
  );
  // Assert
  const ticket = JSON.parse(await readFile(path.join(results, 'ticket.json')));
  expect(ticket.vectors).toStrictEqual(['Conexões']);
  expect(ticket.task_type).toBe('incident');
  expect(
    await readFile(path.join(directory, 'captured-prompt.txt'), 'utf8'),
  ).toMatch(/repository_candidates/);
  expect(
    JSON.parse(await readFile(path.join(results, 'run.json'))).status,
  ).toBe('success');
  await expect(
    readFile(path.join(results, 'github-issues.json')),
  ).rejects.toMatchObject({ code: 'ENOENT' });
});

it('an unresolved repository blocks the remediation without rewriting the decision of the diagnosis', async () => {
  // Arrange
  const { directory, config } = await setup();
  const id = 'grafana-gate-' + path.basename(directory);
  const results = path.resolve('results', id);
  onTestFinished(() => rm(results, { recursive: true, force: true }));
  const fixture = path.resolve(
    'src/incidents/fixtures/codex-response-unresolved-repository.js',
  );
  await chmod(fixture, 0o755);
  Object.assign(config, {
    codexBin: fixture,
    codexTimeoutMs: 10000,
    diagnosisVectors: [{ name: 'Conexões', description: 'Channels' }],
  });
  // Act
  await processIncident(
    config,
    {
      incidentId: id,
      title: 'Failure',
      status: 'firing',
      receivedAt: '2026-09-15T12:00:00Z',
      annotations: {},
      labels: {},
    },
    '{{TICKET_JSON}}',
    { remediation: 'plan', notify: false },
    runnerDependencies(),
  );
  // Assert
  const action = JSON.parse(
    await readFile(path.join(results, 'engineering-action.json')),
  );
  expect(action.decision).toBe('IMPROVEMENT_RECOMMENDED');
  expect(action.confidence).toBe('high');
  expect(action.repository_gate).toBe('UNRESOLVED');
  const remediation = JSON.parse(
    await readFile(path.join(results, 'remediation.json')),
  );
  expect(remediation.status).toBe('PLAN_ONLY');
  expect(remediation.reason).toMatch(/Nenhum repositório foi confirmado/);
  await expect(
    readFile(path.join(results, 'github-issues.json')),
  ).rejects.toMatchObject({ code: 'ENOENT' });
});

it('runner announces an incident diagnosis over IPC and waits for the acknowledgement', async () => {
  // Arrange
  const { directory, config } = await setup();
  const id = 'grafana-test-' + path.basename(directory);
  const results = path.resolve('results', id);
  onTestFinished(() => rm(results, { recursive: true, force: true }));
  const fixture = path.resolve('src/incidents/fixtures/codex-response.js');
  await chmod(fixture, 0o755);
  Object.assign(config, {
    codexBin: fixture,
    codexTimeoutMs: 10000,
    diagnosisVectors: [{ name: 'Conexões', description: 'Channels' }],
  });
  const sent = [];
  const originalSend = process.send;
  onTestFinished(() => {
    process.send = originalSend;
  });
  process.send = (message) => {
    sent.push(message);
    setImmediate(() =>
      process.emit('message', { incidentId: message.incidentId }),
    );
    return true;
  };
  // Act
  await processIncident(
    config,
    {
      incidentId: id,
      title: 'Failure',
      status: 'firing',
      receivedAt: '2026-09-15T12:00:00Z',
      annotations: {},
      labels: {},
    },
    '{{TICKET_JSON}}',
    { remediation: 'none', notify: true },
    runnerDependencies(),
  );
  // Assert
  expect(sent).toStrictEqual([
    { type: 'incident-diagnosis-ready', incidentId: id },
  ]);
});
