"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { PageHeader } from "../../../../components/page-header";
import { StatsCard } from "../../../../components/stats-card";
import { readPlatformSession, type PlatformSession } from "../../../../lib/platform-auth";
import { fetchPlatformConnectors, type PlatformConnector } from "../../../../lib/platform-api";

export default function AdminConnectorsPage() {
  const router = useRouter();
  const [session, setSession] = useState<PlatformSession | null>(null);
  const [connectors, setConnectors] = useState<PlatformConnector[]>([]);
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
    async function loadConnectors() {
      if (!session) {
        return;
      }

      setLoading(true);
      setNotice("");

      try {
        const payload = await fetchPlatformConnectors(session);
        setConnectors(payload.connectors);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not load connectors.");
      } finally {
        setLoading(false);
      }
    }

    void loadConnectors();
  }, [session]);

  const connectedCount = connectors.filter((item) => item.status === "ACTIVE").length;
  const providers = new Set(connectors.map((item) => item.provider)).size;

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Provider Estate"
        title="Connector overview"
        description="See how customer products are linked into the Nexian platform."
      />

      {notice ? <div className="notice">{notice}</div> : null}

      <div className="stats-row">
        <StatsCard value={loading ? "..." : connectedCount} label="Connected instances" />
        <StatsCard value={loading ? "..." : providers} label="Providers" />
        <StatsCard value={loading ? "..." : connectors[0]?.provider ?? "None"} label="Latest provider" />
        <StatsCard value={loading ? "..." : connectors.filter((item) => item.lastError).length} label="Errors" />
      </div>

      <div className="data-table-wrapper">
        {loading ? (
          <div className="panel">Loading connectors...</div>
        ) : (
          <table>
            <thead><tr><th>Tenant</th><th>Provider</th><th>Status</th><th>User</th><th>Updated</th></tr></thead>
            <tbody>
              {connectors.map((connector) => (
                <tr key={`${connector.tenantId}-${connector.provider}-${connector.userId}`}>
                  <td>{connector.tenantName}</td>
                  <td>{connector.provider}</td>
                  <td><span className={`status-pill ${connector.status.toLowerCase()}`}>{connector.status}</span></td>
                  <td>{connector.userName}</td>
                  <td>{new Date(connector.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
