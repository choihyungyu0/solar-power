# SolarMate Render FastAPI - Supabase 연동

> 현재 활성 MVP는 `apps/web`의 Supabase-first React 흐름입니다. 이 문서는 Render FastAPI 기반 기후 분석 저장 파이프라인의 과거/보조 기록으로 유지하며, 현재 MVP 인증·요청·시뮬레이션 저장 흐름은 [supabase-first-mvp.md](./supabase-first-mvp.md)를 기준으로 봅니다.

## 목적

SolarMate 운영 데이터 저장은 프론트엔드가 아니라 Render FastAPI 백엔드에서만 수행한다. 브라우저는 Render API를 호출하고, Render API가 Supabase service role key로 필요한 테이블에 저장한다.

```text
Vercel frontend -> Render FastAPI backend -> Supabase PostgreSQL
```

이 구조는 `/risk-map` 분석 결과, 시뮬레이션 기반 학습 샘플, 상담 신청을 운영 DB에 남기면서도 Supabase service role key를 브라우저에 노출하지 않기 위한 구조다.

## 사용 테이블

- `analysis_results`: 건물 분석 결과, `aiSimulationResult`, `agentPayload`, 원본 분석 payload 저장
- `consultation_requests`: 상담 신청 정보와 연결된 `analysis_result_id`, 상담 agent payload 저장
- `simulation_training_samples`: Render 분석 결과에서 생성한 시뮬레이션 기반 학습 샘플 저장
- `profit_reports`: AI 수익·보조금·금융 리포트 결과 저장
- `subsidy_programs`: 주택 유형별 보조금 matrix 저장(아파트/공동주택은 한국에너지공단 공동주택 기준, 단독주택은 경기 시군 3kW 기준)
- `loan_scenarios`: 리포트 생성 시 사용한 대출 지원 시나리오 저장
- `ai_model_versions`: AI 모델 버전과 메타데이터 관리용 테이블

## Render 환경 변수

Render FastAPI 서비스에만 아래 값을 설정한다.

```text
SUPABASE_URL=https://...supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
ENABLE_SUPABASE_WRITE=true
```

`ENABLE_SUPABASE_WRITE`가 정확히 `true`가 아니거나 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`가 없으면 백엔드는 DB 저장을 건너뛴다. 이 경우에도 기후 분석 API는 실패하지 않고 결과를 반환한다.

## 보안 원칙

`SUPABASE_SERVICE_ROLE_KEY`는 RLS를 우회할 수 있는 서버 전용 권한이다. 다음 위치에는 절대 넣지 않는다.

- `apps/web/.env`
- `apps/web/.env.local`
- Vercel 환경 변수
- `VITE_*`로 시작하는 프론트엔드 환경 변수
- 브라우저 Network 요청
- Git 커밋

프론트엔드가 필요한 값은 `VITE_CLIMATE_BACKEND_BASE_URL`뿐이다. 상담 신청과 분석 저장은 모두 Render 백엔드를 거쳐 처리한다.

## 저장 동작

`POST /api/climate-rooftop-analysis`는 `aiSimulationResult`와 `agentPayload` 생성 후 다음 순서로 저장을 시도한다.
`agentPayload`에는 상담 에이전트가 우선 읽는 `reportInputMetrics`가 포함된다.
이 4대 지표는 예상 발전량, 투입 비용/자부담, 회수기간, 보조금 적용 가능성/설치 적합도다.

1. `analysis_results`에 분석 결과 저장
2. 저장 성공 시 `analysisResultId`를 top-level 응답, `bundle`, `aiSimulationResult`, `agentPayload`에 추가
3. `simulation_training_samples`에 시뮬레이션 기반 학습 샘플 저장
4. 저장 실패 시에도 분석 결과는 그대로 반환하고 `dbSaveStatus`에 실패 사유만 기록

운영 화면에서 생성된 row는 기본적으로 `is_test=false`다. 반복 테스트 스크립트는 `isTest:true`, `source:'manual-production-test'`를 API 요청에 포함해 수동 테스트 row를 구분한다.
새 컬럼이 아직 Supabase에 적용되지 않은 환경에서는 백엔드가 `is_test`, `source` 컬럼을 제거하고 1회 재시도하므로 기존 저장 흐름은 유지된다.

성공 예:

```json
{
  "ok": true,
  "analysisResultId": "uuid",
  "dbSaveStatus": {
    "enabled": true,
    "analysisResultOk": true,
    "analysisResultId": "uuid",
    "ok": true,
    "trainingSampleOk": true,
    "trainingSampleId": "uuid"
  }
}
```

비활성화 또는 실패 예:

```json
{
  "ok": true,
  "analysisResultId": null,
  "dbSaveStatus": {
    "enabled": false,
    "analysisResultOk": false,
    "analysisResultId": null,
    "ok": false,
    "errorType": "SupabaseDisabled",
    "reason": "ENABLE_SUPABASE_WRITE is not true."
  }
}
```

## 상담 API

프론트엔드는 `POST /api/consultations`로 상담 신청을 보낸다.

필수값:

- `name`
- `contact`
- `privacyAgreed: true`

입력 제한:

- `name`: 최대 50자
- `contact`: 최대 50자
- `email`: 최대 120자
- `content`: 최대 2000자

중복 접수 방지:

- `analysisResultId`가 있으면 최근 5분 내 `contact + analysisResultId`가 같은 상담 신청을 중복으로 본다.
- `analysisResultId`가 없으면 최근 5분 내 `contact + roadAddress`가 같은 상담 신청을 중복으로 본다.
- 중복이면 새 row를 만들지 않고 기존 `consultationRequestId`를 반환한다.
- 오류 응답에는 이름, 연락처, 이메일 같은 개인정보 값을 포함하지 않는다.

저장 컬럼:

- `name`
- `contact`
- `email`
- `consultation_type`
- `content`
- `road_address`
- `jibun_address`
- `analysis_result_id`
- `privacy_agreed`
- `third_party_agreed`
- `agent_payload`
- `status = "received"`

성공 응답:

```json
{
  "ok": true,
  "consultationRequestId": "uuid",
  "message": "상담 신청이 접수되었습니다."
}
```

중복 접수 응답:

```json
{
  "ok": true,
  "consultationRequestId": "existing-uuid",
  "message": "이미 접수된 상담 신청입니다."
}
```

실패 응답:

```json
{
  "ok": false,
  "message": "상담 신청 저장 중 오류가 발생했습니다.",
  "errorType": "SupabaseDisabled"
}
```

프론트엔드는 상담 저장 실패 시 sessionStorage에 임시 저장하고 다음 메시지를 표시한다.

```text
서버 저장에 실패하여 임시 저장되었습니다. 네트워크 상태를 확인해주세요.
```

## 상담 에이전트 payload

`analysis_results.agent_payload`와 `consultation_requests.agent_payload`에는 동일한 상담용 payload 구조가 저장된다.
상담 LLM/RAG는 `agentPayload.reportInputMetrics`를 우선 사용한다.

보조금 기준은 건물 유형에 따라 분기한다. 아파트/공동주택은 한국에너지공단 공동주택 기준, 단독주택은 경기 시군 3kW 기준을 사용한다.
서로 다른 보조금 제도를 중복 합산하지 않는다.

```json
{
  "subsidyProgramName": "한국에너지공단 신재생에너지 보급사업(공동주택)",
  "subsidyPolicyMode": "knrec_apartment_low_carbon_module",
  "subsidyStackingAllowed": false
}
```

`fieldCheckRequired`의 옥상 장애물, 구조안전성, 방수 상태 등은 현장 확인 및 리포트 경고 항목이다.
AI가 구조안전성이나 장애물 여부를 확정했다고 표현하지 않는다.

## AI 수익·보조금·금융 리포트 API

`POST /api/ai-profit-report`는 범용 상담 챗봇이 아니라 태양광 도입 수익성 리포트 생성 endpoint다.

요청 예:

```json
{
  "analysisResultId": "uuid",
  "userFinanceInput": {
    "availableCashKrw": 5000000,
    "preferredLoanYears": 5,
    "loanCoverageRatio": 0.8
  }
}
```

응답 예:

```json
{
  "ok": true,
  "profitReportId": "uuid",
  "report": {
    "schemaVersion": "solarmate-profit-report-v1",
    "reportType": "solar_profit_report",
    "fourMetrics": {},
    "subsidyMatrix": {},
    "loanSupportScenario": {},
    "netInvestment": {}
  },
  "reportMarkdown": "# AI 수익·보조금·금융 리포트...",
  "dbSaveStatus": {
    "enabled": true,
    "profitReportOk": true,
    "loanScenarioOk": true
  }
}
```

보조금은 건물 유형별 기준이며 `subsidyStackingAllowed=false`다.
대출은 예상 시나리오이며 실제 승인은 금융기관 심사가 필요하다.

## 테스트 데이터 표시 컬럼 SQL

아래 SQL은 수동 운영 테스트 row와 실제 사용자 row를 구분하기 위한 마이그레이션이다.
Supabase SQL Editor에서 1회 적용한다.

```sql
alter table public.analysis_results
  add column if not exists is_test boolean not null default false,
  add column if not exists source text;

alter table public.consultation_requests
  add column if not exists is_test boolean not null default false,
  add column if not exists source text;

alter table public.simulation_training_samples
  add column if not exists is_test boolean not null default false,
  add column if not exists source text;

alter table public.profit_reports
  add column if not exists is_test boolean not null default false,
  add column if not exists source text;

alter table public.loan_scenarios
  add column if not exists is_test boolean not null default false,
  add column if not exists source text;
```

수동 테스트 row 정리 SQL:

```sql
delete from public.loan_scenarios
where is_test = true or source = 'manual-production-test';

delete from public.profit_reports
where is_test = true or source = 'manual-production-test';

delete from public.consultation_requests
where is_test = true or source = 'manual-production-test';

delete from public.simulation_training_samples
where is_test = true or source = 'manual-production-test';

delete from public.analysis_results
where is_test = true or source = 'manual-production-test';
```

`consultation_requests`의 `name`, `contact`는 개인정보다. 테스트 row 조회나 정리 결과를 공개 화면/API에 노출하지 않는다.

## AI 수익 리포트 테이블 SQL

아래 SQL은 Supabase SQL Editor에서 수동으로 적용한다.
운영 RLS 정책은 프로젝트 인증/관리자 API 설계에 맞게 강화해야 하며, 프론트엔드는 이 테이블에 직접 접근하지 않는다.
Render FastAPI 백엔드는 service role key로 서버 저장만 수행한다.

```sql
create extension if not exists pgcrypto;

create table if not exists public.profit_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  analysis_result_id uuid references public.analysis_results(id),
  consultation_request_id uuid references public.consultation_requests(id),
  report_type text not null default 'solar_profit_report',
  report_status text not null default 'generated',
  input_payload jsonb,
  subsidy_matrix jsonb,
  loan_scenario jsonb,
  report_json jsonb,
  report_markdown text,
  disclaimer text,
  is_test boolean not null default false,
  source text
);

alter table public.profit_reports enable row level security;

create table if not exists public.subsidy_programs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  program_name text,
  region_sido text,
  region_sigungu text,
  target_building_type text,
  support_type text,
  subsidy_amount_krw bigint,
  subsidy_rate numeric,
  max_subsidy_krw bigint,
  stacking_allowed boolean not null default false,
  stacking_note text,
  eligibility_note text,
  source_title text,
  source_url text,
  source_year integer,
  raw_payload jsonb
);

alter table public.subsidy_programs enable row level security;

create table if not exists public.loan_scenarios (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  analysis_result_id uuid references public.analysis_results(id),
  loan_basis text,
  loan_years integer,
  loan_coverage_ratio numeric,
  estimated_loan_limit_krw bigint,
  annual_revenue_basis_krw bigint,
  monthly_payment_estimate_krw bigint,
  note text,
  raw_payload jsonb,
  is_test boolean not null default false,
  source text
);

alter table public.loan_scenarios enable row level security;
```

최신 수익 리포트 확인:

```sql
select
  id,
  created_at,
  analysis_result_id,
  report_type,
  report_status,
  is_test,
  source,
  report_json->'fourMetrics' as four_metrics
from public.profit_reports
order by created_at desc
limit 5;
```

최신 대출 시나리오 확인:

```sql
select
  id,
  created_at,
  analysis_result_id,
  loan_years,
  loan_coverage_ratio,
  estimated_loan_limit_krw,
  monthly_payment_estimate_krw,
  is_test,
  source
from public.loan_scenarios
order by created_at desc
limit 5;
```

동일한 점검 쿼리는 아래 파일에도 정리되어 있다.

```text
scripts/check-profit-report-tables.sql
```

운영 API 저장까지 한 번에 확인하려면 Render 재배포와 테이블 생성 후 아래 스크립트를 실행한다.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-production-profit-report-flow.ps1
```

## DB Health

운영 점검용 endpoint:

```text
GET /api/db-health
```

응답 예:

```json
{
  "ok": true,
  "supabaseEnabled": true,
  "canConnect": true,
  "tables": {
    "analysis_results": true,
    "consultation_requests": true,
    "simulation_training_samples": true,
    "profit_reports": true,
    "subsidy_programs": true,
    "loan_scenarios": true,
    "subsidy_documents": true,
    "subsidy_chunks": true
  },
  "rpcs": {
    "match_subsidy_chunks": true
  }
}
```

테이블이 아직 생성되지 않았거나 권한 문제로 읽을 수 없으면 해당 테이블 값만 `false`로 내려오며, endpoint 자체는 실패하지 않는다.
`canConnect`는 Supabase가 활성화되어 있고 위 기본 테이블과 RAG 테이블을 모두 읽을 수 있을 때 `true`다.

응답에는 Supabase URL이나 service role key를 포함하지 않는다.

## 보조금 RAG pgvector 테이블

SolarMate 보조금 RAG는 정책 row/document chunk를 Supabase pgvector에 저장하고, `/api/ai-profit-report`에서 지역/건물 조건에 맞는 chunk를 검색해 `subsidyRagContext`와 `sourceReferences`로 저장한다.
아래 SQL은 Supabase SQL Editor에서 실행한다.

```sql
create extension if not exists vector with schema extensions;

create table if not exists public.subsidy_documents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source_type text not null,
  source_title text not null,
  source_url text,
  source_year integer,
  region_sido text,
  region_sigungu text,
  program_name text,
  document_version text,
  raw_metadata jsonb,
  is_active boolean not null default true,
  is_test boolean not null default false
);

create table if not exists public.subsidy_chunks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  document_id uuid references public.subsidy_documents(id) on delete cascade,
  chunk_index integer not null,
  chunk_text text not null,
  chunk_type text,
  region_sido text,
  region_sigungu text,
  program_name text,
  target_building_type text,
  subsidy_amount_krw bigint,
  subsidy_rate numeric,
  max_subsidy_krw bigint,
  self_payment_krw bigint,
  stacking_allowed boolean,
  eligibility_note text,
  source_title text,
  source_url text,
  source_year integer,
  embedding extensions.vector(1536),
  raw_payload jsonb,
  is_active boolean not null default true,
  is_test boolean not null default false
);

alter table public.subsidy_documents enable row level security;
alter table public.subsidy_chunks enable row level security;

create or replace function public.match_subsidy_chunks (
  query_embedding extensions.vector(1536),
  match_count int default 5,
  filter_region_sido text default null,
  filter_region_sigungu text default null
)
returns table (
  id uuid,
  document_id uuid,
  chunk_text text,
  program_name text,
  region_sido text,
  region_sigungu text,
  subsidy_amount_krw bigint,
  subsidy_rate numeric,
  max_subsidy_krw bigint,
  self_payment_krw bigint,
  stacking_allowed boolean,
  source_title text,
  source_url text,
  source_year integer,
  similarity float
)
language sql stable
as $$
  select
    c.id,
    c.document_id,
    c.chunk_text,
    c.program_name,
    c.region_sido,
    c.region_sigungu,
    c.subsidy_amount_krw,
    c.subsidy_rate,
    c.max_subsidy_krw,
    c.self_payment_krw,
    c.stacking_allowed,
    c.source_title,
    c.source_url,
    c.source_year,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.subsidy_chunks c
  where c.is_active = true
    and (filter_region_sido is null or c.region_sido = filter_region_sido)
    and (filter_region_sigungu is null or c.region_sigungu = filter_region_sigungu)
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
```

검증 SQL은 [check-subsidy-rag-tables.sql](../scripts/check-subsidy-rag-tables.sql)에 있다.

```powershell
cd services\climate_backend
python scripts\seed_subsidy_rag_from_excel.py
```

seed는 `data/policy/태양광_지원사업_정리.xlsx`를 읽어 `subsidy_documents`, `subsidy_chunks`를 생성한다.
`OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`는 Render 또는 로컬 백엔드 환경변수에만 둔다.

## Supabase SQL Editor 수동 확인

아래 쿼리는 Supabase SQL Editor에서 운영 저장 여부를 직접 확인하기 위한 것이다.
이 결과를 공개 화면이나 공개 API로 노출하지 않는다. 특히 `consultation_requests`의 `name`, `contact`는 개인정보다.

최신 분석 결과 확인:

```sql
select
  id,
  created_at,
  building_id,
  road_address,
  annual_generation_kwh,
  suitability_score,
  suitability_grade,
  is_test,
  source
from public.analysis_results
order by created_at desc
limit 5;
```

최신 학습 샘플 확인:

```sql
select
  id,
  created_at,
  building_id,
  shading_average,
  panel_count,
  install_capacity_kw,
  annual_generation_kwh,
  is_test,
  source
from public.simulation_training_samples
order by created_at desc
limit 5;
```

최신 상담 신청 확인:

```sql
select
  id,
  created_at,
  name,
  contact,
  consultation_type,
  road_address,
  analysis_result_id,
  status,
  is_test,
  source
from public.consultation_requests
order by created_at desc
limit 5;
```

## RLS 메모

운영 테이블은 RLS를 유지한다. Render 백엔드는 service role key로 서버 저장을 수행하고, 프론트엔드는 직접 쓰기 권한을 갖지 않는다. 사용자별 공개/비공개 조회 정책이 필요해지면 Supabase Auth 기반의 별도 읽기 API 또는 RLS 정책을 추가한다.

## 테스트 절차

백엔드 문법 검사:

```powershell
cd services\climate_backend
python -m py_compile app/main.py app/pipeline.py app/supabase_client.py app/schemas.py
```

프론트엔드 빌드:

```powershell
cd apps\web
npm.cmd run build
```

운영 수동 테스트:

1. Render에 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ENABLE_SUPABASE_WRITE=true` 설정
2. Render 재배포
3. `https://solarmate-climate-backend.onrender.com/api/db-health` 확인
4. 반복 가능한 운영 테스트 스크립트 실행

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-production-supabase-flow.ps1
```

5. Supabase SQL Editor에서 위 수동 확인 쿼리 실행
6. `/risk-map`에서 건물 선택 후 분석 실행
7. `/consultation`에서 상담 신청
8. 브라우저 Network, Vercel env, `apps/web` 소스에 service role key가 없는지 확인

## 문제 해결

- `supabaseEnabled:false`: Render 환경 변수와 `ENABLE_SUPABASE_WRITE=true` 값을 확인한다.
- `canConnect:false`: 테이블명, service role key 권한, Supabase URL을 확인한다.
- 분석은 성공했지만 `analysisResultId:null`: DB 저장이 비활성화되었거나 insert 응답에 id가 없을 수 있다. `dbSaveStatus`를 확인한다.
- 상담 완료 페이지에 “임시 접수 상태입니다.”가 표시됨: `/api/consultations` 호출 또는 Supabase 저장이 실패해 sessionStorage fallback을 사용한 상태다.
- 브라우저에서 service key가 보임: 즉시 Vercel/Vite 환경 변수에서 제거하고 키를 회전한다.
