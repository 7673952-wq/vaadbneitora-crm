# ---- Build stage ----
FROM oven/bun:1.1 AS builder
WORKDIR /app

# Install deps (cached layer)
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Build with the Node server preset so output is a standalone Node app
COPY . .
ENV NITRO_PRESET=node-server
RUN bun run build

# ---- Runtime stage ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Nitro's node-server preset emits a self-contained bundle under .output/
COPY --from=builder /app/.output ./.output

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/public/health || exit 1

CMD ["node", ".output/server/index.mjs"]
