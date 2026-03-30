import { createStubTool } from "../base/tool-factory";

import type { ProviderAdapter } from "@nexian/core/connectors/contracts";
import type { TokenPair } from "@nexian/core/domain/models";

function getHaloBaseUrl() {
  const value = process.env.HALOPSA_BASE_URL ?? process.env.HALOPSA_URL;
  if (!value) {
    throw new Error("Set HALOPSA_BASE_URL in your environment to your HaloPSA instance URL");
  }

  return value.replace(/\/$/, "");
}

function getHaloScopes() {
  return (process.env.HALOPSA_SCOPES ?? "read:tickets read:customers read:actions offline_access")
    .split(/\s+/)
    .filter(Boolean);
}

async function exchangeHaloToken(params: URLSearchParams): Promise<TokenPair> {
  const response = await fetch(`${getHaloBaseUrl()}/auth/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HaloPSA token exchange failed (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000) : undefined,
    scopes: payload.scope?.split(" ").filter(Boolean)
  };
}

export const haloPsaAdapter: ProviderAdapter = {
  provider: "halopsa",
  displayName: "HaloPSA",
  supportsOAuth: true,
  oauthConfig: {
    authorizationUrl: "http://localhost/placeholder",
    tokenUrl: "http://localhost/placeholder",
    scopes: getHaloScopes(),
    redirectUri: process.env.HALOPSA_REDIRECT_URI ?? "http://localhost:4000/oauth/halopsa/callback"
  },
  getAuthorizationUrl(state) {
    const params = new URLSearchParams({
      client_id: process.env.HALOPSA_CLIENT_ID ?? "",
      redirect_uri: process.env.HALOPSA_REDIRECT_URI ?? "http://localhost:4000/oauth/halopsa/callback",
      response_type: "code",
      scope: getHaloScopes().join(" "),
      state
    });
    return `${getHaloBaseUrl()}/auth/authorize?${params.toString()}`;
  },
  async exchangeCode(code) {
    return exchangeHaloToken(
      new URLSearchParams({
        grant_type: "authorization_code",
        client_id: process.env.HALOPSA_CLIENT_ID ?? "",
        client_secret: process.env.HALOPSA_CLIENT_SECRET ?? "",
        code,
        redirect_uri: process.env.HALOPSA_REDIRECT_URI ?? "http://localhost:4000/oauth/halopsa/callback"
      })
    );
  },
  async refreshToken(_account, refreshToken) {
    return exchangeHaloToken(
      new URLSearchParams({
        grant_type: "refresh_token",
        client_id: process.env.HALOPSA_CLIENT_ID ?? "",
        client_secret: process.env.HALOPSA_CLIENT_SECRET ?? "",
        refresh_token: refreshToken
      })
    );
  },
  getTools() {
    return [
      createStubTool("find_customer", "Find a customer by name or account reference."),
      createStubTool("list_open_tickets", "List open HaloPSA tickets for a customer or queue."),
      createStubTool("get_ticket", "Get a HaloPSA ticket by identifier, ticket number, or display reference."),
      createStubTool("list_ticket_actions", "List actions and notes recorded against a HaloPSA ticket."),
      createStubTool("search_projects", "Search HaloPSA projects and project tickets by name, code, or summary."),
      createStubTool("find_contact", "Find HaloPSA contacts or end users by name, email, or phone."),
      createStubTool("search_documents", "Search HaloPSA knowledge base articles and documentation."),
      createStubTool("list_devices_for_site", "List HaloPSA assets and devices for a site or location."),
      createStubTool("get_recent_invoices", "List recent HaloPSA invoices or billing records."),
      createStubTool("create_draft_ticket", "Create a guarded draft HaloPSA ticket with minimal safe fields."),
      createStubTool("add_internal_note", "Add a non-customer-visible internal note or action to a HaloPSA ticket.")
    ];
  }
};
