import { describe, expect, it } from 'vitest';
import {
  extractPullRequestLinks,
  isOrganizationPullRequest,
  sanitizePullRequestView,
} from './pull-request-links.js';

describe('extractPullRequestLinks', () => {
  it('extracts and deduplicates pull request links from ClickUp texts', () => {
    expect(
      extractPullRequestLinks([
        'PR: github.com/Driva-tecnologia/hub-driva/pull/812',
        'https://github.com/Driva-tecnologia/hub-driva/pull/812#issuecomment-123',
        '(https://github.com/Driva-tecnologia/engagement-service/pull/45).',
        'github.com/Driva-tecnologia/hub-driva/pulls',
      ]),
    ).toEqual([
      {
        owner: 'Driva-tecnologia',
        repo: 'hub-driva',
        number: 812,
        url: 'https://github.com/Driva-tecnologia/hub-driva/pull/812',
      },
      {
        owner: 'Driva-tecnologia',
        repo: 'engagement-service',
        number: 45,
        url: 'https://github.com/Driva-tecnologia/engagement-service/pull/45',
      },
    ]);
  });
});

describe('isOrganizationPullRequest', () => {
  it('matches the organization case-insensitively', () => {
    const ref = { owner: 'driva-TECNOLOGIA', repo: 'r', number: 1, url: 'u' };
    expect(isOrganizationPullRequest(ref, 'Driva-tecnologia')).toBe(true);
    expect(
      isOrganizationPullRequest({ ...ref, owner: 'other' }, 'Driva-tecnologia'),
    ).toBe(false);
  });
});

describe('sanitizePullRequestView', () => {
  it('redacts secrets from the title and body', () => {
    const token = `ghp_${'a'.repeat(36)}`;
    expect(
      sanitizePullRequestView({
        title: `fix ${token}`,
        body: `password=hunter2\nAuthorization: Bearer ${token}`,
        state: 'MERGED',
        files: [{ path: 'a.ts' }],
      }),
    ).toEqual({
      title: 'fix [REDACTED_GITHUB_TOKEN]',
      body: 'password=[REDACTED]\nAuthorization: [REDACTED]',
      state: 'MERGED',
      files: [{ path: 'a.ts' }],
    });
  });
});
