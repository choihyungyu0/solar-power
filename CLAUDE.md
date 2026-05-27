# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

"솔라메이트" / 우리 아파트 태양광 설치하기 MVP. 한국 아파트·공동주택을 대상으로 하며 UI 문구는 한국어입니다. 제품 방향과 에이전트 동작 규칙의 최종 출처는 `AGENTS.md` 입니다. 비자명한 수정을 하기 전에는 `AGENTS.md` 를 먼저 읽어야 합니다.

## 기술 스택과 활성 코드

- 실제 MVP 코드는 `apps/web` (React 18 + TypeScript + Vite, `@supabase/supabase-js` 기반 Supabase Auth/DB 연동).
- `apps/api` (FastAPI + Pydantic) 는 **레거시 스캐폴드** 입니다. `AGENTS.md` 지침에 따라 사용자가 명시적으로 요청하지 않는 한 Python API 에 기능을 추가하거나 백엔드 의존성을 재도입하지 않습니다.
- Vercel 서버리스 함수는 `apps/web/api/` 에 위치 (예: `pv-analysis.ts`, `vworld-feature.ts`). 외부 한국 GIS/기후 API 의 서버사이드 프록시 역할을 하며, `apps/web/src/lib` · `apps/web/src/types` 의 공유 타입/헬퍼를 import 합니다.

## 명령어 (Windows PowerShell)

PowerShell 에서는 `npm.ps1` 이 차단될 수 있으므로 항상 `npm.cmd` 를 사용합니다. `npm.cmd.install` 은 잘못된 형식이며, 올바른 형식은 `npm.cmd install` 입니다.

```powershell
# 프론트엔드 개발 (Vite 만 5173 포트, /api/* 프록시 함수는 뜨지 않음)
cd apps\web
npm.cmd install
npm.cmd run dev

# Vercel 함수까지 띄우기 (/risk-map → /api/vworld-feature, /api/pv-analysis 동작 확인용)
cd apps\web
npx vercel dev      # http://localhost:3000

# 프로덕션 빌드 = 검증 게이트. 프론트 수정 후 반드시 실행
npm.cmd run build   # tsc && vite build

# 레포 루트 검증 스크립트 (apps/web install + build 수행)
.\scripts\check-windows.ps1
```

`apps/web` 에는 테스트 러너나 린터가 연결되어 있지 않습니다. 검증은 `tsc` 타입체크 + `vite build` 가 전부이며 `npm.cmd run build` 또는 `check-windows.ps1` 로 수행합니다.

CI: `.github/workflows/web-ci.yml` 이 main 푸시/PR 시 `apps/web` 에서 `npm install && npm run build` 를 실행합니다.

레거시 Python API (사용자가 명시적으로 요청한 경우에만):

```powershell
cd apps\api
python -m venv .venv
.venv\Scripts\activate
pip install -e .
uvicorn main:app --reload --port 8000
```

## 아키텍처

- `apps/web/src/App.tsx` 는 React Router 기반으로 주요 화면을 라우팅합니다.
  - `/` — 랜딩. hero와 `ServiceIntroSection` 중심이며, 도입 사례 시뮬레이션 아래 섹션은 현재 제거된 상태입니다.
  - `/risk-map` — `RiskMapPage.tsx`. 핵심 인터랙티브 기능.
  - `vercel.json` 이 모든 경로를 `/` 로 rewrite 하므로 어떤 화면을 렌더할지는 클라이언트가 결정합니다.

- **Risk map 데이터 흐름** (`apps/web/src/pages/RiskMapPage.tsx` 가 조율):
  1. `lib/loadVWorldScript.ts` 가 VWorld 3D 지도 SDK 를 로드하고 글로브를 초기화합니다.
  2. 사용자가 건물을 클릭하면 `lib/vworldFeatureQuery.ts` 가 Vercel 프록시 `/api/vworld-feature` 를 호출해 건물 폴리곤 GeoJSON 을 가져옵니다. `VWORLD_API_KEY` 는 서버에서만 보유하며 클라이언트로 노출되지 않습니다.
  3. `lib/roofGeometry.ts` 가 폴리곤 좌표를 정규화하고 면적/중심점을 계산합니다. `lib/solarPanelLayout.ts` 가 패널 그리드를 생성하고 `components/VWorldSolarRoofLayer.tsx` 가 글로브 위에 패널을 오버레이합니다.
  4. `lib/pvAnalysisClient.ts` 가 Vercel 프록시 `/api/pv-analysis` 로 POST 하면 프록시가 다시 `https://climate.gg.go.kr/spsvc/pv/analysis` (경기 기후 플랫폼) 로 포워딩합니다. 프록시는 입력을 검증하고 8초 타임아웃을 걸며, 실패하면 `lib/normalizePvAnalysis.ts` 가 만든 **fallback** 페이로드를 반환해 UI 가 우아하게 격하됩니다. `lib/solarSimulation.ts` 는 로컬 데모 산식을 제공합니다.
  5. `SolarSimulationOverlay` 가 결과를 표시하며 `예상`/`추정` 같은 단어를 사용합니다 (데모 수치를 확정값처럼 표현하지 않습니다).

- **서버 프록시** (`apps/web/api/*.ts`) 는 `VWORLD_API_KEY` 같은 비밀값을 읽을 수 있는 **유일한** 위치입니다. 클라이언트 코드는 `VITE_*` 환경변수만 읽습니다 (예: `VITE_VWORLD_BUILDING_DATA_ID`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).

- **Supabase 통합** 은 `AGENTS.md` 에 정의되어 있습니다. 회원가입/로그인, 회원 프로필, 신청 저장, 시뮬레이션 저장, `supabase/schema.sql` 의 RLS를 기준으로 작업합니다.

## 컨벤션

- 폼 값, 신청 row, 시뮬레이션 결과는 TypeScript 타입으로 정의합니다. 시뮬레이션 상수는 한 파일에 모읍니다 (`lib/solarSimulation.ts` 스타일).
- 컴포넌트는 PascalCase, 변수/함수는 camelCase.
- UI 문구는 한국어. 추정값은 `예상`, `추정`, `데모 산식`, `실제 공고 확인 필요` 같은 신중한 표현을 사용합니다. 정책 상태는 `확인 필요`/`접수중`/`마감 임박`/`마감`.
- 실제 연동이 없는 한 정책/보조금 데이터를 실시간 데이터처럼 표현하지 않습니다. 제공된 자격증명이 없는 한 실제 카카오/SMS 발송을 추가하지 않습니다.
- `docs/` 와 `.codex/prompts/` 의 기획 문서는 명시적 요청 없이 삭제하지 않습니다.

## 좌표계 컨벤션 (★)

- **풀스택/UI/지도/fixture 는 EPSG:4326 (WGS84) 만 사용.** VWorld 지도가 4326 기반이라 개발자(최현규)와 분석가(양인성) 간 합의된 인터페이스.
- climate.gg 내부 API 5종 중 4종 (`selectBuld`, `selectSunList`, `selectRuleList`, WFS `TM_BLDG_INFO`) 은 **EPSG:5186 (Korea 2000 / Central Belt 2010)** 으로 입출력. `/spsvc/pv/analysis` 만 4326.
- **5186 ↔ 4326 변환은 분석가 측 백엔드 (Python PoC 또는 Vercel function) 에서만 수행**. 풀스택은 5186 좌표를 한 번도 보지 않는다.
- 분석가 산출물 (fixture, bundle.json, panels GeoJSON) 의 모든 좌표는 4326. EPSG:5186 원본 bbox 가 필요할 때만 `properties.cell_5186_bbox` 같은 보조 필드로 동봉.

## 역할 분담 (★ 2026-05-22 합의)

- **분석가(양인성)**: 데이터·API 발견 · 명세화 · 정제 · 사용 예시 작성. **백엔드 운영은 안 함.** 산출물은 (1) API 카탈로그 문서, (2) 라이브 호출 예시(mvp_app·poc_pipeline), (3) 정제된 정적 데이터(footprint, fixture, B2G 집계) 형태로 전달.
- **개발자(최현규)**: 받은 자료를 보고 서비스 아키텍처 자유 결정·구현·운영. 백엔드 형태(Vercel TS / Vercel Python / 별도 백엔드), 캐시, rate limit, 호출 시점 모두 개발자 권한.
- 분석가는 결정을 강요하지 않고, 개발자는 분석가에게 운영 책임을 묻지 않는다.

핸드오프 단일 진입 문서: `docs/HANDOFF_PACKAGE.md`
전달 대본: `docs/DELIVERY_TALKING_POINTS.md`

## 분석가 작업 컨텍스트

데이터분석가(양인성, dlstjd6401@khu.ac.kr) 가 데이터 수집·가공·검증을 담당. 경기도 공공데이터 활용 창업경진대회 출품 일정으로 작업 중.

핵심 발견 (2026-05-22) — `docs/api_spec_climate_har.md`:
- `data/processed/climate.gg.go.kr.har` 를 전수 분석한 결과, **climate.gg 내부 API 5종이 옥상 polygon + 셀별 음영지수 + 건물 높이/면적/unq_id + 월별 실측 사용량(전력/가스) + 19종 규제 매칭을 모두 즉시 반환**.
- 따라서 분석가가 별도로 가공할 항목에서 **DSM 음영 자체구현은 제외**. 남는 산출물은 (1) 차등요금제 시뮬 (A2), (2) 보조금 매트릭스 (A3), (3) 위험점수 (A1), (4) 데모 fixture (A7), (5) B2G 화성시 잠재량 (A5).
- 현재 `RiskMapPage.tsx` 하드코드 5종 (`PV_DEFAULT_SHADING_INDEX_AVERAGE=3.36` 등) 은 모두 API 응답으로 치환 대상.

PoC 재현 자산:
- `scripts/poc_rooftop_pipeline.py` — 8단계 라이브 호출 스크립트 (검증 완료)
- `scripts/poc_rooftop_pipeline.ipynb` — 같은 내용의 노트북 버전
- `data/processed/har_extracted/*.json` — HAR 5개 API + WFS + 카카오 entry 추출본
- `data/processed/poc/{unq_id}/bundle.json` + `panels_4326.geojson` — PoC 출력 (4326 좌표)

핸드오프 사양:
- `docs/HANDOFF_PACKAGE.md` — 개발자용 단일 진입 (API 카탈로그 + mvp_app 예시 + 시드 fixture + 정적 데이터 자산)
- `docs/DEV_HANDOFF_CLIMATE_APIS.md` — 좌표계·인터페이스 합의 (참고)
- `apps/web/public/fixtures/poc/` — 시연 안전판 fixture (1차 1건, 20건 확장 예정)

참고 구현 (분석가 운영 안 함):
- `services/climate_proxy/` — FastAPI 백엔드 참고 구현. `REFERENCE_ONLY.md` 참조. 개발자가 Python 백엔드를 선택할 경우만 활용.
- `supabase/reference_bundle_cache.sql` — 위 참고 구현용 캐시 테이블 (메인 schema 와 분리).

관련 보조 문서: `docs/DATA_CONTEXT.md` (./data 자산 명세), `docs/api_spec_simul_v1.md` (pv/analysis 전용), `docs/ANALYST_WORKFLOW_REVIEW.md` (분석가 산출물 우선순위 v0 — DSM 트랙 제거로 갱신 필요).

## 신규 정보가 발생할 때

- climate.gg API 캡처가 갱신되면: `data/processed/climate.gg.go.kr.har` 갱신 → `data/processed/har_extracted/` 재추출 → `docs/api_spec_climate_har.md` §3·§4 갱신.
- 새 PoC 건물이 추가되면: `scripts/poc_rooftop_pipeline.py` 의 `CLICK_WGS` 변경 → 실행 → `data/processed/poc/{unq_id}/` 생성 → fixture `index.json` 에 등록.
- 분석가 산출물 우선순위가 바뀌면: `docs/ANALYST_WORKFLOW_REVIEW.md` 갱신.
- 좌표계 컨벤션·핸드오프 인터페이스가 바뀌면: 본 CLAUDE.md 와 `docs/DEV_HANDOFF_CLIMATE_APIS.md` 동기화.
