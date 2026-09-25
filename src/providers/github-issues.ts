import type {
  Octokit,
  PullRequestContext,
  WorkItemProvider,
  WorkItemReference,
} from './types';

const CLOSING_ISSUE_PATTERN =
  /\b(?:close[sd]?|fix(?:es|ed)?|resolve[sd]?)\s+(?:([\w.-]+)\/([\w.-]+))?#([1-9]\d*)\b/gi;
const DOCS_URL =
  'https://docs.github.com/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue';

interface LinkedIssue {
  number: number;
  repository?: {
    nameWithOwner: string;
  };
}

interface ClosingIssuesResponse {
  repository: {
    pullRequest: {
      closingIssuesReferences: {
        nodes: Array<LinkedIssue | null>;
        pageInfo: {
          hasNextPage: boolean;
          endCursor: string | null;
        };
      };
    };
  };
}

function isLinkedIssue(value: unknown): value is LinkedIssue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'number' in value &&
    typeof value.number === 'number' &&
    'repository' in value &&
    typeof value.repository === 'object' &&
    value.repository !== null &&
    'nameWithOwner' in value.repository &&
    typeof value.repository.nameWithOwner === 'string'
  );
}

function belongsToRepository(
  issue: LinkedIssue,
  owner: string,
  repo: string,
): boolean {
  return (
    issue.repository?.nameWithOwner.toLowerCase() ===
    `${owner}/${repo}`.toLowerCase()
  );
}

export const githubIssuesProvider: WorkItemProvider = {
  name: 'github',
  commentCodes: {
    success: 'ghi-200',
    missing: 'ghi-404',
    unlinked: 'ghi-409',
  },
  docsUrl: DOCS_URL,
  findReference(description: string, pullRequest: PullRequestContext) {
    const match = CLOSING_ISSUE_PATTERN.exec(description);
    CLOSING_ISSUE_PATTERN.lastIndex = 0;

    const id = match?.[3];
    if (!id) {
      return undefined;
    }

    const owner = match[1] ?? pullRequest.owner;
    const repo = match[2] ?? pullRequest.repo;

    return {
      id,
      owner,
      repo,
      display: `${owner}/${repo}#${id}`,
    };
  },
  async isLinked(
    octokit: Octokit,
    pullRequest: PullRequestContext,
    reference: WorkItemReference,
  ) {
    let cursor: string | null = null;

    do {
      const response: ClosingIssuesResponse =
        await octokit.graphql<ClosingIssuesResponse>(
          `
          query($owner: String!, $repo: String!, $pullNumber: Int!, $after: String) {
            repository(owner: $owner, name: $repo) {
              pullRequest(number: $pullNumber) {
                closingIssuesReferences(first: 100, after: $after) {
                  nodes {
                    number
                    repository {
                      nameWithOwner
                    }
                  }
                  pageInfo {
                    hasNextPage
                    endCursor
                  }
                }
              }
            }
          }
          `,
          {
            owner: pullRequest.owner,
            repo: pullRequest.repo,
            pullNumber: pullRequest.number,
            after: cursor,
          },
        );
      const connection: ClosingIssuesResponse['repository']['pullRequest']['closingIssuesReferences'] =
        response.repository.pullRequest.closingIssuesReferences;
      const linkedIssues = connection.nodes.filter(isLinkedIssue);

      if (
        linkedIssues.some(
          (issue) =>
            issue.number === Number(reference.id) &&
            belongsToRepository(issue, reference.owner, reference.repo),
        )
      ) {
        return true;
      }

      cursor = connection.pageInfo.endCursor;
      if (!connection.pageInfo.hasNextPage) return false;
    } while (cursor);

    return false;
  },
  getMissingMessage() {
    return 'Description does not contain a GitHub issue reference, such as Fixes #123';
  },
  getUnlinkedMessage(reference: WorkItemReference) {
    return `Description contains ${reference.display}, but GitHub has not linked that issue`;
  },
  getSuccessMessage(reference: WorkItemReference) {
    return `Work item link check complete. GitHub issue ${reference.display} is linked to this pull request.`;
  },
  shouldWaitForLink() {
    return false;
  },
  shouldDeleteFailureComment() {
    return false;
  },
};
