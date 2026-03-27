# Railway + Vercel deployment

This repo is set up to use:

- `apps/web` on Vercel
- `apps/api` on Railway
- `apps/mcp` on Railway
- Postgres on Neon
- Redis on Railway or Upstash

## 1. Deploy the web app on Vercel

Use the `apps/web` folder as the Vercel project root.

Set these Vercel environment variables:

- `NEXT_PUBLIC_API_URL=https://<your-api-service>.up.railway.app`
- `NEXT_PUBLIC_MCP_URL=https://<your-mcp-service>.up.railway.app`
- `APP_URL=https://<your-vercel-app>.vercel.app`
- `API_URL=https://<your-api-service>.up.railway.app`

## 2. Create two Railway services from the same repo

Create:

- one Railway service for `api`
- one Railway service for `mcp`

Both services should point to the same GitHub repo:

- `jordy-nexian/mcphub`

Use the Docker builder for each service.

Recommended Dockerfile paths:

- API service: `apps/api/Dockerfile`
- MCP service: `apps/mcp/Dockerfile`

## 3. Railway variables for the API service

Set these on the API service:

- `PORT=4000`
- `APP_URL=https://<your-vercel-app>.vercel.app`
- `API_URL=https://<your-api-service>.up.railway.app`
- `MCP_URL=https://<your-mcp-service>.up.railway.app`
- `REDIS_URL=<your-redis-url>`
- `DATABASE_URL=<your-neon-url>`
- `INTERNAL_MCP_SHARED_SECRET=<shared-secret-for-mcp-to-api-calls>`
- `SESSION_SECRET=<strong-random-secret>`
- `MCP_OAUTH_CLIENT_ID=claude`
- `MCP_OAUTH_CLIENT_SECRET=<long-random-client-secret>`
- `MCP_OAUTH_REDIRECT_URIS=https://claude.ai/api/mcp/auth_callback`
- `MCP_OAUTH_SCOPES=mcp`
- `OAUTH_STATE_SIGNING_SECRET=<strong-random-secret>`
- `TOKEN_ENCRYPTION_KEY_BASE64=<32-byte-base64-key>`
- `HALOPSA_BASE_URL=https://<your-halo-instance>`
- `HALOPSA_CLIENT_ID=<your-halo-client-id>`
- `HALOPSA_CLIENT_SECRET=<your-halo-client-secret>`
- `HALOPSA_REDIRECT_URI=https://<your-api-service>.up.railway.app/oauth/halopsa/callback`
- `HALOPSA_SCOPES=read:tickets read:customers read:actions offline_access`

Optional:

- `MS365_CLIENT_ID=<your-m365-client-id>`
- `MS365_CLIENT_SECRET=<your-m365-client-secret>`
- `MS365_REDIRECT_URI=https://<your-api-service>.up.railway.app/oauth/microsoft365/callback`
- `HUBSPOT_CLIENT_ID=<your-hubspot-client-id>`
- `HUBSPOT_CLIENT_SECRET=<your-hubspot-client-secret>`
- `HUBSPOT_REDIRECT_URI=https://<your-api-service>.up.railway.app/oauth/hubspot/callback`
- `ITGLUE_API_KEY=<your-itglue-key>`

## 4. Railway variables for the MCP service

Set these on the MCP service:

- `PORT=4100`
- `API_URL=https://<your-api-service>.up.railway.app`
- `MCP_URL=https://<your-mcp-service>.up.railway.app`
- `MCP_AUTH_MODE=optional`
- `MCP_DEFAULT_TENANT_ID=demo-tenant`
- `MCP_DEFAULT_USER_ID=demo-user`
- `MCP_DEFAULT_ROLES=ADMIN`
- `INTERNAL_MCP_SHARED_SECRET=<the same value used by the API service>`
- `SESSION_SECRET=<the same value used by the API service>`

For real Claude/OpenAI connector auth, switch this to:

- `MCP_AUTH_MODE=required`

The API and MCP services must share the same `SESSION_SECRET`, because the API issues the bearer token and the MCP service validates it.

## 5. Health checks

After deploy, confirm:

- `https://<your-api-service>.up.railway.app/health`
- `https://<your-mcp-service>.up.railway.app/health`

## 6. HaloPSA OAuth configuration

In HaloPSA, register the callback URL as:

- `https://<your-api-service>.up.railway.app/oauth/halopsa/callback`

The web UI sends the user to the API start route, and the API handles the callback:

- start: `https://<your-api-service>.up.railway.app/oauth/halopsa/start?...`
- callback: `https://<your-api-service>.up.railway.app/oauth/halopsa/callback`

## 7. MCP URL to give to clients

Use the MCP endpoint:

- `https://<your-mcp-service>.up.railway.app`

Compatibility aliases are also available at:

- `https://<your-mcp-service>.up.railway.app/mcp`
- `https://<your-mcp-service>.up.railway.app/invoke`

## 8. Claude custom connector setup

In Claude custom connector settings, use:

- Server URL: `https://<your-mcp-service>.up.railway.app`
- Client ID: the value of `MCP_OAUTH_CLIENT_ID`
- Client Secret: the value of `MCP_OAUTH_CLIENT_SECRET`

Claude will redirect the user to Nexian's OAuth authorize endpoint, the user signs in to Nexian, approves access, and Claude receives a user-scoped MCP token automatically.

## 9. Current limitation

Connected accounts are now stored in Postgres, which fixes the previous redeploy/reset problem.

The next production step is to add full Prisma-managed migrations for every model beyond connected accounts, rather than relying on startup schema bootstrapping for this one table.
