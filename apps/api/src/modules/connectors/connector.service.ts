import crypto from "node:crypto";

import Redis from "ioredis";
import jwt from "jsonwebtoken";

import { getProviderRegistry } from "@nexian/connectors";
import type { ConnectedAccountRecord, ProviderName } from "@nexian/core/domain/models";
import { TokenEncryptionService } from "@nexian/core/security/encryption";

import { buildAppConfig } from "../../common/config/env";
import { createOAuthState, verifyOAuthState } from "../../common/security/oauth-state";
import { ConnectorConfigStore } from "../../common/store/connector-config.store";
import { ConnectedAccountStore } from "../../common/store/connected-account.store";
import type { AuditService } from "../audit/audit.service";

import { TokenRefreshService } from "./token-refresh.service";

const config = buildAppConfig();

type HaloTicketRecord = Record<string, unknown>;
type HaloClientRecord = Record<string, unknown>;
type HaloGenericRecord = Record<string, unknown>;
type ConnectorConfigInput = Record<string, unknown>;
type StoredConnectorConfig = {
  apiUrl?: string;
  authUrl?: string;
  clientId?: string;
  clientSecretEncrypted?: string;
  redirectUri?: string;
  scopes?: string[];
  tenantId?: string;
  appId?: string;
  webhookBaseUrl?: string;
};

type N8nWorkflowRecord = Record<string, unknown>;
type N8nExecutionRecord = Record<string, unknown>;

function pickString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

function pickNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string" && value.trim().length > 0 && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }

  return undefined;
}

function isTicketOpen(record: HaloTicketRecord) {
  const closed = record.closed ?? record.isclosed ?? record.isClosed;
  if (typeof closed === "boolean") {
    return !closed;
  }

  const statusName = pickString(record, ["status_name", "status", "ticketstatus", "statusName"])?.toLowerCase();
  if (!statusName) {
    return true;
  }

  return !["closed", "resolved", "completed", "cancelled"].some((keyword) => statusName.includes(keyword));
}

function buildHaloHeaders(accessToken: string) {
  return {
    accept: "application/json",
    authorization: `Bearer ${accessToken}`
  };
}

function buildHaloJsonHeaders(accessToken: string) {
  return {
    ...buildHaloHeaders(accessToken),
    "content-type": "application/json"
  };
}

function ticketMatchesIdentifier(ticket: HaloTicketRecord, identifier: string) {
  const normalized = identifier.replace(/^0+/, "");
  const candidates = [
    pickString(ticket, ["id", "ticket_id", "TicketID", "ticketnumber", "ticket_number", "number"]),
    String(pickNumber(ticket, ["id", "ticket_id", "TicketID", "ticketnumber", "ticket_number", "number"]) ?? "")
  ]
    .map((value) => value?.trim())
    .filter(Boolean) as string[];

  return candidates.some((candidate) => candidate === identifier || candidate.replace(/^0+/, "") === normalized);
}

function normalizeCollectionPayload(payload: unknown, keys: string[]) {
  if (Array.isArray(payload)) {
    return payload as HaloGenericRecord[];
  }

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of keys) {
      const value = record[key];
      if (Array.isArray(value)) {
        return value as HaloGenericRecord[];
      }
    }
  }

  return [];
}

function textMatches(value: string | undefined, query: string) {
  if (!value) {
    return false;
  }

  return value.toLowerCase().includes(query.toLowerCase());
}

const haloDebugEnabled = process.env.HALO_DEBUG === "true";

function logHaloDebug(event: string, payload: Record<string, unknown>) {
  if (!haloDebugEnabled) {
    return;
  }

  console.info("[halo-debug]", JSON.stringify({ event, ...payload }));
}

async function haloFetch(input: string | URL, init: RequestInit & { bodyPreview?: unknown } = {}) {
  const url = typeof input === "string" ? input : input.toString();
  const { bodyPreview, ...requestInit } = init;

  logHaloDebug("request", {
    method: requestInit.method ?? "GET",
    url,
    body: bodyPreview ?? (typeof requestInit.body === "string" ? requestInit.body : undefined)
  });

  const response = await fetch(url, requestInit);

  logHaloDebug("response", {
    method: requestInit.method ?? "GET",
    url,
    status: response.status,
    ok: response.ok
  });

  return response;
}

export class ConnectorService {
  private readonly registry = getProviderRegistry();
  private readonly encryption = TokenEncryptionService.fromBase64(config.tokenEncryptionKeyBase64);
  private readonly redis = config.redisUrl
    ? new Redis(config.redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 1
      })
    : undefined;
  private readonly refreshService = new TokenRefreshService(this.redis, this.encryption);
  private readonly store = ConnectedAccountStore.createDefault();
  private readonly configStore = ConnectorConfigStore.createDefault();

  constructor(private readonly auditService: AuditService) {
    this.redis?.on("error", (error) => {
      console.warn("[redis]", error.message);
    });
  }

  async getProviders(tenantId?: string, userId?: string) {
    const accounts = tenantId && userId ? await this.store.findByTenantUser(tenantId, userId) : [];

    return [...this.registry.values()].map((adapter) => {
      const account = accounts.find((candidate) => candidate.provider === adapter.provider);
      return {
        provider: adapter.provider,
        displayName: adapter.displayName,
        supportsOAuth: adapter.supportsOAuth,
        status: account?.status ?? "DISCONNECTED",
        connected: Boolean(account),
        lastError: account?.lastError,
        toolNames: adapter.getTools().map((tool) => tool.name)
      };
    });
  }

  async beginOAuth(provider: ProviderName, tenantId: string, userId: string, returnTo?: string) {
    if (provider === "halopsa") {
      const haloConfig = await this.resolveHaloConfig(tenantId);
      const state = createOAuthState({ provider, tenantId, userId, returnTo }, config.oauthStateSigningSecret);
      const params = new URLSearchParams({
        client_id: haloConfig.clientId,
        redirect_uri: haloConfig.redirectUri,
        response_type: "code",
        scope: haloConfig.scopes.join(" "),
        state
      });

      return { authorizationUrl: `${haloConfig.authUrl}/auth/authorize?${params.toString()}` };
    }

    if (provider === "ninjaone") {
      const ninjaConfig = await this.resolveNinjaOneConfig(tenantId);
      const state = createOAuthState({ provider, tenantId, userId, returnTo }, config.oauthStateSigningSecret);
      const params = new URLSearchParams({
        client_id: ninjaConfig.clientId,
        redirect_uri: ninjaConfig.redirectUri,
        response_type: "code",
        scope: ninjaConfig.scopes.join(" "),
        state
      });

      return { authorizationUrl: `${ninjaConfig.authUrl}/ws/oauth/authorize?${params.toString()}` };
    }

    const adapter = this.registry.get(provider);
    if (!adapter?.supportsOAuth || !adapter.getAuthorizationUrl) {
      throw new Error(`Provider ${provider} does not support OAuth`);
    }

    const state = createOAuthState({ provider, tenantId, userId, returnTo }, config.oauthStateSigningSecret);
    return { authorizationUrl: adapter.getAuthorizationUrl(state) };
  }

  async finishOAuth(provider: ProviderName, code: string, state: string) {
    if (provider === "halopsa") {
      const payload = verifyOAuthState(state, config.oauthStateSigningSecret);
      const haloConfig = await this.resolveHaloConfig(payload.tenantId);
      const tokens = await this.exchangeHaloToken(
        haloConfig,
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: haloConfig.clientId,
          client_secret: haloConfig.clientSecret,
          code,
          redirect_uri: haloConfig.redirectUri
        })
      );
      const now = new Date();
      const account: ConnectedAccountRecord = {
        id: crypto.randomUUID(),
        tenantId: payload.tenantId,
        userId: payload.userId,
        provider,
        providerAccountId: payload.userId,
        accessTokenEncrypted: this.encryption.encrypt(tokens.accessToken),
        refreshTokenEncrypted: tokens.refreshToken ? this.encryption.encrypt(tokens.refreshToken) : undefined,
        expiresAt: tokens.expiresAt,
        scopes: tokens.scopes ?? haloConfig.scopes,
        metadataJson: {
          connectedVia: "oauth_authorization_code",
          apiUrl: haloConfig.apiUrl,
          clientId: haloConfig.clientId,
          redirectUri: haloConfig.redirectUri,
          scopes: haloConfig.scopes
        },
        status: "ACTIVE",
        lastError: undefined,
        createdAt: now,
        updatedAt: now
      };

      await this.store.upsert(account);
      await this.auditService.log({
        tenantId: payload.tenantId,
        userId: payload.userId,
        action: "CONNECTOR_CONNECTED",
        targetType: "connected_account",
        metadata: { provider }
      });

      return {
        returnTo: payload.returnTo ?? `${config.appUrl}/dashboard/connectors`,
        tenantId: payload.tenantId,
        userId: payload.userId,
        provider,
        expiresAt: tokens.expiresAt,
        scopes: tokens.scopes ?? haloConfig.scopes
      };
    }

    if (provider === "ninjaone") {
      const payload = verifyOAuthState(state, config.oauthStateSigningSecret);
      const ninjaConfig = await this.resolveNinjaOneConfig(payload.tenantId);
      const tokens = await this.exchangeNinjaOneToken(
        ninjaConfig,
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: ninjaConfig.clientId,
          client_secret: ninjaConfig.clientSecret,
          code,
          redirect_uri: ninjaConfig.redirectUri
        })
      );
      const now = new Date();
      const account: ConnectedAccountRecord = {
        id: crypto.randomUUID(),
        tenantId: payload.tenantId,
        userId: payload.userId,
        provider,
        providerAccountId: payload.userId,
        accessTokenEncrypted: this.encryption.encrypt(tokens.accessToken),
        refreshTokenEncrypted: tokens.refreshToken ? this.encryption.encrypt(tokens.refreshToken) : undefined,
        expiresAt: tokens.expiresAt,
        scopes: tokens.scopes ?? ninjaConfig.scopes,
        metadataJson: {
          connectedVia: "oauth_authorization_code",
          apiUrl: ninjaConfig.apiUrl,
          authUrl: ninjaConfig.authUrl,
          clientId: ninjaConfig.clientId,
          redirectUri: ninjaConfig.redirectUri,
          scopes: ninjaConfig.scopes
        },
        status: "ACTIVE",
        lastError: undefined,
        createdAt: now,
        updatedAt: now
      };

      await this.store.upsert(account);
      await this.auditService.log({
        tenantId: payload.tenantId,
        userId: payload.userId,
        action: "CONNECTOR_CONNECTED",
        targetType: "connected_account",
        metadata: { provider }
      });

      return {
        returnTo: payload.returnTo ?? `${config.appUrl}/dashboard/connectors`,
        tenantId: payload.tenantId,
        userId: payload.userId,
        provider,
        expiresAt: tokens.expiresAt,
        scopes: tokens.scopes ?? ninjaConfig.scopes
      };
    }

    const adapter = this.registry.get(provider);
    if (!adapter?.exchangeCode) {
      throw new Error(`Provider ${provider} does not support token exchange`);
    }

    const payload = verifyOAuthState(state, config.oauthStateSigningSecret);
    const tokens = await adapter.exchangeCode(code);
    const now = new Date();
    const account: ConnectedAccountRecord = {
      id: crypto.randomUUID(),
      tenantId: payload.tenantId,
      userId: payload.userId,
      provider,
      providerAccountId: payload.userId,
      accessTokenEncrypted: this.encryption.encrypt(tokens.accessToken),
      refreshTokenEncrypted: tokens.refreshToken ? this.encryption.encrypt(tokens.refreshToken) : undefined,
      expiresAt: tokens.expiresAt,
      scopes: tokens.scopes ?? adapter.oauthConfig?.scopes ?? [],
      metadataJson: { connectedVia: "oauth_authorization_code" },
      status: "ACTIVE",
      lastError: undefined,
      createdAt: now,
      updatedAt: now
    };

    await this.store.upsert(account);
    await this.auditService.log({
      tenantId: payload.tenantId,
      userId: payload.userId,
      action: "CONNECTOR_CONNECTED",
      targetType: "connected_account",
      metadata: { provider }
    });

    return {
      returnTo: payload.returnTo ?? `${config.appUrl}/dashboard/connectors`,
      tenantId: payload.tenantId,
      userId: payload.userId,
      provider,
      expiresAt: tokens.expiresAt,
      scopes: tokens.scopes ?? adapter.oauthConfig?.scopes ?? []
    };
  }

  async disconnect(provider: ProviderName, tenantId: string, userId: string) {
    await this.store.disconnect(tenantId, userId, provider);
    await this.auditService.log({
      tenantId,
      userId,
      action: "CONNECTOR_DISCONNECTED",
      targetType: "connected_account",
      metadata: { provider }
    });
  }

  async getConnectedAccounts(tenantId: string, userId: string) {
    const accounts = await this.store.findByTenantUser(tenantId, userId);
    return accounts.map((account) => ({
      provider: account.provider,
      status: account.status,
      scopes: account.scopes,
      expiresAt: account.expiresAt?.toISOString(),
      lastError: account.lastError
    }));
  }

  async getConnectorConfig(tenantId: string, provider: ProviderName) {
    const record = await this.configStore.get(tenantId, provider);
    const configJson = (record?.configJson ?? {}) as StoredConnectorConfig;

    switch (provider) {
      case "halopsa":
        return {
          provider,
          config: {
            apiUrl: configJson.apiUrl ?? "",
            authUrl: configJson.authUrl ?? "",
            clientId: configJson.clientId ?? "",
            redirectUri: configJson.redirectUri ?? process.env.HALOPSA_REDIRECT_URI ?? `${config.apiUrl}/oauth/halopsa/callback`,
            scopes: (configJson.scopes ?? this.getDefaultHaloScopes()).join(" "),
            hasClientSecret: Boolean(configJson.clientSecretEncrypted)
          }
        };
      case "ninjaone":
        return {
          provider,
          config: {
            apiUrl: configJson.apiUrl ?? "",
            authUrl: configJson.authUrl ?? "",
            clientId: configJson.clientId ?? "",
            redirectUri: configJson.redirectUri ?? "",
            scopes: (configJson.scopes ?? ["monitoring", "devices", "organizations"]).join(" "),
            hasClientSecret: Boolean(configJson.clientSecretEncrypted)
          }
        };
      case "cipp":
        return {
          provider,
          config: {
            apiUrl: configJson.apiUrl ?? "",
            tenantId: configJson.tenantId ?? "",
            clientId: configJson.clientId ?? configJson.appId ?? "",
            hasClientSecret: Boolean(configJson.clientSecretEncrypted)
          }
        };
      case "n8n":
        return {
          provider,
          config: {
            apiUrl: configJson.apiUrl ?? "",
            clientId: configJson.clientId ?? "",
            redirectUri: configJson.webhookBaseUrl ?? "",
            hasClientSecret: Boolean(configJson.clientSecretEncrypted)
          }
        };
      default:
        return { provider, config: {} };
    }
  }

  async saveConnectorConfig(tenantId: string, userId: string, provider: ProviderName, input: ConnectorConfigInput) {
    const existing = (await this.configStore.get(tenantId, provider))?.configJson as StoredConnectorConfig | undefined;
    const nextConfig = this.buildConnectorConfig(provider, input, existing);
    const now = new Date();

    await this.configStore.upsert({
      tenantId,
      provider,
      configJson: nextConfig,
      createdAt: now,
      updatedAt: now
    });

    await this.auditService.log({
      tenantId,
      userId,
      action: "CONNECTOR_CONFIG_UPDATED",
      targetType: "connector_config",
      metadata: { provider }
    });

    return this.getConnectorConfig(tenantId, provider);
  }

  async listN8nWorkflows(tenantId: string) {
    const n8nConfig = await this.resolveN8nConfig(tenantId);
    const response = await fetch(`${n8nConfig.apiUrl}/workflows`, {
      headers: {
        accept: "application/json",
        "X-N8N-API-KEY": n8nConfig.apiKey
      }
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`n8n workflows request failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as { data?: N8nWorkflowRecord[] } | N8nWorkflowRecord[];
    const records = Array.isArray(payload) ? payload : Array.isArray(payload.data) ? payload.data : [];

    return records.map((workflow) => ({
      id: String(pickString(workflow, ["id"]) ?? pickNumber(workflow, ["id"]) ?? ""),
      name: pickString(workflow, ["name"]) ?? "Untitled workflow",
      active: Boolean(workflow.active),
      updatedAt:
        pickString(workflow, ["updatedAt", "updated_at"]) ??
        pickString(workflow, ["createdAt", "created_at"]) ??
        new Date().toISOString(),
      tags: Array.isArray(workflow.tags)
        ? workflow.tags
            .map((tag) => {
              if (typeof tag === "string") {
                return tag;
              }

              if (tag && typeof tag === "object") {
                return pickString(tag as Record<string, unknown>, ["name"]);
              }

              return undefined;
            })
            .filter(Boolean)
        : []
    }));
  }

  async listN8nExecutions(tenantId: string, workflowId?: string) {
    const n8nConfig = await this.resolveN8nConfig(tenantId);
    const url = new URL(`${n8nConfig.apiUrl}/executions`);
    url.searchParams.set("limit", "25");
    if (workflowId) {
      url.searchParams.set("workflowId", workflowId);
    }

    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "X-N8N-API-KEY": n8nConfig.apiKey
      }
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`n8n executions request failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as { data?: N8nExecutionRecord[] } | N8nExecutionRecord[];
    const records = Array.isArray(payload) ? payload : Array.isArray(payload.data) ? payload.data : [];

    return records.map((execution) => ({
      id: String(pickString(execution, ["id"]) ?? pickNumber(execution, ["id"]) ?? ""),
      workflowId: String(
        pickString(execution, ["workflowId", "workflow_id"]) ??
          pickNumber(execution, ["workflowId", "workflow_id"]) ??
          ""
      ),
      status:
        pickString(execution, ["status", "finished"]) ??
        (execution.finished === true ? "success" : execution.finished === false ? "running" : "unknown"),
      mode: pickString(execution, ["mode"]) ?? "manual",
      startedAt:
        pickString(execution, ["startedAt", "started_at"]) ??
        pickString(execution, ["createdAt", "created_at"]) ??
        new Date().toISOString(),
      stoppedAt: pickString(execution, ["stoppedAt", "stopped_at"]) ?? undefined
    }));
  }

  async ensureFreshAccount(account: ConnectedAccountRecord) {
    if (account.provider === "halopsa") {
      const refreshed = await this.refreshHaloAccountIfNeeded(account);
      if (
        refreshed.accessTokenEncrypted !== account.accessTokenEncrypted ||
        refreshed.refreshTokenEncrypted !== account.refreshTokenEncrypted ||
        refreshed.expiresAt?.toISOString() !== account.expiresAt?.toISOString() ||
        refreshed.status !== account.status
      ) {
        refreshed.updatedAt = new Date();
        await this.store.upsert(refreshed);
      }
      return refreshed;
    }

    const adapter = this.registry.get(account.provider);
    if (!adapter) {
      throw new Error(`Unknown provider ${account.provider}`);
    }
    const refreshed = await this.refreshService.refreshIfNeeded(account, adapter);
    if (
      refreshed.accessTokenEncrypted !== account.accessTokenEncrypted ||
      refreshed.refreshTokenEncrypted !== account.refreshTokenEncrypted ||
      refreshed.expiresAt?.toISOString() !== account.expiresAt?.toISOString() ||
      refreshed.status !== account.status
    ) {
      refreshed.updatedAt = new Date();
      await this.store.upsert(refreshed);
    }
    return refreshed;
  }

  issueMcpToken(tenantId: string, userId: string, roles: string[] = ["ADMIN"]) {
    return jwt.sign({ tenantId, userId, roles }, config.sessionSecret, { expiresIn: "1h" });
  }

  async executeTool(tenantId: string, userId: string, roles: string[], toolName: string, input: Record<string, unknown>) {
    const provider = [...this.registry.values()].find((candidate) =>
      candidate.getTools().some((tool) => tool.name === toolName)
    );

    if (!provider) {
      throw new Error(`Unknown tool ${toolName}`);
    }

    if (provider.provider === "halopsa") {
      return this.executeHaloTool(tenantId, userId, roles, toolName, input);
    }

    const tool = provider.getTools().find((candidate) => candidate.name === toolName);
    if (!tool) {
      throw new Error(`Tool ${toolName} not found`);
    }

    return tool.execute(
      {
        tenantId,
        userId,
        roles,
        requestId: crypto.randomUUID(),
        accountId: "connected-account-placeholder"
      },
      input
    );
  }

  private async executeHaloTool(tenantId: string, userId: string, roles: string[], toolName: string, input: Record<string, unknown>) {
    const account = (await this.store.findByTenantUser(tenantId, userId)).find(
      (candidate) => candidate.provider === "halopsa" && candidate.status === "ACTIVE"
    );

    if (!account) {
      throw new Error(`No active HaloPSA account found for ${tenantId}/${userId}`);
    }

    const freshAccount = await this.ensureFreshAccount(account);
    const accessToken = this.encryption.decrypt(freshAccount.accessTokenEncrypted);
    const baseUrl = this.getHaloBaseUrlForAccount(freshAccount);

    switch (toolName) {
      case "list_open_tickets":
        return this.listOpenHaloTickets(baseUrl, accessToken, input);
      case "get_customer_overview":
        return this.getHaloCustomerOverview(baseUrl, accessToken, input);
      case "get_ticket":
        return this.getHaloTicket(baseUrl, accessToken, input);
      case "get_ticket_with_actions":
        return this.getHaloTicketWithActions(baseUrl, accessToken, input);
      case "find_customer":
        return this.findHaloCustomer(baseUrl, accessToken, input);
      case "list_ticket_actions":
        return this.listHaloTicketActions(baseUrl, accessToken, input);
      case "search_projects":
        return this.searchHaloProjects(baseUrl, accessToken, input);
      case "find_contact":
        return this.findHaloContact(baseUrl, accessToken, input);
      case "search_documents":
        return this.searchHaloDocuments(baseUrl, accessToken, input);
      case "list_devices_for_site":
        return this.listHaloDevicesForSite(baseUrl, accessToken, input);
      case "get_recent_invoices":
        return this.getRecentHaloInvoices(baseUrl, accessToken, input);
      case "create_draft_ticket":
        return this.createDraftHaloTicket(baseUrl, accessToken, input);
      case "add_internal_note":
        return this.addHaloInternalNote(baseUrl, accessToken, input);
      default: {
        const tool = this.registry.get("halopsa")?.getTools().find((candidate) => candidate.name === toolName);
        if (!tool) {
          throw new Error(`HaloPSA tool ${toolName} not found`);
        }

        return tool.execute(
          {
            tenantId,
            userId,
            roles,
            requestId: crypto.randomUUID(),
            accountId: freshAccount.id
          },
          input
        );
      }
    }
  }

  private async listOpenHaloTickets(baseUrl: string, accessToken: string, input: Record<string, unknown>) {
    const query = typeof input.query === "string" ? input.query.trim() : undefined;
    const explicitClientId =
      pickNumber(input, ["clientId", "client_id"]) ??
      pickNumber(input, ["customerId", "customer_id"]) ??
      pickNumber(input, ["organisationId", "organisation_id"]);

    let clientId = explicitClientId;
    let resolvedCustomerName: string | undefined;

    if (!clientId && query) {
      const customerLookup = await this.lookupHaloCustomers(baseUrl, accessToken, query, 10);
      const matchedCustomer = customerLookup.find((customer) =>
        [
          pickString(customer, ["name", "client_name"]),
          pickString(customer, ["reference", "client_reference", "ref"]),
          pickString(customer, ["organisation_name", "customer_name"])
        ].some((candidate) => textMatches(candidate, query))
      );

      clientId = matchedCustomer ? pickNumber(matchedCustomer, ["id", "client_id"]) : undefined;
      resolvedCustomerName = matchedCustomer
        ? pickString(matchedCustomer, ["name", "client_name", "organisation_name", "customer_name"])
        : undefined;
    }

    const url = new URL(`${baseUrl}/api/tickets`);
    url.searchParams.set("count", "50");
    url.searchParams.set("includeclosed", "false");
    if (clientId) {
      url.searchParams.set("client_id", String(clientId));
    } else if (query) {
      url.searchParams.set("search", query);
    }

    const response = await haloFetch(url, {
      headers: buildHaloHeaders(accessToken)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HaloPSA tickets request failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as HaloTicketRecord[] | { tickets?: HaloTicketRecord[] };
    const tickets = Array.isArray(payload) ? payload : (payload.tickets ?? []);

    const openTickets = tickets
      .filter(isTicketOpen)
      .filter((ticket) => {
        if (!clientId) {
          return true;
        }

        const ticketClientId = pickNumber(ticket, ["client_id", "clientid", "organisation_id", "customer_id"]);
        if (ticketClientId && ticketClientId === clientId) {
          return true;
        }

        const ticketCustomerName = pickString(ticket, ["client_name", "customer_name", "organisation_name"]);
        return Boolean(resolvedCustomerName && ticketCustomerName === resolvedCustomerName);
      })
      .slice(0, 25);

    return {
      summary:
        openTickets.length > 0
          ? `Found ${openTickets.length} open HaloPSA tickets${resolvedCustomerName ? ` for ${resolvedCustomerName}` : ""}. Results include ticket id, summary, status, customer, priority, and last action time.`
          : `No open HaloPSA tickets found${resolvedCustomerName ? ` for ${resolvedCustomerName}` : ""}.`,
      data: openTickets.map((ticket) => ({
        id: pickNumber(ticket, ["id", "ticket_id", "TicketID"]),
        summary: pickString(ticket, ["summary", "subject", "title"]) ?? "Untitled ticket",
        status: pickString(ticket, ["status_name", "status", "ticketstatus"]),
        customer: pickString(ticket, ["client_name", "customer_name", "organisation_name"]),
        priority: pickString(ticket, ["priority_name", "priority"]),
        lastActionAt: pickString(ticket, ["last_action_date", "lastupdated", "dateupdated"]),
        raw: ticket
      })),
      source: "halopsa"
    };
  }

  private async getHaloCustomerOverview(baseUrl: string, accessToken: string, input: Record<string, unknown>) {
    const query = typeof input.query === "string" ? input.query.trim() : "";
    if (!query) {
      throw new Error("get_customer_overview requires a customer query");
    }

    const customers = await this.lookupHaloCustomers(baseUrl, accessToken, query, 10);
    const matchedCustomer =
      customers.find((customer) =>
        [
          pickString(customer, ["name", "client_name"]),
          pickString(customer, ["reference", "client_reference", "ref"]),
          pickString(customer, ["organisation_name", "customer_name"])
        ].some((candidate) => textMatches(candidate, query))
      ) ?? customers[0];

    if (!matchedCustomer) {
      return {
        summary: `No HaloPSA customer matched ${query}.`,
        data: [],
        source: "halopsa"
      };
    }

    const customerId = pickNumber(matchedCustomer, ["id", "client_id"]);
    const customerName =
      pickString(matchedCustomer, ["name", "client_name", "organisation_name", "customer_name"]) ?? query;
    const tickets = await this.listOpenHaloTickets(baseUrl, accessToken, {
      client_id: customerId,
      query: customerName
    });

    return {
      summary: `Loaded HaloPSA customer overview for ${customerName}. Result includes core customer fields and recent open ticket activity.`,
      data: [
        {
          customer: {
            id: customerId,
            name: customerName,
            reference: pickString(matchedCustomer, ["reference", "client_reference", "ref"]),
            email: pickString(matchedCustomer, ["email", "main_email"]),
            phone: pickString(matchedCustomer, ["phone", "main_phone"]),
            raw: matchedCustomer
          },
          openTicketCount: tickets.data.length,
          recentTickets: tickets.data
        }
      ],
      source: "halopsa"
    };
  }

  private async lookupHaloCustomers(baseUrl: string, accessToken: string, query: string, count = 25) {
    const url = new URL(`${baseUrl}/api/client`);
    url.searchParams.set("search", query);
    url.searchParams.set("count", String(count));

    const response = await haloFetch(url, {
      headers: buildHaloHeaders(accessToken)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HaloPSA customer request failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as HaloClientRecord[] | { clients?: HaloClientRecord[] };
    return Array.isArray(payload) ? payload : (payload.clients ?? []);
  }

  private async listHaloTicketActions(baseUrl: string, accessToken: string, input: Record<string, unknown>) {
    const rawId = input.id ?? input.ticketId ?? input.ticket_id ?? input.query;
    const ticketId = typeof rawId === "number" || typeof rawId === "string" ? String(rawId).trim() : undefined;
    if (!ticketId) {
      throw new Error("list_ticket_actions requires a ticket id");
    }

    const url = new URL(`${baseUrl}/api/actions`);
    url.searchParams.set("count", "50");
    url.searchParams.set("ticket_id", ticketId);

    const response = await haloFetch(url, {
      headers: buildHaloHeaders(accessToken)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HaloPSA actions request failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as unknown;
    const actions = normalizeCollectionPayload(payload, ["actions"]).slice(0, 50);

    return {
      summary:
        actions.length > 0
          ? `Loaded ${actions.length} HaloPSA actions for ticket ${ticketId}. Results include agent, note text, action type, and created time.`
          : `No HaloPSA actions found for ticket ${ticketId}.`,
      data: actions.map((action) => ({
        id: pickNumber(action, ["id", "action_id"]),
        ticketId: pickNumber(action, ["ticket_id", "ticketid"]),
        agent: pickString(action, ["agent_name", "agent", "who"]),
        note: pickString(action, ["note", "note_html", "outcome", "details"]),
        actionType: pickString(action, ["action_type", "type", "category"]),
        createdAt: pickString(action, ["datecreated", "created_at", "datetime"]),
        raw: action
      })),
      source: "halopsa"
    };
  }

  private async getHaloTicketWithActions(baseUrl: string, accessToken: string, input: Record<string, unknown>) {
    const ticket = await this.getHaloTicket(baseUrl, accessToken, input);
    const ticketRecord = ticket.data[0] as Record<string, unknown> | undefined;
    const resolvedTicketId =
      pickNumber(ticketRecord ?? {}, ["id"]) ??
      pickNumber(input, ["id", "ticketId", "ticket_id"]) ??
      (typeof input.query === "string" && !Number.isNaN(Number(input.query.trim())) ? Number(input.query.trim()) : undefined);

    const actions = resolvedTicketId
      ? await this.listHaloTicketActions(baseUrl, accessToken, { ticket_id: resolvedTicketId })
      : { summary: "No ticket actions loaded.", data: [], source: "halopsa" };

    return {
      summary: `Loaded HaloPSA ticket with recent actions. Result includes the main ticket fields and recent internal updates or actions.`,
      data: [
        {
          ticket: ticket.data[0] ?? null,
          recentActions: actions.data
        }
      ],
      source: "halopsa"
    };
  }

  private async searchHaloProjects(baseUrl: string, accessToken: string, input: Record<string, unknown>) {
    const query = typeof input.query === "string" ? input.query.trim() : "";
    const url = new URL(`${baseUrl}/api/projects`);
    url.searchParams.set("count", "25");
    if (query) {
      url.searchParams.set("search", query);
    }

    const response = await haloFetch(url, {
      headers: buildHaloHeaders(accessToken)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HaloPSA projects request failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as unknown;
    const projects = normalizeCollectionPayload(payload, ["projects"]).slice(0, 25);

    return {
      summary:
        projects.length > 0
          ? `Found ${projects.length} HaloPSA projects. Results include project id, summary, status, customer, and manager where available.`
          : "No HaloPSA projects matched that query.",
      data: projects.map((project) => ({
        id: pickNumber(project, ["id", "project_id", "ticket_id"]),
        summary: pickString(project, ["summary", "name", "title"]),
        status: pickString(project, ["status_name", "status"]),
        customer: pickString(project, ["client_name", "customer_name", "organisation_name"]),
        manager: pickString(project, ["project_manager", "agent_name", "owner_name"]),
        raw: project
      })),
      source: "halopsa"
    };
  }

  private async findHaloContact(baseUrl: string, accessToken: string, input: Record<string, unknown>) {
    const query = typeof input.query === "string" ? input.query.trim() : "";
    if (!query) {
      throw new Error("find_contact requires a query");
    }

    const url = new URL(`${baseUrl}/api/users`);
    url.searchParams.set("count", "25");
    url.searchParams.set("search", query);

    const response = await haloFetch(url, {
      headers: buildHaloHeaders(accessToken)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HaloPSA contacts request failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as unknown;
    const contacts = normalizeCollectionPayload(payload, ["users", "contacts"]).slice(0, 25);

    return {
      summary:
        contacts.length > 0
          ? `Found ${contacts.length} HaloPSA contacts. Results include contact id, name, email, phone, and associated customer or site where available.`
          : "No HaloPSA contacts matched that query.",
      data: contacts.map((contact) => ({
        id: pickNumber(contact, ["id", "user_id", "contact_id"]),
        name: pickString(contact, ["name", "display_name", "fullname", "full_name"]),
        email: pickString(contact, ["email", "emailaddress", "email_address"]),
        phone: pickString(contact, ["phone", "mobilephone", "telephone"]),
        customer: pickString(contact, ["client_name", "organisation_name", "site_name"]),
        raw: contact
      })),
      source: "halopsa"
    };
  }

  private async searchHaloDocuments(baseUrl: string, accessToken: string, input: Record<string, unknown>) {
    const query = typeof input.query === "string" ? input.query.trim() : "";
    if (!query) {
      throw new Error("search_documents requires a query");
    }

    const url = new URL(`${baseUrl}/api/kbarticle`);
    url.searchParams.set("count", "25");
    url.searchParams.set("search", query);

    const response = await fetch(url, {
      headers: buildHaloHeaders(accessToken)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HaloPSA knowledge request failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as unknown;
    const documents = normalizeCollectionPayload(payload, ["articles", "kbarticles", "knowledgebase"]).slice(0, 25);

    return {
      summary:
        documents.length > 0
          ? `Found ${documents.length} HaloPSA knowledge articles. Results include article id, title, category, excerpt, and last updated time where available.`
          : "No HaloPSA knowledge articles matched that query.",
      data: documents.map((document) => ({
        id: pickNumber(document, ["id", "kbarticle_id", "article_id"]),
        title: pickString(document, ["title", "summary", "name"]),
        category: pickString(document, ["category", "category_name"]),
        excerpt: pickString(document, ["excerpt", "summary_text", "short_description"]),
        updatedAt: pickString(document, ["dateupdated", "updated_at", "lastmodified"]),
        raw: document
      })),
      source: "halopsa"
    };
  }

  private async listHaloDevicesForSite(baseUrl: string, accessToken: string, input: Record<string, unknown>) {
    const rawSite = input.siteId ?? input.site_id ?? input.query;
    const siteRef = typeof rawSite === "number" || typeof rawSite === "string" ? String(rawSite).trim() : "";
    if (!siteRef) {
      throw new Error("list_devices_for_site requires a site id or search query");
    }

    let siteId = siteRef;
    if (Number.isNaN(Number(siteRef))) {
      const siteUrl = new URL(`${baseUrl}/api/site`);
      siteUrl.searchParams.set("count", "10");
      siteUrl.searchParams.set("search", siteRef);
      const siteResponse = await haloFetch(siteUrl, {
        headers: buildHaloHeaders(accessToken)
      });

      if (!siteResponse.ok) {
        const body = await siteResponse.text();
        throw new Error(`HaloPSA site lookup failed (${siteResponse.status}): ${body}`);
      }

      const sitePayload = (await siteResponse.json()) as unknown;
      const sites = normalizeCollectionPayload(sitePayload, ["sites"]);
      const site = sites[0];
      if (!site) {
        throw new Error(`No HaloPSA site matched ${siteRef}`);
      }

      siteId = String(pickNumber(site, ["id", "site_id"]) ?? "");
    }

    const assetUrl = new URL(`${baseUrl}/api/assets`);
    assetUrl.searchParams.set("count", "50");
    assetUrl.searchParams.set("site_id", siteId);

    const response = await haloFetch(assetUrl, {
      headers: buildHaloHeaders(accessToken)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HaloPSA assets request failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as unknown;
    const assets = normalizeCollectionPayload(payload, ["assets", "devices"]).slice(0, 50);

    return {
      summary:
        assets.length > 0
          ? `Found ${assets.length} HaloPSA devices for site ${siteId}. Results include asset id, name, type, site, status, and serial number where available.`
          : `No HaloPSA devices found for site ${siteId}.`,
      data: assets.map((asset) => ({
        id: pickNumber(asset, ["id", "asset_id"]),
        name: pickString(asset, ["name", "inventory_number", "hostname"]),
        type: pickString(asset, ["assettype", "asset_type", "type"]),
        site: pickString(asset, ["site_name", "location_name"]),
        status: pickString(asset, ["status_name", "status"]),
        serialNumber: pickString(asset, ["serial_number", "serialno"]),
        raw: asset
      })),
      source: "halopsa"
    };
  }

  private async getRecentHaloInvoices(baseUrl: string, accessToken: string, input: Record<string, unknown>) {
    const countValue = typeof input.count === "number" ? input.count : typeof input.count === "string" ? Number(input.count) : 25;
    const count = Number.isFinite(countValue) ? Math.min(Math.max(countValue, 1), 50) : 25;
    const url = new URL(`${baseUrl}/api/invoices`);
    url.searchParams.set("count", String(count));

    const response = await haloFetch(url, {
      headers: buildHaloHeaders(accessToken)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HaloPSA invoices request failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as unknown;
    const invoices = normalizeCollectionPayload(payload, ["invoices"]).slice(0, count);

    return {
      summary:
        invoices.length > 0
          ? `Loaded ${invoices.length} recent HaloPSA invoices. Results include invoice id, reference, customer, status, total, and issued date where available.`
          : "No recent HaloPSA invoices found.",
      data: invoices.map((invoice) => ({
        id: pickNumber(invoice, ["id", "invoice_id"]),
        reference: pickString(invoice, ["invoice_number", "reference", "ref"]),
        customer: pickString(invoice, ["client_name", "customer_name"]),
        status: pickString(invoice, ["status_name", "status"]),
        total: pickString(invoice, ["total", "amount", "grand_total"]),
        issuedAt: pickString(invoice, ["date", "issued_at", "invoice_date"]),
        raw: invoice
      })),
      source: "halopsa"
    };
  }

  private async createDraftHaloTicket(baseUrl: string, accessToken: string, input: Record<string, unknown>) {
    const summary = typeof input.summary === "string" ? input.summary.trim() : typeof input.query === "string" ? input.query.trim() : "";
    if (!summary) {
      throw new Error("create_draft_ticket requires a summary");
    }

    const payload = {
      summary,
      details: typeof input.details === "string" ? input.details : undefined,
      client_id: pickNumber(input, ["clientId", "client_id"]),
      site_id: pickNumber(input, ["siteId", "site_id"]),
      user_id: pickNumber(input, ["contactId", "contact_id", "userId", "user_id"]),
      tickettype_id: pickNumber(input, ["ticketTypeId", "ticket_type_id"]),
      priority_id: pickNumber(input, ["priorityId", "priority_id"])
    };

    const response = await haloFetch(`${baseUrl}/api/tickets`, {
      method: "POST",
      headers: buildHaloJsonHeaders(accessToken),
      body: JSON.stringify(payload),
      bodyPreview: payload
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HaloPSA ticket creation failed (${response.status}): ${body}`);
    }

    const ticket = (await response.json()) as HaloGenericRecord;
    return {
      summary: "Created a draft HaloPSA ticket. Result includes the new ticket id, summary, and current status.",
      data: [
        {
          id: pickNumber(ticket, ["id", "ticket_id", "TicketID"]),
          summary: pickString(ticket, ["summary", "subject", "title"]),
          status: pickString(ticket, ["status_name", "status", "ticketstatus"]),
          raw: ticket
        }
      ],
      source: "halopsa"
    };
  }

  private async addHaloInternalNote(baseUrl: string, accessToken: string, input: Record<string, unknown>) {
    const rawId =
      input.id ??
      input.ticketId ??
      input.ticket_id ??
      input.ticket ??
      input.ticketNumber ??
      input.ticket_number;
    let ticketId = typeof rawId === "number" || typeof rawId === "string" ? String(rawId).trim() : undefined;
    let note =
      typeof input.note === "string"
        ? input.note.trim()
        : typeof input.message === "string"
          ? input.message.trim()
          : typeof input.text === "string"
            ? input.text.trim()
            : typeof input.content === "string"
              ? input.content.trim()
              : typeof input.comment === "string"
                ? input.comment.trim()
                : typeof input.body === "string"
                  ? input.body.trim()
                  : "";

    if ((!ticketId || !note) && typeof input.query === "string") {
      const query = input.query.trim();

      if (!ticketId) {
        const ticketMatch = query.match(/ticket\s+#?0*([0-9]+)/i);
        if (ticketMatch) {
          ticketId = ticketMatch[1];
        }
      }

      if (!note) {
        note = query
          .replace(/add\s+(an?\s+)?internal\s+note\s+(to|for)\s+ticket\s+#?0*[0-9]+/i, "")
          .replace(/ticket\s+#?0*[0-9]+/i, "")
          .trim();
      }
    }

    if (!ticketId || !note) {
      throw new Error("add_internal_note requires a ticket id and note");
    }

    const actionPayload = [
      {
        ticket_id: ticketId,
        outcome: "Private Note",
        note,
        note_html: note,
        hiddenfromuser: true
      }
    ];

    const response = await haloFetch(`${baseUrl}/api/actions`, {
      method: "POST",
      headers: buildHaloJsonHeaders(accessToken),
      body: JSON.stringify(actionPayload),
      bodyPreview: actionPayload
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HaloPSA action creation failed (${response.status}): ${body}`);
    }

    const action = (await response.json()) as HaloGenericRecord;
    return {
      summary: `Added an internal HaloPSA note to ticket ${ticketId}. Result includes the created action id and stored note text.`,
      data: [
        {
          id: pickNumber(action, ["id", "action_id"]),
          ticketId: pickNumber(action, ["ticket_id", "ticketid"]),
          note: pickString(action, ["note", "note_html", "outcome"]) ?? note,
          raw: action
        }
      ],
      source: "halopsa"
    };
  }

  private async getHaloTicket(baseUrl: string, accessToken: string, input: Record<string, unknown>) {
    const rawId = input.id ?? input.ticketId ?? input.ticket_id ?? input.query;
    const id = typeof rawId === "number" || typeof rawId === "string" ? String(rawId).trim() : undefined;
    if (!id) {
      throw new Error("get_ticket requires an id");
    }

    let ticket: HaloTicketRecord | undefined;

    const directResponse = await haloFetch(`${baseUrl}/api/tickets/${id}`, {
      headers: buildHaloHeaders(accessToken)
    });

    if (directResponse.ok) {
      ticket = (await directResponse.json()) as HaloTicketRecord;
    } else {
      const searchUrl = new URL(`${baseUrl}/api/tickets`);
      searchUrl.searchParams.set("search", id);
      searchUrl.searchParams.set("count", "25");

      const searchResponse = await haloFetch(searchUrl, {
        headers: buildHaloHeaders(accessToken)
      });

      if (!searchResponse.ok) {
        const body = await searchResponse.text();
        throw new Error(`HaloPSA ticket request failed (${searchResponse.status}): ${body}`);
      }

      const payload = (await searchResponse.json()) as HaloTicketRecord[] | { tickets?: HaloTicketRecord[] };
      const tickets = Array.isArray(payload) ? payload : (payload.tickets ?? []);
      ticket = tickets.find((candidate) => ticketMatchesIdentifier(candidate, id));

      if (!ticket) {
        const directBody = await directResponse.text();
        throw new Error(`HaloPSA ticket request failed (${directResponse.status}): ${directBody}`);
      }
    }

    return {
      summary: `Loaded HaloPSA ticket ${id}. Result includes the ticket summary, status, customer, priority, and raw Halo details.`,
      data: [
        {
          id: pickNumber(ticket, ["id", "ticket_id", "TicketID"]),
          summary: pickString(ticket, ["summary", "subject", "title"]),
          status: pickString(ticket, ["status_name", "status", "ticketstatus"]),
          customer: pickString(ticket, ["client_name", "customer_name", "organisation_name"]),
          priority: pickString(ticket, ["priority_name", "priority"]),
          details: ticket
        }
      ],
      source: "halopsa"
    };
  }

  private async findHaloCustomer(baseUrl: string, accessToken: string, input: Record<string, unknown>) {
    const query = typeof input.query === "string" ? input.query : undefined;
    if (!query) {
      throw new Error("find_customer requires a query");
    }

    const clients = await this.lookupHaloCustomers(baseUrl, accessToken, query, 25);

    return {
      summary:
        clients.length > 0
          ? `Found ${clients.length} HaloPSA customers. Results include customer id, name, reference, email, and phone where available.`
          : "No HaloPSA customers matched that query.",
      data: clients.map((client) => ({
        id: pickNumber(client, ["id", "client_id"]),
        name: pickString(client, ["name", "client_name"]),
        reference: pickString(client, ["reference", "client_reference", "ref"]),
        email: pickString(client, ["email", "main_email"]),
        phone: pickString(client, ["phone", "main_phone"]),
        raw: client
      })),
      source: "halopsa"
    };
  }

  private readOptionalString(input: ConnectorConfigInput, key: string) {
    const value = input[key];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
  }

  private normalizeApiUrl(value: string | undefined) {
    return value?.replace(/\/$/, "");
  }

  private normalizeHaloBaseUrl(value: string | undefined) {
    const normalized = this.normalizeApiUrl(value);
    if (!normalized) {
      return normalized;
    }

    return normalized.replace(/\/auth(?:\/authorize|\/token)?$/i, "");
  }

  private normalizeHaloRedirectUri(value: string | undefined) {
    const normalized = this.normalizeApiUrl(value);
    if (!normalized) {
      return undefined;
    }

    return normalized.endsWith("/oauth/halopsa/callback") ? normalized : `${normalized}/oauth/halopsa/callback`;
  }

  private normalizeNinjaOneBaseUrl(value: string | undefined) {
    const normalized = this.normalizeApiUrl(value);
    if (!normalized) {
      return normalized;
    }

    return normalized.replace(/\/ws\/oauth(?:\/authorize|\/token)?$/i, "");
  }

  private normalizeNinjaOneRedirectUri(value: string | undefined) {
    const normalized = this.normalizeApiUrl(value);
    if (!normalized) {
      return undefined;
    }

    return normalized.endsWith("/oauth/ninjaone/callback") ? normalized : `${normalized}/oauth/ninjaone/callback`;
  }

  private parseScopes(value: unknown, fallback: string[]) {
    if (Array.isArray(value)) {
      const scopes = value.map((item) => String(item).trim()).filter(Boolean);
      return scopes.length > 0 ? scopes : fallback;
    }

    if (typeof value === "string") {
      const scopes = value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
      return scopes.length > 0 ? scopes : fallback;
    }

    return fallback;
  }

  private getDefaultHaloScopes() {
    return (process.env.HALOPSA_SCOPES ?? "read:tickets read:customers read:actions offline_access")
      .split(/\s+/)
      .filter(Boolean);
  }

  private buildConnectorConfig(provider: ProviderName, input: ConnectorConfigInput, existing: StoredConnectorConfig = {}) {
    const rawApiUrl = this.readOptionalString(input, "apiUrl");
    const apiUrl =
      provider === "halopsa"
        ? this.normalizeHaloBaseUrl(rawApiUrl) ?? this.normalizeHaloBaseUrl(existing.apiUrl)
        : this.normalizeApiUrl(rawApiUrl) ?? existing.apiUrl;
    const clientId = this.readOptionalString(input, "clientId") ?? existing.clientId;
    const rawSecret = this.readOptionalString(input, "clientSecret");
    const clientSecretEncrypted = rawSecret ? this.encryption.encrypt(rawSecret) : existing.clientSecretEncrypted;

    switch (provider) {
      case "halopsa":
        return {
          apiUrl,
          authUrl:
            this.normalizeHaloBaseUrl(this.readOptionalString(input, "authUrl"))
            ?? this.normalizeHaloBaseUrl(existing.authUrl)
            ?? apiUrl,
          clientId,
          clientSecretEncrypted,
          redirectUri: this.normalizeHaloRedirectUri(this.readOptionalString(input, "redirectUri") ?? existing.redirectUri)
            ?? this.normalizeHaloRedirectUri(process.env.HALOPSA_REDIRECT_URI)
            ?? `${config.apiUrl}/oauth/halopsa/callback`,
          scopes: this.parseScopes(input.scopes, existing.scopes ?? this.getDefaultHaloScopes())
        } satisfies StoredConnectorConfig;
      case "ninjaone":
        return {
          apiUrl,
          authUrl:
            this.normalizeNinjaOneBaseUrl(this.readOptionalString(input, "authUrl"))
            ?? this.normalizeNinjaOneBaseUrl(existing.authUrl)
            ?? apiUrl,
          clientId,
          clientSecretEncrypted,
          redirectUri:
            this.normalizeNinjaOneRedirectUri(this.readOptionalString(input, "redirectUri") ?? existing.redirectUri)
            ?? this.normalizeNinjaOneRedirectUri(process.env.NINJAONE_REDIRECT_URI)
            ?? `${config.apiUrl}/oauth/ninjaone/callback`,
          scopes: this.parseScopes(input.scopes, existing.scopes ?? ["monitoring", "devices", "organizations"])
        } satisfies StoredConnectorConfig;
      case "cipp":
        return {
          apiUrl,
          tenantId: this.readOptionalString(input, "tenantId") ?? existing.tenantId,
          appId: clientId,
          clientId,
          clientSecretEncrypted
        } satisfies StoredConnectorConfig;
      case "n8n":
        return {
          apiUrl,
          clientId,
          clientSecretEncrypted,
          webhookBaseUrl: this.normalizeApiUrl(this.readOptionalString(input, "redirectUri")) ?? existing.webhookBaseUrl
        } satisfies StoredConnectorConfig;
      default:
        return existing;
    }
  }

  private getHaloBaseUrlForAccount(account: ConnectedAccountRecord) {
    const metadata = (account.metadataJson ?? {}) as StoredConnectorConfig;
    const baseUrl = this.normalizeHaloBaseUrl(metadata.apiUrl ?? process.env.HALOPSA_BASE_URL ?? process.env.HALOPSA_URL);
    if (!baseUrl) {
      throw new Error("Set HaloPSA API URL in connector settings or HALOPSA_BASE_URL in the environment");
    }

    return baseUrl;
  }

  private async resolveHaloConfig(tenantId: string) {
    const stored = ((await this.configStore.get(tenantId, "halopsa"))?.configJson ?? {}) as StoredConnectorConfig;
    const apiUrl = this.normalizeHaloBaseUrl(stored.apiUrl ?? process.env.HALOPSA_BASE_URL ?? process.env.HALOPSA_URL);
    const authUrl = this.normalizeHaloBaseUrl(stored.authUrl) ?? apiUrl;
    const clientId = stored.clientId ?? process.env.HALOPSA_CLIENT_ID;
    const clientSecret =
      stored.clientSecretEncrypted ? this.encryption.decrypt(stored.clientSecretEncrypted) : process.env.HALOPSA_CLIENT_SECRET;
    const redirectUri =
      this.normalizeHaloRedirectUri(stored.redirectUri)
      ?? this.normalizeHaloRedirectUri(process.env.HALOPSA_REDIRECT_URI)
      ?? `${config.apiUrl}/oauth/halopsa/callback`;
    const scopes = stored.scopes ?? this.getDefaultHaloScopes();

    if (!apiUrl || !authUrl || !clientId || !clientSecret) {
      throw new Error("HaloPSA requires API URL, client ID, and client secret in connector settings before connecting");
    }

    return { apiUrl, authUrl, clientId, clientSecret, redirectUri, scopes };
  }

  private async resolveN8nConfig(tenantId: string) {
    const stored = ((await this.configStore.get(tenantId, "n8n"))?.configJson ?? {}) as StoredConnectorConfig;
    const apiUrl = this.normalizeApiUrl(stored.apiUrl);
    const apiKey = stored.clientSecretEncrypted ? this.encryption.decrypt(stored.clientSecretEncrypted) : undefined;

    if (!apiUrl || !apiKey) {
      throw new Error("n8n requires API URL and bearer token/API key in connector settings");
    }

    return {
      apiUrl: apiUrl.replace(/\/$/, ""),
      apiKey
    };
  }

  private async resolveNinjaOneConfig(tenantId: string) {
    const stored = ((await this.configStore.get(tenantId, "ninjaone"))?.configJson ?? {}) as StoredConnectorConfig;
    const apiUrl = this.normalizeNinjaOneBaseUrl(stored.apiUrl ?? process.env.NINJAONE_BASE_URL ?? process.env.NINJAONE_URL);
    const authUrl = this.normalizeNinjaOneBaseUrl(stored.authUrl ?? process.env.NINJAONE_AUTH_URL) ?? apiUrl;
    const clientId = stored.clientId ?? process.env.NINJAONE_CLIENT_ID;
    const clientSecret =
      stored.clientSecretEncrypted ? this.encryption.decrypt(stored.clientSecretEncrypted) : process.env.NINJAONE_CLIENT_SECRET;
    const redirectUri =
      this.normalizeNinjaOneRedirectUri(stored.redirectUri)
      ?? this.normalizeNinjaOneRedirectUri(process.env.NINJAONE_REDIRECT_URI)
      ?? `${config.apiUrl}/oauth/ninjaone/callback`;
    const scopes = stored.scopes ?? (process.env.NINJAONE_SCOPES ?? "monitoring devices organizations").split(/\s+/).filter(Boolean);

    if (!apiUrl || !authUrl || !clientId || !clientSecret) {
      throw new Error("NinjaOne requires API URL, client ID, and client secret in connector settings before connecting");
    }

    return { apiUrl, authUrl, clientId, clientSecret, redirectUri, scopes };
  }

  private async exchangeHaloToken(
    haloConfig: { apiUrl: string; authUrl: string; clientId: string; clientSecret: string; redirectUri: string; scopes: string[] },
    params: URLSearchParams
  ) {
    const response = await haloFetch(`${haloConfig.authUrl}/auth/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body: params.toString(),
      bodyPreview: params.toString()
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

  private async exchangeNinjaOneToken(
    ninjaConfig: { apiUrl: string; authUrl: string; clientId: string; clientSecret: string; redirectUri: string; scopes: string[] },
    params: URLSearchParams
  ) {
    const response = await fetch(`${ninjaConfig.authUrl}/ws/oauth/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json"
      },
      body: params.toString()
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`NinjaOne token exchange failed (${response.status}): ${body}`);
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
      scopes: payload.scope?.split(/\s+/).filter(Boolean)
    };
  }

  private async refreshHaloAccountIfNeeded(account: ConnectedAccountRecord): Promise<ConnectedAccountRecord> {
    if (!account.expiresAt || account.expiresAt.getTime() > Date.now() + 60_000) {
      return account;
    }

    if (!account.refreshTokenEncrypted) {
      throw new Error(`No refresh path configured for ${account.provider}`);
    }

    try {
      const haloConfig = await this.resolveHaloConfig(account.tenantId);
      const refreshToken = this.encryption.decrypt(account.refreshTokenEncrypted);
      const tokens = await this.exchangeHaloToken(
        haloConfig,
        new URLSearchParams({
          grant_type: "refresh_token",
          client_id: haloConfig.clientId,
          client_secret: haloConfig.clientSecret,
          refresh_token: refreshToken
        })
      );

      return {
        ...account,
        accessTokenEncrypted: this.encryption.encrypt(tokens.accessToken),
        refreshTokenEncrypted: tokens.refreshToken ? this.encryption.encrypt(tokens.refreshToken) : account.refreshTokenEncrypted,
        expiresAt: tokens.expiresAt ?? account.expiresAt,
        status: "ACTIVE",
        lastError: undefined
      };
    } catch (error) {
      return {
        ...account,
        status: "ERROR",
        lastError: error instanceof Error ? error.message : "Unknown refresh error"
      };
    }
  }
}
