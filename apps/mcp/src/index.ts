import crypto from "node:crypto";

import Fastify from "fastify";

import { getProviderRegistry } from "@nexian/connectors";
import type { AuthContext, ToolExecutionContext } from "@nexian/core/domain/models";
import type { NormalizedToolResponse } from "@nexian/core/mcp/tools";

import { parseBearerToken } from "./auth/bearer";
import { buildToolCatalog } from "./tools/catalog";
import {
  initializeParamsSchema,
  jsonRpcError,
  jsonRpcRequestSchema,
  jsonRpcResult,
  toolsCallParamsSchema,
  toolsListParamsSchema
} from "./transport/http";

const app = Fastify({ logger: true });
const jwtSecret = process.env.SESSION_SECRET ?? "local-session-secret";
const providers = getProviderRegistry();
const toolCatalog = buildToolCatalog();
const sessionAuth = new Map<string, AuthContext>();
const heartbeatTimers = new WeakMap<NodeJS.WritableStream, NodeJS.Timeout>();

function getAuthContext(authorization: string | undefined): AuthContext {
  return parseBearerToken(authorization, jwtSecret);
}

function validateSession(sessionId: string | undefined) {
  if (!sessionId) {
    return;
  }

  if (!sessionAuth.has(sessionId)) {
    throw new Error("Unknown MCP session");
  }
}

async function executeTool(auth: AuthContext, name: string, input: Record<string, unknown>) {
  const provider = [...providers.values()].find((candidate) =>
    candidate.getTools().some((tool) => tool.name === name)
  );

  if (!provider) {
    throw new Error(`Unknown tool ${name}`);
  }

  const tool = provider.getTools().find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Tool ${name} not found`);
  }

  const context: ToolExecutionContext = {
    ...auth,
    requestId: crypto.randomUUID(),
    accountId: "connected-account-placeholder"
  };

  return tool.execute(context, input) as Promise<NormalizedToolResponse>;
}

function buildToolCallResult(output: NormalizedToolResponse) {
  return {
    content: [
      {
        type: "text",
        text: output.summary
      }
    ],
    structuredContent: output,
    isError: false
  };
}

function registerMcpHttpEndpoint(path: string) {
  app.get(path, async (request, reply) => {
    getAuthContext(request.headers.authorization);
    validateSession(request.headers["mcp-session-id"] as string | undefined);

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    });
    reply.raw.write(": connected\n\n");

    const timer = setInterval(() => {
      reply.raw.write(": ping\n\n");
    }, 15000);

    heartbeatTimers.set(reply.raw, timer);

    request.raw.on("close", () => {
      const activeTimer = heartbeatTimers.get(reply.raw);
      if (activeTimer) {
        clearInterval(activeTimer);
      }
      heartbeatTimers.delete(reply.raw);
    });

    return reply.hijack();
  });

  app.post(path, async (request, reply) => {
    const parsed = jsonRpcRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(jsonRpcError(undefined, -32600, "Invalid Request", parsed.error.flatten()));
    }

    const rpc = parsed.data;

    try {
      if (rpc.method === "initialize") {
        const auth = getAuthContext(request.headers.authorization);
        const params = initializeParamsSchema.parse(rpc.params ?? {});
        const sessionId = crypto.randomUUID();
        sessionAuth.set(sessionId, auth);
        reply.header("Mcp-Session-Id", sessionId);

        return reply.send(
          jsonRpcResult(rpc.id, {
            protocolVersion: params.protocolVersion ?? "2025-03-26",
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: "nexian-mcp-hub",
              version: "0.1.0"
            }
          })
        );
      }

      const auth = getAuthContext(request.headers.authorization);
      validateSession(request.headers["mcp-session-id"] as string | undefined);

      if (rpc.method === "notifications/initialized") {
        return reply.status(202).send();
      }

      if (rpc.method === "ping") {
        return reply.send(jsonRpcResult(rpc.id, {}));
      }

      if (rpc.method === "tools/list") {
        toolsListParamsSchema.parse(rpc.params ?? {});
        return reply.send(
          jsonRpcResult(rpc.id, {
            tools: toolCatalog
          })
        );
      }

      if (rpc.method === "tools/call") {
        const params = toolsCallParamsSchema.parse(rpc.params ?? {});
        const output = await executeTool(auth, params.name, params.arguments ?? {});
        return reply.send(jsonRpcResult(rpc.id, buildToolCallResult(output)));
      }

      return reply.status(404).send(jsonRpcError(rpc.id, -32601, `Method not found: ${rpc.method}`));
    } catch (error) {
      request.log.error(error);
      const message = error instanceof Error ? error.message : "Unexpected MCP server error";
      return reply.status(500).send(jsonRpcError(rpc.id, -32000, message));
    }
  });
}

app.get("/health", async () => ({ ok: true }));

app.get("/.well-known/oauth-protected-resource", async () => ({
  resource: process.env.MCP_URL ?? "http://localhost:4100",
  authorization_servers: [process.env.API_URL ?? "http://localhost:4000"]
}));

registerMcpHttpEndpoint("/");
registerMcpHttpEndpoint("/mcp");
registerMcpHttpEndpoint("/invoke");

app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? process.env.MCP_PORT ?? 4100) }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
