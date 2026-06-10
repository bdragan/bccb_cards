# Multiplayer Card Games Platform

A full-stack TypeScript multiplayer card-game platform. The first supported game is GreaterCard: every player draws one Hungarian card, and the highest poker-style rank and suit wins.

## Stack

- Frontend: React, Vite, TypeScript, Tailwind CSS, Zustand, Socket.IO Client, Vitest, React Testing Library
- Backend: NestJS, Socket.IO Gateway, Passport/JWT, Prisma, PostgreSQL, Jest
- Shared: pnpm workspaces, Zod, pure TypeScript game logic

## Project Layout

```text
apps/web          React SPA
apps/api          NestJS API and game gateway
packages/shared   Shared types, DTOs, and Zod schemas
packages/game-core Pure card and game logic
```

`packages/game-core` is framework-free and does not depend on React, NestJS, Socket.IO, Prisma, or browser APIs.

## Local Setup

```bash
corepack enable
pnpm install
docker compose up -d
pnpm --filter @card-games/api prisma:migrate
pnpm dev
```

Default services:

- Frontend: http://localhost:5173
- Backend: http://localhost:3000
- PostgreSQL: localhost:5432

## Environment

Create `apps/api/.env`:

```text
DATABASE_URL="postgresql://cardgames:cardgames@localhost:5432/cardgames"
JWT_SECRET="change-me-in-dev"
WEB_ORIGIN="http://localhost:5173"
```

The web app reads `VITE_API_URL`; if it is not set, it defaults to `http://localhost:3000`.

## Commands

```bash
pnpm dev
pnpm test
pnpm test:e2e
pnpm build
pnpm lint
pnpm typecheck
pnpm format
pnpm format:check
```

`pnpm test:e2e` runs Playwright against the real web and API servers. Start
PostgreSQL first with `docker compose up -d`; the script applies Prisma
migrations, builds the workspace, launches both dev servers, and plays a full
Bellot game in two browser contexts.

## MVP Flow

1. Register or log in.
2. Select GreaterCard.
3. Create a room or join by code.
4. All joined players mark ready.
5. Each player draws exactly once.
6. Cards stay hidden from other players until everyone has drawn.
7. The backend calculates the winner or tie and stores the completed match.
8. Match history is available from the dashboard.
