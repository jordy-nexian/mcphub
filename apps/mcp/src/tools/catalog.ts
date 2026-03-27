import { getProviderRegistry } from "@nexian/connectors";

export function buildToolCatalog() {
  const providers = getProviderRegistry();
  return [...providers.values()].flatMap((provider) =>
    provider.getTools().map((tool) => ({
      provider: provider.provider,
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }))
  );
}

