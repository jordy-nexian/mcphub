import { PageHeader } from "../../../../components/page-header";

export default function AdminSettingsPage() {
  return (
    <div className="stack">
      <PageHeader
        eyebrow="Platform Settings"
        title="Commercial and technical defaults"
        description="Baseline settings for how Nexian packages and operates the platform."
      />

      <div className="grid two">
        <section className="settings-section">
          <div className="settings-section-header">Platform</div>
          <div className="settings-row"><span>MCP endpoint base</span><code>localhost:4100</code></div>
          <div className="settings-row"><span>Environment</span><span className="chip">Development</span></div>
        </section>
        <section className="settings-section">
          <div className="settings-section-header">Security</div>
          <div className="settings-row"><span>Session timeout</span><span>7 days</span></div>
          <div className="settings-row"><span>Token expiry</span><span>1 hour</span></div>
        </section>
      </div>
    </div>
  );
}
