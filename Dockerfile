# syntax=docker/dockerfile:1
# NotionPan — multi-stage production image (Next.js standalone)
# Node 22: 内置 node:sqlite 可用；否则自动回退 JSON 索引

# ========== deps ==========
FROM node:22-bookworm-slim AS deps
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

# ========== builder ==========
FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next 静态资源目录；没有 public 时也要有空目录，否则 runner COPY 失败
RUN mkdir -p public

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build \
  && mkdir -p .next/standalone .next/static public \
  && if [ ! -f .next/standalone/server.js ]; then \
       echo "ERROR: standalone build missing server.js — check next.config output:standalone" >&2; \
       exit 1; \
     fi

# ========== runner ==========
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV DOCKER=1
ENV DATA_DIR=/app/data
ENV COOKIE_SECURE=0

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs \
  && mkdir -p /app/data /app/public /app/.next/static \
  && chown -R nextjs:nodejs /app

# standalone 应用（含 server.js）
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# 静态资源
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# public（builder 已保证目录存在）
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/auth/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
