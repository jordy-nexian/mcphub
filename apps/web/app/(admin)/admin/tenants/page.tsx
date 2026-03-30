"use client";

import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";

import { PageHeader } from "../../../../components/page-header";
import { demoTenants } from "../../../../lib/demo-data";

export default function TenantsPage() {
  const [search, setSearch] = useState("");
  const filtered = demoTenants.filter((tenant) =>
    `${tenant.name} ${tenant.slug}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Customer Estates"
        title="Managed tenants"
        description="View each customer workspace Nexian can operate, govern, and package commercially."
        actions={<button className="button primary">Create tenant</button>}
      />

      <div className="filter-bar">
        <input
          type="text"
          placeholder="Search customer name or slug"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <div className="grid two">
        {filtered.map((tenant) => (
          <Link key={tenant.id} href={`/admin/tenants/${tenant.id}` as Route} className="tenant-card-link">
            <article className="tenant-card">
              <div className="tenant-card-header">
                <div>
                  <h3>{tenant.name}</h3>
                  <span>{tenant.slug}</span>
                </div>
                <span className={`status-pill ${tenant.status}`}>{tenant.status}</span>
              </div>
              <div className="tenant-card-stats">
                <div className="tenant-card-stat">
                  <strong>{tenant.userCount}</strong>
                  <span>Users</span>
                </div>
                <div className="tenant-card-stat">
                  <strong>{tenant.connectorCount}</strong>
                  <span>Connectors</span>
                </div>
              </div>
              <p className="muted">Customer-ready workspace with dedicated guardrails and managed integrations.</p>
            </article>
          </Link>
        ))}
      </div>
    </div>
  );
}
