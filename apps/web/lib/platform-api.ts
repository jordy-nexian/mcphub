"use client";

import { readPlatformSession, type PlatformSession } from "./platform-auth";

export type PlatformTenant = {
  id: string;
  name: string;
  slug: string;
  type: string;
  status: string;
  plan: string;
  vertical: string;
  region: string;
  parentTenantId?: string;
  userCount: number;
  connectorCount: number;
  createdAt: string;
  branding?: Record<string, unknown>;
};

export type PlatformConnector = {
  provider: string;
  status: string;
  tenantId: string;
  tenantName: string;
  userId: string;
  userName: string;
  updatedAt: string;
  lastError?: string;
};

export type PlatformAuditEvent = {
  id: string;
  tenantId: string;
  userId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type PlatformUser = {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantType: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
  lastActiveAt: string;
};

export type PlatformTenantDetail = {
  tenant: {
    id: string;
    slug: string;
    name: string;
    type: string;
    status: string;
    plan: string;
    vertical: string;
    region: string;
    parentTenantId?: string;
    branding: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  };
  users: Array<{
    id: string;
    tenantId: string;
    email: string;
    displayName: string;
    role: string;
    status: string;
    lastActiveAt: string;
  }>;
  connectors: Array<{
    provider: string;
    status: string;
    userId: string;
    updatedAt: string;
    lastError?: string;
  }>;
  audit: PlatformAuditEvent[];
};

export type PlatformOverview = {
  metrics: {
    totalTenants: number;
    customerTenants: number;
    totalUsers: number;
    connectedAccounts: number;
  };
  tenants: PlatformTenant[];
  connectors: PlatformConnector[];
  recentAudit: PlatformAuditEvent[];
};

export type ProviderResponse = {
  provider: string;
  status: string;
  connected: boolean;
  lastError?: string;
};

function getApiOrigin() {
  if (typeof window === "undefined") {
    return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  }

  return process.env.NEXT_PUBLIC_API_URL ?? window.location.origin.replace(":3000", ":4000");
}

function getAuthSession(session?: PlatformSession | null) {
  return session ?? readPlatformSession();
}

async function authedFetch<T>(path: string, session?: PlatformSession | null, init?: RequestInit): Promise<T> {
  const activeSession = getAuthSession(session);
  if (!activeSession) {
    throw new Error("Not signed in");
  }

  const response = await fetch(`${getApiOrigin()}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      authorization: `Bearer ${activeSession.token}`
    }
  });

  const payload = (await response.json()) as T & { error?: string; message?: string };
  if (!response.ok) {
    throw new Error(payload.message ?? payload.error ?? `Request failed (${response.status})`);
  }

  return payload;
}

export function getTenantMcpUrl() {
  if (typeof window === "undefined") {
    return process.env.NEXT_PUBLIC_MCP_URL ?? "http://localhost:4100";
  }

  return process.env.NEXT_PUBLIC_MCP_URL ?? window.location.origin.replace(":3000", ":4100");
}

export async function fetchPlatformOverview(session?: PlatformSession | null) {
  return authedFetch<PlatformOverview>("/platform/overview", session);
}

export async function fetchPlatformTenants(session?: PlatformSession | null) {
  return authedFetch<{ tenants: PlatformTenant[] }>("/platform/tenants", session);
}

export async function fetchPlatformTenantDetail(tenantId: string, session?: PlatformSession | null) {
  return authedFetch<PlatformTenantDetail>(`/platform/tenants/${tenantId}`, session);
}

export async function fetchPlatformUsers(session?: PlatformSession | null) {
  return authedFetch<{ users: PlatformUser[] }>("/platform/users", session);
}

export async function fetchPlatformConnectors(session?: PlatformSession | null) {
  return authedFetch<{ connectors: PlatformConnector[] }>("/platform/connectors", session);
}

export async function fetchAuditEvents(options?: { tenantId?: string; limit?: number }, session?: PlatformSession | null) {
  const query = new URLSearchParams();
  if (options?.tenantId) {
    query.set("tenantId", options.tenantId);
  }
  if (typeof options?.limit === "number") {
    query.set("limit", String(options.limit));
  }

  const suffix = query.toString() ? `?${query.toString()}` : "";
  return authedFetch<{ events: PlatformAuditEvent[] }>(`/platform/audit${suffix}`, session);
}

export async function fetchProviders(session?: PlatformSession | null) {
  return authedFetch<{ providers: ProviderResponse[] }>("/providers", session);
}
