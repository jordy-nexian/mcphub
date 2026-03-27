import { createStubTool } from "../base/tool-factory";

import type { ProviderAdapter } from "@nexian/core/connectors/contracts";

export const hubspotAdapter: ProviderAdapter = {
  provider: "hubspot",
  displayName: "HubSpot",
  supportsOAuth: true,
  oauthConfig: {
    authorizationUrl: "https://app.hubspot.com/oauth/authorize",
    tokenUrl: "https://api.hubapi.com/oauth/v1/token",
    scopes: ["crm.objects.contacts.read", "crm.objects.companies.read", "oauth"],
    redirectUri: "http://localhost:4000/oauth/hubspot/callback"
  },
  getAuthorizationUrl(state) {
    const params = new URLSearchParams({
      client_id: process.env.HUBSPOT_CLIENT_ID ?? "",
      redirect_uri: this.oauthConfig?.redirectUri ?? "",
      response_type: "code",
      scope: this.oauthConfig?.scopes.join(" ") ?? "",
      state
    });
    return `${this.oauthConfig?.authorizationUrl}?${params.toString()}`;
  },
  async exchangeCode() {
    return {
      accessToken: "replace-with-hubspot-token",
      refreshToken: "replace-with-hubspot-refresh-token",
      expiresAt: new Date(Date.now() + 1800_000)
    };
  },
  async refreshToken() {
    return {
      accessToken: "replace-with-hubspot-refreshed-token",
      refreshToken: "replace-with-hubspot-refreshed-refresh-token",
      expiresAt: new Date(Date.now() + 1800_000)
    };
  },
  getTools() {
    return [createStubTool("find_contact", "Find CRM contacts and companies.")];
  }
};

