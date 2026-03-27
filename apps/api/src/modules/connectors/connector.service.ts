import crypto from "node:crypto";

import Redis from "ioredis";
import jwt from "jsonwebtoken";

import { getProviderRegistry } from "@nexian/connectors";
import type { ConnectedAccountRecord, ProviderName } from "@nexian/core/domain/models";
import { TokenEncryptionService } from "@nexian/core/security/encryption";

import { buildAppConfig } from "../../common/config/env";
import { createOAuthState, verifyOAuthState } from "../../common/security/oauth-state";
import { ConnectedAccountStore } from "../../common/store/connected-account.store";
import type { AuditService } from "../audit/audit.service";

import { TokenRefreshService } from "./token-refresh.service";

const config = buildAppConfig();

type HaloTicketRecord = Record<string, unknown>;
type HaloClientRecord = Record<string, unknown>;

function getHaloBaseUrl() {
  const value = process.env.HALOPSA_BASE_URL ?? process.env.HALOPSA_URL;
  if (!value) {
    throw new Error("Set HALOPSA_BASE_URL in your environment to your HaloPSA instance URL");
  }

  return value.replace(/\/$/, "");
}

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

export class ConnectorService {
  private readonly registry = getProviderRegistry();
  private readonly encryption = TokenEncryptionService.fromBase64(config.tokenEncryptionKeyBase64);
  private readonly redis = new Redis(config.redisUrl, { lazyConnect: true });
  private readonly refreshService = new TokenRefreshService(this.redis, this.encryption);
  private readonly store = ConnectedAccountStore.createDefault();

  constructor(private readonly auditService: AuditService) {}

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

  beginOAuth(provider: ProviderName, tenantId: string, userId: string, returnTo?: string) {
    const adapter = this.registry.get(provider);
    if (!adapter?.supportsOAuth || !adapter.getAuthorizationUrl) {
      throw new Error(`Provider ${provider} does not support OAuth`);
    }

    const state = createOAuthState({ provider, tenantId, userId, returnTo }, config.oauthStateSigningSecret);
    return { authorizationUrl: adapter.getAuthorizationUrl(state) };
  }

  async finishOAuth(provider: ProviderName, code: string, state: string) {
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

  async ensureFreshAccount(account: ConnectedAccountRecord) {
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

    switch (toolName) {
      case "list_open_tickets":
        return this.listOpenHaloTickets(accessToken, input);
      case "get_ticket":
        return this.getHaloTicket(accessToken, input);
      case "find_customer":
        return this.findHaloCustomer(accessToken, input);
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

  private async listOpenHaloTickets(accessToken: string, input: Record<string, unknown>) {
    const query = typeof input.query === "string" ? input.query : undefined;
    const url = new URL(`${getHaloBaseUrl()}/api/tickets`);
    url.searchParams.set("count", "50");
    url.searchParams.set("includeclosed", "false");
    if (query) {
      url.searchParams.set("search", query);
    }

    const response = await fetch(url, {
      headers: buildHaloHeaders(accessToken)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HaloPSA tickets request failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as HaloTicketRecord[] | { tickets?: HaloTicketRecord[] };
    const tickets = Array.isArray(payload) ? payload : (payload.tickets ?? []);
    const openTickets = tickets.filter(isTicketOpen).slice(0, 25);

    return {
      summary: openTickets.length > 0 ? `Found ${openTickets.length} open HaloPSA tickets.` : "No open HaloPSA tickets found.",
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

  private async getHaloTicket(accessToken: string, input: Record<string, unknown>) {
    const id = typeof input.id === "number" || typeof input.id === "string" ? String(input.id) : undefined;
    if (!id) {
      throw new Error("get_ticket requires an id");
    }

    const response = await fetch(`${getHaloBaseUrl()}/api/tickets/${id}`, {
      headers: buildHaloHeaders(accessToken)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HaloPSA ticket request failed (${response.status}): ${body}`);
    }

    const ticket = (await response.json()) as HaloTicketRecord;
    return {
      summary: `Loaded HaloPSA ticket ${id}.`,
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

  private async findHaloCustomer(accessToken: string, input: Record<string, unknown>) {
    const query = typeof input.query === "string" ? input.query : undefined;
    if (!query) {
      throw new Error("find_customer requires a query");
    }

    const url = new URL(`${getHaloBaseUrl()}/api/client`);
    url.searchParams.set("search", query);
    url.searchParams.set("count", "25");

    const response = await fetch(url, {
      headers: buildHaloHeaders(accessToken)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HaloPSA customer request failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as HaloClientRecord[] | { clients?: HaloClientRecord[] };
    const clients = Array.isArray(payload) ? payload : (payload.clients ?? []);

    return {
      summary: clients.length > 0 ? `Found ${clients.length} HaloPSA customers.` : "No HaloPSA customers matched that query.",
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
}
