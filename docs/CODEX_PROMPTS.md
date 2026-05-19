# Codex Prompt Harness

Use these prompts one at a time. Do not give Codex all tasks at once.

## Prompt 0 — Repository inspection and safe plan

```text
You are working in this repository for a React + TypeScript + Vite + Supabase MVP.

First, read AGENTS.md, package.json files, apps/web, docs, and any existing data files.

Important context:
- The product is an apartment/public-housing solar adoption service for Gyeonggi-do.
- Core CTA: "우리 아파트 태양광 설치하기".
- MVP backend should use Supabase Auth and Supabase Postgres.
- Do not continue the FastAPI backend unless explicitly required.
- The user is on Windows PowerShell, so use npm.cmd commands in instructions.

Task:
1. Inspect the current repo structure.
2. Identify what must change to make this a clean React + TypeScript + Supabase MVP.
3. Do not edit files yet.
4. Return a concise implementation plan with phases and exact files to modify.
```

## Prompt 1 — Convert frontend to Supabase-ready MVP

```text
Read AGENTS.md first.

Implement the first Supabase-ready frontend phase.

Requirements:
1. In apps/web, install and use @supabase/supabase-js.
2. Add apps/web/src/lib/supabase.ts.
3. Add apps/web/src/types/database.ts with minimal table row/insert/update types for:
   - profiles
   - apartment_solar_requests
   - solar_simulations
   - notification_preferences
   - subsidy_programs
   - install_reviews
4. Add apps/web/.env.example with:
   - VITE_SUPABASE_URL
   - VITE_SUPABASE_ANON_KEY
5. Do not require FastAPI for the main user flow.
6. Keep Korean UI copy.
7. Run npm.cmd run build in apps/web and fix TypeScript/build errors.

When done, summarize changed files and the build result.
```

## Prompt 2 — Auth UI

```text
Read AGENTS.md first.

Add Supabase Auth to the React app.

Requirements:
1. Implement email/password signup, login, and logout.
2. Show current user email when logged in.
3. Keep the UI beginner-friendly and Korean.
4. Add friendly error messages for wrong password, missing fields, and Supabase env not configured.
5. Do not expose service-role keys.
6. If Supabase env values are missing, the app should still render with a clear setup notice instead of crashing.
7. Run npm.cmd run build in apps/web and fix errors.

Return changed files and build result.
```

## Prompt 3 — Solar simulation utility and request form

```text
Read AGENTS.md first.

Implement the core feature: "우리 아파트 태양광 설치하기".

Requirements:
1. Create a typed solar calculation utility in apps/web/src/features/solar/solarCalculator.ts.
2. The calculator must accept:
   - apartmentName
   - address
   - householdCount
   - roofAreaM2
   - monthlyElectricBillKrw
   - shadeScore
   - averageDailySunHours
3. The calculator must return:
   - suitabilityScore
   - suitabilityGrade
   - recommendedCapacityKw
   - panelCount
   - expectedMonthlyGenerationKwh
   - expectedYearlyGenerationKwh
   - expectedYearlySavingKrw
   - estimatedInstallCostKrw
   - estimatedSubsidyKrw
   - estimatedPolicyLoanLimitKrw
   - estimatedSelfPaymentKrw
   - paybackYears
   - householdMonthlyBenefitKrw
   - nextActions
4. Add a form that runs the calculator locally.
5. If the user is logged in and Supabase is configured, save the request and simulation result to Supabase.
6. Clearly label calculation values as estimated demo values.
7. Run npm.cmd run build in apps/web and fix errors.

Return changed files and build result.
```

## Prompt 4 — Supabase SQL schema

```text
Read AGENTS.md first.

Create or update supabase/schema.sql.

Requirements:
1. Include tables:
   - profiles
   - apartment_solar_requests
   - solar_simulations
   - notification_preferences
   - subsidy_programs
   - install_reviews
2. Enable Row Level Security on user-owned tables.
3. Add policies so users can select/insert/update only their own profile, requests, simulations, and notification preferences.
4. Add public read policy for subsidy_programs and install_reviews.
5. Add a trigger that creates a profile row when a new auth user signs up.
6. Include comments explaining each table for a beginner.
7. Keep the SQL idempotent where reasonable.

Do not run Supabase CLI unless it is already configured. Return the SQL file content summary.
```

## Prompt 5 — Notification preference flow

```text
Read AGENTS.md first.

Implement the MVP notification flow.

Requirements:
1. Add UI for choosing notification method: KakaoTalk, SMS, email.
2. Save the preference to Supabase when logged in.
3. If logged out, show a message that login is required to save notification settings.
4. Do not implement real Kakao/SMS sending yet.
5. Use wording "알림 신청" or "알림 예약", not "실시간 알림".
6. Run npm.cmd run build in apps/web and fix errors.

Return changed files and build result.
```

## Prompt 6 — Final UI polish for demo

```text
Read AGENTS.md first.

Polish the app for a contest/demo presentation.

Requirements:
1. Keep the theme: urban apartment solar, public value, subsidy support, business feasibility.
2. Add sections:
   - why now: electricity price burden and grid loss
   - how it works: suitability -> subsidy -> request -> notification
   - expected impact: apartment residents, Gyeonggi-do policy budget, building owners
   - demo reviews
3. Add clear disclaimers for demo data.
4. Ensure responsive layout for desktop and mobile.
5. Run npm.cmd run build in apps/web and fix errors.

Return changed files and build result.
```

## Prompt 7 — Review and cleanup before GitHub push

```text
Read AGENTS.md first.

Perform a cleanup pass before GitHub push.

Requirements:
1. Check that no secrets are committed.
2. Check that .env.local is ignored.
3. Check that apps/web builds.
4. Remove dead imports and unused code.
5. Ensure README has Windows PowerShell setup commands.
6. Ensure README explains Supabase setup, SQL schema, and env variables.
7. Do not delete important docs.

Run the build and summarize readiness for push.
```
