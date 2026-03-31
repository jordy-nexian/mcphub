import { PageHeader } from "../../../components/page-header";

const productionGuardrails = [
  "Connector access is scoped per user and tenant.",
  "Provider tokens stay encrypted server-side and are never exposed to MCP clients.",
  "MCP tools are gated by the connected account, tenant membership, and role.",
  "Write actions remain explicitly constrained to guarded tools such as draft ticket creation and internal notes."
];

export default function PermissionsPage() {
  return (
    <div className="stack">
      <PageHeader
        eyebrow="Guardrails"
        title="Tool permissions"
        description="Production guardrails are enforced in the platform API and MCP layers, even while the policy editor is being finalised."
      />

      <div className="permission-list">
        {productionGuardrails.map((rule) => (
          <article key={rule} className="permission-item">
            <div>
              <strong>Enforced policy</strong>
              <p>{rule}</p>
            </div>
            <span className="status-pill connected">Active</span>
          </article>
        ))}
      </div>
    </div>
  );
}
