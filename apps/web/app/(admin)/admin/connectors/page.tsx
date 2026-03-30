import { PageHeader } from "../../../../components/page-header";
import { StatsCard } from "../../../../components/stats-card";
import { demoGlobalConnectors } from "../../../../lib/demo-data";

export default function AdminConnectorsPage() {
  const connectedCount = demoGlobalConnectors.filter((item) => item.status === "Connected").length;

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Provider Estate"
        title="Connector overview"
        description="See how customer products are linked into the Nexian platform."
      />

      <div className="stats-row">
        <StatsCard value={connectedCount} label="Connected instances" />
        <StatsCard value={4} label="Providers" />
        <StatsCard value="HaloPSA" label="Primary live path" />
        <StatsCard value="Low" label="Error rate" />
      </div>

      <div className="data-table-wrapper">
        <table>
          <thead><tr><th>Tenant</th><th>Provider</th><th>Status</th><th>Last sync</th></tr></thead>
          <tbody>
            {demoGlobalConnectors.map((connector, index) => (
              <tr key={`${connector.id}-${index}`}>
                <td>{connector.tenantName}</td>
                <td>{connector.name}</td>
                <td><span className={`status-pill ${connector.status.toLowerCase().replace(/\s+/g, "-")}`}>{connector.status}</span></td>
                <td>{connector.lastSync}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
