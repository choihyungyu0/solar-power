# 04 — Solar simulation result

Read `AGENTS.md` and `docs/CODEX_HARNESS.md` first.

Implement deterministic MVP solar simulation.

Requirements:

1. Create or update `src/lib/solarCalculator.ts`.
2. Create or update `src/types/solar.ts`.
3. Calculate recommended capacity, panel count, yearly generation, yearly saving, install cost, subsidy estimate, self payment, payback years, household monthly benefit, and suitability score.
4. Show result cards after form submission.
5. If logged in and Supabase is configured, save result to `solar_simulations`.
6. Add safe disclaimer: results are MVP estimates, not engineering-certified values.

Validation:

```powershell
cd apps\web
npm.cmd run build
```

Final report must include changed files and build result.
