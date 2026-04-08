import { z } from "zod";

const envSchema = z.object({
  APP_URL: z.string().url().default("http://localhost:3000"),
  API_URL: z.string().url().default("http://localhost:4000"),
  PORT: z.coerce.number().default(4000),
  INTERNAL_MCP_SHARED_SECRET: z.string().min(8).optional(),
  MCP_OAUTH_CLIENT_ID: z.string().default("claude"),
  MCP_OAUTH_CLIENT_SECRET: z.string().min(8).default("replace-me-mcp-client-secret"),
  MCP_OAUTH_REDIRECT_URIS: z
    .string()
    .default(
      "https://claude.ai/api/mcp/auth_callback,https://chat.openai.com/aip/*/oauth/callback,https://chatgpt.com/aip/*/oauth/callback"
    ),
  MCP_OAUTH_SCOPES: z.string().default("mcp"),
  TOKEN_ENCRYPTION_KEY_BASE64: z.string().min(16).default(Buffer.alloc(32).toString("base64")),
  SESSION_SECRET: z.string().min(8).default("local-session-secret"),
  OAUTH_STATE_SIGNING_SECRET: z.string().min(8).default("local-oauth-state-secret"),
  REDIS_URL: z.string().optional()
});

export function buildAppConfig() {
  const env = envSchema.parse({
    APP_URL: process.env.APP_URL,
    API_URL: process.env.API_URL,
    PORT: process.env.PORT,
    INTERNAL_MCP_SHARED_SECRET: process.env.INTERNAL_MCP_SHARED_SECRET,
    MCP_OAUTH_CLIENT_ID: process.env.MCP_OAUTH_CLIENT_ID,
    MCP_OAUTH_CLIENT_SECRET: process.env.MCP_OAUTH_CLIENT_SECRET,
    MCP_OAUTH_REDIRECT_URIS: process.env.MCP_OAUTH_REDIRECT_URIS,
    MCP_OAUTH_SCOPES: process.env.MCP_OAUTH_SCOPES,
    TOKEN_ENCRYPTION_KEY_BASE64: process.env.TOKEN_ENCRYPTION_KEY_BASE64,
    SESSION_SECRET: process.env.SESSION_SECRET,
    OAUTH_STATE_SIGNING_SECRET: process.env.OAUTH_STATE_SIGNING_SECRET,
    REDIS_URL: process.env.REDIS_URL
  });

  return {
    appUrl: env.APP_URL,
    apiUrl: env.API_URL,
    port: env.PORT,
    internalMcpSharedSecret: env.INTERNAL_MCP_SHARED_SECRET ?? env.SESSION_SECRET,
    mcpOauthClientId: env.MCP_OAUTH_CLIENT_ID,
    mcpOauthClientSecret: env.MCP_OAUTH_CLIENT_SECRET,
    mcpOauthRedirectUris: env.MCP_OAUTH_REDIRECT_URIS.split(",").map((item) => item.trim()).filter(Boolean),
    mcpOauthScopes: env.MCP_OAUTH_SCOPES.split(/\s+/).filter(Boolean),
    redisUrl: env.REDIS_URL,
    oauthStateSigningSecret: env.OAUTH_STATE_SIGNING_SECRET,
    sessionSecret: env.SESSION_SECRET,
    tokenEncryptionKeyBase64: env.TOKEN_ENCRYPTION_KEY_BASE64
  };
}
