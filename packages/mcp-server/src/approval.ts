import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export type ApprovalResult =
  | { readonly approved: true }
  | { readonly approved: false; readonly reason: string };

/** Ask a person to approve an action. Resolves `approved: true` only on an explicit yes. */
export type ApprovalRequester = (message: string) => Promise<ApprovalResult>;

const APPROVAL_SCHEMA = {
  type: 'object' as const,
  properties: {
    approve: {
      type: 'boolean' as const,
      title: 'Approve',
      description: 'Tick to approve exactly what is described above.',
    },
  },
  required: ['approve'],
};

/**
 * Ask the person using the MCP client — not the model — to approve an action.
 *
 * This uses MCP elicitation: the client shows the prompt to its user and returns the
 * answer to the server directly. The model never holds a token it could replay and
 * cannot answer on the person's behalf. A client without elicitation support cannot
 * show the prompt, so the action is refused rather than allowed.
 */
export function createApprovalRequester(server: McpServer): ApprovalRequester {
  return async (message) => {
    if (!server.server.getClientCapabilities()?.elicitation) {
      return {
        approved: false,
        reason:
          'This server requires a person to approve each transfer and signature, but the ' +
          'connected MCP client cannot show approval prompts (no elicitation support). ' +
          'Nothing was signed. Use a client that supports elicitation, or run without ' +
          'LOCKTEK_REQUIRE_CONFIRMATION and rely on spend limits.',
      };
    }

    try {
      const result = await server.server.elicitInput({ message, requestedSchema: APPROVAL_SCHEMA });
      if (result.action === 'accept' && result.content?.['approve'] === true) {
        return { approved: true };
      }
      return {
        approved: false,
        reason:
          result.action === 'accept'
            ? 'The person did not approve it. Nothing was signed.'
            : `The person ${result.action === 'decline' ? 'declined' : 'dismissed'} the approval prompt. Nothing was signed.`,
      };
    } catch (error: unknown) {
      // Fail closed: an approval that could not be asked for is not an approval.
      return {
        approved: false,
        reason: `The approval prompt failed (${
          error instanceof Error ? error.message : 'unknown error'
        }). Nothing was signed.`,
      };
    }
  };
}
