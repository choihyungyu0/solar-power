# SolarMate 관리자 상담 관리

## 목적

`/admin/consultations`는 Supabase에 저장된 상담 신청을 내부 운영자가 확인하고 처리 상태를 바꾸기 위한 데모 관리자 화면이다.
프론트엔드는 Supabase에 직접 연결하지 않고 Render FastAPI 백엔드만 호출한다.

```text
Vercel/Vite frontend -> Render FastAPI admin API -> Supabase PostgreSQL
```

## Render 환경 변수

Render FastAPI 서비스에 관리자 키를 설정한다.

```text
SOLARMATE_ADMIN_KEY=충분히 긴 임의 문자열
```

이미 운영 DB 저장을 위해 아래 값도 Render에 있어야 한다.

```text
SUPABASE_URL=https://...supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
ENABLE_SUPABASE_WRITE=true
```

`SOLARMATE_ADMIN_KEY`는 프론트엔드 환경 변수에 넣지 않는다.
`VITE_SOLARMATE_ADMIN_KEY`, `VITE_SUPABASE_SERVICE_ROLE_KEY` 같은 값을 만들지 않는다.

## 접근 방법

프론트 배포 또는 로컬 Vite에서 아래 경로로 접속한다.

```text
/admin/consultations
```

페이지의 관리자 키 입력칸에 `SOLARMATE_ADMIN_KEY` 값을 직접 입력하고 새로고침 버튼을 누른다.
키는 React state에만 머물며 `localStorage`나 `sessionStorage`에 저장하지 않는다.

## 백엔드 API

### 상담 목록 조회

```http
GET /api/admin/consultations
X-SolarMate-Admin-Key: {SOLARMATE_ADMIN_KEY}
```

응답은 상담 신청 배열이다.

```json
[
  {
    "id": "uuid",
    "createdAt": "2026-05-26T00:00:00Z",
    "name": "테스트사용자",
    "contact": "010-0000-0000",
    "email": "test@example.com",
    "consultationType": "설치 가능 여부 상담",
    "roadAddress": "경기도 화성시 테스트 주소",
    "status": "received",
    "analysisResultId": "uuid",
    "suitabilityScore": 82,
    "suitabilityGrade": "A",
    "annualGenerationKwh": 12345,
    "installCapacityKw": 12.8
  }
]
```

연결된 `analysis_results`가 없으면 적합도, 발전량, 설치용량 필드는 `null`로 반환한다.

### 상태 변경

```http
PATCH /api/admin/consultations/{id}/status
X-SolarMate-Admin-Key: {SOLARMATE_ADMIN_KEY}
Content-Type: application/json

{
  "status": "contacted"
}
```

허용 상태:

- `received`
- `contacted`
- `waiting_documents`
- `proposal_sent`
- `closed`

성공 응답:

```json
{
  "ok": true,
  "id": "uuid",
  "status": "contacted"
}
```

관리자 키가 없거나 틀리면 안전한 오류만 반환한다.

```json
{
  "ok": false,
  "message": "관리자 권한이 필요합니다."
}
```

## 운영 테스트

PowerShell에서 관리자 키를 현재 세션 환경 변수로 설정한 뒤 실행한다.

```powershell
$env:SOLARMATE_ADMIN_KEY="Render에 설정한 관리자 키"
powershell -ExecutionPolicy Bypass -File .\scripts\test-production-admin-consultations.ps1
```

백엔드 URL을 바꾸려면:

```powershell
$env:SOLARMATE_BACKEND_URL="https://solarmate-climate-backend.onrender.com"
```

스크립트는 상담 목록을 조회하고, 첫 번째 행이 있으면 상태를 `contacted`로 바꾼 뒤 원래 상태로 되돌린다.
스크립트는 관리자 키를 출력하지 않는다.

## 보안 한계

현재 방식은 내부 데모용 공유 키 인증이다.
실제 운영에서는 다음 보강이 필요하다.

- 관리자 계정 기반 로그인
- 역할 기반 권한 관리
- 감사 로그
- IP 제한 또는 사내 SSO
- 키 회전 절차

상담 목록에는 이름, 연락처 등 개인정보가 포함되므로 공개 API나 공개 화면에 노출하면 안 된다.
