import { describe, expect, it } from 'vitest';
import {
  incidentPullRequestLinkComment,
  linkedIncidentPullRequestUrls,
} from './incident-pull-request-links.js';

const PR_A = 'https://github.com/Driva-tecnologia/hub-driva/pull/10';
const PR_B = 'https://github.com/Driva-tecnologia/mail-service/pull/7';

describe('linkedIncidentPullRequestUrls', () => {
  it('reads PR URLs only from the agent link comments, without duplicates', () => {
    expect(
      linkedIncidentPullRequestUrls([
        incidentPullRequestLinkComment([PR_A, PR_B]),
        `Veja também ${PR_B}`,
        incidentPullRequestLinkComment([PR_A]),
      ]),
    ).toEqual([PR_A, PR_B]);
  });

  it('returns nothing when no link comment exists', () => {
    expect(linkedIncidentPullRequestUrls([`Relacionado: ${PR_A}`])).toEqual([]);
  });
});
