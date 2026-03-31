"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useMemo, useState } from "react";

import { clearPlatformSession, readPlatformSession, writePlatformSession, type PlatformSession } from "../lib/platform-auth";

type Connector = {
  id: string;
  name: string;
  category: string;
  auth: "OAuth 2.0" | "API key";
  status: "Connected" | "Needs consent" | "Disconnected";
  description: string;
  lastSync: string;
  tools: string[];
  lastError?: string;
  realOAuth?: boolean;
};

type Permission = {
  tool: string;
  roles: string[];
  enabled: boolean;
};

type AuditEvent = {
  id: string;
  time: string;
  action: string;
  detail: string;
};

type DemoState = {
  workspaceName: string;
  workspaceSlug: string;
  tenantId: string;
  userId: string;
  connectors: Connector[];
  permissions: Permission[];
  audit: AuditEvent[];
};

type ProviderResponse = {
  provider: string;
  status: string;
  connected: boolean;
  lastError?: string;
};

const initialState: DemoState = {
  workspaceName: "Nexian Legal Ops",
  workspaceSlug: "nexian-legal-ops",
  tenantId: "demo-tenant",
  userId: "demo-user",
  connectors: [
    {
      id: "halopsa",
      name: "HaloPSA",
      category: "Service desk",
      auth: "OAuth 2.0",
      status: "Disconnected",
      description: "Customers, tickets, ticket actions, projects, contacts, knowledge, devices, invoices, and guarded write tools.",
      lastSync: "Not connected",
      tools: [
        "find_customer",
        "get_customer_overview",
        "list_open_tickets",
        "get_ticket",
        "get_ticket_with_actions",
        "list_ticket_actions",
        "search_projects",
        "find_contact",
        "search_documents",
        "list_devices_for_site",
        "get_recent_invoices",
        "create_draft_ticket",
        "add_internal_note"
      ],
      realOAuth: true
    },
    {
      id: "microsoft365",
      name: "Microsoft 365 / SharePoint",
      category: "Documents",
      auth: "OAuth 2.0",
      status: "Needs consent",
      description: "Search SharePoint, projects, and tenant-approved contacts.",
      lastSync: "Scaffold only",
      tools: ["search_documents", "search_projects", "find_contact"]
    },
    {
      id: "hubspot",
      name: "HubSpot CRM",
      category: "CRM",
      auth: "OAuth 2.0",
      status: "Needs consent",
      description: "Client relationship context for people and companies.",
      lastSync: "Scaffold only",
      tools: ["find_contact"]
    },
    {
      id: "itglue",
      name: "IT Glue",
      category: "Documentation",
      auth: "API key",
      status: "Disconnected",
      description: "Knowledge base, device, and documentation lookup.",
      lastSync: "Not connected",
      tools: ["search_documents", "list_devices_for_site"]
    }
  ],
  permissions: [
    { tool: "find_customer", roles: ["Owner", "Admin", "Analyst", "User"], enabled: true },
    { tool: "get_customer_overview", roles: ["Owner", "Admin", "Analyst", "User"], enabled: true },
    { tool: "list_open_tickets", roles: ["Owner", "Admin", "Analyst", "User"], enabled: true },
    { tool: "get_ticket", roles: ["Owner", "Admin", "Analyst", "User"], enabled: true },
    { tool: "get_ticket_with_actions", roles: ["Owner", "Admin", "Analyst", "User"], enabled: true },
    { tool: "list_ticket_actions", roles: ["Owner", "Admin", "Analyst", "User"], enabled: true },
    { tool: "search_projects", roles: ["Owner", "Admin", "Analyst", "User"], enabled: true },
    { tool: "find_contact", roles: ["Owner", "Admin", "Analyst", "User"], enabled: true },
    { tool: "search_documents", roles: ["Owner", "Admin", "Analyst", "User"], enabled: true },
    { tool: "list_devices_for_site", roles: ["Owner", "Admin", "Analyst", "User"], enabled: true },
    { tool: "get_recent_invoices", roles: ["Owner", "Admin"], enabled: true },
    { tool: "create_draft_ticket", roles: ["Owner", "Admin"], enabled: true },
    { tool: "add_internal_note", roles: ["Owner", "Admin"], enabled: false }
  ],
  audit: [
    { id: "a1", time: "10:22", action: "Connector updated", detail: "HaloPSA now uses the real API authorization route." },
    { id: "a2", time: "10:17", action: "Tool invoked", detail: "list_open_tickets called for tenant nexian-legal-ops." },
    { id: "a3", time: "10:01", action: "Policy reviewed", detail: "Safe write tools limited to Owner and Admin roles." }
  ]
};

const storageKey = "nexian-mcp-demo-state";

function makeAuditEvent(action: string, detail: string): AuditEvent {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    action,
    detail
  };
}

function mapProviderStatus(status: string | undefined): Connector["status"] {
  if (status === "ACTIVE") {
    return "Connected";
  }

  if (status === "DISCONNECTED" || !status) {
    return "Disconnected";
  }

  return "Needs consent";
}

export function WorkspaceConsole() {
  const router = useRouter();
  const [state, setState] = useState<DemoState>(initialState);
  const [session, setSession] = useState<PlatformSession | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [selectedConnector, setSelectedConnector] = useState("halopsa");
  const [token, setToken] = useState("");
  const [copied, setCopied] = useState("");
  const [notice, setNotice] = useState("");
  const [loadingToken, setLoadingToken] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [newTenantName, setNewTenantName] = useState("");
  const [switchingTenant, setSwitchingTenant] = useState(false);
  const [creatingTenant, setCreatingTenant] = useState(false);

  const origin = typeof window === "undefined" ? "http://localhost:3000" : window.location.origin;
  const apiOrigin = useMemo(
    () => process.env.NEXT_PUBLIC_API_URL ?? origin.replace(":3000", ":4000"),
    [origin]
  );
  const mcpUrl = process.env.NEXT_PUBLIC_MCP_URL ?? origin.replace(":3000", ":4100");

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    if (saved) {
      startTransition(() => {
        setState((current) => ({ ...current, ...JSON.parse(saved) as Partial<DemoState> }));
      });
    }
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    const storedSession = readPlatformSession();
    if (!storedSession) {
      router.replace("/auth/login");
      return;
    }

    setSession(storedSession);
    setState((current) => ({
      ...current,
      workspaceName: storedSession.tenant.name,
      workspaceSlug: storedSession.tenant.slug,
      tenantId: storedSession.tenant.id,
      userId: storedSession.user.id
    }));
  }, [router]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        workspaceName: state.workspaceName,
        workspaceSlug: state.workspaceSlug,
        tenantId: state.tenantId,
        userId: state.userId
      })
    );
  }, [isHydrated, state.workspaceName, state.workspaceSlug, state.tenantId, state.userId]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const oauthStatus = params.get("oauth");
    const provider = params.get("provider");

    if (oauthStatus === "success" && provider) {
      setNotice(`${provider} connected successfully.`);
      setState((current) => ({
        ...current,
        audit: [makeAuditEvent("Connector connected", `${provider} completed OAuth successfully.`), ...current.audit]
      }));
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [isHydrated]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    async function loadProviders() {
      if (!session) {
        return;
      }

      try {
        const response = await fetch(`${apiOrigin}/providers`, {
          headers: {
            authorization: `Bearer ${session.token}`
          }
        });
        if (!response.ok) {
          throw new Error(`Failed to load providers (${response.status})`);
        }

        const payload = (await response.json()) as { providers: ProviderResponse[] };
        setState((current) => ({
          ...current,
          connectors: current.connectors.map((connector) => {
            const provider = payload.providers.find((candidate) => candidate.provider === connector.id);
            if (!provider) {
              return connector;
            }

            return {
              ...connector,
              status: mapProviderStatus(provider.status),
              lastSync: provider.connected ? "Connected via backend" : connector.lastSync,
              lastError: provider.lastError
            };
          })
        }));
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Unable to load connector state from API.");
      }
    }

    void loadProviders();
  }, [apiOrigin, isHydrated, session]);

  const connectedCount = state.connectors.filter((connector) => connector.status === "Connected").length;

  function togglePermission(tool: string) {
    setState((current) => ({
      ...current,
      permissions: current.permissions.map((permission) =>
        permission.tool === tool ? { ...permission, enabled: !permission.enabled } : permission
      ),
      audit: [makeAuditEvent("Permission changed", `${tool} access policy was updated.`), ...current.audit]
    }));
  }

  async function connectConnector(id: string) {
    const connector = state.connectors.find((item) => item.id === id);
    if (!connector) {
      return;
    }

    if (connector.id === "halopsa") {
      if (!session) {
        router.replace("/auth/login");
        return;
      }

      const response = await fetch(`${apiOrigin}/oauth/halopsa/url`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.token}`
        },
        body: JSON.stringify({
          returnTo: `${origin}/dashboard/connectors`
        })
      });

      if (!response.ok) {
        setNotice(`Failed to start ${connector.name} OAuth.`);
        return;
      }

      const payload = (await response.json()) as { authorizationUrl: string };
      window.location.href = payload.authorizationUrl;
      return;
    }

    if (connector.auth === "API key") {
      setNotice("API-key-backed connectors still need backend persistence. HaloPSA OAuth is the first live path.");
      setState((current) => ({
        ...current,
        audit: [makeAuditEvent("API key pending", `${connector.name} is still using scaffold-only onboarding.`), ...current.audit]
      }));
      return;
    }

    setNotice(`${connector.name} is still scaffolded. HaloPSA is the first real OAuth connector.`);
  }

  async function disconnectConnector(id: string) {
    const connector = state.connectors.find((item) => item.id === id);
    if (!connector) {
      return;
    }

    if (connector.id !== "halopsa") {
      setNotice(`${connector.name} disconnect is still local-only until that connector is wired.`);
      return;
    }

    if (!session) {
      router.replace("/auth/login");
      return;
    }

    const response = await fetch(`${apiOrigin}/connected-accounts/${id}`, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${session.token}`
      }
    });

    if (!response.ok) {
      setNotice(`Failed to disconnect ${connector.name}.`);
      return;
    }

    setState((current) => ({
      ...current,
      connectors: current.connectors.map((item) =>
        item.id === id ? { ...item, status: "Disconnected", lastSync: "Disconnected locally" } : item
      ),
      audit: [makeAuditEvent("Connector disconnected", `${connector.name} was disconnected from the backend store.`), ...current.audit]
    }));
    setNotice(`${connector.name} disconnected.`);
  }

  async function generateToken() {
    if (!session) {
      router.replace("/auth/login");
      return;
    }

    setLoadingToken(true);
    try {
      const response = await fetch(`${apiOrigin}/auth/mcp-token`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.token}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to create MCP token (${response.status})`);
      }

      const payload = (await response.json()) as { token: string };
      setToken(payload.token);
      setState((current) => ({
        ...current,
        audit: [makeAuditEvent("MCP token issued", "A backend-signed MCP bearer token was generated for local testing."), ...current.audit]
      }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create MCP token.");
    } finally {
      setLoadingToken(false);
    }
  }

  async function copy(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(""), 1500);
  }

  function signOut() {
    clearPlatformSession();
    router.replace("/auth/login");
  }

  async function switchTenant(tenantId: string) {
    if (!session || tenantId === session.tenant.id) {
      return;
    }

    setSwitchingTenant(true);
    setNotice("");

    try {
      const response = await fetch(`${apiOrigin}/auth/switch-tenant`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.token}`
        },
        body: JSON.stringify({ tenantId })
      });

      const payload = (await response.json()) as PlatformSession & { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? payload.error ?? "Could not switch tenant");
      }

      writePlatformSession(payload);
      setSession(payload);
      setState((current) => ({
        ...current,
        workspaceName: payload.tenant.name,
        workspaceSlug: payload.tenant.slug,
        tenantId: payload.tenant.id,
        userId: payload.user.id,
        audit: [makeAuditEvent("Tenant switched", `Active workspace changed to ${payload.tenant.name}.`), ...current.audit]
      }));
      setNotice(`Now working in ${payload.tenant.name}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not switch tenant.");
    } finally {
      setSwitchingTenant(false);
    }
  }

  async function createTenant() {
    if (!session || !newTenantName.trim()) {
      return;
    }

    setCreatingTenant(true);
    setNotice("");

    try {
      const response = await fetch(`${apiOrigin}/auth/tenants`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.token}`
        },
        body: JSON.stringify({ workspaceName: newTenantName.trim() })
      });

      const payload = (await response.json()) as PlatformSession & { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? payload.error ?? "Could not create tenant");
      }

      writePlatformSession(payload);
      setSession(payload);
      setState((current) => ({
        ...current,
        workspaceName: payload.tenant.name,
        workspaceSlug: payload.tenant.slug,
        tenantId: payload.tenant.id,
        userId: payload.user.id,
        audit: [makeAuditEvent("Tenant created", `${payload.tenant.name} was created and made active.`), ...current.audit]
      }));
      setNewTenantName("");
      setNotice(`Created and switched to ${payload.tenant.name}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create tenant.");
    } finally {
      setCreatingTenant(false);
    }
  }

  const selected = state.connectors.find((connector) => connector.id === selectedConnector) ?? state.connectors[0];

  return (
    <div className="console stack">
      <section className="hero hero-console">
        <div className="hero-copy stack">
          <span className="eyebrow">Nexian AI & Automation Control Centre</span>
          <h1 className="hero-title">Connect your MSP stack, control safe tools, and hand clients a single MCP endpoint.</h1>
          <p className="muted hero-text">
            HaloPSA now uses the real authorization-code route and exposes the expanded Nexian MCP surface for tickets,
            actions, projects, contacts, knowledge, assets, invoices, and guarded writes. The other connectors remain
            scaffolded until we wire their provider-specific token exchange and storage paths.
          </p>
          <div className="stats-grid">
            <div className="stat-card">
              <strong>{connectedCount}</strong>
              <span>Connected services</span>
            </div>
            <div className="stat-card">
              <strong>{state.permissions.filter((item) => item.enabled).length}</strong>
              <span>Enabled tools</span>
            </div>
            <div className="stat-card">
              <strong>{session?.tenants.length ?? 1}</strong>
              <span>Accessible tenants</span>
            </div>
          </div>
          {notice ? <div className="notice">{notice}</div> : null}
        </div>
        <aside className="hero-side stack">
          <div className="panel panel-dark stack">
            <span className="eyebrow">Workspace</span>
            <strong className="workspace-name">{state.workspaceName}</strong>
            <label className="stack">
              <span className="field-label">Tenant slug</span>
              <input value={state.workspaceSlug} readOnly />
            </label>
            <label className="stack">
              <span className="field-label">Tenant ID</span>
              <input value={state.tenantId} readOnly />
            </label>
            <label className="stack">
              <span className="field-label">User ID</span>
              <input value={state.userId} readOnly />
            </label>
            <div className="stack">
              <span className="field-label">Active tenants</span>
              <div className="chip-row">
                {(session?.tenants ?? []).map((tenant) => (
                  <button
                    key={tenant.id}
                    className={`chip tenant-chip ${tenant.id === state.tenantId ? "active" : ""}`}
                    onClick={() => void switchTenant(tenant.id)}
                    type="button"
                    disabled={switchingTenant}
                  >
                    {tenant.name} · {tenant.role}
                  </button>
                ))}
              </div>
            </div>
            <label className="stack">
              <span className="field-label">Create tenant</span>
              <input
                value={newTenantName}
                onChange={(event) => setNewTenantName(event.target.value)}
                placeholder="Add a new customer workspace"
              />
            </label>
            <div className="row">
              <button className="button primary" onClick={() => void createTenant()} type="button" disabled={creatingTenant}>
                {creatingTenant ? "Creating..." : "Create tenant"}
              </button>
              <button className="button secondary" onClick={signOut} type="button">
                Sign out
              </button>
            </div>
          </div>
        </aside>
      </section>

      <section className="dashboard-grid">
        <article className="panel stack">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Connectors</span>
              <h2>Service connections</h2>
            </div>
            <span className="badge">{connectedCount} live</span>
          </div>
          <div className="connector-grid">
            {state.connectors.map((connector) => (
              <div key={connector.id} className="connector-card">
                <div className="row row-spread">
                  <div>
                    <strong>{connector.name}</strong>
                    <p className="muted connector-meta">
                      {connector.category} · {connector.auth}
                    </p>
                  </div>
                  <span className={`status-pill ${connector.status.toLowerCase().replace(/\s+/g, "-")}`}>{connector.status}</span>
                </div>
                <p className="muted">{connector.description}</p>
                <p className="connector-meta">Last activity: {connector.lastSync}</p>
                {connector.lastError ? <p className="danger-text">{connector.lastError}</p> : null}
                <div className="chip-row">
                  {connector.tools.slice(0, connector.id === "halopsa" ? 6 : 3).map((tool) => (
                    <span key={tool} className="chip">
                      {tool}
                    </span>
                  ))}
                </div>
                {connector.id === "halopsa" ? <p className="connector-meta">{connector.tools.length} MCP tools available</p> : null}
                <div className="row">
                  <button className="button primary" onClick={() => connectConnector(connector.id)} type="button">
                    {connector.id === "halopsa" ? "Connect with HaloPSA" : connector.auth === "API key" ? "Save API key" : "Coming next"}
                  </button>
                  <button className="button secondary" onClick={() => void disconnectConnector(connector.id)} type="button">
                    Disconnect
                  </button>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="panel stack">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Connector Setup</span>
              <h2>Onboarding workflow</h2>
            </div>
          </div>
          <label className="stack">
            <span className="field-label">Select provider</span>
            <select value={selectedConnector} onChange={(event) => setSelectedConnector(event.target.value)}>
              {state.connectors.map((connector) => (
                <option key={connector.id} value={connector.id}>
                  {connector.name}
                </option>
              ))}
            </select>
          </label>
          <div className="setup-card">
            <strong>{selected.name}</strong>
            <p className="muted">{selected.description}</p>
            <p className="connector-meta">
              {selected.id === "halopsa"
                ? "Live MCP tools: customer lookup, ticketing, action history, project search, contacts, documents, site devices, invoices, and guarded writes."
                : "Displayed tools are the current scaffold surface for this provider."}
            </p>
            <div className="chip-row">
              {selected.tools.map((tool) => (
                <span key={tool} className="chip">
                  {tool}
                </span>
              ))}
            </div>
          </div>
          {selected.auth === "API key" ? (
            <label className="stack">
              <span className="field-label">Provider API key</span>
              <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Backend API-key storage is next to wire." />
            </label>
          ) : (
            <div className="notice">
              {selected.id === "halopsa"
                ? "HaloPSA is now wired to the API authorization-code route and the expanded MCP tool catalog. Set HALOPSA_BASE_URL, HALOPSA_CLIENT_ID, HALOPSA_CLIENT_SECRET, and HALOPSA_REDIRECT_URI before connecting."
                : "This provider still uses scaffold logic. HaloPSA is the only live OAuth path in this build."}
            </div>
          )}
          <div className="row">
            <button className="button primary" onClick={() => connectConnector(selected.id)} type="button">
              {selected.id === "halopsa" ? "Start HaloPSA OAuth" : "Use selected connector"}
            </button>
          </div>
        </article>

        <article className="panel stack">
          <div className="section-heading">
            <div>
              <span className="eyebrow">MCP Access</span>
              <h2>Tenant endpoint</h2>
            </div>
          </div>
          <div className="credential-card">
            <span className="field-label">MCP URL</span>
            <code>{mcpUrl}</code>
            <button className="button secondary" onClick={() => void copy(mcpUrl, "url")} type="button">
              {copied === "url" ? "Copied" : "Copy URL"}
            </button>
          </div>
          <div className="credential-card">
            <span className="field-label">Bearer token</span>
            <code>{token || "Generate a backend-signed MCP token for local requests."}</code>
            <div className="row">
              <button className="button primary" onClick={() => void generateToken()} type="button" disabled={loadingToken}>
                {loadingToken ? "Generating..." : "Generate token"}
              </button>
              {token ? (
                <button className="button secondary" onClick={() => void copy(token, "token")} type="button">
                  {copied === "token" ? "Copied" : "Copy token"}
                </button>
              ) : null}
            </div>
          </div>
          <div className="notice">
            Example header: <code>Authorization: Bearer &lt;token&gt;</code>
          </div>
        </article>

        <article className="panel stack">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Permissions</span>
              <h2>Tool guardrails</h2>
            </div>
          </div>
          <div className="permission-list">
            {state.permissions.map((permission) => (
              <label key={permission.tool} className="permission-item">
                <div>
                  <strong>{permission.tool}</strong>
                  <p className="muted">{permission.roles.join(", ")}</p>
                </div>
                <button
                  className={`toggle ${permission.enabled ? "enabled" : ""}`}
                  onClick={() => togglePermission(permission.tool)}
                  type="button"
                  aria-pressed={permission.enabled}
                >
                  <span />
                </button>
              </label>
            ))}
          </div>
        </article>

        <article className="panel stack">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Audit Feed</span>
              <h2>Recent activity</h2>
            </div>
          </div>
          <div className="timeline">
            {state.audit.map((event) => (
              <div key={event.id} className="timeline-item">
                <span className="timeline-time">{event.time}</span>
                <div>
                  <strong>{event.action}</strong>
                  <p className="muted">{event.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
