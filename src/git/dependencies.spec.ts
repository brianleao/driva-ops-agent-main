import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeChildProcess } from '../common/fake-child-process.js';

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

const {
  dependencyFingerprint,
  dependencyInstallationPaths,
  dependencyInstallCommand,
  dependencyProjects,
  synchronizeDependencies,
} = await import('./dependencies.js');

type SpawnCall = [
  string,
  string[],
  { cwd: string; env: Record<string, string>; stdio: string },
];

describe('dependency sync adapter', () => {
  let root: string;
  let reposDir: string;
  let cacheDir: string;
  let stateFile: string;

  beforeEach(async () => {
    spawnMock.mockReset();
    root = await mkdtemp(path.join(os.tmpdir(), 'deps-spec-'));
    reposDir = path.join(root, 'repos');
    cacheDir = path.join(root, 'cache');
    stateFile = path.join(root, 'state', 'dependency-sync.json');
    await mkdir(path.dirname(stateFile), { recursive: true });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(root, { recursive: true, force: true });
  });

  async function createProjectFiles() {
    for (const project of dependencyProjects(reposDir)) {
      await mkdir(project.directory, { recursive: true });
      for (const file of project.files)
        await writeFile(path.join(project.directory, file), `${file}-v1`);
    }
  }

  const config = () => ({
    enabled: true,
    reposDir,
    timeoutMs: 1000,
    repositorySyncTimeoutMs: 1000,
    cacheDir,
    stateFile,
  });

  it('lista os projetos na ordem e com o gerenciador de cada um', () => {
    expect(
      dependencyProjects('/r').map((p) => [p.name, p.manager, p.directory]),
    ).toEqual([
      ['engagement-service', 'npm', '/r/engagement-service'],
      ['export-service', 'go', '/r/export-service'],
      ['hub-driva', 'npm', '/r/hub-driva'],
      ['hunter-backend', 'npm', '/r/hunter-backend'],
      ['integrations', 'go', '/r/integrations'],
      [
        'linkedin-service/linkedin-api',
        'pnpm',
        '/r/linkedin-service/linkedin-api',
      ],
      [
        'linkedin-service/linkedin-worker',
        'pnpm',
        '/r/linkedin-service/linkedin-worker',
      ],
      [
        'linkedin-service/agentic-extension',
        'pnpm',
        '/r/linkedin-service/agentic-extension',
      ],
      ['mail-service', 'npm', '/r/mail-service'],
      ['management-service', 'npm', '/r/management-service'],
      ['scheduler-service', 'npm', '/r/scheduler-service'],
      ['search-go-api', 'go', '/r/search-go-api'],
      ['whatsapp-cloud-service', 'go', '/r/whatsapp-cloud-service'],
      ['whatsapp-service', 'go', '/r/whatsapp-service'],
    ]);
  });

  it('deriva instalações gerenciadas da mesma lista de projetos', () => {
    const paths = dependencyInstallationPaths('/r', '/c');
    expect(paths).toContain('/r/engagement-service/node_modules');
    expect(paths).toContain('/r/linkedin-service/linkedin-api/node_modules');
    expect(paths).toContain('/c/markers/export-service');
    expect(paths).toHaveLength(14);
  });

  it('monta o comando de instalação por gerenciador', () => {
    const projects = dependencyProjects('/r');
    const npm = projects.find((p) => p.manager === 'npm');
    const pnpm = projects.find((p) => p.manager === 'pnpm');
    const go = projects.find((p) => p.manager === 'go');
    if (!npm || !pnpm || !go) throw new Error('missing project');
    expect(dependencyInstallCommand('/c', npm, { CI: 'true' })).toEqual({
      command: 'npm',
      args: ['ci', '--include=dev'],
      environment: { CI: 'true', npm_config_cache: '/c/npm' },
    });
    expect(dependencyInstallCommand('/c', pnpm, {}).args).toEqual([
      'install',
      '--frozen-lockfile',
      '--prod=false',
      '--store-dir=/c/pnpm',
    ]);
    expect(dependencyInstallCommand('/c', go, {})).toEqual({
      command: 'go',
      args: ['mod', 'download'],
      environment: {
        GOPATH: '/c/go-path',
        GOCACHE: '/c/go-build',
        GOMODCACHE: '/c/go-mod',
      },
    });
  });

  it('fingerprint muda com o lockfile e acusa arquivo ausente', async () => {
    await createProjectFiles();
    const [project] = dependencyProjects(reposDir);
    if (!project) throw new Error('missing project');
    const before = await dependencyFingerprint(project);
    await writeFile(path.join(project.directory, 'package-lock.json'), 'v2');
    expect(await dependencyFingerprint(project)).not.toBe(before);
    await rm(path.join(project.directory, 'package.json'));
    await expect(dependencyFingerprint(project)).rejects.toThrow(
      'Dependency file is missing for engagement-service: package.json',
    );
  });

  it('desativado só registra no log', async () => {
    const log = vi.fn();
    await synchronizeDependencies({ ...config(), enabled: false }, log);
    expect(log).toHaveBeenCalledWith('Dependency synchronization is disabled');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('instala em bwrap, grava estado e pula projetos já prontos', async () => {
    vi.stubEnv('GITHUB_DDS_TOKEN', 'dds');
    await createProjectFiles();
    spawnMock.mockImplementation(() => {
      const child = new FakeChildProcess();
      setImmediate(() => child.finish({}, 0));
      return child;
    });
    const log = vi.fn();

    await synchronizeDependencies(config(), log);

    const bwrapCalls = spawnMock.mock.calls.filter(
      ([command]) => command === 'bwrap',
    );
    expect(bwrapCalls).toHaveLength(14);
    // Each npm project checks for a tracked yarn.lock after installing.
    const gitCalls = spawnMock.mock.calls.filter(
      ([command]) => command === 'git',
    );
    expect(gitCalls).toHaveLength(6);
    expect(gitCalls[0]?.[1]).toEqual(['ls-files', '--', 'yarn.lock']);
    const [command, args, options] = spawnMock.mock.calls[0] as SpawnCall;
    const directory = path.join(reposDir, 'engagement-service');
    expect(command).toBe('bwrap');
    expect(args).toEqual([
      '--die-with-parent',
      '--new-session',
      '--unshare-pid',
      '--ro-bind',
      '/',
      '/',
      '--proc',
      '/proc',
      '--dev',
      '/dev',
      '--tmpfs',
      '/tmp',
      '--tmpfs',
      '/app/secrets',
      '--bind',
      directory,
      directory,
      '--bind',
      cacheDir,
      cacheDir,
      '--chdir',
      directory,
      '--',
      'npm',
      'ci',
      '--include=dev',
    ]);
    expect(options).toMatchObject({ cwd: directory, stdio: 'inherit' });
    expect(options.env).toMatchObject({ CI: 'true', HUSKY: '0' });
    expect(options.env.GITHUB_DDS_TOKEN).toBeUndefined();
    const hub = bwrapCalls[2] as SpawnCall;
    expect(hub[2].env.GITHUB_DDS_TOKEN).toBe('dds');
    expect(log).toHaveBeenCalledWith(
      'Installing dependencies for engagement-service: installation missing',
    );

    const state = JSON.parse(await readFile(stateFile, 'utf8')) as {
      version: number;
      projects: Record<string, { manager: string }>;
    };
    expect(state.version).toBe(2);
    expect(Object.keys(state.projects)).toHaveLength(14);

    for (const project of dependencyProjects(reposDir))
      if (project.manager !== 'go')
        await mkdir(path.join(project.directory, 'node_modules'));
    spawnMock.mockClear();
    log.mockClear();

    await synchronizeDependencies(config(), log);

    expect(spawnMock).not.toHaveBeenCalled();
    expect(log.mock.calls[0]?.[0]).toMatch(
      /^Dependencies ready: engagement-service \([0-9a-f]{12}\)$/,
    );
    vi.unstubAllEnvs();
  });

  it('restaura o yarn.lock versionado que o npm reescreveu', async () => {
    vi.stubEnv('GITHUB_DDS_TOKEN', 'dds');
    await createProjectFiles();
    spawnMock.mockImplementation((command: string, args: string[]) => {
      const child = new FakeChildProcess();
      const stdout =
        command === 'git' && args[0] === 'ls-files' ? 'yarn.lock\n' : '';
      setImmediate(() => child.finish({ stdout }, 0));
      return child;
    });

    await synchronizeDependencies(config(), vi.fn());

    const engagement = path.join(reposDir, 'engagement-service');
    const gitCalls = spawnMock.mock.calls.filter(
      ([command]) => command === 'git',
    ) as SpawnCall[];
    expect(
      gitCalls
        .filter(([, , options]) => options.cwd === engagement)
        .map(([, args]) => args),
    ).toEqual([
      ['ls-files', '--', 'yarn.lock'],
      ['checkout', '--', 'yarn.lock'],
    ]);
    expect(gitCalls).toHaveLength(12);
    vi.unstubAllEnvs();
  });

  it('falha com o exit code e mata a instalação no timeout', async () => {
    vi.stubEnv('GITHUB_DDS_TOKEN', 'dds');
    await createProjectFiles();
    const failing = new FakeChildProcess();
    spawnMock.mockReturnValueOnce(failing);
    const failed = synchronizeDependencies(config(), vi.fn());
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1));
    failing.finish({}, 1);
    await expect(failed).rejects.toThrow(
      'Dependency installation failed for engagement-service: npm exited with 1',
    );

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const hanging = new FakeChildProcess();
    spawnMock.mockReturnValueOnce(hanging);
    const timedOut = synchronizeDependencies(config(), vi.fn());
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(2));
    vi.advanceTimersByTime(1000);
    expect(hanging.killed).toEqual(['SIGTERM']);
    hanging.finish({}, null, 'SIGTERM');
    await expect(timedOut).rejects.toThrow('npm exited with SIGTERM');
    vi.unstubAllEnvs();
  });
});
