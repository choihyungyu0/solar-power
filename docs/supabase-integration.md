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

보조금 기준은 `경기 주택태양광 지원사업` 단일 기준이다.
국가 보조금과 경기도 보조금을 중복 합산하지 않는다.

```json
{
  "subsidyProgramName": "경기 주택태양광 지원사업",
  "subsidyPolicyMode": "gyeonggi_home_solar_only",
  "subsidyStackingAllowed": false
}
```

`fieldCheckRequired`의 옥상 장애물, 구조안전성, 방수 상태 등은 현장 확인 및 리포트 경고 항목이다.
AI가 구조안전성이나 장애물 여부를 확정했다고 표현하지 않는다.

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
    "simulation_training_samples": true
  }
}
```

응답에는 Supabase URL이나 service role key를 포함하지 않는다.

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
  suitability_grade
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
  status
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
