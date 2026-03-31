import { createStubTool } from "../base/tool-factory";

import type { ProviderAdapter } from "@nexian/core/connectors/contracts";

export const cippAdapter: ProviderAdapter = {
  provider: "cipp",
  displayName: "CIPP",
  supportsOAuth: false,
  getTools() {
    return [
      createStubTool("find_contact", "Find tenant users and contacts surfaced through CIPP."),
      createStubTool("search_documents", "Search Microsoft 365 tenant notes and operational context exposed through CIPP."),
      createStubTool("search_projects", "List tenant work items or administration tasks coordinated through CIPP.")
    ];
  }
};
