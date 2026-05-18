FROM node:20-alpine3.21 AS dev
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ENV NODE_ENV=development
ENV HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM node:20-alpine3.21 AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN mkdir -p public && npm run build

FROM node:20-alpine3.21 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
