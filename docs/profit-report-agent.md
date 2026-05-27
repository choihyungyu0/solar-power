# SolarMate AI 수익·보조금·금융 리포트 에이전트

## 변경 배경

기존 `상담 에이전트` 개념은 범용 상담 챗봇처럼 보일 수 있어 SolarMate의 핵심 의사결정 흐름과 맞지 않았다.
현재 포지셔닝은 `AI 수익·보조금·금융 리포트 에이전트`다.

이 에이전트는 사용자의 자유 대화를 처리하는 챗봇이 아니라, 태양광 도입을 검토하는 관리자·입주자대표회의·건물주에게 수익성과 정책 지원 가능성을 안전하게 설명하는 리포트 생성기다.

## 입력 소스

리포트는 다음 입력만 사용한다.

- `aiSimulationResult`: 설치 적합도, 예상 발전량, 경제성 추정, ML surrogate model 결과
- `agentPayload.reportInputMetrics`: 상담/리포트용 4대 핵심 지표
- `subsidy_programs`: 주택 유형별 보조금 matrix(아파트/공동주택은 한국에너지공단 공동주택 기준, 단독주택은 경기 시군 3kW 기준)
- `userFinanceInput`: 선택 입력값
  - `availableCashKrw`
  - `preferredLoanYears`
  - `loanCoverageRatio`

OpenAI 또는 LLM은 필수 의존성이 아니다.
현재 리포트 narrative는 비용 절감을 위해 결정론 템플릿을 기본 및 운영 경로로 사용한다.
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
  "subsidyProgramName": "한국에너지공단 신재생에너지 보급사업(공동주택)",
  "subsidyPolicyMode": "knrec_apartment_low_carbon_module",
  "subsidyStackingAllowed": false,
  "subsidyStackingReason": "아파트는 경기태양광지원사업 대상이 아니며 한국에너지공단 공동주택 기준으로 산정",
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

보조금 기준은 건물 유형에 따라 분기한다.

```json
{
  "subsidyPolicyMode": "knrec_apartment_low_carbon_module | gyeonggi_detached_home_3kw",
  "subsidyStackingAllowed": false
}
```

아파트/공동주택은 한국에너지공단 공동주택 기준(`min(설치용량, 30kW) × 466,000원/kW`)으로 계산한다. 단독주택은 경기 시군별 3kW 표준 보조금 절대액으로 계산한다. 서로 다른 제도를 중복 합산하지 않는다.
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
    "reportNarrativeSource": "deterministic-template",
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

## Template narrative 생성

리포트 narrative는 비용 절감을 위해 결정론 템플릿으로 생성한다.

- `reportNarrativeSource = deterministic-template`
- `llmEnabled = false`
- 숫자, 보조금, 대출 한도, 회수기간은 백엔드 결정론 코드가 계산한 값을 그대로 사용한다.
- 프론트엔드와 Render 환경변수에 OpenAI API 키를 요구하지 않는다.
- 한국어, `예상`, `추정`, `가능성`, `검토`, `확인 필요` 표현을 유지한다.
- 보조금, 대출 승인, 절감액, 구조안전성, 장애물 상태를 보장하지 않는다.

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

리포트 narrative는 템플릿 경로가 정식 동작이다. `/api/ai-profit-report` 응답에서 `reportNarrativeSource`가 `deterministic-template`, `llmEnabled`가 `false`인지 확인한다.
