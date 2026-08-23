# NOTE: like the original headless-server template this was forked from, this Dockerfile
# assumes `@open-pencil/automation` / `@open-pencil/core` / `@open-pencil/scene-graph`
# (workspace:* deps) are resolvable at `npm install` time — e.g. built from a monorepo
# context that vendors/publishes them first, or with your package manager's workspace
# protocol rewritten to real versions/paths before this build runs. Nothing about the
# automation swap changes that pre-existing constraint.

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# Chromium for @open-pencil/automation (puppeteer-cluster). Installed from Alpine's own
# package repo instead of puppeteer's bundled download — smaller image, no glibc/musl
# mismatch. Run with OPENPENCIL_HEADLESS=true in this image; there's no display here.
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

COPY package.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY src/db/schema.sql ./dist/db/schema.sql

EXPOSE 8787
CMD ["node", "dist/index.js"]
