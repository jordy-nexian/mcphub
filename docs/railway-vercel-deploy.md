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
- `DATA_DIR=/app/data`
- `SESSION_SECRET=<strong-random-secret>`
- `OAUTH_STATE_SIGNING_SECRET=<strong-random-secret>`
- `TOKEN_ENCRYPTION_KEY_BASE64=<32-byte-base64-key>`
- `HALOPSA_BASE_URL=https://<your-halo-instance>`
- `HALOPSA_CLIENT_ID=<your-halo-client-id>`
- `HALOPSA_CLIENT_SECRET=<your-halo-client-secret>`
- `HALOPSA_REDIRECT_URI=https://<your-api-service>.up.railway.app/oauth/halopsa/callback`
- `HALOPSA_SCOPES=read:tickets read:customers read:actions offline_access`

Optional:

- `DATABASE_URL=<your-neon-url>`
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
- `SESSION_SECRET=<the same value used by the API service>`

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

## 8. Current limitation

The API currently stores connected accounts in a local JSON file under `DATA_DIR`.
That is acceptable for smoke testing and initial OAuth verification, but it is not durable for production.

The next production step is to move connected-account storage into Postgres via Prisma.
