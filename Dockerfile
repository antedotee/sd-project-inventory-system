# Production image: one container serves the API and the built web app
# from the same origin (no CORS, session cookie just works).

# 1. Install all workspace dependencies (dev deps are needed to build the web app).
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY server/package.json server/
COPY web/package.json web/
RUN bun install --frozen-lockfile

# 2. Build the React app.
FROM deps AS web-build
COPY web web
RUN bun run --cwd web build

# 3. Runtime: production dependencies + server source + built assets.
FROM oven/bun:1-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json bun.lock ./
COPY server/package.json server/
COPY web/package.json web/
RUN bun install --frozen-lockfile --production
COPY server/src server/src
COPY server/drizzle server/drizzle
COPY --from=web-build /app/web/dist web/dist

WORKDIR /app/server
ENV STATIC_DIR=../web/dist PORT=3000
USER bun
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Migrations run on startup (idempotent), then the server starts.
CMD ["bun", "src/main.ts"]
