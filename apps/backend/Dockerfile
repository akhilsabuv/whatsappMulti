FROM node:22-alpine AS base
WORKDIR /app

RUN apk add --no-cache postgresql-client

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/backend ./apps/backend
COPY apps/frontend/package.json ./apps/frontend/package.json
COPY apps/worker/package.json ./apps/worker/package.json

RUN npm ci
RUN npm run build -w @whatsapp-platform/common
RUN npm run prisma:generate -w @whatsapp-platform/backend
RUN npm run build -w @whatsapp-platform/backend

WORKDIR /app/apps/backend
EXPOSE 3001
CMD ["npm", "run", "start:docker"]
