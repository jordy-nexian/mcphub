"use client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { PageHeader } from "../../../../components/page-header";
import { readPlatformSession, writePlatformSession, type PlatformSession } from "../../../../lib/platform-auth";

type TenantSummary = {
  id: string;
  name: string;
  slug: string;
  type: string;
  status: string;
  plan: string;
  vertical: string;
  region: string;
  userCount: number;
  connectorCount: number;
};

export default function TenantsPage() {
  const router = useRouter();
  const [session, setSession] = useState<PlatformSession | null>(null);
  const [search, setSearch] = useState("");
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [workspaceName, setWorkspaceName] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");

  const apiOrigin = useMemo(
    () => process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
    []
  );

  useEffect(() => {
    const storedSession = readPlatformSession();
    if (!storedSession) {
      router.replace("/auth/login");
      return;
    }

    setSession(storedSession);
  }, [router]);

  useEffect(() => {
    async function loadTenants() {
      if (!session) {
        return;
      }

      setLoading(true);
      setNotice("");

      try {
        const response = await fetch(`${apiOrigin}/platform/tenants`, {
          headers: {
            authorization: `Bearer ${session.token}`
          }
        });

        if (!response.ok) {
          throw new Error(`Could not load tenants (${response.status})`);
        }

        const payload = (await response.json()) as { tenants: TenantSummary[] };
        setTenants(payload.tenants);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not load tenants.");
      } finally {
        setLoading(false);
      }
    }

    void loadTenants();
  }, [apiOrigin, session]);

  async function createTenant() {
    if (!session || !workspaceName.trim()) {
      setNotice("Enter a tenant name first.");
      return;
    }

    setCreating(true);
    setNotice("");

    try {
      const response = await fetch(`${apiOrigin}/auth/tenants`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.token}`
        },
        body: JSON.stringify({ workspaceName: workspaceName.trim() })
      });

      const payload = (await response.json()) as
        | PlatformSession
        | { error?: string; message?: string };

      if (!response.ok) {
        throw new Error(("message" in payload && payload.message) || ("error" in payload && payload.error) || "Could not create tenant");
      }

      const nextSession = payload as PlatformSession;
      writePlatformSession(nextSession);
      setSession(nextSession);
      setWorkspaceName("");
      setNotice(`Created ${nextSession.tenant.name}.`);

      const tenantsResponse = await fetch(`${apiOrigin}/platform/tenants`, {
        headers: {
          authorization: `Bearer ${nextSession.token}`
        }
      });

      if (tenantsResponse.ok) {
        const tenantsPayload = (await tenantsResponse.json()) as { tenants: TenantSummary[] };
        setTenants(tenantsPayload.tenants);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create tenant.");
    } finally {
      setCreating(false);
    }
  }

  const filtered = tenants.filter((tenant) =>
    `${tenant.name} ${tenant.slug} ${tenant.vertical} ${tenant.region}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Customer Estates"
        title="Managed tenants"
        description="View each customer workspace Nexian can operate, govern, and package commercially."
      />

      <div className="panel stack">
        <div className="row row-spread row-wrap">
          <div className="stack stack-tight">
            <strong>Create a tenant</strong>
            <p className="muted">Add a new customer workspace and attach your current Nexian admin account as owner.</p>
          </div>
          <div className="row row-wrap">
            <input
              type="text"
              placeholder="Customer workspace name"
              value={workspaceName}
              onChange={(event) => setWorkspaceName(event.target.value)}
            />
            <button className="button primary" onClick={() => void createTenant()} type="button" disabled={creating}>
              {creating ? "Creating..." : "Create tenant"}
            </button>
          </div>
        </div>
        {notice ? <div className="notice">{notice}</div> : null}
      </div>

      <div className="filter-bar">
        <input
          type="text"
          placeholder="Search customer name, slug, vertical, or region"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {loading ? (
        <div className="panel">Loading tenants...</div>
      ) : (
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
                <p className="muted">
                  {tenant.type} · {tenant.plan} · {tenant.vertical} · {tenant.region}
                </p>
              </article>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
