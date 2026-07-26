FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
# system-prompt.md is read at runtime via fs, not bundled by tsc — copy it explicitly.
# (Remember the manual `cp src/app/ai/chat/system-prompt.md packages/server/src/system-prompt.md`
# step from the README — it needs to exist before this image is built.)
COPY src/system-prompt.md ./dist/system-prompt.md
COPY src/db/schema.sql ./dist/db/schema.sql

EXPOSE 8787
CMD ["node", "dist/index.js"]
