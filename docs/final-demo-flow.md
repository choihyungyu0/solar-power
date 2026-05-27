# SolarMate Final Demo Flow

## 목적

최종 데모에서는 사용자가 건물을 선택해 태양광 적합도와 수익 리포트를 확인하고, 상담 신청이 Supabase에 저장되며, 관리자가 상담과 연결된 수익 리포트를 확인하는 흐름을 보여준다.

## 데모 URL

- 프론트엔드: `https://solar-power-eta.vercel.app`
- 백엔드 health: `https://solarmate-climate-backend.onrender.com/health`
- DB health: `https://solarmate-climate-backend.onrender.com/api/db-health`
- 지도/분석: `https://solar-power-eta.vercel.app/risk-map`
- 결과 리포트: `https://solar-power-eta.vercel.app/simulation/result`
- 상담 신청: `https://solar-power-eta.vercel.app/consultation`
- 관리자 상담 관리: `https://solar-power-eta.vercel.app/admin/consultations`

배포 URL이 바뀌면 위 주소 대신 현재 Vercel/Render 주소를 사용한다.

## 시연 시나리오

1. `/risk-map`에서 화성시 테스트 건물 또는 데모 가능한 건물을 선택한다.
2. 태양광 설치 탭에서 AI 분석을 실행한다.
3. `analysisResultId`가 생성되고 `dbSaveStatus.analysisResultOk`, `dbSaveStatus.trainingSampleOk`가 true인지 확인한다.
4. `AI 수익 리포트 보기` 또는 `/simulation/result`의 `수익 리포트 생성하기`를 실행한다.
5. `reportNarrativeSource`가 `llm-structured-output`이면 OpenAI LLM이 문장 생성에 성공한 상태다. 실패하거나 비활성화되면 `deterministic-template` 문장으로 fallback된다.
6. `AI 태양광 도입 종합 보고서`에서 LLM/템플릿 narrative, 5개 카드, `보조금 RAG 근거`, 주의사항을 확인한다.
7. `PDF로 저장` 버튼으로 브라우저 인쇄 미리보기를 연다.
8. 인쇄 미리보기에서 리포트 제목, narrative 문장, 5개 수익 카드, 주의사항, 상담 CTA가 보이는지 확인한다.
9. `상담 신청하기`로 이동해 상담을 제출한다.
10. 완료 화면에서 `접수번호`를 확인한다.
11. `/login`의 `관리자 화면으로 이동` 버튼 또는 직접 URL로 `/admin/consultations`에 접속한다.
12. Render에 설정한 `SOLARMATE_ADMIN_KEY`를 입력하고 `새로고침`한다.
13. 상담 row, 상태 변경, `수익 리포트 보기` 모달을 확인한다.
14. 관리자 수익 리포트 모달에서 narrative 문장, 5개 카드, 주의사항, Markdown/JSON 개발자 보기를 확인한다.

## 기대 DB Rows

분석 1회와 상담 1회를 정상 진행하면 아래 row가 생성된다.

- `analysis_results`: 건물/주소, 연간 발전량, 적합도, `ai_simulation_result`, `agent_payload`
- `simulation_training_samples`: 지붕 면적, 음영 비율, 패널 수, 설치 용량, 발전량
- `profit_reports`: `analysis_result_id`, `subsidy_matrix`, `loan_scenario`, `report_json`, `report_markdown`
- `subsidy_documents`, `subsidy_chunks`: 보조금 RAG 원천 문서와 pgvector chunk
- `loan_scenarios`: 대출 검토 시나리오와 월 상환 추정치
- `consultation_requests`: 이름, 연락처, 주소, `analysis_result_id`, `agent_payload`, 상태

반복 테스트 스크립트가 만든 row는 `is_test=true`, `source='manual-production-test'`로 저장된다. 관리자 화면은 기본적으로 테스트 데이터를 숨기며, `테스트 데이터 보기`를 켜면 표시한다.

`profit_reports.report_json`에는 다음 LLM narrative 상태 필드가 저장된다.

- `reportNarrativeSource`: `llm-structured-output` 또는 `deterministic-template`
- `llmEnabled`: Render 환경변수 기준 LLM 사용 여부
- `reportNarrative.headline`, `summary`, `salesMessage`
- `subsidyRagContext`: 검색 query와 보조금 근거 chunk
- `sourceReferences`: 리포트에 사용한 보조금 근거 출처

LLM은 narrative 문장만 생성한다. 보조금 설명은 검색된 RAG chunk를 근거로만 작성하며, 설치비, 보조금, 대출 한도, 실투자금, 회수기간은 백엔드 결정론 코드가 계산한 값을 그대로 사용한다.

## 운영 Smoke Test

Render 배포와 Supabase 테이블 상태를 한 번에 확인한다.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\final-production-smoke-test.ps1
```

이 스크립트는 Supabase secret을 요구하지 않는다. 공개 Render API만 호출하며 다음 ID를 출력한다.

- `analysisResultId`
- `profitReportId`
- `consultationRequestId`

기존 상세 테스트도 유지한다.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-production-supabase-flow.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\test-production-profit-report-flow.ps1
```

## Fallback Behavior

- Supabase 저장 실패: 분석 결과 자체는 가능한 범위에서 반환하고 `dbSaveStatus`에 실패 상태를 남긴다.
- 상담 저장 실패: 프론트엔드는 sessionStorage에 임시 저장하고 `서버 저장에 실패하여 임시 저장되었습니다. 네트워크 상태를 확인해주세요.`를 보여준다.
- 수익 리포트 생성 실패: deterministic report 생성 실패 메시지를 표시하고 상담 흐름은 기존 분석 payload로 진행할 수 있다.
- OpenAI LLM 비활성 또는 호출 실패: `/api/ai-profit-report`는 `ok:true`를 유지하고 `reportNarrativeSource='deterministic-template'` 문장을 사용한다.
- 관리자 키 오류: `{ ok:false, message:"관리자 권한이 필요합니다." }`만 반환하고 키 값은 노출하지 않는다.
- 기후 분석 입력이 너무 크면 좌표 수, 지붕 면적, 셀 스캔 수 제한으로 중단하고 안전한 검증 오류 메시지를 반환한다.

## 입력 제한

- 상담 신청: 이름 50자, 연락처 50자, 이메일 120자, 상담 내용 2000자
- 기후 분석: 건물 feature JSON 약 500KB, polygon 좌표 1000개, 지붕 면적 70000㎡, 셀 스캔 50000개, 원본 분석 셀 20000개 이내
- 테스트 데이터: 운영 smoke/test 스크립트는 `isTest=true`, `source='manual-production-test'`로 저장한다.

## 보안 체크

- `apps/web/.env.local`은 `.gitignore`에 포함되어 있고 Git에 추적되지 않아야 한다.
- `services/climate_backend/.venv/`, `__pycache__/`, `*.pyc`는 추적하지 않는다.
- `SUPABASE_SERVICE_ROLE_KEY`, `SOLARMATE_ADMIN_KEY`, `OPENAI_API_KEY` 값은 프론트엔드 env 또는 소스에 넣지 않는다.
- `OPENAI_API_KEY`는 Render FastAPI 백엔드 환경변수에만 둔다. `VITE_OPENAI_API_KEY` 같은 프론트엔드 env는 만들지 않는다.
- 관리자 키는 `/admin/consultations` 화면에서 직접 입력하고, localStorage/sessionStorage에 저장하지 않는다.
- 프론트엔드는 Supabase service role key로 직접 요청하지 않는다.

## 알려진 한계

- 보조금은 `경기 주택태양광 지원사업` 단일 기준 추정이며, 실제 지원 여부는 공고와 예산 잔여 여부 확인이 필요하다.
- 대출 시나리오는 예상이며, 실제 승인과 조건은 금융기관 심사가 필요하다.
- 장애물, 구조안전성, 방수 상태는 AI가 확정하지 않는다. 현장 확인 항목으로만 표시한다.
- VWorld/기후 API 외부 의존성이 실패하면 일부 분석은 fallback 또는 오류 안내로 전환될 수 있다.
- PDF 저장은 브라우저 `window.print()` 기반이다. 전용 PDF 렌더링 라이브러리는 아직 사용하지 않는다.
- Kakao/SMS 실제 발송은 구현하지 않았고 알림 채널은 선호도/상담 운영 개념으로만 사용한다.
