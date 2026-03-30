"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";

import { clearPlatformSession, readPlatformSession } from "../lib/platform-auth";

const adminNav = [
  { href: "/admin/dashboard", label: "Overview", caption: "Platform health" },
  { href: "/admin/tenants", label: "Tenants", caption: "Customer estates" },
  { href: "/admin/connectors", label: "Connectors", caption: "Provider health" },
  { href: "/admin/audit", label: "Audit", caption: "Cross-tenant activity" },
  { href: "/admin/users", label: "Users", caption: "Platform access" },
  { href: "/admin/settings", label: "Settings", caption: "Commercial setup" }
] as const;

const tenantNav = [
  { href: "/dashboard", label: "Overview", caption: "Workspace health" },
  { href: "/dashboard/connectors", label: "Connectors", caption: "Linked products" },
  { href: "/dashboard/permissions", label: "Permissions", caption: "Tool guardrails" },
  { href: "/dashboard/audit", label: "Audit", caption: "Operational trail" },
  { href: "/dashboard/mcp", label: "MCP Access", caption: "Endpoint and tokens" }
] as const;

function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function Sidebar({ variant }: { variant: "admin" | "tenant" }) {
  const pathname = usePathname();
  const session = readPlatformSession();
  const nav = variant === "admin" ? adminNav : tenantNav;
  const displayName = session?.user.displayName ?? "Guest";

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <Link href={(variant === "admin" ? "/admin/dashboard" : "/dashboard") as Route} className="sidebar-brand">
          <span className="sidebar-logo">N</span>
          <span className="sidebar-brand-copy">
            <strong>Nexian Command</strong>
            <span>{variant === "admin" ? "MSP Operations Console" : "Customer Workspace"}</span>
          </span>
        </Link>

        <div className="sidebar-panel">
          <span className="sidebar-kicker">Mode</span>
          <strong>{variant === "admin" ? "Platform" : "Tenant"}</strong>
          <p>
            {variant === "admin"
              ? "Operate customer estates, product packaging, and cross-tenant governance."
              : "Manage customer integrations, permissions, and governed AI access."}
          </p>
        </div>

        <nav className="sidebar-nav">
          {nav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link key={item.href} href={item.href as Route} className={`sidebar-link ${active ? "active" : ""}`}>
                <span className="sidebar-link-label">{item.label}</span>
                <span className="sidebar-link-caption">{item.caption}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="sidebar-user">
        <div className="sidebar-avatar">{getInitials(displayName)}</div>
        <div className="sidebar-user-copy">
          <strong>{displayName}</strong>
          <span>{session?.user.email ?? "No active session"}</span>
        </div>
        <button
          className="button secondary sidebar-signout"
          type="button"
          onClick={() => {
            clearPlatformSession();
            window.location.href = "/auth/login";
          }}
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
