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
- `questionsToAskUser`: 실제 상담에서 확인할 질문
- `requiredDocuments`: 상담 또는 보조금 검토에 필요한 서류
- `subsidyRagInput`: 정책/보조금 RAG 검색에 넣을 위치, 용량, 비용, 등급 정보
- `nextStep`: 권장 다음 단계

## Model Limitations

- `trainingDataSource = "simulation-derived-seed-data"`
- `isMeasuredGenerationModel = false`
- 모델 설명 문구는 다음 표현을 사용한다.
  - `시뮬레이션 기반 대리 회귀 모델`
  - `설명 가능한 AI 점수화`
  - `실측 데이터 누적 시 고도화 가능`
- 보조금 수령을 보장하지 않는다.
- 실제 설치 가능 여부는 현장조사, 구조안전성, 옥상 장애물, 계통연계, 관리주체 협의, 최신 공고 확인이 필요하다.

## How Inseong Agent Should Consume It

1. `summaryForCounselor`를 상담 첫 안내 문장으로 사용한다.
2. `questionsToAskUser`를 순서대로 확인하되, 이미 사용자가 답한 항목은 건너뛴다.
3. `requiredDocuments`는 제출 체크리스트로 표시한다.
4. `subsidyRagInput.location`, `installCapacityKw`, `estimatedInstallCostKrw`, `selfPaymentEstimateKrw`, `suitabilityGrade`, `suitabilityCluster`를 RAG 검색 조건으로 전달한다.
5. `buildingSuitability.warnings` 또는 `agentPayload.counselingHints.warnings`가 있으면 상담 리스크로 먼저 설명한다.

## Example

See [sample-simulation-ai-result.json](./sample-simulation-ai-result.json).
