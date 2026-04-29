# WhatsApp Platform MVP

Monorepo implementation of the supplied blueprint:

- Next.js dashboard
- NestJS backend API with Swagger and Socket.IO
- BullMQ worker service
- PostgreSQL + Prisma
- Redis
- Docker Compose deployment

## Quick start

1. Copy `.env.example` to `.env`
2. Run `docker compose up --build`
3. Open:
   - Frontend: `http://localhost:3000`
   - Backend Swagger: `http://localhost:3001/docs`

## Default seeded users

- Superadmin: `owner@example.com` / `ChangeMe123!`
- Admin: `admin@example.com` / `ChangeMe123!`

## Notes

- The worker includes a `MOCK_WHATSAPP=true` mode so the stack boots cleanly without a live WhatsApp pairing during initial deployment.
- The Baileys-facing service and persisted auth-state schema are already wired for a production adapter path instead of file-based sessions.

