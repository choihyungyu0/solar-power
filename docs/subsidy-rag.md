# SolarMate 보조금 RAG

## 목적

SolarMate의 보조금 설명은 더 이상 단순 정책 matrix만 보지 않는다.
`태양광_지원사업_정리.xlsx`와 향후 정책 PDF/공고문을 chunk로 나누고, OpenAI embedding을 생성해 Supabase pgvector에 저장한 뒤, 수익 리포트 생성 시 관련 근거 chunk를 검색한다.

이 프로젝트에서 RAG는 다음 조건을 모두 만족해야 한다.

1. 보조금 원천 row/document를 chunk로 만든다.
2. chunk embedding을 생성한다.
3. Supabase `subsidy_chunks.embedding`에 pgvector로 저장한다.
4. `/api/ai-profit-report`가 지역/건물/설치 조건에 맞는 chunk를 검색한다.
5. LLM은 검색된 chunk만 보조금 설명 근거로 사용한다.
6. 리포트에는 `subsidyRagContext`와 `sourceReferences`가 저장된다.

## 데이터 소스

현재 1차 소스:

```text
data/policy/태양광_지원사업_정리.xlsx
```

파일이 없다면 위 경로에 배치한 뒤 seed를 실행한다.
향후 경기도/시군 공고 PDF, 지자체 고시, 사업 안내문을 같은 방식으로 chunk화할 수 있다.

## Supabase 저장 구조

- `subsidy_documents`: 원천 문서/시트 metadata
- `subsidy_chunks`: 검색 가능한 chunk, 보조금 금액/자부담/지역 metadata, embedding
- `match_subsidy_chunks`: query embedding과 chunk embedding의 vector similarity 검색 RPC

SQL은 `docs/supabase-integration.md`와 `scripts/check-subsidy-rag-tables.sql`에 있다.

## Seed 방법

Render 또는 로컬 백엔드 환경에 서버 전용 env를 설정한다.

```text
OPENAI_API_KEY=...
ENABLE_SUBSIDY_RAG=true
SUBSIDY_EMBEDDING_MODEL=text-embedding-3-small
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
ENABLE_SUPABASE_WRITE=true
```

키 값은 프론트엔드 env, 문서, 소스에 저장하지 않는다.

실행:

```powershell
cd services\climate_backend
python scripts/seed_subsidy_rag_from_excel.py
```

출력 예:

```text
{'documentsDeactivated': 2, 'chunksDeactivated': 37, 'documentsInserted': 2, 'chunksInserted': 37, 'failedRows': 0}
```

seed는 같은 `태양광 지원사업 정리 - ...` 출처의 기존 RAG row를 먼저 `is_active=false`로 비활성화한 뒤 새 chunk를 넣는다.
엑셀 매핑이나 chunk 품질을 고친 뒤 다시 실행해도 예전 chunk가 검색 결과에 섞이지 않게 하기 위한 동작이다.

## 검색 API

```http
POST /api/subsidy-rag/search
Content-Type: application/json

{
  "regionSido": "경기도",
  "regionSigungu": "화성시",
  "buildingUsage": "공동주택",
  "installCapacityKw": 3,
  "query": "화성시 경기 주택태양광 지원사업 보조금 중복 지원 여부"
}
```

성공 시:

```json
{
  "ok": true,
  "ragEnabled": true,
  "query": "...",
  "matches": []
}
```

RAG가 꺼져 있거나 테이블/RPC가 없으면 safe error를 반환하고 secret은 노출하지 않는다.

## 수익 리포트 통합

`/api/ai-profit-report`는 report 생성 중 다음 필드를 추가한다.

```json
{
  "subsidyRagContext": {
    "enabled": true,
    "query": "...",
    "matches": []
  },
  "sourceReferences": [
    {
      "sourceTitle": "태양광 지원사업 정리 - Sheet1",
      "sourceUrl": null,
      "sourceYear": 2026,
      "evidenceSummary": "경기 주택태양광 지원사업 경기도 화성시 ..."
    }
  ]
}
```

LLM narrative prompt에는 검색된 `subsidyRagContext`만 보조금 근거로 쓰라는 규칙이 들어간다.
검색 근거가 없으면 `확인 필요`로 표현한다.

## 말할 수 있는 것

- 보조금 RAG 근거 기반 리포트
- 경기도/시군 보조금 자료 검색 결과에 따른 예상 검토
- 보조금 중복 합산은 하지 않음
- 실제 지원 여부는 공고와 예산 잔여 여부 확인 필요

## 말할 수 없는 것

- 보조금 확정
- 대출 확정
- 발전량/절감액 보장
- 구조안전성 또는 장애물 상태 확정
- 국가 + 경기도 보조금 stack 계산

## 테스트

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-production-subsidy-rag-flow.ps1
```

기대 결과:

- `/api/db-health`에 `subsidy_documents`, `subsidy_chunks`, `match_subsidy_chunks`가 표시된다.
- `/api/subsidy-rag/search`가 match를 반환한다.
- `/api/ai-profit-report`의 `subsidyRagContext.enabled`가 true다.
- `sourceReferences`가 1개 이상이다.
- `reportNarrativeSource`는 OpenAI LLM 설정에 따라 `llm-structured-output` 또는 fallback 값이 될 수 있다.
