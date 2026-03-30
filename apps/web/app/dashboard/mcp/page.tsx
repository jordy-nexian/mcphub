import { PageHeader } from "../../../components/page-header";

export default function McpPage() {
  return (
    <div className="stack">
      <PageHeader
        eyebrow="MCP Access"
        title="Endpoint and bearer access"
        description="Use the customer workspace endpoint to route approved tools into downstream AI clients."
      />

      <section className="grid two">
        <article className="panel stack">
          <span className="field-label">Endpoint</span>
          <code>http://localhost:4100/invoke</code>
          <p className="muted">
            Each customer workspace can be issued a dedicated token and routed through governed provider access.
          </p>
        </article>
        <article className="panel stack">
          <span className="field-label">Access model</span>
          <p className="muted">
            Nexian keeps MSP governance while the customer consumes a clean workspace-level MCP endpoint.
          </p>
        </article>
      </section>
    </div>
  );
}
