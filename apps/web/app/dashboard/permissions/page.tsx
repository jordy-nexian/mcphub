"use client";

import { useEffect, useState } from "react";

import { PageHeader } from "../../../components/page-header";

const productionGuardrails = [
  "Connector access is scoped per user and tenant.",
  "Provider tokens stay encrypted server-side and are never exposed to MCP clients.",
  "MCP tools are gated by the connected account, tenant membership, and role.",
  "Write actions remain explicitly constrained to guarded tools such as draft ticket creation and internal notes."
];

const defaultToolPolicies = [
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

const storageKey = "nexian-tool-policies";

export default function PermissionsPage() {
  const [toolPolicies, setToolPolicies] = useState(defaultToolPolicies);

  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) {
      return;
    }

    try {
      const parsed = JSON.parse(stored) as typeof defaultToolPolicies;
      if (Array.isArray(parsed)) {
        setToolPolicies(parsed);
      }
    } catch {
      // Keep defaults if local storage is invalid.
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(toolPolicies));
  }, [toolPolicies]);

  function togglePolicy(tool: string) {
    setToolPolicies((current) =>
      current.map((policy) => (policy.tool === tool ? { ...policy, enabled: !policy.enabled } : policy))
    );
  }

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Guardrails"
        title="Tool permissions"
        description="Production guardrails are enforced in the platform API and MCP layers. Use the policy toggles below to model which tools should be enabled for this workspace."
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
          description="Toggle the default MCP tool exposure for this workspace. These switches currently persist in the portal and are ready to be wired to the live policy backend next."
        />
        <div className="permission-list">
          {toolPolicies.map((policy) => (
            <label key={policy.tool} className="permission-item">
              <div>
                <strong>{policy.tool}</strong>
                <p>{policy.roles}</p>
              </div>
              <button
                className={`toggle ${policy.enabled ? "enabled" : ""}`}
                onClick={() => togglePolicy(policy.tool)}
                type="button"
                aria-pressed={policy.enabled}
              >
                <span />
              </button>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
