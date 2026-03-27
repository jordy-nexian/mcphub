FROM node:22-alpine AS base
WORKDIR /app

COPY package.json pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/mcp ./apps/mcp
COPY packages ./packages

RUN corepack enable
RUN pnpm install

EXPOSE 4100
CMD ["pnpm", "--filter", "@nexian/mcp", "dev"]

