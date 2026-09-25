import { describe, expect, test, vi } from 'vitest';
import {
  azureDevOpsProvider,
  githubIssuesProvider,
  type Octokit,
  type PullRequestContext,
} from '../src/providers';

const pullRequest: PullRequestContext = {
  number: 99,
  description: '',
  owner: 'octo-org',
  repo: 'project',
};

function createOctokit(pages: unknown[][]): Octokit {
  const request = vi.fn(async () => ({ data: [] }));
  const graphql = vi.fn(
    async (_query: string, parameters: { after: string | null }) => {
      const page = parameters.after
        ? Number(parameters.after.replace('cursor-', '')) + 1
        : 1;
      const nodes = pages[page - 1] ?? [];
      return {
        repository: {
          pullRequest: {
            closingIssuesReferences: {
              nodes,
              pageInfo: {
                hasNextPage: page < pages.length,
                endCursor: page < pages.length ? `cursor-${page}` : null,
              },
            },
          },
        },
      };
    },
  );

  return { request, graphql } as unknown as Octokit;
}

describe('Azure DevOps provider', () => {
  test('finds an AB work item reference', () => {
    expect(
      azureDevOpsProvider.findReference('Implements AB#123', pullRequest),
    ).toMatchObject({
      id: '123',
      display: 'AB#123',
      owner: 'octo-org',
      repo: 'project',
    });
  });

  test('finds an AB work item reference after a closing keyword', () => {
    expect(
      azureDevOpsProvider.findReference('Closes AB#2469', pullRequest),
    ).toMatchObject({
      id: '2469',
      display: 'AB#2469',
      owner: 'octo-org',
      repo: 'project',
    });
  });

  test('finds an AB work item reference inside a Markdown link', () => {
    expect(
      azureDevOpsProvider.findReference(
        'Closes [AB#2659](https://dev.azure.com/example/_workitems/edit/2659)',
        pullRequest,
      ),
    ).toMatchObject({
      id: '2659',
      display: 'AB#2659',
    });
  });

  test('accepts a lowercase AB reference', () => {
    expect(
      azureDevOpsProvider.findReference('Closes ab#2469', pullRequest),
    ).toMatchObject({
      id: '2469',
      display: 'AB#2469',
    });
  });

  test('requires Azure Boards rendered link evidence', async () => {
    const reference = azureDevOpsProvider.findReference(
      'Implements AB#123',
      pullRequest,
    );
    expect(reference).toBeDefined();
    if (!reference) throw new Error('Expected an Azure DevOps reference');
    await expect(
      azureDevOpsProvider.isLinked(createOctokit([]), pullRequest, reference),
    ).resolves.toBe(false);
  });

  test('uses consistent Azure DevOps work item messages', () => {
    const reference = azureDevOpsProvider.findReference(
      'Implements AB#123',
      pullRequest,
    );

    expect(azureDevOpsProvider.getMissingMessage()).toBe(
      'Description does not contain an Azure DevOps work item reference, such as AB#123',
    );
    expect(reference).toBeDefined();
    if (!reference) throw new Error('Expected an Azure DevOps reference');
    expect(azureDevOpsProvider.getUnlinkedMessage(reference)).toBe(
      'Description contains AB#123, but Azure DevOps has not linked that work item',
    );
    expect(azureDevOpsProvider.getSuccessMessage(reference)).toBe(
      'Work item link check complete. Azure DevOps work item AB#123 is linked to this pull request.',
    );
  });
});

describe('GitHub Issues provider', () => {
  test('normalizes a same-repository closing reference', () => {
    expect(
      githubIssuesProvider.findReference('Fixes #123', pullRequest),
    ).toMatchObject({
      id: '123',
      display: 'octo-org/project#123',
      owner: 'octo-org',
      repo: 'project',
    });
  });

  test('uses consistent GitHub issue messages', () => {
    const reference = githubIssuesProvider.findReference(
      'Fixes #123',
      pullRequest,
    );

    expect(githubIssuesProvider.getMissingMessage()).toBe(
      'Description does not contain a GitHub issue reference, such as Fixes #123',
    );
    expect(reference).toBeDefined();
    if (!reference) throw new Error('Expected a GitHub issue reference');
    expect(githubIssuesProvider.getUnlinkedMessage(reference)).toBe(
      'Description contains octo-org/project#123, but GitHub has not linked that issue',
    );
    expect(githubIssuesProvider.getSuccessMessage(reference)).toBe(
      'Work item link check complete. GitHub issue octo-org/project#123 is linked to this pull request.',
    );
  });

  test('recognizes closing keywords without regard to case', () => {
    expect(
      githubIssuesProvider.findReference('RESOLVED #123', pullRequest),
    ).toBeDefined();
  });

  test('recognizes a cross-repository closing reference', () => {
    expect(
      githubIssuesProvider.findReference(
        'Closes other-org/other-project#456',
        pullRequest,
      ),
    ).toMatchObject({
      id: '456',
      owner: 'other-org',
      repo: 'other-project',
      display: 'other-org/other-project#456',
    });
  });

  test('rejects a casual issue reference and zero issue number', () => {
    expect(
      githubIssuesProvider.findReference('Related to #123', pullRequest),
    ).toBeUndefined();
    expect(
      githubIssuesProvider.findReference('Fixes #0', pullRequest),
    ).toBeUndefined();
  });

  test('matches a linked issue from the pull request repository', async () => {
    const reference = githubIssuesProvider.findReference(
      'Fixes #123',
      pullRequest,
    );
    const octokit = createOctokit([
      [
        {
          number: 123,
          repository: { nameWithOwner: 'octo-org/project' },
        },
      ],
    ]);

    if (!reference) throw new Error('Expected a GitHub issue reference');
    await expect(
      githubIssuesProvider.isLinked(octokit, pullRequest, reference),
    ).resolves.toBe(true);
  });

  test('requires both the issue number and target repository to match', async () => {
    const reference = githubIssuesProvider.findReference(
      'Fixes other-org/other-project#123',
      pullRequest,
    );
    const octokit = createOctokit([
      [
        {
          number: 123,
          repository: { nameWithOwner: 'octo-org/project' },
        },
      ],
    ]);

    if (!reference) throw new Error('Expected a GitHub issue reference');
    await expect(
      githubIssuesProvider.isLinked(octokit, pullRequest, reference),
    ).resolves.toBe(false);
  });

  test('checks subsequent linked-issue pages', async () => {
    const reference = githubIssuesProvider.findReference(
      'Fixes #123',
      pullRequest,
    );
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      number: index + 1000,
      repository: { nameWithOwner: 'octo-org/project' },
    }));
    const octokit = createOctokit([
      firstPage,
      [
        {
          number: 123,
          repository: { nameWithOwner: 'octo-org/project' },
        },
      ],
    ]);

    if (!reference) throw new Error('Expected a GitHub issue reference');
    await expect(
      githubIssuesProvider.isLinked(octokit, pullRequest, reference),
    ).resolves.toBe(true);
  });

  test('returns false when an issue is absent from all linked-issue pages', async () => {
    const reference = githubIssuesProvider.findReference(
      'Fixes #999',
      pullRequest,
    );
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      number: index + 1000,
      repository: { nameWithOwner: 'octo-org/project' },
    }));
    const octokit = createOctokit([firstPage, []]);

    if (!reference) throw new Error('Expected a GitHub issue reference');
    await expect(
      githubIssuesProvider.isLinked(octokit, pullRequest, reference),
    ).resolves.toBe(false);
  });
});
