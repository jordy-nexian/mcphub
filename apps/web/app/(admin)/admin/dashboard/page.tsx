"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { PageHeader } from "../../../../components/page-header";
import { StatsCard } from "../../../../components/stats-card";
import { readPlatformSession, type PlatformSession } from "../../../../lib/platform-auth";
import { fetchPlatformOverview, type PlatformOverview } from "../../../../lib/platform-api";

export default function AdminDashboardPage() {
  const router = useRouter();
  const [session, setSession] = useState<PlatformSession | null>(null);
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
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
    async function loadOverview() {
      if (!session) {
        return;
      }

      setLoading(true);
      setNotice("");

      try {
        setOverview(await fetchPlatformOverview(session));
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not load platform overview.");
      } finally {
        setLoading(false);
      }
    }

    void loadOverview();
  }, [session]);

  return (
    <div className="stack">
      <PageHeader
        eyebrow="MSP Console"
        title="Nexian platform overview"
        description="Operate customer estates, package the platform, and govern tenant AI access from a single command layer."
      />

      {notice ? <div className="notice">{notice}</div> : null}

      <div className="stats-row">
        <StatsCard value={loading ? "..." : overview?.metrics.customerTenants ?? 0} label="Managed customers" />
        <StatsCard value={loading ? "..." : overview?.metrics.connectedAccounts ?? 0} label="Live integrations" />
        <StatsCard value={loading ? "..." : overview?.recentAudit.length ?? 0} label="Recent audit events" />
        <StatsCard value={loading ? "..." : overview?.metrics.totalUsers ?? 0} label="Platform users" />
      </div>

      <section className="grid two">
        <article className="panel stack">
          <span className="eyebrow">Commercial Readiness</span>
          <h2>Built to operate for real</h2>
          <p className="muted">
            The MSP console now reflects live tenant, connector, and audit data from Postgres instead of seeded demo workspaces.
          </p>
        </article>
        <article className="panel stack">
          <span className="eyebrow">Customer Estate</span>
          <h2>Tenant health snapshot</h2>
          <div className="tenant-health-list">
            {(overview?.tenants ?? []).slice(0, 6).map((tenant) => (
              <div key={tenant.id} className="tenant-health-row">
                <div>
                  <strong>{tenant.name}</strong>
                  <p>{tenant.userCount} users · {tenant.connectorCount} connectors</p>
                </div>
                <span className={`status-pill ${tenant.status.toLowerCase()}`}>{tenant.status}</span>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
