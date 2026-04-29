FROM node:22-alpine AS base
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/backend/package.json ./apps/backend/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/frontend ./apps/frontend

RUN npm ci
RUN npm run build -w @whatsapp-platform/frontend

WORKDIR /app/apps/frontend
EXPOSE 3000
CMD ["npm", "run", "start"]
