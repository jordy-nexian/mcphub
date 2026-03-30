import { PageHeader } from "../../../../components/page-header";
import { demoAuditEvents } from "../../../../lib/demo-data";

export default function AdminAuditPage() {
  return (
    <div className="stack">
      <PageHeader
        eyebrow="Cross-Tenant Audit"
        title="Platform audit logs"
        description="Review connector changes, tool usage, and operational events across managed customer estates."
      />

      <div className="data-table-wrapper">
        <table>
          <thead><tr><th>Time</th><th>Tenant</th><th>Action</th><th>Actor</th><th>Detail</th></tr></thead>
          <tbody>
            {demoAuditEvents.map((event) => (
              <tr key={event.id}>
                <td>{event.time}</td>
                <td>{event.tenantName}</td>
                <td><span className="chip">{event.action}</span></td>
                <td>{event.actor}</td>
                <td>{event.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
