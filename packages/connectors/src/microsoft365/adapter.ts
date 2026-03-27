import { createStubTool } from "../base/tool-factory";

import type { ProviderAdapter } from "@nexian/core/connectors/contracts";

export const microsoft365Adapter: ProviderAdapter = {
  provider: "microsoft365",
  displayName: "Microsoft 365 / SharePoint",
  supportsOAuth: true,
  oauthConfig: {
    authorizationUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: ["Files.Read", "Sites.Read.All", "offline_access"],
    redirectUri: "http://localhost:4000/oauth/microsoft365/callback"
  },
  getAuthorizationUrl(state) {
    const params = new URLSearchParams({
      client_id: process.env.MS365_CLIENT_ID ?? "",
      redirect_uri: this.oauthConfig?.redirectUri ?? "",
      response_type: "code",
      scope: this.oauthConfig?.scopes.join(" ") ?? "",
      state
    });
    return `${this.oauthConfig?.authorizationUrl}?${params.toString()}`;
  },
  async exchangeCode() {
    return {
      accessToken: "replace-with-ms365-token",
      refreshToken: "replace-with-ms365-refresh-token",
      expiresAt: new Date(Date.now() + 3600_000)
    };
  },
  async refreshToken() {
    return {
      accessToken: "replace-with-ms365-refreshed-token",
      refreshToken: "replace-with-ms365-refreshed-refresh-token",
      expiresAt: new Date(Date.now() + 3600_000)
    };
  },
  getTools() {
    return [
      createStubTool("search_documents", "Search SharePoint and OneDrive documents."),
      createStubTool("search_projects", "Search project workspaces surfaced through Microsoft 365."),
      createStubTool("find_contact", "Find contacts from tenant-approved Microsoft sources.")
    ];
  }
};

