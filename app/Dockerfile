# ---------- Stage 1: install production dependencies ----------
FROM node:20-alpine AS deps
WORKDIR /app
# Copy only package files first → this slow layer is cached until dependencies change
COPY package*.json ./
# Exact install from package-lock.json, without test tools; then clear the npm cache
RUN npm ci --omit=dev && npm cache clean --force

# ---------- Stage 2: small final image ----------
FROM node:20-alpine AS runtime
# Commit ID passed in by the pipeline
ARG APP_VERSION=local
ENV NODE_ENV=production \
    PORT=3000 \
    APP_VERSION=${APP_VERSION}
WORKDIR /app
# Bring the installed libraries from stage 1, owned by the non-root 'node' user
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
# Copy the application code
COPY --chown=node:node . .
# Security: never run as root
USER node
# Documentation: the app listens on 3000
EXPOSE 3000
# Docker checks /health every 30 s; 3 failures in a row = unhealthy
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health > /dev/null || exit 1
# Start the app (exec form → receives 'docker stop' signals)
CMD ["node", "server.js"]
