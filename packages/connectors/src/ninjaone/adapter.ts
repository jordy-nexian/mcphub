import { createStubTool } from "../base/tool-factory";

import type { ProviderAdapter } from "@nexian/core/connectors/contracts";

export const ninjaOneAdapter: ProviderAdapter = {
  provider: "ninjaone",
  displayName: "NinjaOne",
  supportsOAuth: true,
  getTools() {
    return [
      createStubTool(
        "get_user_devices",
        "Use when the user asks for devices used by, assigned to, or belonging to a named person or contact. This should resolve the person through Halo and NinjaOne context and return the most likely endpoints in one step."
      ),
      createStubTool(
        "search_rmm_devices",
        "Search NinjaOne managed devices by name, hostname, serial, or organization and return endpoint identity plus health context."
      ),
      createStubTool(
        "get_rmm_device_overview",
        "Get a single NinjaOne device with rich operational context including alerts, storage or disk details where available, health, and recent activity."
      ),
      createStubTool(
        "get_rmm_device_alerts",
        "List active or recent NinjaOne alerts for a specific device so AI clients can reason about current endpoint issues."
      ),
      createStubTool(
        "get_rmm_device_activities",
        "List recent NinjaOne device activities such as checks, automation runs, patches, and operational changes."
      ),
      createStubTool(
        "list_rmm_organizations",
        "List or search NinjaOne organizations so AI clients can resolve customer or site context before querying devices."
      ),
      createStubTool(
        "get_rmm_organization",
        "Get a single NinjaOne organization by id so AI clients can inspect organization details before loading managed devices."
      ),
      createStubTool("list_rmm_devices_for_site", "List managed endpoints and device health for a NinjaOne organization or site."),
      createStubTool("search_rmm_documents", "Search runbooks, scripts, and supporting notes exposed through NinjaOne."),
      createStubTool("find_rmm_contact", "Find technician or customer contact information linked to NinjaOne records.")
    ];
  }
};
