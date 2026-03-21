# Workspace

## Overview

AI Timestamp generator app using the timestamps.video API. Users can submit YouTube URLs or upload video files to get AI-generated chapter timestamps. Built as a pnpm monorepo with React + Vite frontend and Express backend.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite, Tailwind CSS, framer-motion, lucide-react, sonner, @headlessui/react, spark-md5, date-fns

## External APIs

- **timestamps.video** (`https://api.timestamps.video`) — AI timestamp generation
  - API key stored as `TIMESTAMPS_API_KEY` secret
  - Proxied server-side so key is never exposed to the frontend

## Payment System

- **Credit-based model**: 1 credit = 1 timestamp job; credits never expire
- **Plans**: Starter (10 credits, $4.99), Pro (50 credits, $19.99), Business (200 credits, $59.99)
- **Lemon Squeezy** (card payments): requires `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID`, `LEMONSQUEEZY_WEBHOOK_SECRET`, and variant IDs `LEMONSQUEEZY_VARIANT_10`, `LEMONSQUEEZY_VARIANT_50`, `LEMONSQUEEZY_VARIANT_200`
- **Cryptomus** (crypto payments): requires `CRYPTOMUS_PAYMENT_KEY`, `CRYPTOMUS_MERCHANT_ID`, and `APP_URL` (public URL for webhook callbacks)
- Webhooks: `POST /api/payments/lemon/webhook` and `POST /api/payments/crypto/webhook`
- Credits tracked in `user_credits` table; payments logged in `payments` table

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   ├── api-server/         # Express API server
│   │   └── src/
│   │       ├── lib/timestamps-client.ts  # timestamps.video API client
│   │       └── routes/jobs.ts            # Job CRUD routes
│   └── ai-timestamp/       # React + Vite frontend (served at /)
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
│       └── src/schema/jobs.ts  # Jobs table
├── scripts/                # Utility scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## Features

1. **YouTube URL submission** — paste a YouTube link, submit for AI timestamp generation
2. **Video file upload** — upload local video files (MD5 computed client-side for S3 presigned upload)
3. **Job history** — all past jobs stored in PostgreSQL, shown with status
4. **Status polling** — pending/processing jobs auto-refresh status from timestamps.video API
5. **Timestamps viewer** — click a finished job to see AI-generated chapter timestamps, with copy support
6. **Caching** — timestamps are cached in the DB after first fetch

## API Endpoints

- `GET /api/jobs` — list all jobs
- `POST /api/jobs/submit-youtube` — submit YouTube URL
- `POST /api/jobs/upload-init` — get presigned S3 URL for upload
- `POST /api/jobs/upload-complete` — complete upload, start processing
- `GET /api/jobs/:id` — get job (auto-refreshes status from external API if pending/processing)
- `GET /api/jobs/:id/timestamps` — get timestamps (cached in DB after first fetch)

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references.

- **Always typecheck from the root** — run `pnpm run typecheck`
- **`emitDeclarationOnly`** — only `.d.ts` files during typecheck
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API client and Zod schemas
- `pnpm --filter @workspace/db run push` — push DB schema changes
