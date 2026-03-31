import { createStubTool } from "../base/tool-factory";

import type { ProviderAdapter } from "@nexian/core/connectors/contracts";

export const n8nAdapter: ProviderAdapter = {
  provider: "n8n",
  displayName: "n8n",
  supportsOAuth: false,
  getTools() {
    return [
      createStubTool("list_workflows", "List n8n workflows available for the current tenant."),
      createStubTool("get_workflow", "Load a single n8n workflow definition and node layout."),
      createStubTool("list_executions", "List recent n8n workflow executions and their statuses."),
      createStubTool("get_execution", "Inspect a single n8n execution, including timing and failure details."),
      createStubTool("trigger_webhook", "Trigger an n8n webhook or execution path for a connected workflow.")
    ];
  }
};
