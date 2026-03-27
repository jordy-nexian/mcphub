# Nexian MCP Hub

Nexian MCP Hub is a multi-tenant MSP integration platform that lets each tenant connect third-party systems and expose normalized, AI-safe tools through a single remote MCP server.

## Monorepo layout

- `apps/web`: Next.js admin and end-user app
- `apps/api`: backend API for auth, tenant management, connectors, OAuth callbacks, and audit APIs
- `apps/mcp`: remote MCP server with bearer-token protected HTTP endpoints
- `packages/core`: shared domain types, security primitives, MCP models, validation helpers
- `packages/connectors`: provider adapters and normalized tool implementations
- `prisma`: Postgres schema and seed-ready models
- `docker`: local container assets
- `docs`: architecture, deployment, and security notes

## Local setup

1. Install Node.js 22+ and `pnpm`.
2. Copy `.env.example` to `.env` and fill in provider credentials.
3. Start infrastructure:

```bash
docker compose up -d
```

4. Install dependencies:

```bash
pnpm install
```

5. Generate Prisma client and run migrations:

```bash
pnpm db:generate
pnpm db:migrate
```

6. Start the stack:

```bash
pnpm dev
```

## Vercel deployment

Deploy the `apps/web` Next.js app as the Vercel project.

Recommended Vercel settings:

- Root Directory: `apps/web`
- Install Command: `pnpm install`
- Build Command: `pnpm build`
- Output Directory: leave empty for Next.js auto-detection

Environment variables to set in Vercel:

- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_MCP_URL`
- `API_URL`
- `APP_URL`

This repo keeps `apps/api` and `apps/mcp` as separate Node services. For production, deploy those on a container host and point the Vercel frontend to them via environment variables.

## Railway deployment

Use Railway for the backend split:

- `apps/api` on Railway
- `apps/mcp` on Railway
- `apps/web` on Vercel

The practical setup guide is in:

- `docs/railway-vercel-deploy.md`

Important production env relationships:

- `APP_URL` should be your Vercel web URL
- `API_URL` should be your Railway API URL
- `MCP_URL` should be your Railway MCP URL
- `HALOPSA_REDIRECT_URI` should point to the Railway API callback URL
- `NEXT_PUBLIC_API_URL` in Vercel should point to the Railway API URL
- `NEXT_PUBLIC_MCP_URL` in Vercel should point to the Railway MCP endpoint URL
- `SESSION_SECRET` must match between the API and MCP services

## Product architecture

- Web users authenticate with the platform and act within a tenant workspace.
- Connected accounts are stored per tenant and user, with access and refresh tokens encrypted at rest.
- The API owns OAuth callback handling, token refresh, policy checks, audit logging, and connector lifecycle.
- The MCP server validates `Authorization: Bearer <token>` on every HTTP request and routes each tool call through tenant-aware policies.
- Provider-specific logic stays inside adapters; only normalized tools are exposed externally.

## Version 1 connector scope

- HaloPSA
- Microsoft 365 / SharePoint
- HubSpot as CRM
- IT Glue as documentation / KB

## Guardrails

- Read-heavy tools first
- Safe writes only for low-risk workflows such as draft ticket creation and internal notes
- No destructive writes in v1
- All tool invocations generate audit events

## Next implementation milestones

1. Wire real auth and persistence into the API module skeletons.
2. Add Prisma migrations and database client bootstrapping.
3. Replace connector placeholders with live provider SDK or REST integrations.
4. Add integration tests for OAuth, token refresh, and MCP tool execution.
