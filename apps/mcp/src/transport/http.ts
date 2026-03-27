import { z } from "zod";

export const mcpInvocationSchema = z.object({
  tool: z.string().min(1),
  arguments: z.record(z.unknown()).default({})
});

export type McpInvocation = z.infer<typeof mcpInvocationSchema>;

