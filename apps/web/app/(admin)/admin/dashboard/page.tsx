import { PageHeader } from "../../../../components/page-header";
import { StatsCard } from "../../../../components/stats-card";
import { demoAuditEvents, demoGlobalConnectors, demoTenants } from "../../../../lib/demo-data";

export default function AdminDashboardPage() {
  const liveConnectors = demoGlobalConnectors.filter((item) => item.status === "Connected").length;

  return (
    <div className="stack">
      <PageHeader
        eyebrow="MSP Console"
        title="Nexian platform overview"
        description="Operate customer estates, package the platform, and govern tenant AI access from a single command layer."
      />

      <div className="stats-row">
        <StatsCard value={demoTenants.length} label="Managed customers" trend={{ direction: "up", text: "+1 ready to onboard" }} />
        <StatsCard value={liveConnectors} label="Live integrations" trend={{ direction: "up", text: "Healthy connector estate" }} />
        <StatsCard value={demoAuditEvents.length} label="Audit events today" trend={{ direction: "up", text: "Cross-tenant visibility" }} />
        <StatsCard value="98.7%" label="Workspace availability" />
      </div>

      <section className="grid two">
        <article className="panel stack">
          <span className="eyebrow">Commercial Readiness</span>
          <h2>Built to sell</h2>
          <p className="muted">
            MSP-owned console, customer-facing workspaces, isolated tenant context, and governed MCP access.
          </p>
        </article>
        <article className="panel stack">
          <span className="eyebrow">Customer Estate</span>
          <h2>Tenant health snapshot</h2>
          <div className="tenant-health-list">
            {demoTenants.map((tenant) => (
              <div key={tenant.id} className="tenant-health-row">
                <div>
                  <strong>{tenant.name}</strong>
                  <p>{tenant.userCount} users · {tenant.connectorCount} connectors</p>
                </div>
                <span className={`status-pill ${tenant.status}`}>{tenant.status}</span>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
