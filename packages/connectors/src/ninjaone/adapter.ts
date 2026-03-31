import { createStubTool } from "../base/tool-factory";

import type { ProviderAdapter } from "@nexian/core/connectors/contracts";

export const ninjaOneAdapter: ProviderAdapter = {
  provider: "ninjaone",
  displayName: "NinjaOne",
  supportsOAuth: false,
  getTools() {
    return [
      createStubTool("list_devices_for_site", "List managed endpoints and device health for a customer or site."),
      createStubTool("search_documents", "Search runbooks, scripts, and supporting notes exposed through NinjaOne."),
      createStubTool("find_contact", "Find technician or customer contact information linked to NinjaOne records.")
    ];
  }
};
