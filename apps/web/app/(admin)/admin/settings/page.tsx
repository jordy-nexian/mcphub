import { PageHeader } from "../../../../components/page-header";

const settingsGroups = [
  {
    title: "Platform",
    rows: [
      ["MCP endpoint base", "Configured from deployment"],
      ["Environment", "Production-ready runtime"],
      ["Tenant model", "Separate MSP and tenant roles"]
    ]
  },
  {
    title: "Security",
    rows: [
      ["Session timeout", "7 days"],
      ["Access token expiry", "1 hour"],
      ["Connector tokens", "Encrypted at rest"]
    ]
  },
  {
    title: "Operations",
    rows: [
      ["Connector ownership", "User-scoped inside tenant"],
      ["Admin surfaces", "Platform roles only"],
      ["Workflow visibility", "n8n API-backed"]
    ]
  }
] as const;

export default function AdminSettingsPage() {
  return (
    <div className="stack">
      <PageHeader
        eyebrow="Admin"
        title="Admin settings"
        description="Commercial, security, and operational defaults for how Nexian runs the platform."
      />

      <div className="tabs">
        <span className="tab active">Admin</span>
      </div>

      <div className="grid two">
        {settingsGroups.map((group) => (
          <section key={group.title} className="settings-section">
            <div className="settings-section-header">{group.title}</div>
            {group.rows.map(([label, value]) => (
              <div key={label} className="settings-row">
                <span>{label}</span>
                <span>{value}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
