import { PageHeader } from "../../../components/page-header";
import { demoPermissions } from "../../../lib/demo-data";

export default function PermissionsPage() {
  return (
    <div className="stack">
      <PageHeader
        eyebrow="Guardrails"
        title="Tool permissions"
        description="Review which customer roles can use which AI-enabled tools."
      />

      <div className="permission-list">
        {demoPermissions.map((permission) => (
          <article key={permission.tool} className="permission-item">
            <div>
              <strong>{permission.tool}</strong>
              <p>{permission.roles.join(", ")}</p>
            </div>
            <span className={`status-pill ${permission.enabled ? "connected" : "disconnected"}`}>
              {permission.enabled ? "Enabled" : "Restricted"}
            </span>
          </article>
        ))}
      </div>
    </div>
  );
}
