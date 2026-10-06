# Bouwcontext is de repo-root (zie render.yaml `dockerContext: .`), niet backend/ zelf: de
# server serveert ook ../frontend, dus die map moet op dezelfde relatieve plek in de image staan.
# Debian-slim en geen Alpine: argon2 heeft prebuilds voor glibc (zelfde keuze als ACCRD en CMMNTY).
FROM node:22-bookworm-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/prisma ./prisma
RUN npx prisma generate
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app/backend
COPY --from=builder /app/backend/node_modules ./node_modules
COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/backend/prisma ./prisma
COPY backend/package.json ./
# Het meegeleverde programma (Benen / Push / Pull); de seed laadt het in als het er nog niet is.
COPY backend/programmas ./programmas
# De oefeningenbibliotheek (Free Exercise DB, publiek domein) die de server in het geheugen laadt.
COPY backend/data ./data
COPY frontend /app/frontend
EXPOSE 4200
# Migraties + seed (account en startschema) zijn idempotent en draaien bij elke start — zelfde patroon als ACCRD en CMMNTY.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/seed.js && node dist/index.js"]
