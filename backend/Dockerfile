FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json ./
COPY prisma ./prisma/

RUN npm install --legacy-peer-deps

COPY . .

RUN npx prisma generate
RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app

# Timezone Brasil — afeta logs Pino, crons (@Cron/@Interval) e new Date()
# Alpine precisa do pacote tzdata pra ler /usr/share/zoneinfo
RUN apk add --no-cache tzdata && \
    cp /usr/share/zoneinfo/America/Sao_Paulo /etc/localtime && \
    echo "America/Sao_Paulo" > /etc/timezone && \
    apk del tzdata
ENV TZ=America/Sao_Paulo

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma
# prisma.config.ts é lido por `prisma migrate deploy` em jobs administrativos.
# Sem ele, falha com "datasource.url required" — bug histórico já resolvido.
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "dist/src/main"]
