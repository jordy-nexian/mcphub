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
  const closedCandidates = [
    record.closed,
    record.isclosed,
    record.isClosed,
    record.inactive,
    record.isinactive
  ];
  for (const candidate of closedCandidates) {
    if (typeof candidate === "boolean") {
      if (candidate) {
        return false;
      }
    }
    if (typeof candidate === "number") {
      if (candidate === 1) {
        return false;
      }
    }
    if (typeof candidate === "string") {
      const normalized = candidate.trim().toLowerCase();
      if (["true", "1", "yes", "closed", "resolved", "completed", "cancelled", "canceled"].includes(normalized)) {
        return false;
      }
    }
  }

  const statusName = pickString(record, [
    "status_name",
    "status",
    "ticketstatus",
    "statusName",
    "ticket_status",
    "workflow_status"
  ])?.toLowerCase();
  if (!statusName) {
    return true;
  }

  return !["closed", "resolved", "completed", "cancelled", "canceled", "inactive"].some((keyword) =>
    statusName.includes(keyword)
  );
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

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function extractMeaningfulQuery(query: string | undefined, noisePatterns: RegExp[] = []) {
  if (!query) {
    return "";
  }

  let normalized = normalizeWhitespace(query.toLowerCase());
  for (const pattern of noisePatterns) {
    normalized = normalized.replace(pattern, " ");
  }

  normalized = normalized
    .replace(/\b(show|find|get|list|give me|tell me|search|lookup|for me|please)\b/g, " ")
    .replace(/[?.,]+/g, " ");

  return normalizeWhitespace(normalized);
}

function wantsOpenItems(input: Record<string, unknown>, query: string | undefined) {
  if (typeof input.includeClosed === "boolean") {
    return !input.includeClosed;
  }

  const normalized = query?.toLowerCase() ?? "";
  if (!normalized) {
    return true;
  }

  if (/\b(all|closed|resolved|completed|cancelled|canceled|archived)\b/.test(normalized)) {
    return false;
  }

  return /\b(open|active|outstanding|recent|current|live|in progress|in-progress)\b/.test(normalized) || true;
}

function isProjectOpen(record: HaloGenericRecord) {
  const statusName = pickString(record, ["status_name", "status", "project_status", "projectStatus"])?.toLowerCase();
  if (!statusName) {
    return true;
  }

  return !["closed", "completed", "cancelled", "canceled", "resolved", "archived"].some((keyword) =>
    statusName.includes(keyword)
  );
}

function normalizeIdentityToken(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildIdentityVariants(value: string) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return [];
  }

  const pieces = normalized
    .split(/[\s@._\\/-]+/)
    .map((piece) => piece.trim())
    .filter(Boolean);

  const joined = pieces.join("");
  const dashed = pieces.join("-");
  const underscored = pieces.join("_");
  const emailLocalPart = normalized.includes("@") ? normalized.split("@")[0] : "";
  const variants = new Set(
    [
      normalized,
      normalized.replace(/\s+/g, ""),
      joined,
      dashed,
      underscored,
      emailLocalPart,
      normalized.replace(/^.*\\/, ""),
      normalized.replace(/^.*\//, "")
    ]
      .map((candidate) => candidate.trim())
      .filter(Boolean)
  );

  if (pieces.length >= 2) {
    variants.add(`${pieces[0]}${pieces[pieces.length - 1]}`);
    variants.add(`${pieces[0]}.${pieces[pieces.length - 1]}`);
    variants.add(`${pieces[0]}_${pieces[pieces.length - 1]}`);
    variants.add(`${pieces[0]}-${pieces[pieces.length - 1]}`);
    variants.add(`${pieces[pieces.length - 1]}${pieces[0]}`);
    variants.add(`${pieces[0][0]}${pieces[pieces.length - 1]}`);
  }

  return [...variants];
}

function deviceMatchesUserHint(device: Record<string, unknown>, userHint: string) {
  if (!userHint) {
    return true;
  }

  const variants = buildIdentityVariants(userHint);
  const candidates = [
    pickString(device, ["lastLoggedInUser", "currentUser", "loggedInUser", "assignedUser", "userName", "username"]),
    pickString(device, ["primaryUser", "owner", "contactName", "user", "displayName", "loggedInUsername"]),
    pickString(device, ["email", "emailAddress", "userEmail"]),
    pickString(device, ["organizationName", "organisationName", "customerName"])
  ].filter(Boolean) as string[];

  return candidates.some((candidate) => {
    const loweredCandidate = candidate.toLowerCase();
    const normalizedCandidate = normalizeIdentityToken(candidate);
    return variants.some((variant) => {
      const loweredVariant = variant.toLowerCase();
      const normalizedVariant = normalizeIdentityToken(variant);
      return loweredCandidate.includes(loweredVariant) || normalizedCandidate.includes(normalizedVariant);
    });
  });
}

function extractUserHint(query: string | undefined) {
  if (!query) {
    return "";
  }

  const match =
    query.match(/\bdevices?\s+(?:for|used by|belonging to|assigned to)\s+(.+)$/i) ??
    query.match(/\bfor\s+(.+)$/i);

  return normalizeWhitespace(match?.[1] ?? "");
}

type ResolvedEntityHints = {
  userHints: string[];
  organizationHints: string[];
  emailHints: string[];
};

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
      const codeVerifier = crypto.randomBytes(32).toString("base64url");
      const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
      const state = createOAuthState({ provider, tenantId, userId, returnTo, codeVerifier }, config.oauthStateSigningSecret);
      const params = new URLSearchParams({
        client_id: ninjaConfig.clientId,
        redirect_uri: ninjaConfig.redirectUri,
        response_type: "code",
        scope: ninjaConfig.scopes.join(" "),
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
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
      const tokenParams = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: ninjaConfig.clientId,
        code,
        redirect_uri: ninjaConfig.redirectUri
      });
      if (payload.codeVerifier) {
        tokenParams.set("code_verifier", payload.codeVerifier);
      }
      if (ninjaConfig.clientSecret) {
        tokenParams.set("client_secret", ninjaConfig.clientSecret);
      }
      const tokens = await this.exchangeNinjaOneToken(ninjaConfig, tokenParams);
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

    if (provider.provider === "ninjaone") {
      return this.executeNinjaOneTool(tenantId, userId, roles, toolName, input);
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

  private async executeNinjaOneTool(tenantId: string, userId: string, roles: string[], toolName: string, input: Record<string, unknown>) {
    const account = (await this.store.findByTenantUser(tenantId, userId)).find(
      (candidate) => candidate.provider === "ninjaone" && candidate.status === "ACTIVE"
    );

    if (!account) {
      throw new Error(`No active NinjaOne account found for ${tenantId}/${userId}`);
    }

    const freshAccount = await this.ensureFreshAccount(account);
    const accessToken = this.encryption.decrypt(freshAccount.accessTokenEncrypted);
    const baseUrl = this.getNinjaOneBaseUrlForAccount(freshAccount);

    switch (toolName) {
      case "search_rmm_devices":
      case "list_devices_for_site":
        return this.searchNinjaOneDevices(tenantId, userId, baseUrl, accessToken, input);
      case "get_rmm_device_overview":
        return this.getNinjaOneDeviceOverview(baseUrl, accessToken, input);
      case "get_rmm_device_alerts":
        return this.getNinjaOneDeviceAlerts(baseUrl, accessToken, input);
      case "get_rmm_device_activities":
        return this.getNinjaOneDeviceActivities(baseUrl, accessToken, input);
      default: {
        const tool = this.registry.get("ninjaone")?.getTools().find((candidate) => candidate.name === toolName);
        if (!tool) {
          throw new Error(`NinjaOne tool ${toolName} not found`);
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
    const rawQuery = typeof input.query === "string" ? input.query.trim() : undefined;
    const query = extractMeaningfulQuery(rawQuery, [
      /\bopen\b/g,
      /\brecent\b/g,
      /\btickets?\b/g,
      /\bincidents?\b/g,
      /\brequests?\b/g,
      /\bfor\b/g
    ]);
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

    const requestedLimit =
      pickNumber(input, ["limit", "count", "top"]) ??
      (typeof input.query === "string" && /\b(all)\b/i.test(input.query) ? 100 : 50);
    const limit = Math.max(1, Math.min(requestedLimit, 100));

    const url = new URL(`${baseUrl}/api/tickets`);
    url.searchParams.set("count", String(limit));
    url.searchParams.set("includeclosed", wantsOpenItems(input, rawQuery) ? "false" : "true");
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
      .slice(0, limit);

    return {
      summary:
        openTickets.length > 0
          ? `Found ${openTickets.length} ${wantsOpenItems(input, rawQuery) ? "open " : ""}HaloPSA tickets${resolvedCustomerName ? ` for ${resolvedCustomerName}` : ""}. Results are condensed to ticket id, summary, status, customer, priority, and latest update.`
          : `No ${wantsOpenItems(input, rawQuery) ? "open " : ""}HaloPSA tickets found${resolvedCustomerName ? ` for ${resolvedCustomerName}` : ""}.`,
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

  private async resolveHaloEntityHints(tenantId: string, userId: string, query: string): Promise<ResolvedEntityHints> {
    const hints: ResolvedEntityHints = {
      userHints: [],
      organizationHints: [],
      emailHints: []
    };

    const haloAccount = (await this.store.findByTenantUser(tenantId, userId)).find(
      (candidate) => candidate.provider === "halopsa" && candidate.status === "ACTIVE"
    );
    if (!haloAccount) {
      return hints;
    }

    const freshHalo = await this.ensureFreshAccount(haloAccount);
    const haloToken = this.encryption.decrypt(freshHalo.accessTokenEncrypted);
    const haloBaseUrl = this.getHaloBaseUrlForAccount(freshHalo);

    try {
      const customers = await this.lookupHaloCustomers(haloBaseUrl, haloToken, query, 10);
      const matchedCustomer =
        customers.find((customer) =>
          [
            pickString(customer, ["name", "client_name", "organisation_name", "customer_name"]),
            pickString(customer, ["reference", "client_reference", "ref"])
          ].some((candidate) => textMatches(candidate, query))
        ) ?? customers[0];

      if (matchedCustomer) {
        const customerName = pickString(matchedCustomer, ["name", "client_name", "organisation_name", "customer_name"]);
        if (customerName) {
          hints.organizationHints.push(customerName);
        }
      }
    } catch {
      // Optional enrichment only.
    }

    try {
      const contactResult = await this.findHaloContact(haloBaseUrl, haloToken, { query });
      for (const row of contactResult.data as Record<string, unknown>[]) {
        const name = pickString(row, ["name"]);
        const email = pickString(row, ["email"]);
        const customer = pickString(row, ["customer"]);
        if (name) {
          hints.userHints.push(name);
        }
        if (email) {
          hints.emailHints.push(email);
        }
        if (customer) {
          hints.organizationHints.push(customer);
        }
      }
    } catch {
      // Optional enrichment only.
    }

    hints.userHints = [...new Set(hints.userHints.map((value) => value.trim()).filter(Boolean))];
    hints.organizationHints = [...new Set(hints.organizationHints.map((value) => value.trim()).filter(Boolean))];
    hints.emailHints = [...new Set(hints.emailHints.map((value) => value.trim()).filter(Boolean))];
    return hints;
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
    const rawQuery = typeof input.query === "string" ? input.query.trim() : "";
    const query = extractMeaningfulQuery(rawQuery, [
      /\bopen\b/g,
      /\bactive\b/g,
      /\bprojects?\b/g,
      /\bfor\b/g
    ]);
    const openOnly = wantsOpenItems(input, rawQuery);
    const url = new URL(`${baseUrl}/api/projects`);
    url.searchParams.set("count", "50");
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
    const projects = normalizeCollectionPayload(payload, ["projects"])
      .filter((project) => (openOnly ? isProjectOpen(project) : true))
      .slice(0, 25);

    return {
      summary:
        projects.length > 0
          ? `Found ${projects.length} ${openOnly ? "open " : ""}HaloPSA projects. Results are condensed to project id, summary, status, customer, and manager.`
          : `No ${openOnly ? "open " : ""}HaloPSA projects matched that query.`,
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

  private buildNinjaOneHeaders(accessToken: string) {
    return {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`
    };
  }

  private normalizeNinjaOneCollection(payload: unknown) {
    return normalizeCollectionPayload(payload, [
      "results",
      "items",
      "devices",
      "data",
      "alerts",
      "activities"
    ]);
  }

  private async fetchNinjaOneJson(baseUrl: string, accessToken: string, path: string, query?: Record<string, string | number | undefined>) {
    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && String(value).length > 0) {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url, {
      headers: this.buildNinjaOneHeaders(accessToken)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`NinjaOne request failed (${response.status}) for ${path}: ${body}`);
    }

    return response.json() as Promise<unknown>;
  }

  private async tryFetchNinjaOneJson(baseUrl: string, accessToken: string, path: string) {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: this.buildNinjaOneHeaders(accessToken)
    });

    if (!response.ok) {
      return undefined;
    }

    return response.json() as Promise<unknown>;
  }

  private pickDeviceId(input: Record<string, unknown>) {
    const rawId =
      input.id ??
      input.deviceId ??
      input.device_id ??
      input.endpointId ??
      input.endpoint_id;

    if (typeof rawId === "number" || typeof rawId === "string") {
      return String(rawId).trim();
    }

    const query = typeof input.query === "string" ? input.query.trim() : "";
    if (/^\d+$/.test(query)) {
      return query;
    }

    return "";
  }

  private mapNinjaOneDevice(device: Record<string, unknown>) {
    return {
      id: pickNumber(device, ["id", "deviceId", "device_id"]),
      name: pickString(device, ["systemName", "displayName", "name", "hostname"]),
      hostname: pickString(device, ["hostname", "dnsName", "systemName"]),
      organization: pickString(device, ["organizationName", "organisationName", "customerName"]),
      organizationId: pickNumber(device, ["organizationId", "organisationId", "customerId"]),
      site: pickString(device, ["siteName", "locationName"]),
      status: pickString(device, ["online", "status", "healthStatus"]),
      os: pickString(device, ["osName", "operatingSystem", "os"]),
      serialNumber: pickString(device, ["serialNumber", "serial"]),
      lastSeen: pickString(device, ["lastContact", "lastSeen", "lastLoggedInUser"]),
      raw: device
    };
  }

  private async resolveNinjaOneDevice(baseUrl: string, accessToken: string, input: Record<string, unknown>) {
    const deviceId = this.pickDeviceId(input);
    if (deviceId) {
      const payload = await this.fetchNinjaOneJson(baseUrl, accessToken, `/device/${deviceId}`);
      return payload as Record<string, unknown>;
    }

    const query = typeof input.query === "string" ? input.query.trim() : "";
    if (!query) {
      throw new Error("A NinjaOne device id or search query is required");
    }

    const payload = await this.fetchNinjaOneJson(baseUrl, accessToken, "/devices", {
      search: query
    });
    const devices = this.normalizeNinjaOneCollection(payload);
    const matched = devices.find((device) =>
      [pickString(device, ["systemName", "displayName", "name", "hostname", "serialNumber", "serial"])].some((candidate) =>
        textMatches(candidate, query)
      )
    ) ?? devices[0];

    if (!matched) {
      throw new Error(`No NinjaOne device matched ${query}`);
    }

    const matchedId = pickNumber(matched, ["id", "deviceId", "device_id"]);
    if (!matchedId) {
      return matched;
    }

    const detail = await this.fetchNinjaOneJson(baseUrl, accessToken, `/device/${matchedId}`);
    return detail as Record<string, unknown>;
  }

  private async searchNinjaOneDevices(
    tenantId: string,
    userId: string,
    baseUrl: string,
    accessToken: string,
    input: Record<string, unknown>
  ) {
    const rawQuery = typeof input.query === "string" ? input.query.trim() : "";
    const userHint = extractUserHint(rawQuery);
    const query = extractMeaningfulQuery(rawQuery, [
      /\bdevices?\b/g,
      /\bdevice\b/g,
      /\bendpoints?\b/g,
      /\bendpoint\b/g,
      /\bfor\b/g,
      /\bused by\b/g,
      /\bbelonging to\b/g,
      /\bassigned to\b/g
    ]);
    const organizationId = pickNumber(input, ["organizationId", "organisationId", "customerId", "siteId", "site_id"]);
    const haloHints = rawQuery ? await this.resolveHaloEntityHints(tenantId, userId, rawQuery) : undefined;
    const effectiveUserHints = [userHint, ...(haloHints?.userHints ?? []), ...(haloHints?.emailHints ?? [])]
      .map((value) => value.trim())
      .filter(Boolean);
    const effectiveOrganizationHints = (haloHints?.organizationHints ?? []).map((value) => value.trim()).filter(Boolean);

    const payload = await this.fetchNinjaOneJson(baseUrl, accessToken, "/devices", {
      search: query || undefined,
      organizationId
    });
    const allDevices = this.normalizeNinjaOneCollection(payload);
    const devices = allDevices
      .filter((device) => {
        if (effectiveUserHints.length === 0 && effectiveOrganizationHints.length === 0) {
          return true;
        }

        const userMatch =
          effectiveUserHints.length === 0 ||
          effectiveUserHints.some((hint) => deviceMatchesUserHint(device, hint));
        const organizationCandidate = pickString(device, ["organizationName", "organisationName", "customerName", "siteName"]);
        const organizationMatch =
          effectiveOrganizationHints.length === 0 ||
          effectiveOrganizationHints.some((hint) => textMatches(organizationCandidate, hint));

        return userMatch || organizationMatch;
      })
      .sort((left, right) => {
        const leftScore =
          Number(
            effectiveUserHints.some((hint) => deviceMatchesUserHint(left, hint)) ||
              effectiveOrganizationHints.some((hint) =>
                textMatches(pickString(left, ["organizationName", "organisationName", "customerName", "siteName"]), hint)
              )
          ) +
          Number(textMatches(pickString(left, ["systemName", "displayName", "hostname", "name"]), query));
        const rightScore =
          Number(
            effectiveUserHints.some((hint) => deviceMatchesUserHint(right, hint)) ||
              effectiveOrganizationHints.some((hint) =>
                textMatches(pickString(right, ["organizationName", "organisationName", "customerName", "siteName"]), hint)
              )
          ) +
          Number(textMatches(pickString(right, ["systemName", "displayName", "hostname", "name"]), query));
        return rightScore - leftScore;
      })
      .slice(0, 50);

    return {
      summary:
        devices.length > 0
          ? `Found ${devices.length} NinjaOne devices${
              effectiveUserHints[0] || effectiveOrganizationHints[0]
                ? ` related to ${effectiveUserHints[0] ?? effectiveOrganizationHints[0]}`
                : ""
            }. Results are condensed to device identity, organization, site, health, operating system, and serial information.`
          : "No NinjaOne devices matched that search.",
      data: devices.map((device) => this.mapNinjaOneDevice(device)),
      source: "ninjaone"
    };
  }

  private async getNinjaOneDeviceAlerts(baseUrl: string, accessToken: string, input: Record<string, unknown>) {
    const device = await this.resolveNinjaOneDevice(baseUrl, accessToken, input);
    const deviceId = pickNumber(device, ["id", "deviceId", "device_id"]);
    if (!deviceId) {
      throw new Error("Could not resolve a NinjaOne device id for alerts");
    }

    const payload = await this.fetchNinjaOneJson(baseUrl, accessToken, `/device/${deviceId}/alerts`);
    const alerts = this.normalizeNinjaOneCollection(payload).slice(0, 50);

    return {
      summary:
        alerts.length > 0
          ? `Found ${alerts.length} NinjaOne alerts for device ${deviceId}. Results include severity, category, source, timestamps, and raw alert context where available.`
          : `No NinjaOne alerts found for device ${deviceId}.`,
      data: alerts.map((alert) => ({
        id: pickNumber(alert, ["id", "alertId", "uid"]),
        severity: pickString(alert, ["severity", "priority", "status"]),
        category: pickString(alert, ["category", "type", "alertType"]),
        message: pickString(alert, ["message", "title", "summary"]),
        source: pickString(alert, ["source", "policyName", "checkName"]),
        createdAt: pickString(alert, ["created", "createdAt", "raisedAt"]),
        raw: alert
      })),
      source: "ninjaone"
    };
  }

  private async getNinjaOneDeviceActivities(baseUrl: string, accessToken: string, input: Record<string, unknown>) {
    const device = await this.resolveNinjaOneDevice(baseUrl, accessToken, input);
    const deviceId = pickNumber(device, ["id", "deviceId", "device_id"]);
    if (!deviceId) {
      throw new Error("Could not resolve a NinjaOne device id for activities");
    }

    const payload = await this.fetchNinjaOneJson(baseUrl, accessToken, `/device/${deviceId}/activities`);
    const activities = this.normalizeNinjaOneCollection(payload).slice(0, 50);

    return {
      summary:
        activities.length > 0
          ? `Found ${activities.length} NinjaOne activities for device ${deviceId}. Results include activity type, summary, user or source, and timestamps where available.`
          : `No NinjaOne activities found for device ${deviceId}.`,
      data: activities.map((activity) => ({
        id: pickNumber(activity, ["id", "activityId"]),
        type: pickString(activity, ["type", "activityType", "category"]),
        summary: pickString(activity, ["summary", "message", "description"]),
        actor: pickString(activity, ["userName", "actor", "source"]),
        createdAt: pickString(activity, ["created", "createdAt", "timestamp"]),
        raw: activity
      })),
      source: "ninjaone"
    };
  }

  private async getNinjaOneDeviceOverview(baseUrl: string, accessToken: string, input: Record<string, unknown>) {
    const device = await this.resolveNinjaOneDevice(baseUrl, accessToken, input);
    const deviceId = pickNumber(device, ["id", "deviceId", "device_id"]);
    if (!deviceId) {
      throw new Error("Could not resolve a NinjaOne device id");
    }

    const [alertsPayload, activitiesPayload, disksPayload] = await Promise.all([
      this.tryFetchNinjaOneJson(baseUrl, accessToken, `/device/${deviceId}/alerts`),
      this.tryFetchNinjaOneJson(baseUrl, accessToken, `/device/${deviceId}/activities`),
      this.tryFetchNinjaOneJson(baseUrl, accessToken, `/device/${deviceId}/volumes`)
        .then((payload) => payload ?? this.tryFetchNinjaOneJson(baseUrl, accessToken, `/device/${deviceId}/disks`))
    ]);

    const alerts = alertsPayload ? this.normalizeNinjaOneCollection(alertsPayload).slice(0, 10) : [];
    const activities = activitiesPayload ? this.normalizeNinjaOneCollection(activitiesPayload).slice(0, 10) : [];
    const disks = disksPayload ? this.normalizeNinjaOneCollection(disksPayload).slice(0, 20) : [];
    const mappedDevice = this.mapNinjaOneDevice(device);

    return {
      summary: `Loaded NinjaOne device ${mappedDevice.name ?? deviceId}. Results include endpoint identity, health context, alerts, recent activities, and storage information where the API exposes it.`,
      data: [
        {
          ...mappedDevice,
          alerts: alerts.map((alert) => ({
            id: pickNumber(alert, ["id", "alertId", "uid"]),
            severity: pickString(alert, ["severity", "priority", "status"]),
            message: pickString(alert, ["message", "title", "summary"]),
            source: pickString(alert, ["source", "policyName", "checkName"]),
            createdAt: pickString(alert, ["created", "createdAt", "raisedAt"])
          })),
          activities: activities.map((activity) => ({
            id: pickNumber(activity, ["id", "activityId"]),
            type: pickString(activity, ["type", "activityType", "category"]),
            summary: pickString(activity, ["summary", "message", "description"]),
            createdAt: pickString(activity, ["created", "createdAt", "timestamp"])
          })),
          disks: disks.map((disk) => ({
            name: pickString(disk, ["name", "label", "mountPoint", "device"]),
            totalBytes: pickNumber(disk, ["size", "totalBytes", "capacity"]),
            freeBytes: pickNumber(disk, ["free", "freeBytes", "available"]),
            usedPercent: pickNumber(disk, ["usedPercent", "usagePercent", "percentUsed"]),
            fileSystem: pickString(disk, ["fileSystem", "filesystem", "fsType"])
          }))
        }
      ],
      source: "ninjaone"
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

  private getNinjaOneBaseUrlForAccount(account: ConnectedAccountRecord) {
    const metadata = (account.metadataJson ?? {}) as StoredConnectorConfig;
    const baseUrl = this.normalizeNinjaOneBaseUrl(metadata.apiUrl ?? process.env.NINJAONE_BASE_URL ?? process.env.NINJAONE_URL);
    if (!baseUrl) {
      throw new Error("Set NinjaOne API URL in connector settings or NINJAONE_BASE_URL in the environment");
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
    const scopes = stored.scopes ?? (process.env.NINJAONE_SCOPES ?? "monitoring management control").split(/\s+/).filter(Boolean);

    if (!apiUrl || !authUrl || !clientId) {
      throw new Error("NinjaOne requires API URL and client ID in connector settings before connecting");
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
    ninjaConfig: { apiUrl: string; authUrl: string; clientId: string; clientSecret?: string; redirectUri: string; scopes: string[] },
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
