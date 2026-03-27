import type { FastifyReply, FastifyInstance } from "fastify";
import { z } from "zod";

import type { AuditService } from "../audit/audit.service";
import type { AuthService, PlatformAuthContext } from "../auth/auth.service";
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

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1),
  workspaceName: z.string().min(2)
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

function applyCors(reply: FastifyReply, origin: string) {
  reply.header("access-control-allow-origin", origin);
  reply.header("access-control-allow-headers", "content-type, authorization");
  reply.header("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
}

function parsePlatformAuth(
  authorizationHeader: string | undefined,
  authService: AuthService
): PlatformAuthContext | undefined {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    return undefined;
  }

  return authService.verifyPlatformToken(authorizationHeader.slice("Bearer ".length));
}

export function registerApiRoutes(
  app: FastifyInstance,
  deps: {
    authService: AuthService;
    connectorService: ConnectorService;
    auditService: AuditService;
    config: { apiUrl: string; appUrl: string; internalMcpSharedSecret: string; sessionSecret: string };
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

  app.post("/auth/register", async (request) => {
    const body = registerSchema.parse(request.body);
    return deps.authService.register(body);
  });

  app.post("/auth/login", async (request) => {
    const body = loginSchema.parse(request.body);
    return deps.authService.login(body.email, body.password);
  });

  app.get("/auth/me", async (request, reply) => {
    const auth = parsePlatformAuth(request.headers.authorization, deps.authService);
    if (!auth) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    return deps.authService.getSession(auth);
  });

  app.get("/providers", async (request) => {
    const auth = parsePlatformAuth(request.headers.authorization, deps.authService);
    const query = connectedAccountQuerySchema.safeParse(request.query);
    return {
      providers: await deps.connectorService.getProviders(
        auth?.tenantId ?? (query.success ? query.data.tenantId : undefined),
        auth?.userId ?? (query.success ? query.data.userId : undefined)
      )
    };
  });

  app.get("/connected-accounts", async (request, reply) => {
    const auth = parsePlatformAuth(request.headers.authorization, deps.authService);
    if (!auth) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    return { accounts: await deps.connectorService.getConnectedAccounts(auth.tenantId, auth.userId) };
  });

  app.post("/oauth/:provider/url", async (request, reply) => {
    const auth = parsePlatformAuth(request.headers.authorization, deps.authService);
    if (!auth) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const provider = (request.params as { provider: "halopsa" | "microsoft365" | "hubspot" | "itglue" }).provider;
    const body = z.object({ returnTo: z.string().url().optional() }).parse(request.body ?? {});
    const result = deps.connectorService.beginOAuth(provider, auth.tenantId, auth.userId, body.returnTo);
    return { authorizationUrl: result.authorizationUrl };
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

  app.delete("/connected-accounts/:provider", async (request, reply) => {
    const auth = parsePlatformAuth(request.headers.authorization, deps.authService);
    if (!auth) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const provider = (request.params as { provider: "halopsa" | "microsoft365" | "hubspot" | "itglue" }).provider;
    await deps.connectorService.disconnect(provider, auth.tenantId, auth.userId);
    return { ok: true };
  });

  app.post("/auth/mcp-token", async (request, reply) => {
    const auth = parsePlatformAuth(request.headers.authorization, deps.authService);
    if (!auth) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    return { token: deps.connectorService.issueMcpToken(auth.tenantId, auth.userId, [auth.role]) };
  });

  app.post("/internal/mcp/tools/call", async (request, reply) => {
    const secret = request.headers["x-internal-mcp-secret"];
    if (secret !== deps.config.internalMcpSharedSecret) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const body = z
      .object({
        tenantId: z.string().min(1),
        userId: z.string().min(1),
        roles: z.array(z.string()).default(["ADMIN"]),
        name: z.string().min(1),
        arguments: z.record(z.unknown()).default({})
      })
      .parse(request.body);

    const result = await deps.connectorService.executeTool(
      body.tenantId,
      body.userId,
      body.roles,
      body.name,
      body.arguments
    );

    return { result };
  });
}
