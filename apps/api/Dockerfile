FROM node:22-alpine AS base
WORKDIR /app

COPY package.json pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api ./apps/api
COPY packages ./packages
COPY prisma ./prisma

RUN corepack enable
RUN pnpm install

EXPOSE 4000
CMD ["pnpm", "--filter", "@nexian/api", "dev"]

