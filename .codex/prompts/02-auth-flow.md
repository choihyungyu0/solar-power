# 02 — Supabase Auth flow

Read `AGENTS.md` and `docs/CODEX_HARNESS.md` first.

Implement email signup/login/logout with Supabase Auth in the React app.

Requirements:

1. Create or update `AuthPanel.tsx`.
2. Show current logged-in user email.
3. Support signup, login, logout.
4. Show loading, error, and success messages.
5. Do not store passwords manually in any table.
6. Do not use service_role key.
7. If Supabase env variables are missing, show local setup warning instead of crashing.

Validation:

```powershell
cd apps\web
npm.cmd run build
```

Final report must include changed files and build result.
