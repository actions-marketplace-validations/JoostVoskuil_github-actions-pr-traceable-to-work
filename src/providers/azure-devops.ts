import type {
  Octokit,
  PullRequestContext,
  WorkItemProvider,
  WorkItemReference,
} from './types';

const AB_PATTERN = /\bAB#(\d+)\b/i;
const AZURE_BOARDS_BOT = 'azure-boards[bot]';
const DOCS_URL =
  'https://learn.microsoft.com/en-us/azure/devops/boards/github/link-to-from-github?view=azure-devops#use-ab-mention-to-link-from-github-to-azure-boards-work-items';

export const azureDevOpsProvider: WorkItemProvider = {
  name: 'azuredevops',
  commentCodes: {
    success: 'lcc-200',
    missing: 'lcc-404',
    unlinked: 'lcc-416',
  },
  docsUrl: DOCS_URL,
  findReference(description: string, pullRequest: PullRequestContext) {
    const match = AB_PATTERN.exec(description);

    if (!match) {
      return undefined;
    }

    const id = match[1];
    return {
      id,
      owner: pullRequest.owner,
      repo: pullRequest.repo,
      display: `AB#${id}`,
    };
  },
  async isLinked(
    _octokit: Octokit,
    pullRequest: PullRequestContext,
    _reference: WorkItemReference,
  ) {
    return (
      pullRequest.description.includes('[AB#') &&
      pullRequest.description.includes('/_workitems/edit/')
    );
  },
  getMissingMessage() {
    return 'Description does not contain an Azure DevOps work item reference, such as AB#123';
  },
  getUnlinkedMessage(reference: WorkItemReference) {
    return `Description contains ${reference.display}, but Azure DevOps has not linked that work item`;
  },
  getSuccessMessage(reference: WorkItemReference) {
    return `Work item link check complete. Azure DevOps work item ${reference.display} is linked to this pull request.`;
  },
  shouldWaitForLink(senderLogin: string) {
    return senderLogin === AZURE_BOARDS_BOT;
  },
  shouldDeleteFailureComment(senderLogin: string) {
    return senderLogin === AZURE_BOARDS_BOT;
  },
};
