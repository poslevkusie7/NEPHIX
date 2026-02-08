# NEPHIX

Nephix is a study-feed webapp with two MVP assignment types:
- Reading assignments (sequential text units)
- Essay assignments (thesis -> outline -> writing sections -> revise)

This repository now uses a TypeScript monorepo for production code, while `poc/` keeps the legacy Python prototype.

## Monorepo Layout

- `apps/web`: Next.js app (frontend + API route handlers)
- `packages/contracts`: shared Zod schemas and DTO types
- `packages/domain`: pure domain logic (ordering, completion criteria, revision checks)
- `packages/db`: Prisma schema, repositories, migrations, seed scripts
- `packages/ui`: shared UI primitives
- `tests`: unit/integration/e2e tests

## Prerequisites

1. Install pnpm (if missing):
```bash
npm install -g pnpm
```
2. Provision PostgreSQL (Neon recommended).

## Environment

Copy `.env.example` to `.env` and set values:

- `DATABASE_URL`
- `JWT_SECRET`
- `ACCESS_TOKEN_TTL_MINUTES` (optional)
- `REFRESH_TOKEN_TTL_DAYS` (optional)

## Setup

```bash
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

App runs at `http://localhost:3000`.

## Key APIs

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/me`
- `GET /api/feed`
- `GET /api/assignments/:id`
- `GET /api/assignments/:id/state`
- `PATCH /api/units/:unitId/state`
- `POST /api/units/:unitId/complete`
- `POST /api/units/:unitId/bookmark`

## Testing

```bash
pnpm test        # workspace tests + root unit/integration tests
pnpm test:e2e    # playwright e2e
```

## Deployment Notes

- Target runtime: Vercel (`apps/web`) + Neon Postgres.
- Set production environment variables in Vercel.
- Run `pnpm db:migrate && pnpm db:seed` against target DB during staging bootstrap.
