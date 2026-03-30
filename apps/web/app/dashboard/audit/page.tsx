import { PageHeader } from "../../../components/page-header";
import { demoAuditEvents } from "../../../lib/demo-data";

export default function AuditPage() {
  return (
    <div className="stack">
      <PageHeader
        eyebrow="Workspace Audit"
        title="Operational activity"
        description="Review connector changes, token issuance, and policy events for this managed workspace."
      />

      <div className="data-table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Action</th>
              <th>Actor</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {demoAuditEvents.map((event) => (
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
    </div>
  );
}
