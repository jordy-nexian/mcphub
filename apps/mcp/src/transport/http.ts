import { z } from "zod";

const jsonRpcIdSchema = z.union([z.string(), z.number(), z.null()]);

export const jsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: jsonRpcIdSchema.optional(),
  method: z.string().min(1),
  params: z.unknown().optional()
});

export const toolsCallParamsSchema = z.object({
  name: z.string().min(1),
  arguments: z.record(z.unknown()).optional()
});

export const toolsListParamsSchema = z.object({
  cursor: z.string().optional()
});

export const initializeParamsSchema = z.object({
  protocolVersion: z.string().optional(),
  capabilities: z.record(z.unknown()).optional(),
  clientInfo: z
    .object({
      name: z.string().optional(),
      version: z.string().optional()
    })
    .optional()
});

export type JsonRpcRequest = z.infer<typeof jsonRpcRequestSchema>;
export type JsonRpcId = z.infer<typeof jsonRpcIdSchema>;

export function jsonRpcResult(id: JsonRpcId | undefined, result: unknown) {
  return {
    jsonrpc: "2.0" as const,
    id: id ?? null,
    result
  };
}

export function jsonRpcError(id: JsonRpcId | undefined, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: "2.0" as const,
    id: id ?? null,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data })
    }
  };
}
