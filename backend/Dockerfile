FROM node:20-alpine AS base
RUN apk add --no-cache openssl openssl-dev
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate

FROM base AS api
EXPOSE 3000
CMD ["node", "src/app.js"]

FROM base AS worker
CMD ["node", "src/workers/simulation.worker.js"]
