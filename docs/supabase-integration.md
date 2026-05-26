# SolarMate Render FastAPI - Supabase 연동

## 구조

SolarMate 운영 데이터 저장은 프론트엔드가 아니라 Render FastAPI 백엔드에서만 수행한다.

```text
Vercel/Vite React
  -> Render FastAPI (/api/climate-rooftop-analysis, /api/consultations)
    -> Supabase PostgreSQL (service role key)
```

프론트엔드는 `VITE_CLIMATE_BACKEND_BASE_URL`로 Render API를 호출한다. Supabase service role key는 Render 환경변수로만 읽고, 브라우저 네트워크 요청이나 Vercel 환경변수에 넣지 않는다.

## 사용 테이블

- `public.analysis_results`: 기후/옥상 분석 결과, AI 시뮬레이션 결과, 상담 agentPayload, raw result 저장
- `public.simulation_training_samples`: 시뮬레이션 기반 학습 샘플 저장
- `public.consultation_requests`: 상담 신청 저장
- `public.ai_model_versions`: AI 모델 버전/메타데이터 관리용 테이블

## Render 환경변수

```text
SUPABASE_URL=https://...supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
ENABLE_SUPABASE_WRITE=true
```

`ENABLE_SUPABASE_WRITE`가 정확히 `true`가 아니거나 URL/key가 없으면 백엔드는 DB 저장을 건너뛴다. 이 경우에도 `/api/climate-rooftop-analysis` 응답은 계속 반환된다.

## Service Role Key 위치

service role key는 RLS를 우회할 수 있는 강한 권한이다. 그래서 다음 위치에는 절대 넣지 않는다.

- `apps/web/.env`
- `apps/web/.env.local`
- Vercel 환경변수
- 브라우저에서 읽히는 `VITE_*` 환경변수
- Git 커밋

백엔드가 Supabase에 저장하고 프론트엔드는 Render API만 호출한다.

## RLS 메모

운영 테이블은 RLS를 유지한다. 백엔드는 service role key로 서버 간 저장을 수행하고, 프론트엔드는 직접 쓰기 권한을 갖지 않는다. 공개 조회가 필요한 데이터는 별도 public 정책을 두고, 사용자/상담 데이터는 서버 API를 통해서만 저장한다.

## 저장 동작

분석 API는 `aiSimulationResult`와 `agentPayload`를 만든 뒤 다음을 시도한다.

1. `analysis_results`에 분석 row 저장
2. 저장 성공 시 `analysisResultId`를 top-level 응답, `bundle`, `agentPayload`에 포함
3. `simulation_training_samples`에 학습 샘플 저장
4. DB 실패가 있어도 분석 API 응답은 실패시키지 않음

응답 예시:

```json
{
  "ok": true,
  "analysisResultId": "uuid-or-null",
  "dbSaveStatus": {
    "enabled": true,
    "analysisResultId": "uuid-or-null",
    "ok": true
  }
}
```

상담 API는 `POST /api/consultations`로 접수한다. Supabase 저장 성공 시:

```json
{
  "ok": true,
  "consultationRequestId": "uuid",
  "message": "상담 신청이 접수되었습니다."
}
```

Supabase가 비활성화되었거나 저장 실패 시 안전한 `ok:false` 응답만 반환하고 secret은 노출하지 않는다.

## 테스트 절차

백엔드 문법 확인:

```powershell
cd services\climate_backend
python -m py_compile app/main.py app/pipeline.py app/supabase_client.py app/schemas.py
```

프론트엔드 빌드:

```powershell
cd apps\web
npm.cmd run build
```

수동 확인:

1. Render에 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ENABLE_SUPABASE_WRITE=true` 설정
2. Render 재배포
3. `https://solarmate-climate-backend.onrender.com/api/db-health` 확인
4. `/risk-map`에서 분석 실행
5. Supabase `analysis_results` row 삽입 확인
6. Supabase `simulation_training_samples` row 삽입 확인
7. `/consultation`에서 상담 신청
8. Supabase `consultation_requests` row 삽입 확인
9. 브라우저 Network와 Vercel env에 service role key가 없는지 확인

## 문제 해결

- `supabaseEnabled:false`: Render 환경변수 또는 `ENABLE_SUPABASE_WRITE` 값을 확인한다.
- `canConnect:false`: 테이블명, service role key 권한, Supabase URL을 확인한다.
- 분석은 성공했지만 `analysisResultId:null`: DB 저장이 비활성화되었거나 insert 응답에서 id가 반환되지 않은 상태다. `dbSaveStatus.error`를 확인한다.
- 상담 화면에서 임시 접수 상태 표시: `/api/consultations` 호출 또는 Supabase 저장이 실패해 sessionStorage fallback이 사용된 상태다.
- 빌드에 service key가 보임: 즉시 Vercel/Vite 환경변수에서 제거하고 키를 회전한다.
