import { z } from "zod";

export const toolNames = [
  "find_customer",
  "get_customer_overview",
  "list_open_tickets",
  "get_ticket",
  "get_ticket_with_actions",
  "list_ticket_actions",
  "search_projects",
  "find_contact",
  "search_documents",
  "list_devices_for_site",
  "list_halo_categories",
  "get_user_devices",
  "list_rmm_organizations",
  "get_rmm_organization",
  "list_rmm_devices_for_site",
  "search_rmm_documents",
  "find_rmm_contact",
  "search_rmm_devices",
  "get_rmm_device_overview",
  "get_rmm_device_alerts",
  "get_rmm_device_activities",
  "list_workflows",
  "get_workflow",
  "list_executions",
  "get_execution",
  "trigger_webhook",
  "get_recent_invoices",
  "create_draft_ticket",
  "add_internal_note"
] as const;

export type ToolName = (typeof toolNames)[number];

export const normalizedToolResponseSchema = z.object({
  summary: z.string(),
  data: z.array(z.record(z.unknown())).default([]),
  nextCursor: z.string().optional(),
  source: z.string()
});

export type NormalizedToolResponse = z.infer<typeof normalizedToolResponseSchema>;
