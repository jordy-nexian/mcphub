import { PageHeader } from "../../../components/page-header";

const productionGuardrails = [
  "Connector access is scoped per user and tenant.",
  "Provider tokens stay encrypted server-side and are never exposed to MCP clients.",
  "MCP tools are gated by the connected account, tenant membership, and role.",
  "Write actions remain explicitly constrained to guarded tools such as draft ticket creation and internal notes."
];

const toolPolicies = [
  { tool: "find_customer", roles: "Owner, Admin, Analyst, User", enabled: true },
  { tool: "get_customer_overview", roles: "Owner, Admin, Analyst, User", enabled: true },
  { tool: "list_open_tickets", roles: "Owner, Admin, Analyst, User", enabled: true },
  { tool: "get_ticket_with_actions", roles: "Owner, Admin, Analyst, User", enabled: true },
  { tool: "get_recent_invoices", roles: "Owner, Admin", enabled: true },
  { tool: "create_draft_ticket", roles: "Owner, Admin", enabled: true },
  { tool: "add_internal_note", roles: "Owner, Admin", enabled: false },
  { tool: "list_workflows", roles: "Owner, Admin, Analyst", enabled: true },
  { tool: "trigger_webhook", roles: "Owner, Admin", enabled: true }
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

      <div className="stack">
        <PageHeader
          eyebrow="Tool Matrix"
          title="Connector guardrails"
          description="These are the default role guardrails currently applied to the MCP tools exposed through the workspace."
        />
        <div className="permission-list">
          {toolPolicies.map((policy) => (
            <article key={policy.tool} className="permission-item">
              <div>
                <strong>{policy.tool}</strong>
                <p>{policy.roles}</p>
              </div>
              <span className={`status-pill ${policy.enabled ? "connected" : "disconnected"}`}>
                {policy.enabled ? "Enabled" : "Restricted"}
              </span>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
