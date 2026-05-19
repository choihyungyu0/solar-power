# AGENTS.md

## Project identity

This repository is for a solar adoption MVP for apartments and public housing.
The service concept is: residents, apartment managers, building owners, and public-sector decision makers can estimate whether rooftop or shared-space solar installation is suitable, what benefit may be expected, and what subsidy/policy-support path may apply.

The core product message is:

1. Electricity bills may continue to rise.
2. Apartment-scale self-generation can reduce shared/common electricity burden.
3. Subsidies and policy funds are hard for normal users to understand.
4. This service estimates suitability, expected benefit, subsidy candidates, and next actions in one place.

The core CTA must remain visible in the UI:

```text
우리 아파트 태양광 설치하기
```

## Current technical direction

Use the following stack for the MVP:

```text
React + TypeScript + Vite
Supabase Auth
Supabase PostgreSQL
Supabase Row Level Security
```

Do not introduce a Python/FastAPI dependency for the current MVP unless the user explicitly asks for a backend again. The existing Python API folder may remain as historical/scaffold code, but the active MVP should run from `apps/web`.

## Product scope

Build around these features first:

1. Landing/service introduction
   - Urban apartment + solar visual impression.
   - Explain the problem: electricity cost, grid loss, subsidy complexity, low adoption friction.
   - Explain the solution: AI-based solar suitability and benefit estimate.

2. Auth
   - Supabase email/password signup.
   - Supabase email/password login.
   - Logout.
   - Show logged-in state in the UI.

3. Apartment solar request
   - Form fields:
     - apartment name
     - address
     - household count
     - roof area in square meters
     - current monthly electricity bill
     - preferred contact method: kakao, sms, email
     - phone or contact value
   - Store requests in Supabase.

4. Solar simulation
   - Calculate locally in TypeScript for the MVP.
   - Store the result in Supabase.
   - Result should include:
     - recommended capacity kw
     - panel count
     - expected monthly generation kWh
     - expected yearly generation kWh
     - expected yearly saving KRW
     - estimated install cost KRW
     - estimated subsidy KRW
     - estimated self payment KRW
     - policy loan limit KRW
     - payback years
     - suitability score
   - Use cautious wording such as `예상`, `추정`, `데모 산식`, `실제 공고 확인 필요`.

5. Policy/subsidy information
   - Display subsidy/policy fund candidates.
   - Do not claim a user is guaranteed to receive a subsidy.
   - Use statuses such as `확인 필요`, `접수중`, `마감 임박`, `마감`.

6. Notification concept
   - Kakao/SMS/email can be shown as preferred notification channels.
   - For now, do not implement real Kakao/SMS sending.
   - Save notification preference and show mock notification status in UI.

7. Reviews
   - Display adoption/review cards.
   - Keep mock reviews clearly non-sensitive and non-identifying.

## Business and public-value framing

The service is not only a pretty landing page. It must show how the business works.

Keep this business flow visible in docs and UI copy:

```text
경기도/지자체: 태양광 예산 소진과 정책 참여 확대가 필요함
아파트/건물주: 전기요금 절감과 설치 가능성 확인이 필요함
우리 서비스: 적합지 발굴, 혜택 추정, 신청 지원, 알림 제공
수익 모델: B2G 리포트/대시보드, 설치 중개 수수료, 정책지원 운영 대행
```

Public-value angle:

```text
도심 내 자가발전 확대
송전 손실 완화
공동주택 에너지 비용 부담 완화
정책자금 접근성 향상
경기도/지자체 탄소중립 정책 실행 지원
```

## Repository structure expectations

Preferred structure:

```text
apps/web/                 React + TypeScript app
apps/web/src/lib/          Supabase client, calculator, types
apps/web/src/components/   UI components
supabase/schema.sql        Database schema and RLS policies
docs/                      Planning and submission docs
scripts/                   Local check scripts
AGENTS.md                  Coding-agent instructions
CODEX_PROMPTS.md           Prompt templates for Codex tasks
HARNESS.md                 Local execution and troubleshooting guide
```

## Supabase rules

1. Use environment variables only.

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

2. Never commit Supabase service-role keys.
3. Use `src/lib/supabase.ts` for the Supabase client.
4. Use Row Level Security for user-owned tables.
5. A user should only read/write their own request and simulation rows.
6. Public tables such as policy programs and published reviews may be readable by everyone.
7. Keep all schema changes in `supabase/schema.sql`.

## Frontend coding rules

1. Use TypeScript types for form values, request rows, and simulation result values.
2. Prefer clear beginner-readable code over clever abstractions.
3. Keep components small enough to understand.
4. Use PascalCase for React components.
5. Use camelCase for variables and functions.
6. Do not hide important business logic inside CSS or magic constants.
7. Put simulation constants in one file, for example `src/lib/solarCalculator.ts`.
8. Use Korean UI copy because the project target and contest material are Korean.

## Windows command rules

The user is running Windows PowerShell.

Use this style:

```powershell
cd C:\Users\Administrator\desktop\solar-power-starter\apps\web
npm.cmd install
npm.cmd run dev
npm.cmd run build
```

Do not use Linux/macOS activation commands such as:

```bash
source .venv/bin/activate
```

Do not write the invalid command:

```powershell
npm.cmd.install
```

Correct command:

```powershell
npm.cmd install
```

If PowerShell blocks `npm.ps1`, prefer `npm.cmd` commands or use:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

## Harness / validation commands

Before changing files, inspect the repo.

After changing frontend code, run from repo root:

```powershell
.\scripts\check-windows.ps1
```

If that script does not exist yet, create it. At minimum it should run:

```powershell
cd apps\web
npm.cmd install
npm.cmd run build
```

If the build fails, fix the error before claiming success.

## Agent behavior rules

1. Read this `AGENTS.md` before editing code.
2. Summarize the plan before large changes.
3. Implement one coherent task at a time.
4. Do not delete existing planning documents unless explicitly asked.
5. Do not remove the solar/public-policy business context.
6. Do not replace the product with a generic SaaS landing page.
7. Do not claim live government subsidy data unless actual API/data integration exists.
8. Do not add real Kakao/SMS integration unless credentials and provider requirements are provided.
9. If a command fails, report the exact command and failure reason.
10. Final response must include:
    - files changed
    - commands run
    - whether build passed
    - anything still mock/demo

## Current priority

The next Codex task should be:

```text
Convert the project into a Supabase-first React + TypeScript MVP.
Keep the existing solar UI idea, but connect signup/login, apartment solar request saving, simulation result saving, policy program display, and mock notification preferences through Supabase-ready code and SQL schema.
```
