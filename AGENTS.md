<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# SIC ↔ NAICS Mapper

## Setup order (first time)
1. Create Vercel project, add Postgres (Neon) from Vercel Marketplace
2. `vercel env pull .env.local` — pulls DATABASE_URL etc.
3. `npm run db:push` — creates tables
4. `npm run seed "/Volumes/Big5/AI TEMP/NAICS2022.csv" "/Volumes/Big5/AI TEMP/SIC.csv"` — loads codes
5. Add `ANTHROPIC_API_KEY` to `.env.local`
6. `npm run map` — generates AI mappings (takes a few minutes, ~50 batches of 20)

## Deployment
Push to `main` → Vercel auto-deploys.

## Key scripts
- `npm run seed <naics.csv> <sic.csv>` — idempotent, safe to re-run
- `npm run map` — idempotent, skips already-mapped SIC codes
- `npm run db:push` — push schema changes to DB
