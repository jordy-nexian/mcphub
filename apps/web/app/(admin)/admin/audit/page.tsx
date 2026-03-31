"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { PageHeader } from "../../../../components/page-header";
import { readPlatformSession, type PlatformSession } from "../../../../lib/platform-auth";
import { fetchAuditEvents, fetchPlatformTenants, type PlatformAuditEvent, type PlatformTenant } from "../../../../lib/platform-api";

export default function AdminAuditPage() {
  const router = useRouter();
  const [session, setSession] = useState<PlatformSession | null>(null);
  const [events, setEvents] = useState<PlatformAuditEvent[]>([]);
  const [tenantsById, setTenantsById] = useState<Record<string, PlatformTenant>>({});
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
    async function loadAudit() {
      if (!session) {
        return;
      }

      setLoading(true);
      setNotice("");

      try {
        const [auditPayload, tenantsPayload] = await Promise.all([
          fetchAuditEvents({ limit: 30 }, session),
          fetchPlatformTenants(session)
        ]);

        setEvents(auditPayload.events);
        setTenantsById(Object.fromEntries(tenantsPayload.tenants.map((tenant) => [tenant.id, tenant])));
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not load platform audit.");
      } finally {
        setLoading(false);
      }
    }

    void loadAudit();
  }, [session]);

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Cross-Tenant Audit"
        title="Platform audit logs"
        description="Review connector changes, tool usage, and operational events across managed customer estates."
      />

      {notice ? <div className="notice">{notice}</div> : null}

      <div className="data-table-wrapper">
        {loading ? (
          <div className="panel">Loading platform audit...</div>
        ) : (
          <table>
            <thead><tr><th>Time</th><th>Tenant</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>{new Date(event.createdAt).toLocaleString()}</td>
                  <td>{tenantsById[event.tenantId]?.name ?? event.tenantId}</td>
                  <td><span className="chip">{event.action}</span></td>
                  <td>{event.targetType}{event.targetId ? ` · ${event.targetId}` : ""}</td>
                  <td>{JSON.stringify(event.metadata)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
