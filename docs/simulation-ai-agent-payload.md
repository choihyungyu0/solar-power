# SolarMate Simulation AI Agent Payload

## Purpose

SolarMate의 Render climate backend는 건물 선택, climate.gg 음영 셀, 패널 배치, 경제성 추정값을 하나의 `aiSimulationResult`로 묶는다. 이 문서는 인성 상담 에이전트가 그중 `agentPayload`를 받아 상담 요약, 추가 질문, 필요 서류, 보조금 RAG 검색 입력으로 사용하는 방식을 정의한다.

현재 AI는 실측 발전량 학습 모델이 아니다. MVP에서는 `simulation_training_samples.csv`의 시뮬레이션 파생 seed data로 학습한 `시뮬레이션 기반 대리 회귀 모델`과 KMeans 군집을 사용한다. 따라서 모든 화면과 상담 문구는 `예상`, `추정`, `데모 산식`, `실제 공고 확인 필요`를 유지해야 한다.

## Runtime Schema

`aiSimulationResult` 주요 필드:

- `building`: 건물명, 주소, 좌표, 용도
- `roof`: 추정 옥상 면적, 사용 가능 면적, roof source, 셀 수
- `shading`: 평균 음영 점수, 녹색/노란색/붉은 셀 비율
- `panelOptimization`: `shading_aware_optimizer_v1` 배치 요약
- `generationPrediction`: RandomForestRegressor 기반 발전량 예측 또는 fallback 산식
- `economics`: 설치비, 보조금 추정, 자부담, 정책자금 한도, 회수기간
- `buildingSuitability`: `설명 가능한 AI 점수화` + KMeans 군집 결과
- `aiModelMetadata`: 모델 상태, 학습 데이터 출처, 실측 모델 여부, 한계
- `agentPayload`: 상담 에이전트용 요약 JSON

`agentPayload` 필수 필드:

- `summaryForCounselor`: 상담사가 먼저 읽을 1문단 요약
- `agentType`: `ai_profit_subsidy_finance_report_agent`
- `agentName`: `AI 수익·보조금·금융 리포트 에이전트`
- `reportInputMetrics`: 수익 리포트 에이전트가 우선 읽을 4대 입력 지표
- `fieldCheckRequired`: 현장 확인 및 리포트 경고 항목
- `fieldCheckAffectsScore`: 현장 확인 항목이 현재 AI 점수에 직접 반영되었는지 여부. 현재는 `false`
- `questionsToAskUser`: 실제 상담에서 확인할 질문
- `requiredDocuments`: 상담 또는 보조금 검토에 필요한 서류
- `subsidyRagInput`: 정책/보조금 RAG 검색에 넣을 위치, 용량, 비용, 등급 정보
- `nextStep`: 권장 다음 단계

## Counseling Report Input Metrics

인성 상담 에이전트는 최종 상담 리포트를 만들 때 `agentPayload.reportInputMetrics`를 우선 읽는다.
상세 AI 결과는 근거 설명용 보조 정보이며, 상담 리포트의 핵심 구조는 아래 4개 지표를 중심으로 구성한다.

1. `annualGenerationKwh`, `monthlyGenerationKwh`: 예상 발전량
2. `estimatedInstallCostKrw`, `subsidyEstimateKrw`, `selfPaymentEstimateKrw`: 투입 비용 / 자부담
3. `annualSavingKrw`, `paybackYears`: 연 절감액과 회수기간
4. `subsidyProgramName`, `subsidyPolicyMode`, `installationSuitabilityScore`, `installationSuitabilityGrade`, `installationSuitabilityLabel`: 보조금 적용 가능성 / 설치 적합도

보조금 기준은 건물 유형에 따라 분기한다. 아파트/공동주택은 한국에너지공단 공동주택 기준, 단독주택은 경기 시군 3kW 기준을 사용한다.

```json
{
  "subsidyProgramName": "한국에너지공단 신재생에너지 보급사업(공동주택)",
  "subsidyPolicyMode": "knrec_apartment_low_carbon_module",
  "subsidyStackingAllowed": false,
  "subsidyStackingReason": "아파트는 경기태양광지원사업 대상이 아니며 한국에너지공단 공동주택 기준으로 산정"
}
```

서로 다른 보조금 제도를 중복 합산하지 않는다.
정확한 지원금은 실제 공고, 대상 조건, 예산 잔여 여부 확인이 필요하며 보조금 수령을 보장하지 않는다.

## Field Check Items

`agentPayload.fieldCheckRequired`는 상담 리포트의 경고 및 현장 확인 섹션에만 사용한다.

```json
[
  "옥상 장애물",
  "구조안전성",
  "방수 상태",
  "관리주체 협의",
  "실제 공고 및 예산 잔여 여부"
]
```

현재 AI는 옥상 장애물, 구조안전성, 방수 상태를 확정하지 않는다.
이 항목들은 점수의 핵심 수치 feature가 아니라 현장 확인 필요 항목이다.

## Model Limitations

- `trainingDataSource = "simulation-derived-seed-data"`
- `isMeasuredGenerationModel = false`
- 모델 설명 문구는 다음 표현을 사용한다.
  - `시뮬레이션 기반 대리 회귀 모델`
  - `설명 가능한 AI 점수화`
  - `실측 데이터 누적 시 고도화 가능`
- 보조금 수령을 보장하지 않는다.
- 실제 설치 가능 여부는 현장조사, 구조안전성, 옥상 장애물, 방수 상태, 계통연계, 관리주체 협의, 최신 공고 확인이 필요하다.
- 구조안전성/장애물 검토는 AI가 확인한 결과가 아니라 상담 리포트의 확인 필요 항목이다.

## How Inseong Agent Should Consume It

1. `reportInputMetrics`를 최종 리포트의 4대 지표 입력으로 사용한다.
2. `summaryForCounselor`를 상담 첫 안내 문장으로 사용한다.
3. `fieldCheckRequired`를 리포트의 현장 확인/주의 항목으로 표시한다.
4. `questionsToAskUser`를 순서대로 확인하되, 이미 사용자가 답한 항목은 건너뛴다.
5. `requiredDocuments`는 제출 체크리스트로 표시한다.
6. `subsidyRagInput.location`, `installCapacityKw`, `estimatedInstallCostKrw`, `selfPaymentEstimateKrw`, `suitabilityGrade`, `subsidyPolicyMode`를 RAG 검색 조건으로 전달한다.
7. `buildingSuitability.warnings` 또는 `agentPayload.counselingHints.warnings`가 있으면 상담 리스크로 먼저 설명한다.

## Example

See [sample-simulation-ai-result.json](./sample-simulation-ai-result.json).
