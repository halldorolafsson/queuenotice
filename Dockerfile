# Ett image for både webtjenesten og den planlagte jobben.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci
COPY backend backend
COPY frontend frontend
RUN npm run build -w frontend && npm run build -w backend

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev --workspace backend && npm cache clean --force
COPY --from=build /app/backend/dist backend/dist
COPY backend/migrations backend/migrations
COPY --from=build /app/frontend/dist frontend/dist
WORKDIR /app/backend
USER node
ENV PORT=8080 STATIC_DIR=../frontend/dist
EXPOSE 8080
# Webtjeneste. Jobben overstyrer med: node dist/jobs/pollOnce.js
# Migreringer: node dist/db/migrateCli.js
CMD ["node", "dist/server.js"]
