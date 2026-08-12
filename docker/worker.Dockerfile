# ============================================================
# MsgFlow WhatsApp worker
#
# A persistent Node service running whatsapp-web.js + Puppeteer.
# Deploy to Railway, Render, Fly.io, a VPS or any Docker host.
# No Kubernetes required.
#
# Build from the repository root:
#   docker build -f docker/worker.Dockerfile -t msgflow-worker .
# ============================================================

FROM node:22-slim AS base

# Chromium and the fonts it needs to render WhatsApp Web. Installing the
# distribution package rather than letting Puppeteer download its own build
# keeps the image smaller and the browser patched by apt.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation \
      fonts-noto-color-emoji \
      ca-certificates \
      dumb-init \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libcups2 \
      libdrm2 \
      libgbm1 \
      libnspr4 \
      libnss3 \
      libxcomposite1 \
      libxdamage1 \
      libxfixes3 \
      libxkbcommon0 \
      libxrandr2 \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

RUN corepack enable && corepack prepare pnpm@11.15.1 --activate

WORKDIR /app

# ------------------------------------------------------------
# Dependencies
# ------------------------------------------------------------
FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/worker/package.json ./apps/worker/
COPY packages/config/package.json ./packages/config/
COPY packages/logger/package.json ./packages/logger/
COPY packages/types/package.json ./packages/types/
COPY packages/db/package.json ./packages/db/

# The worker needs only its own subtree — not the web app, connectors or AI SDKs.
RUN pnpm install --frozen-lockfile \
      --filter @msgflow/worker... \
      --filter @msgflow/config \
      --filter @msgflow/logger \
      --filter @msgflow/types

# ------------------------------------------------------------
# Runtime
# ------------------------------------------------------------
FROM base AS runtime

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules

COPY tsconfig.base.json ./
COPY packages/config ./packages/config
COPY packages/logger ./packages/logger
COPY packages/types ./packages/types
COPY apps/worker ./apps/worker

# WhatsApp sessions must survive a restart, otherwise every deploy forces a
# fresh QR scan. Mount a volume here in production.
RUN mkdir -p /app/apps/worker/.sessions && chown -R node:node /app

USER node

ENV WORKER_PORT=4000 \
    WORKER_SESSION_PATH=/app/apps/worker/.sessions \
    PUPPETEER_HEADLESS=true

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.WORKER_PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# dumb-init reaps the zombie Chromium processes Puppeteer leaves behind.
ENTRYPOINT ["dumb-init", "--"]
CMD ["pnpm", "--filter", "@msgflow/worker", "start"]
