import { createStubTool } from "../base/tool-factory";

import type { ProviderAdapter } from "@nexian/core/connectors/contracts";

export const itGlueAdapter: ProviderAdapter = {
  provider: "itglue",
  displayName: "IT Glue",
  supportsOAuth: false,
  getTools() {
    return [
      createStubTool("search_documents", "Search documentation, SOPs, and knowledge records."),
      createStubTool("list_devices_for_site", "List devices recorded for a site or organization."),
      createStubTool("get_recent_invoices", "List recent invoice-like finance artifacts if enabled by policy.")
    ];
  }
};

