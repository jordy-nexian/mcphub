import { z } from "zod";

export const toolNames = [
  "find_customer",
  "list_open_tickets",
  "get_ticket",
  "list_ticket_actions",
  "search_projects",
  "find_contact",
  "search_documents",
  "list_devices_for_site",
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

