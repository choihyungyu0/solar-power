# 레포트 에이전트 핸드오프 — 수익·보조금·대출 분석 보고서

> 분석가 양인성 → 개발자 최현규 / 기획 현석 (2026-05-27)
> 개발자 `aiSimulationResult` 를 받아 **시군 보조금 + 대출**을 결합한 분석 보고서(HTML + 구조화 데이터)를 생성하는 에이전트입니다.

---

## 30초 요약

- 입력: 개발자 백엔드 `POST /api/climate-rooftop-analysis` 의 응답 중 **`aiSimulationResult`** 를 그대로 전달.
- 처리: ① 주소→시군 매칭 후 **경기도 주택태양광 시군별 보조금** 적용 → ② 자부담 → ③ 대출(목업 가정) → ④ 실투자금·회수기간 재계산.
- 출력: `{ reportData, reportHtml }`. HTML 은 외부 CDN 없는 자립형(인라인 CSS+SVG).
- 엔드포인트: **`POST /api/solar-report`** (기존 백엔드에 추가 완료, 개발자 스타일 그대로).

---

## 추가/수정된 파일

| 파일 | 내용 |
|---|---|
| `services/climate_backend/app/report_agent.py` | **핵심.** `build_solar_report(ai_simulation_result, *, sigungu, loan_ratio, loan_term_years)` → 데이터+HTML |
| `services/climate_backend/app/subsidy_table.py` | 시군별 보조금 조회 (`estimate_subsidy`, `normalize_sigungu`) |
| `services/climate_backend/app/data/gyeonggi_subsidy_2026.json` | 경기 26개 시군 보조금 데이터(임베드) |
| `services/climate_backend/app/schemas.py` | `SolarReportRequest` 추가 |
| `services/climate_backend/app/main.py` | `POST /api/solar-report` 라우트 추가 (import 2줄 + 라우트) |
| `scripts/generate_sample_report.py` | 시연용 샘플 보고서 생성기 |
| `docs/sample_report_hwaseong.html` / `.json` | **화성 동탄 샘플 결과물 (먼저 열어보세요)** |

---

## 호출 방법

```python
from app.report_agent import build_solar_report

result = build_solar_report(ai_simulation_result, sigungu="화성시")
result["reportHtml"]   # 사용자에게 보여줄 HTML
result["reportData"]   # 구조화 데이터 (프론트에서 직접 렌더하고 싶을 때)
```

또는 HTTP:
```
POST /api/solar-report
{ "aiSimulationResult": {...}, "sigungu": "화성시", "loanRatio": 0.8, "loanTermYears": 5 }
```

`sigungu` 생략 시 `aiSimulationResult.building` 주소에서 자동 추출. 호출 시점(분석 직후 자동 vs 상담신청 시)·렌더 위치(백엔드 HTML vs 프론트 reportData)는 **개발자 자유**.

---

## 보조금 적용 방식 (주택 유형별 2개 제도 분기)

건물 용도(`buildingUsage`)로 유형을 분류해 제도를 분기합니다 (`subsidy_table.classify_housing_type`).

| 유형 | 제도 | 산정식 | 화성 예시 |
|---|---|---|---|
| **단독주택** (`detached`) | 경기도 주택태양광 지원사업(시군별) | **도비 + 시군비 절대 금액** (3kW 표준 패키지 고정, 설치비 비율 ❌) | 1,816천 + 925천 = **2,741천원** |
| **아파트/공동주택** (`apartment`) | 한국에너지공단 공동주택 보급사업 | **min(설치용량, 30kW) × 466천원/kW** (저탄소 모듈) | 67.8kW → 30×466천 = **13,980천원** |
| 미상 (`unknown`) | 단독주택 기준 보수 적용 + "건물 유형 확인 필요" | 단독주택과 동일 | 2,741천원 |

- 대상요건: 일반 아파트는 경기 시군 사업 대상이 **아니며** 에너지공단 공동주택 사업으로 신청. 세대분리·구조독립 공동주택(땅콩주택·타운하우스)만 경기 사업 대상. 아파트 개인 단독 설치 시 단독주택 지원 신청 가능.
- 데이터: `docs/경기주택태양광지원사업_시군별_보조금.xlsx` + 에너지공단 공고 → `app/data/gyeonggi_subsidy_2026.json` (`apartment_program` 블록 포함).
- `reportData.economics.subsidy` 에 `regime`/`program`/근거/면책 동봉.
- ⚠️ **이전 버그 수정됨**: 과거 구현은 3kW 지원율(화성 60.36%)을 대용량 설치비에 곱해 보조금이 실제 상한을 18배 초과(49.1M)했음. 유형별 절대 산정으로 교체 완료.

---

## 합의·확정 필요 (현재 목업 가정)

| 항목 | 현재 가정 | 누가 |
|---|---|---|
| **대출 로직** | 자부담의 80%, 5년 만기, "수익 담보", 이자 미반영 | **현석** — 실제 상품·한도·금리·포장 근거 |
| 보조금 산정 | 단독=3kW 절대액 / 아파트=30kW×466천원 (해결됨) | 정책 한도 최신 공고 시 갱신 |
| 입력 인터페이스 | `aiSimulationResult` 전체 수신 | 현규 — 확정 시 그대로 OK |
| 카피 톤 | 중립 분석 리포트체 | (확정됨) |

---

## ⚠️ 개발자 확인 요청 (모델 보정)

샘플(화성 67.8kW)에서 **ML 발전량 예측이 24,131 kWh/년**으로 나옵니다. 67.8kW 설비 기대치(약 8~9만 kWh)보다 현저히 낮아, 단순 회수기간이 22.5년으로 과대 추정됩니다. seed data(24행) 규모/스케일 한계로 보입니다. 보고서는 모델 출력을 그대로 전달하므로, **발전량 모델 보정 시 보고서 수치도 자동 정상화**됩니다. 보정 전이라면 시연 시 보조금·실투자금 구조 중심으로 설명 권장.

---

질문은 카카오톡으로. 톤·레이아웃·수치 표기 피드백 주시면 반영해 재공유합니다.
