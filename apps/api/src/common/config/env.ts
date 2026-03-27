import { z } from "zod";

const envSchema = z.object({
  APP_URL: z.string().url().default("http://localhost:3000"),
  API_URL: z.string().url().default("http://localhost:4000"),
  PORT: z.coerce.number().default(4000),
  INTERNAL_MCP_SHARED_SECRET: z.string().min(8).optional(),
  TOKEN_ENCRYPTION_KEY_BASE64: z.string().min(16).default(Buffer.alloc(32).toString("base64")),
  SESSION_SECRET: z.string().min(8).default("local-session-secret"),
  OAUTH_STATE_SIGNING_SECRET: z.string().min(8).default("local-oauth-state-secret"),
  REDIS_URL: z.string().default("redis://localhost:6379")
});

export function buildAppConfig() {
  const env = envSchema.parse({
    APP_URL: process.env.APP_URL,
    API_URL: process.env.API_URL,
    PORT: process.env.PORT,
    INTERNAL_MCP_SHARED_SECRET: process.env.INTERNAL_MCP_SHARED_SECRET,
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
    redisUrl: env.REDIS_URL,
    oauthStateSigningSecret: env.OAUTH_STATE_SIGNING_SECRET,
    sessionSecret: env.SESSION_SECRET,
    tokenEncryptionKeyBase64: env.TOKEN_ENCRYPTION_KEY_BASE64
  };
}
