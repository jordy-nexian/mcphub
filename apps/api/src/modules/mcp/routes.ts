import type { FastifyReply, FastifyInstance } from "fastify";
import { z } from "zod";

import type { AuditService } from "../audit/audit.service";
import type { ConnectorService } from "../connectors/connector.service";

const oauthQuerySchema = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  returnTo: z.string().url().optional()
});

const oauthCallbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1)
});

const connectedAccountQuerySchema = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1)
});

const disconnectSchema = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1)
});

function applyCors(reply: FastifyReply, origin: string) {
  reply.header("access-control-allow-origin", origin);
  reply.header("access-control-allow-headers", "content-type, authorization");
  reply.header("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
}

export function registerApiRoutes(
  app: FastifyInstance,
  deps: {
    connectorService: ConnectorService;
    auditService: AuditService;
    config: { apiUrl: string; appUrl: string };
  }
) {
  app.addHook("onRequest", async (_request, reply) => {
    applyCors(reply, deps.config.appUrl);
  });

  app.options("/*", async (_request, reply) => {
    applyCors(reply, deps.config.appUrl);
    return reply.status(204).send();
  });

  app.get("/health", async () => ({ ok: true }));

  app.get("/providers", async (request) => {
    const query = connectedAccountQuerySchema.safeParse(request.query);
    return {
      providers: await deps.connectorService.getProviders(
        query.success ? query.data.tenantId : undefined,
        query.success ? query.data.userId : undefined
      )
    };
  });

  app.get("/connected-accounts", async (request) => {
    const query = connectedAccountQuerySchema.parse(request.query);
    return { accounts: await deps.connectorService.getConnectedAccounts(query.tenantId, query.userId) };
  });

  app.get("/oauth/:provider/start", async (request, reply) => {
    const provider = (request.params as { provider: "halopsa" | "microsoft365" | "hubspot" | "itglue" }).provider;
    const query = oauthQuerySchema.parse(request.query);
    const result = deps.connectorService.beginOAuth(provider, query.tenantId, query.userId, query.returnTo);
    return reply.redirect(result.authorizationUrl);
  });

  app.get("/oauth/:provider/callback", async (request, reply) => {
    const provider = (request.params as { provider: "halopsa" | "microsoft365" | "hubspot" | "itglue" }).provider;
    const query = oauthCallbackSchema.parse(request.query);
    const result = await deps.connectorService.finishOAuth(provider, query.code, query.state);
    return reply.redirect(
      `${result.returnTo}?oauth=success&provider=${provider}&tenantId=${result.tenantId}&userId=${result.userId}`
    );
  });

  app.delete("/connected-accounts/:provider", async (request) => {
    const provider = (request.params as { provider: "halopsa" | "microsoft365" | "hubspot" | "itglue" }).provider;
    const query = disconnectSchema.parse(request.query);
    await deps.connectorService.disconnect(provider, query.tenantId, query.userId);
    return { ok: true };
  });

  app.post("/auth/mcp-token", async (request) => {
    const body = z
      .object({
        tenantId: z.string().min(1),
        userId: z.string().min(1),
        roles: z.array(z.string()).optional()
      })
      .parse(request.body);

    return { token: deps.connectorService.issueMcpToken(body.tenantId, body.userId, body.roles) };
  });
}

