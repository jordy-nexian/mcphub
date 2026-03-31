"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { PageHeader } from "../../components/page-header";
import { StatsCard } from "../../components/stats-card";
import { readPlatformSession, type PlatformSession } from "../../lib/platform-auth";
import { fetchAuditEvents, fetchProviders } from "../../lib/platform-api";

type DashboardMetrics = {
  connectedConnectors: number;
  availableConnectors: number;
  recentEvents: number;
};

export default function DashboardPage() {
  const router = useRouter();
  const [session, setSession] = useState<PlatformSession | null>(null);
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    connectedConnectors: 0,
    availableConnectors: 0,
    recentEvents: 0
  });
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const storedSession = readPlatformSession();
    if (!storedSession) {
      router.replace("/auth/login");
      return;
    }

    setSession(storedSession);
  }, [router]);

  useEffect(() => {
    async function load() {
      if (!session) {
        return;
      }

      setLoading(true);
      setNotice("");

      try {
        const [providersPayload, auditPayload] = await Promise.all([
          fetchProviders(session),
          fetchAuditEvents({ tenantId: session.tenant.id, limit: 8 }, session)
        ]);

        setMetrics({
          connectedConnectors: providersPayload.providers.filter((provider) => provider.connected).length,
          availableConnectors: providersPayload.providers.length,
          recentEvents: auditPayload.events.length
        });
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not load workspace overview.");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [session]);

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Customer Portal"
        title="Workspace overview"
        description="A governed customer workspace for integrations, permissions, and managed MCP access."
      />

      {notice ? <div className="notice">{notice}</div> : null}

      <div className="stats-row">
        <StatsCard value={loading ? "..." : metrics.availableConnectors} label="Available connectors" />
        <StatsCard value={loading ? "..." : metrics.connectedConnectors} label="Connected connectors" />
        <StatsCard value={session?.tenants.length ?? 1} label="Accessible tenants" />
        <StatsCard value={loading ? "..." : metrics.recentEvents} label="Recent audit events" />
      </div>

      <section className="grid two">
        <article className="panel stack">
          <span className="eyebrow">Managed Service</span>
          <h2>One workspace, many products</h2>
          <p className="muted">
            Connect service desk, documentation, CRM, Microsoft, and automation tools through one governed MCP surface.
          </p>
        </article>

        <article className="panel stack">
          <span className="eyebrow">Governance</span>
          <h2>Real tenant context</h2>
          <p className="muted">
            Tenant access, audit data, OAuth connections, and MCP token issuance now resolve from live platform records rather than demo fixtures.
          </p>
        </article>
      </section>
    </div>
  );
}
