import { z } from "zod";

import { getProviderRegistry } from "@nexian/connectors";

function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties = Object.fromEntries(
      Object.entries(shape).map(([key, value]) => [key, zodToJsonSchema(value as z.ZodTypeAny)])
    );

    const required = Object.entries(shape)
      .filter(([, value]) => !(value instanceof z.ZodOptional) && !(value instanceof z.ZodDefault))
      .map(([key]) => key);

    return {
      type: "object",
      properties,
      additionalProperties: false,
      ...(required.length > 0 ? { required } : {})
    };
  }

  if (schema instanceof z.ZodString) {
    return { type: "string" };
  }

  if (schema instanceof z.ZodNumber) {
    return { type: "number" };
  }

  if (schema instanceof z.ZodBoolean) {
    return { type: "boolean" };
  }

  if (schema instanceof z.ZodArray) {
    return { type: "array", items: zodToJsonSchema(schema.element) };
  }

  if (schema instanceof z.ZodOptional) {
    return zodToJsonSchema(schema.unwrap());
  }

  if (schema instanceof z.ZodDefault) {
    return zodToJsonSchema(schema._def.innerType);
  }

  return { type: "object", additionalProperties: true };
}

export function buildToolCatalog() {
  const providers = getProviderRegistry();
  return [...providers.values()].flatMap((provider) =>
    provider.getTools().map((tool) => ({
      provider: provider.provider,
      name: tool.name,
      description: tool.description,
      inputSchema: zodToJsonSchema(tool.inputSchema as z.ZodTypeAny)
    }))
  );
}
