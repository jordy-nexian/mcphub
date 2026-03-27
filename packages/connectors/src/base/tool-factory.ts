import { z } from "zod";

import type { ConnectorToolDefinition } from "@nexian/core/connectors/contracts";
import type { NormalizedToolResponse } from "@nexian/core/mcp/tools";

export function createStubTool(
  name: string,
  description: string
): ConnectorToolDefinition<{ query?: string }, NormalizedToolResponse> {
  return {
    name,
    description,
    inputSchema: z.object({
      query: z.string().optional()
    }),
    async execute(context, input) {
      return {
        summary: `${name} is scaffolded for tenant ${context.tenantId}.`,
        data: [
          {
            status: "not_implemented",
            query: input.query ?? null,
            accountId: context.accountId
          }
        ],
        source: "connector-scaffold"
      };
    }
  };
}

