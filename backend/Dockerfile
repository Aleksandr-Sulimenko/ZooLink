# ZooLink backend (NestJS monolith) — multi-stage, non-root, production image.
# Assumes a standard NestJS app in this ./backend directory (created during backend dev).

# ---- build ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build   # produces dist/

# ---- production deps ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- runtime ----
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# non-root
RUN addgroup -S app && adduser -S app -G app
COPY --from=deps   /app/node_modules ./node_modules
COPY --from=build  /app/dist          ./dist
COPY --from=build  /app/prisma        ./prisma
COPY package*.json ./
USER app
EXPOSE 3000
# Healthcheck endpoint must be implemented: GET /health/ready (DB+Redis check) and /health/live
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD node -e "fetch('http://localhost:3000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
