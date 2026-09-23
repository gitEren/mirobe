# Mirobe API. Single container; SQLite + media live on the /app/data volume.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
# npm ci validates the whole workspace lockfile, so the mobile manifest must be present.
COPY mobile/package.json mobile/
RUN npm ci --workspace @mirobe/server --workspace @mirobe/shared --include-workspace-root=false
COPY shared shared
COPY server server
RUN npm run build -w @mirobe/server

FROM node:24-slim
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY mobile/package.json mobile/
RUN npm ci --omit=dev --workspace @mirobe/server --include-workspace-root=false && npm cache clean --force
# @mirobe/shared is bundled into dist by esbuild.
COPY --from=build /app/server/dist server/dist
VOLUME /app/data
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
