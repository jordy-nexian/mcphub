export const demoTenants = [
  {
    id: "t-001",
    name: "Legal Ops Co",
    slug: "legal-ops-co",
    status: "active" as const,
    userCount: 8,
    connectorCount: 3,
    createdAt: "2026-01-15"
  },
  {
    id: "t-002",
    name: "Meridian IT Services",
    slug: "meridian-it",
    status: "active" as const,
    userCount: 12,
    connectorCount: 4,
    createdAt: "2026-01-28"
  },
  {
    id: "t-003",
    name: "Apex Consulting",
    slug: "apex-consulting",
    status: "active" as const,
    userCount: 5,
    connectorCount: 2,
    createdAt: "2026-02-10"
  }
];

export const demoUsers = [
  { id: "u-002", name: "Sarah Chen", email: "sarah@legalops.com", role: "OWNER", tenantId: "t-001", tenantName: "Legal Ops Co", lastActive: "2026-03-30" },
  { id: "u-003", name: "James Rodriguez", email: "james@legalops.com", role: "ANALYST", tenantId: "t-001", tenantName: "Legal Ops Co", lastActive: "2026-03-29" },
  { id: "u-004", name: "Mike Thompson", email: "mike@meridianit.com", role: "ADMIN", tenantId: "t-002", tenantName: "Meridian IT Services", lastActive: "2026-03-30" },
  { id: "u-005", name: "Rachel Green", email: "rachel@meridianit.com", role: "OWNER", tenantId: "t-002", tenantName: "Meridian IT Services", lastActive: "2026-03-30" },
  { id: "u-006", name: "David Kim", email: "david@apex.io", role: "OWNER", tenantId: "t-003", tenantName: "Apex Consulting", lastActive: "2026-03-29" }
];

export const demoGlobalConnectors = [
  { id: "halopsa", name: "HaloPSA", category: "Service desk", status: "Connected" as const, tenantId: "t-001", tenantName: "Legal Ops Co", lastSync: "5 min ago", tools: ["find_customer", "list_open_tickets", "get_ticket"] },
  { id: "microsoft365", name: "Microsoft 365", category: "Documents", status: "Connected" as const, tenantId: "t-001", tenantName: "Legal Ops Co", lastSync: "18 min ago", tools: ["search_documents", "find_contact"] },
  { id: "halopsa", name: "HaloPSA", category: "Service desk", status: "Connected" as const, tenantId: "t-002", tenantName: "Meridian IT Services", lastSync: "2 min ago", tools: ["find_customer", "list_open_tickets"] },
  { id: "hubspot", name: "HubSpot CRM", category: "CRM", status: "Connected" as const, tenantId: "t-002", tenantName: "Meridian IT Services", lastSync: "1 hr ago", tools: ["find_contact"] },
  { id: "microsoft365", name: "Microsoft 365", category: "Documents", status: "Needs consent" as const, tenantId: "t-003", tenantName: "Apex Consulting", lastSync: "Pending", tools: ["search_documents"] }
];

export const demoAuditEvents = [
  { id: "ae-01", time: "10:42", action: "Tool invoked", detail: "list_open_tickets called for tenant legal-ops-co.", tenantName: "Legal Ops Co", actor: "Sarah Chen" },
  { id: "ae-02", time: "10:38", action: "Connector connected", detail: "HaloPSA completed OAuth successfully.", tenantName: "Legal Ops Co", actor: "Sarah Chen" },
  { id: "ae-03", time: "10:30", action: "Policy updated", detail: "create_draft_ticket restricted to Owner and Admin roles.", tenantName: "Legal Ops Co", actor: "Nexian Admin" },
  { id: "ae-04", time: "10:22", action: "MCP token issued", detail: "Bearer token generated for testing.", tenantName: "Meridian IT Services", actor: "Mike Thompson" },
  { id: "ae-05", time: "10:15", action: "Connector connected", detail: "HubSpot CRM OAuth completed.", tenantName: "Meridian IT Services", actor: "Rachel Green" },
  { id: "ae-06", time: "09:45", action: "Token refresh failed", detail: "Microsoft 365 refresh token expired.", tenantName: "Apex Consulting", actor: "System" }
];

export const demoPermissions = [
  { tool: "list_open_tickets", roles: ["Owner", "Admin", "Analyst", "User"], enabled: true },
  { tool: "search_documents", roles: ["Owner", "Admin", "Analyst", "User"], enabled: true },
  { tool: "find_customer", roles: ["Owner", "Admin", "Analyst"], enabled: true },
  { tool: "create_draft_ticket", roles: ["Owner", "Admin"], enabled: true },
  { tool: "add_internal_note", roles: ["Owner", "Admin"], enabled: false }
];
