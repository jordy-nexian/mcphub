"use client";

import Link from "next/link";
import type { Route } from "next";
import { useParams } from "next/navigation";
import { useState } from "react";

import { PageHeader } from "../../../../../components/page-header";
import { demoAuditEvents, demoGlobalConnectors, demoPermissions, demoTenants, demoUsers } from "../../../../../lib/demo-data";

const tabs = ["Users", "Connectors", "Policies", "Audit"] as const;
type Tab = (typeof tabs)[number];

export default function TenantDetailPage() {
  const params = useParams();
  const [activeTab, setActiveTab] = useState<Tab>("Users");
  const tenantId = params.tenantId as string;
  const tenant = demoTenants.find((item) => item.id === tenantId);

  if (!tenant) {
    return <div className="empty-state"><h3>Tenant not found</h3><p>This customer workspace is not available.</p></div>;
  }

  const users = demoUsers.filter((user) => user.tenantId === tenantId);
  const connectors = demoGlobalConnectors.filter((connector) => connector.tenantId === tenantId);
  const audit = demoAuditEvents.filter((event) => event.tenantName === tenant.name);

  return (
    <div className="stack">
      <div className="breadcrumb">
        <Link href={"/admin/tenants" as Route}>Tenants</Link>
        <span>/</span>
        <span>{tenant.name}</span>
      </div>

      <PageHeader
        eyebrow="Tenant Workspace"
        title={tenant.name}
        description={`Slug: ${tenant.slug} · Status: ${tenant.status} · Created: ${tenant.createdAt}`}
      />

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
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last active</th></tr></thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.name}</td>
                  <td>{user.email}</td>
                  <td><span className="chip">{user.role}</span></td>
                  <td>{user.lastActive}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {activeTab === "Connectors" ? (
        <div className="connector-grid">
          {connectors.map((connector, index) => (
            <article key={`${connector.id}-${index}`} className="connector-card">
              <div className="connector-card-header">
                <div>
                  <h4>{connector.name}</h4>
                  <span className="connector-meta">{connector.category}</span>
                </div>
                <span className={`status-pill ${connector.status.toLowerCase().replace(/\s+/g, "-")}`}>{connector.status}</span>
              </div>
              <div className="chip-row">
                {connector.tools.map((tool) => <span key={tool} className="chip">{tool}</span>)}
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {activeTab === "Policies" ? (
        <div className="permission-list">
          {demoPermissions.map((permission) => (
            <article key={permission.tool} className="permission-item">
              <div>
                <strong>{permission.tool}</strong>
                <p>{permission.roles.join(", ")}</p>
              </div>
              <span className={`status-pill ${permission.enabled ? "connected" : "disconnected"}`}>
                {permission.enabled ? "Enabled" : "Restricted"}
              </span>
            </article>
          ))}
        </div>
      ) : null}

      {activeTab === "Audit" ? (
        <div className="data-table-wrapper">
          <table>
            <thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Detail</th></tr></thead>
            <tbody>
              {audit.map((event) => (
                <tr key={event.id}>
                  <td>{event.time}</td>
                  <td><span className="chip">{event.action}</span></td>
                  <td>{event.actor}</td>
                  <td>{event.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
