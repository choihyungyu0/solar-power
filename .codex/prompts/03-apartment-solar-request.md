# 03 — Apartment solar request form

Read `AGENTS.md` and `docs/CODEX_HARNESS.md` first.

Implement the core CTA flow: `우리 아파트 태양광 설치하기`.

Requirements:

1. Create or update a solar request form.
2. Collect apartment name, address, household count, roof area m2, monthly electric bill, and contact method.
3. Validate required fields.
4. If logged in and Supabase is configured, save to `apartment_solar_requests`.
5. If Supabase is not configured, still allow local demo calculation and clearly label it as local demo.
6. Use Korean UI labels.

Validation:

```powershell
cd apps\web
npm.cmd run build
```

Final report must include changed files and build result.
