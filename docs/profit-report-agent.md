# SolarMate AI 수익·보조금·금융 리포트 에이전트

## 변경 배경

기존 `상담 에이전트` 개념은 범용 상담 챗봇처럼 보일 수 있어 SolarMate의 핵심 의사결정 흐름과 맞지 않았다.
현재 포지셔닝은 `AI 수익·보조금·금융 리포트 에이전트`다.

이 에이전트는 사용자의 자유 대화를 처리하는 챗봇이 아니라, 태양광 도입을 검토하는 관리자·입주자대표회의·건물주에게 수익성과 정책 지원 가능성을 안전하게 설명하는 리포트 생성기다.

## 입력 소스

리포트는 다음 입력만 사용한다.

- `aiSimulationResult`: 설치 적합도, 예상 발전량, 경제성 추정, ML surrogate model 결과
- `agentPayload.reportInputMetrics`: 상담/리포트용 4대 핵심 지표
- `subsidy_programs`: 경기 주택태양광 지원사업 기준 보조금 matrix
- `userFinanceInput`: 선택 입력값
  - `availableCashKrw`
  - `preferredLoanYears`
  - `loanCoverageRatio`

OpenAI 또는 LLM은 필수 의존성이 아니다.
`OPENAI_API_KEY`, `ENABLE_LLM_PROFIT_REPORT=true`가 있을 때만 문장 다듬기용 LLM을 선택적으로 사용한다.
숫자, 보조금, 대출 한도, 회수기간은 항상 백엔드 결정론 코드가 먼저 계산하며 LLM은 재계산하지 않는다.

## 4대 핵심 지표

상담/리포트 생성기는 `agentPayload.reportInputMetrics`를 우선 읽는다.

```json
{
  "annualGenerationKwh": 27550,
  "monthlyGenerationKwh": [1984, 2176, 2535, 2783, 2948, 2865, 2672, 2645, 2397, 2011, 1350, 1185],
  "estimatedInstallCostKrw": 26764000,
  "subsidyEstimateKrw": 12044000,
  "selfPaymentEstimateKrw": 14720000,
  "annualSavingKrw": 2310000,
  "paybackYears": 6.3,
  "subsidyProgramName": "경기 주택태양광 지원사업",
  "subsidyPolicyMode": "gyeonggi_home_solar_only",
  "subsidyStackingAllowed": false,
  "subsidyStackingReason": "경기 주택태양광 지원사업 기준 단일 보조금 산정",
  "installationSuitabilityScore": 84,
  "installationSuitabilityGrade": "A",
  "installationSuitabilityLabel": "도입 검토 우선순위 높음",
  "recommendedAction": "현장 확인과 보조금 공고 검토를 권장합니다."
}
```

리포트의 4대 지표는 다음이다.

1. 예상 발전량
2. 투입 비용 / 자부담
3. 회수기간
4. 보조금 적용 가능성 / 설치 적합도

## 보조금 정책

보조금 기준은 `경기 주택태양광 지원사업` 단일 기준이다.

```json
{
  "subsidyPolicyMode": "gyeonggi_home_solar_only",
  "subsidyStackingAllowed": false
}
```

국가 보조금과 경기도 보조금을 중복 합산하지 않는다.
실제 지원 여부와 금액은 최신 공고, 예산 잔여 여부, 대상 요건 확인이 필요하다.

## 대출 시나리오

기본값:

- `loanYears = 5`
- `loanCoverageRatio = 0.8`
- `annualRevenueBasisKrw = annualSavingKrw`

계산식:

```text
estimatedLoanLimitKrw =
  min(selfPaymentEstimateKrw, annualSavingKrw * loanYears * loanCoverageRatio)

cashNeededKrw =
  max(installCost - subsidyEstimateKrw - estimatedLoanLimitKrw, 0)
```

대출은 추정 시나리오다.
실제 승인 여부, 한도, 금리, 상환 조건은 금융기관 심사가 필요하다.

## 출력 스키마

`POST /api/ai-profit-report` 응답:

```json
{
  "ok": true,
  "profitReportId": "uuid-or-null",
  "report": {
    "schemaVersion": "solarmate-profit-report-v1",
    "reportType": "solar_profit_report",
    "generatedAt": "ISO-8601",
    "source": {},
    "buildingSummary": {},
    "fourMetrics": {},
    "subsidyMatrix": {},
    "loanSupportScenario": {},
    "netInvestment": {},
    "reportNarrative": {},
    "reportNarrativeSource": "deterministic-template | llm-structured-output",
    "llmEnabled": false,
    "llmError": "optional safe fallback reason",
    "riskDisclaimers": [],
    "cta": {}
  },
  "reportMarkdown": "# AI 수익·보조금·금융 리포트...",
  "dbSaveStatus": {
    "enabled": true,
    "profitReportOk": true,
    "profitReportId": "uuid",
    "loanScenarioOk": true,
    "loanScenarioId": "uuid"
  }
}
```

## 선택적 LLM narrative 생성

LLM narrative는 `reportNarrative` 필드만 다듬는다.
사용 모델은 Render FastAPI 백엔드 환경변수로만 설정한다.
프론트엔드에는 `OPENAI_API_KEY`를 넣지 않는다.

환경변수:

```text
OPENAI_API_KEY=...
ENABLE_LLM_PROFIT_REPORT=true
OPENAI_MODEL=gpt-4o-mini
```

LLM 입력은 개인정보나 Supabase secret 없이 정제된 구조화 데이터만 포함한다.

- 설치 적합도 등급/점수
- 예상 연간 발전량
- 예상 설치비
- 예상 보조금
- 예상 실투자금
- 예상 회수기간
- 대출 검토 시나리오
- 리포트 주의사항

LLM Structured Outputs JSON schema:

```json
{
  "headline": "string",
  "summary": "string",
  "salesMessage": "string",
  "ctaText": "string",
  "riskNotes": ["string"]
}
```

운영 규칙:

- 한국어만 사용한다.
- `예상`, `추정`, `가능성`, `검토`, `확인 필요` 표현을 사용한다.
- 보조금, 대출 승인, 절감액을 보장하지 않는다.
- 구조안전성이나 장애물 상태를 AI가 확정했다고 표현하지 않는다.
- 제공된 숫자를 바꾸거나 재계산하지 않는다.

Fallback:

- `ENABLE_LLM_PROFIT_REPORT`가 `true`가 아니면 `reportNarrativeSource = deterministic-template`이다.
- `OPENAI_API_KEY`가 없거나 OpenAI 호출이 실패하면 결정론 템플릿을 사용한다.
- 실패 사유는 `llmError`에 안전한 문장으로만 기록하고 secret이나 원문 응답을 노출하지 않는다.
- Supabase `profit_reports.report_json`에는 최종 narrative와 `reportNarrativeSource`, `llmEnabled`가 함께 저장된다.

## Supabase 저장

리포트는 Render FastAPI 백엔드만 Supabase service role key로 저장한다.
프론트엔드는 Supabase에 직접 접근하지 않는다.

저장 테이블:

- `profit_reports`
- `loan_scenarios`
- 선택 정책 데이터: `subsidy_programs`

테이블이 아직 없거나 저장에 실패해도 리포트 생성 응답은 가능한 범위에서 유지한다.
저장 실패 사유는 `dbSaveStatus`에만 담고 secret은 노출하지 않는다.

## 현장 확인 항목

아래 항목은 AI 확정 결과가 아니라 리포트 경고 및 현장 확인 항목이다.

- 옥상 장애물
- 구조안전성
- 방수 상태
- 관리주체 협의
- 실제 공고 및 예산 잔여 여부

AI가 구조안전성, 장애물 여부, 보조금 승인, 대출 승인, 절감액을 보장한다고 표현하지 않는다.

## 테스트

백엔드 문법 검사:

```powershell
cd services\climate_backend
python -m py_compile app/main.py app/profit_report_agent.py app/supabase_client.py app/schemas.py
```

프론트엔드 빌드:

```powershell
npm.cmd run build
```

수동 테스트:

1. `/risk-map`에서 건물을 선택하고 발전량 분석을 실행한다.
2. `analysisResultId`가 생성되었는지 확인한다.
3. `AI 수익 리포트 보기`를 클릭한다.
4. `/simulation/result`에서 `AI 태양광 도입 종합 보고서` 섹션을 확인한다.
5. 개발자 JSON에서 `profitReport.fourMetrics`, `subsidyMatrix`, `loanSupportScenario`, `netInvestment`를 확인한다.
6. `상담 신청하기`를 눌러 `/consultation`으로 이동한다.
7. 상담 신청 후 Supabase `consultation_requests.agent_payload`에 `profitReport` 요약이 포함되는지 확인한다.

LLM narrative 수동 테스트:

```powershell
cd services\climate_backend
$env:ENABLE_LLM_PROFIT_REPORT = "true"
$env:OPENAI_MODEL = "gpt-4o-mini"
# OPENAI_API_KEY는 Render 또는 로컬 세션 환경변수로만 설정한다. 파일에 저장하지 않는다.
python -m py_compile app/main.py app/profit_report_agent.py app/schemas.py
```

이후 `/api/ai-profit-report`를 `forceRegenerate: true`로 호출하면 새 리포트에서 `reportNarrativeSource`가 `llm-structured-output`인지 확인할 수 있다.
키가 없거나 호출이 실패하면 `deterministic-template`으로 안전하게 fallback되어야 한다.
