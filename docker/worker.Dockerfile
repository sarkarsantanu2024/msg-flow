# MsgFlow WhatsApp worker.
#
# A persistent service, not a serverless function: whatsapp-web.js drives a
# headless Chromium and holds a long-lived session that cannot survive being
# frozen between invocations. This is why the worker cannot run on Vercel
# alongside the web app.
#
#   docker build -f docker/worker.Dockerfile -t msgflow-worker .
#
# Build context is the repository root, not this directory.

FROM node:22-bookworm-slim

# Chromium from the distro rather than puppeteer's bundled download: the
# packaged build carries the shared libraries it needs, which the downloaded one
# does not on a slim image. PUPPETEER_SKIP_DOWNLOAD then saves ~150 MB and a
# long install step, as pnpm-workspace.yaml documents.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_HEADLESS=true \
    NODE_ENV=production \
    WORKER_PORT=4000 \
    WORKER_SESSION_PATH=/app/apps/worker/.sessions

RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates \
      # WhatsApp Web renders contact names and QR codes; without a font set
      # Chromium draws empty boxes and the QR fails to scan.
      fonts-liberation \
      fonts-noto-color-emoji \
      dumb-init \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN corepack enable

# Manifests first so `pnpm install` is cached until a dependency actually
# changes. @msgflow/types re-exports Prisma's generated types, so packages/db is
# pulled in transitively and its schema has to be present for the postinstall
# `prisma generate` to succeed.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/worker/package.json apps/worker/
COPY packages/config/package.json packages/config/
COPY packages/logger/package.json packages/logger/
COPY packages/types/package.json packages/types/
COPY packages/db/package.json packages/db/
COPY packages/db/prisma packages/db/prisma

# Dev dependencies are kept: the worker runs its TypeScript sources through tsx
# rather than compiling to JavaScript, so tsx must be present at runtime.
RUN pnpm install --frozen-lockfile --filter @msgflow/worker...

COPY apps/worker apps/worker
COPY packages/config packages/config
COPY packages/logger packages/logger
COPY packages/types packages/types
COPY packages/db packages/db

# Mount a volume here. Without one, every deploy discards the WhatsApp session
# and forces a fresh QR scan.
RUN mkdir -p /app/apps/worker/.sessions && chown -R node:node /app

USER node
EXPOSE 4000

# dumb-init reaps the Chromium processes puppeteer leaves behind; PID 1 in a
# container does not do that on its own and the worker slowly fills with
# zombies across reconnects.
ENTRYPOINT ["dumb-init", "--"]
CMD ["pnpm", "--filter", "@msgflow/worker", "start"]
