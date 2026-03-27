FROM node:22-alpine AS base
WORKDIR /app

ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api ./apps/api
COPY packages ./packages
COPY prisma ./prisma

RUN corepack enable
RUN pnpm install --frozen-lockfile

EXPOSE 4000
CMD ["pnpm", "--filter", "@nexian/api", "start"]
