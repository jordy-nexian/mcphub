"use client";

import Link from "next/link";
import type { Route } from "next";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { PageHeader } from "../../../../../components/page-header";
import { readPlatformSession, type PlatformSession } from "../../../../../lib/platform-auth";
import { fetchPlatformTenantDetail, type PlatformTenantDetail } from "../../../../../lib/platform-api";

const tabs = ["Users", "Connectors", "Audit"] as const;
type Tab = (typeof tabs)[number];

const baselinePolicies = [
  { tool: "find_customer", scope: "Read", roles: "OWNER, ADMIN, ANALYST, USER" },
  { tool: "get_ticket_with_actions", scope: "Read", roles: "OWNER, ADMIN, ANALYST, USER" },
  { tool: "create_draft_ticket", scope: "Guarded write", roles: "OWNER, ADMIN" },
  { tool: "add_internal_note", scope: "Guarded write", roles: "OWNER, ADMIN" }
];

export default function TenantDetailPage() {
  const router = useRouter();
  const params = useParams();
  const tenantId = params.tenantId as string;
  const [session, setSession] = useState<PlatformSession | null>(null);
  const [detail, setDetail] = useState<PlatformTenantDetail | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("Users");
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
    async function loadDetail() {
      if (!session) {
        return;
      }

      setLoading(true);
      setNotice("");

      try {
        setDetail(await fetchPlatformTenantDetail(tenantId, session));
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not load tenant detail.");
      } finally {
        setLoading(false);
      }
    }

    void loadDetail();
  }, [session, tenantId]);

  if (loading) {
    return <div className="panel">Loading tenant...</div>;
  }

  if (!detail) {
    return <div className="empty-state"><h3>Tenant not found</h3><p>This customer workspace is not available.</p></div>;
  }

  return (
    <div className="stack">
      <div className="breadcrumb">
        <Link href={"/admin/tenants" as Route}>Tenants</Link>
        <span>/</span>
        <span>{detail.tenant.name}</span>
      </div>

      <PageHeader
        eyebrow="Tenant Workspace"
        title={detail.tenant.name}
        description={`Slug: ${detail.tenant.slug} · Status: ${detail.tenant.status} · Created: ${new Date(detail.tenant.createdAt).toLocaleDateString()}`}
      />

      {notice ? <div className="notice">{notice}</div> : null}

      <div className="tabs">
        {tabs.map((tab) => (
          <button key={tab} type="button" className={`tab ${activeTab === tab ? "active" : ""}`} onClick={() => setActiveTab(tab)}>
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "Users" ? (
        <div className="data-table-wrapper">
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last active</th></tr></thead>
            <tbody>
              {detail.users.map((user) => (
                <tr key={user.id}>
                  <td>{user.displayName}</td>
                  <td>{user.email}</td>
                  <td><span className="chip">{user.role}</span></td>
                  <td>{user.status}</td>
                  <td>{new Date(user.lastActiveAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {activeTab === "Connectors" ? (
        <div className="connector-grid">
          {detail.connectors.map((connector) => (
            <article key={`${connector.provider}-${connector.userId}`} className="connector-card">
              <div className="connector-card-header">
                <div>
                  <h4>{connector.provider}</h4>
                  <span className="connector-meta">User {connector.userId}</span>
                </div>
                <span className={`status-pill ${connector.status.toLowerCase()}`}>{connector.status}</span>
              </div>
              <p className="connector-meta">Updated {new Date(connector.updatedAt).toLocaleString()}</p>
              {connector.lastError ? <p className="danger-text">{connector.lastError}</p> : null}
            </article>
          ))}

          <article className="connector-card">
            <div className="connector-card-header">
              <div>
                <h4>Policy baseline</h4>
                <span className="connector-meta">Server-enforced</span>
              </div>
            </div>
            <div className="permission-list">
              {baselinePolicies.map((policy) => (
                <article key={policy.tool} className="permission-item">
                  <div>
                    <strong>{policy.tool}</strong>
                    <p>{policy.scope} · {policy.roles}</p>
                  </div>
                  <span className="status-pill connected">Active</span>
                </article>
              ))}
            </div>
          </article>
        </div>
      ) : null}

      {activeTab === "Audit" ? (
        <div className="data-table-wrapper">
          <table>
            <thead><tr><th>Time</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
            <tbody>
              {detail.audit.map((event) => (
                <tr key={event.id}>
                  <td>{new Date(event.createdAt).toLocaleString()}</td>
                  <td><span className="chip">{event.action}</span></td>
                  <td>{event.targetType}{event.targetId ? ` · ${event.targetId}` : ""}</td>
                  <td>{JSON.stringify(event.metadata)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
