import crypto from "node:crypto";
import Fastify from "fastify";
import jwt from "jsonwebtoken";

import { getProviderRegistry } from "@nexian/connectors";

import { parseBearerToken } from "./auth/bearer";
import { buildToolCatalog } from "./tools/catalog";
import { mcpInvocationSchema } from "./transport/http";

const app = Fastify({ logger: true });
const jwtSecret = process.env.SESSION_SECRET ?? "local-session-secret";
const providers = getProviderRegistry();

app.get("/health", async () => ({ ok: true }));

app.get("/.well-known/oauth-protected-resource", async () => ({
  resource: process.env.MCP_URL ?? "http://localhost:4100",
  authorization_servers: [process.env.API_URL ?? "http://localhost:4000"]
}));

app.get("/tools", async (request) => {
  parseBearerToken(request.headers.authorization, jwtSecret);
  return { tools: buildToolCatalog() };
});

app.post("/invoke", async (request) => {
  const auth = parseBearerToken(request.headers.authorization, jwtSecret);
  const invocation = mcpInvocationSchema.parse(request.body);

  const provider = [...providers.values()].find((candidate) =>
    candidate.getTools().some((tool) => tool.name === invocation.tool)
  );

  if (!provider) {
    throw new Error(`Unknown tool ${invocation.tool}`);
  }

  const tool = provider.getTools().find((candidate) => candidate.name === invocation.tool);
  if (!tool) {
    throw new Error(`Tool ${invocation.tool} not found`);
  }

  const output = await tool.execute(
    {
      ...auth,
      requestId: crypto.randomUUID(),
      accountId: "connected-account-placeholder"
    },
    invocation.arguments
  );

  return { result: output };
});

app.post("/tokens/demo", async (request) => {
  const body = request.body as { tenantId: string; userId: string; roles?: string[] };
  return {
    token: jwt.sign(
      {
        tenantId: body.tenantId,
        userId: body.userId,
        roles: body.roles ?? ["ADMIN"]
      },
      jwtSecret,
      { expiresIn: "1h" }
    )
  };
});

app.listen({ host: "0.0.0.0", port: Number(process.env.MCP_PORT ?? 4100) }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
