import { PageHeader } from "../../components/page-header";
import { StatsCard } from "../../components/stats-card";
import { demoGlobalConnectors, demoPermissions } from "../../lib/demo-data";

export default function DashboardPage() {
  return (
    <div className="stack">
      <PageHeader
        eyebrow="Customer Portal"
        title="Workspace overview"
        description="A governed customer workspace for integrations, permissions, and managed MCP access."
      />

      <div className="stats-row">
        <StatsCard value={demoGlobalConnectors.length} label="Available connectors" />
        <StatsCard value={demoPermissions.filter((item) => item.enabled).length} label="Enabled tools" />
        <StatsCard value="1" label="Tenant endpoint" />
        <StatsCard value="Healthy" label="Workspace status" />
      </div>

      <section className="grid two">
        <article className="panel stack">
          <span className="eyebrow">Managed Service</span>
          <h2>One workspace, many products</h2>
          <p className="muted">
            Bring service desk, documentation, CRM, and Microsoft tools into a single governed AI surface.
          </p>
        </article>

        <article className="panel stack">
          <span className="eyebrow">Governance</span>
          <h2>Nexian controlled by design</h2>
          <p className="muted">
            Nexian can limit tools and actions per role while the customer sees a clean, confident workspace experience.
          </p>
        </article>
      </section>
    </div>
  );
}
