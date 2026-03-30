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
      createStubTool(
        "find_customer",
        "Use when the user wants to identify an organisation, customer account, or client record in HaloPSA by name, reference, or partial account text."
      ),
      createStubTool(
        "get_customer_overview",
        "Use when the user wants a combined HaloPSA view of a customer with their core account details plus recent open ticket activity."
      ),
      createStubTool(
        "list_open_tickets",
        "Use when the user wants a queue-style view of active tickets, open incidents, or tickets for a customer. Prefer this before get_ticket if the exact ticket id is unknown."
      ),
      createStubTool(
        "get_ticket",
        "Use when the user gives a specific HaloPSA ticket number, id, or visible ticket reference and wants the full details for one ticket."
      ),
      createStubTool(
        "get_ticket_with_actions",
        "Use when the user wants a single HaloPSA ticket together with its recent actions, notes, or engineer updates in one result."
      ),
      createStubTool(
        "list_ticket_actions",
        "Use when the user wants the notes, updates, engineer actions, or activity history recorded against a specific HaloPSA ticket."
      ),
      createStubTool(
        "search_projects",
        "Use when the user asks about projects, project tickets, project status, or project work in HaloPSA."
      ),
      createStubTool(
        "find_contact",
        "Use when the user wants a person, end user, requester, or contact in HaloPSA by name, email address, or phone number."
      ),
      createStubTool(
        "search_documents",
        "Use when the user wants knowledge base articles, SOP-style documentation, or HaloPSA knowledge records."
      ),
      createStubTool(
        "list_devices_for_site",
        "Use when the user asks what devices, assets, or inventory items are recorded for a HaloPSA site or location."
      ),
      createStubTool(
        "get_recent_invoices",
        "Use when the user wants recent invoice, billing, or finance records from HaloPSA in a read-only way."
      ),
      createStubTool(
        "create_draft_ticket",
        "Use only for safe ticket creation when the user explicitly wants a new ticket created. This should create a draft-style service ticket with minimal fields."
      ),
      createStubTool(
        "add_internal_note",
        "Use when the user explicitly wants to add an internal, non-customer-visible update or engineer note to an existing HaloPSA ticket."
      )
    ];
  }
};
