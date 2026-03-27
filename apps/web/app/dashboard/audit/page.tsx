import { Nav } from "../../../components/nav";

const auditRows = [
  { time: "2026-03-24T10:20:00Z", action: "TOOL_INVOKED", actor: "AI client", target: "list_open_tickets" },
  { time: "2026-03-24T10:22:00Z", action: "CONNECTOR_CONNECTED", actor: "Workspace admin", target: "HaloPSA" },
  { time: "2026-03-24T10:25:00Z", action: "TOKEN_REFRESHED", actor: "System", target: "connected_account_42" }
];

export default function AuditPage() {
  return (
    <main className="shell stack">
      <Nav />
      <section className="hero stack">
        <span className="eyebrow">Operational Audit</span>
        <h1 style={{ margin: 0 }}>Connector and MCP audit trail</h1>
        <p className="muted" style={{ maxWidth: 760 }}>
          Every connector lifecycle change and every MCP request should land here with tenant context, actor identity,
          and enough detail to support security review.
        </p>
      </section>
      <section className="panel">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Action</th>
              <th>Actor</th>
              <th>Target</th>
            </tr>
          </thead>
          <tbody>
            {auditRows.map((row) => (
              <tr key={`${row.time}-${row.action}`}>
                <td>{row.time}</td>
                <td>{row.action}</td>
                <td>{row.actor}</td>
                <td>{row.target}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
