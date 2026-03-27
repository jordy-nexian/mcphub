FROM node:22-alpine AS base
WORKDIR /app

ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/mcp ./apps/mcp
COPY packages ./packages

RUN corepack enable
RUN pnpm install --frozen-lockfile

EXPOSE 4100
CMD ["pnpm", "--filter", "@nexian/mcp", "start"]
