# 01 — Supabase foundation

Read `AGENTS.md` and `docs/CODEX_HARNESS.md` first.

Set up Supabase foundation for the React + TypeScript + Vite MVP.

Required work:

1. Install `@supabase/supabase-js` in `apps/web` if not installed.
2. Create `apps/web/src/lib/supabase.ts`.
3. Create or update `apps/web/src/lib/database.types.ts`.
4. Update `.env.example` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
5. Add or update `supabase/schema.sql` using the MVP tables from `AGENTS.md`.
6. Make sure the app does not crash when env variables are missing.

Validation:

```powershell
cd apps\web
npm.cmd install
npm.cmd run build
```

Final report must include changed files and build result.
