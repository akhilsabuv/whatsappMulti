FROM node:22-alpine AS base
WORKDIR /app

RUN apk add --no-cache git

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/backend/package.json ./apps/backend/package.json
COPY apps/backend/prisma ./apps/backend/prisma
COPY apps/worker ./apps/worker
COPY apps/frontend/package.json ./apps/frontend/package.json

RUN npm ci
RUN npm run build -w @whatsapp-platform/common
RUN npm run prisma:generate -w @whatsapp-platform/backend
RUN npm run build -w @whatsapp-platform/worker

WORKDIR /app/apps/worker
EXPOSE 3010
CMD ["npm", "run", "start:docker"]
