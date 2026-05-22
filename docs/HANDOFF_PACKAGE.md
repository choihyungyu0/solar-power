# 분석가 → 개발자: climate.gg API 발견·예시·데이터 패키지

> **From**: 데이터분석가 양인성
> **To**: 풀스택 개발자 최현규
> **Date**: 2026-05-22
>
> **목적**: 경기기후플랫폼(climate.gg) 내부 API 5종을 발견·검증했고, 이를 현재 우리 서비스에 어떻게 활용할 수 있는지 **참고 예시와 정적 데이터**를 함께 전달합니다.
>
> **분석가 역할**: 데이터 수집·정제·API 발견. 백엔드 운영은 분석가 책임이 아닙니다.
> **개발자 역할**: 받은 자료를 보고 **서비스 아키텍처는 자유롭게 결정**해서 구현.

---

## 0. 한 문단 요약

- 현재 우리 서비스(footprint 클릭 → `pv/analysis` 호출) 는 **5개 API 중 1개만** 쓰고 있습니다.
- 나머지 4개 (`selectBuld`, WFS `TM_BLDG_INFO`, `selectSunList`, `selectBuldInfo`) 를 추가로 쓰면 **옥상 polygon · 음영 히트맵 · 건물 메타 · 실측 사용량** 까지 받을 수 있습니다.
- 모든 API 가 **무인증·결정론적·CORS 만 climate.gg 허용**. 호출 흐름은 `scripts/mvp_app.py` (Streamlit 검증 앱) 에서 라이브 시연 확인 완료.
- 화성시 약 10만 채의 사전 일괄 수집은 **비현실** (5~7일 가동 필요). **클릭 시 라이브 호출 + 시연용 시드 fixture** 하이브리드가 유일한 길.

---

## 1. 5개 API 카탈로그

전수 명세 본문은 `docs/api_spec_climate_har.md` 입니다. 아래는 한 화면 요약.

### 1-1. `POST /gcs/book/cmm/selectBuld.do` — 좌표 → 옥상 polygon

```
요청 (form-data, 좌표는 EPSG:5186):
  x=202615.484&y=518675.015&type=PANEL

응답:
  {"buld": {"feature": "<GeoJSON 문자열, Polygon, EPSG:5186>"}}
  (적중 실패 시) {"buld": null}
```

활용: 사용자 클릭 좌표를 옥상 polygon 으로 변환. 기존 footprint 보다 정확.

### 1-2. `GET /geoserver/spggcee/ows` (WFS `TM_BLDG_INFO`) — 좌표 → 건물 메타

```
요청 (Query):
  service=WFS&version=1.0.0&request=GetFeature
  &typeName=spggcee:TM_BLDG_INFO&outputFormat=application/json&SRS=EPSG:5186
  &CQL_FILTER=INTERSECTS(shape, Point(202615.484 518675.015))

응답 (GeoJSON FeatureCollection):
  properties.unq_id       → climate.gg 내부 건물 ID (다른 API의 키)
  properties.bldg_nm      → 건물명
  properties.bldg_hgt     → 높이 (m) 실측
  properties.bdar         → 건축면적 (㎡)
  properties.bldg_nofl    → 층수
  properties.bldg_usg_cd  → 용도코드 (보조금 매칭에 활용)
```

활용: 기존 footprint 의 높이 추정을 실측값으로 교체. `unq_id` 는 사용량 조회 필수.

### 1-3. `POST /gcs/panel/selectSunList.do` — 옥상 격자 → 셀별 음영점수 ⭐

```
요청 (form-data, panel 필드 반복):
  panel=0-202608.89,518662.96,202609.89,518666.46
  panel=1-202609.89,518662.96,202610.89,518666.46
  panel=...
  type=build
  (각 셀: 1m × 3.5m, EPSG:5186)

응답:
  ["0|2.67", "1|2.55", "2|0.95", ...]
  (셀별 음영점수, 약 0~4 범위, 높을수록 일조 양호)
```

활용: **이게 climate.gg 음영 모델 그 자체.** 셀별 점수로 옥상 히트맵을 그리거나, 평균을 `pv/analysis` 의 `shading_index_average` 입력으로 사용.

### 1-4. `POST /gcs/panel/selectBuldInfo.do` — unq_id → 월별 실측 사용량

```
요청 (form-data):
  unq_id=L1_41110_065203

응답:
  {"list": [{
    "use_ym": "2024\n09,2024\n10,...,2025\n06",
    "elpwr_usqty": "74074,49406,...,76489",   (kWh, 쉼표 구분 문자열)
    "gas_usqty": "585202,158970,...,445298"   (m³)
  }]}
```

활용: 사용자에게 "현재 사용량" 입력받지 않고 자동 표시. 차등요금제 시뮬 입력.

### 1-5. `POST /spsvc/pv/analysis` — 발전·경제성 시뮬 (현재 우리가 쓰는 그것)

```
요청 (JSON, 좌표는 EPSG:4326):
  {
    "latitude": 37.267, "longitude": 127.029,
    "shading_index_average": 2.096,            (1-3 평균)
    "solar_panel_angle": "35",
    "solar_panel_info": {"panel_capacity": 640, "panel_count": 74, "panel_type": 1}
  }

응답:
  {"status_code":200, "data": {
    "annual_generation": 47931,
    "expected_revenue": {"install_kw":48.3, "first_year_revenue":..., ...},
    "monthly_generation": [...12], "annual_revenue": [...20], ...
  }}
```

활용: 변경 없음. 단 입력의 `shading_index_average` 와 `panel_count` 를 1-3·1-1 결과로 채우면 정확도 급상승.

---

## 2. "이렇게 호출하면 이렇게 나옵니다" — 실행 가능한 예시

### 2-1. Streamlit 검증 앱 (지도 클릭 → 8단계 라이브 호출 → 히트맵)

```powershell
cd C:\Users\insung\solar-power
pip install streamlit streamlit-folium folium branca requests pyproj shapely
streamlit run scripts/mvp_app.py
```

→ `http://localhost:8501` 에서 좌표 클릭하면 5개 API 가 다 호출되며 셀별 음영 히트맵이 지도에 그려집니다. 개발자가 **응답 형식·UI 표현·호출 순서를 눈으로 보고 의사결정**하는 용도.

### 2-2. Python 함수 직접 호출 (포팅 참고)

`scripts/poc_rooftop_pipeline.py` 가 8단계를 함수 단위로 분리해두었습니다. TypeScript 등 다른 언어로 포팅 시 참고하면 됩니다:

```python
from scripts.poc_rooftop_pipeline import (
    transform_click_to_5186,   # WGS84 → 5186
    select_buld,               # 1: 옥상 polygon
    wfs_bldg_info,             # 2: 메타
    generate_cells,            # 3: 1m×3.5m 셀 격자 생성
    select_sun_list,           # 4: 음영
    select_buld_info,          # 5: 사용량
    call_pv_analysis,          # 7: 시뮬
    run_pipeline,              # 1~8 통합
    result_to_bundle,          # 결과 → 4326 JSON 직렬화
)
```

---

## 3. 정적 데이터 자산 (이미 정제 완료, 그대로 사용 가능)

### 3-1. 화성시 건물 footprint (기존 자산, 변경 없음)
- `data/processed/hwaseong_buildings_v1.geojson` — 전체 (EPSG:4326)
- `data/processed/hwaseong_buildings_v1_by_admdong/` — 행정동 분할
- 현재 서비스에서 이미 사용 중. 그대로 유지.

### 3-2. 시연용 시드 fixture (1차 1건, 20건 확장 예정)
- `apps/web/public/fixtures/poc/index.json` — 등록 건물 목록
- `apps/web/public/fixtures/poc/{unq_id}/bundle.json` — 8단계 결과 사전계산
- `apps/web/public/fixtures/poc/{unq_id}/panels_4326.geojson` — 셀별 음영 (4326)
- **용도**: climate.gg API 가 죽거나 본선 시연 시 안전판. 좌표가 fixture 근처일 때 라이브 호출 대신 사용.
- 20건 확장 절차: `data/processed/seed_buildings_v1.template.csv` 복사 → 좌표 교체 → `python scripts/generate_fixture_batch.py`

### 3-3. B2G 화성시 집계 (발표 자료 직접 투입)
- `data/processed/b2g/hwaseong_headline_3cards.json` — 시장잠재량 / 현재가동 / 포화도 3숫자
- `data/processed/b2g/hwaseong_admdong_summary.csv` — 행정동별 집계
- `data/processed/b2g/hwaseong_priority_cells.geojson` — 우선추진 격자 (rasterio 설치 환경에서만)
- 생성 명령: `python scripts/hwaseong_b2g_aggregates.py`

### 3-4. footprint 메타 enrich (선택, 야간 배치)
- `scripts/enrich_buildings_with_wfs.py` — footprint 각 건물에 `unq_id, bldg_hgt, bldg_nofl, bldg_usg_cd` 추가
- 약 6시간 (10만 채). 분석가 야간 실행 후 `hwaseong_buildings_v2_enriched.geojson` 전달 가능.
- 이점: 클릭 시 WFS 호출 1회 절약, `unq_id` 사전 보유로 사용량 즉시 조회 가능.

---

## 4. 개발자가 자유롭게 결정할 영역

분석가는 **방법론을 강요하지 않습니다.** 다음 선택지 모두 가능합니다:

### (A) 백엔드 형태
- Vercel function (TypeScript) — `apps/web/api/` 에 5개 + 통합 1개
- Vercel Python function — `scripts/poc_rooftop_pipeline.py` 그대로 들고 가서 래핑
- 별도 백엔드 (Render·Railway·Fly 등) — `services/climate_proxy/` 참고 구현 존재
- 클라이언트 직접 호출 — CORS 우회 필요 (CloudFront/Cloudflare Workers 등)

### (B) 호출 시점
- 클릭 즉시 5개 다 호출 (3-5초)
- 클릭 시 1·2 만 호출 → 사용자가 "분석 실행" 누르면 3·4·5 호출 (단계적 UX)
- 미리 fetch (지도 viewport 안의 건물 큐잉)

### (C) 캐시 전략
- 없음 (매번 라이브)
- 메모리 (CDN edge cache)
- Supabase 테이블 (참고: `supabase/reference_bundle_cache.sql`)
- Vercel KV / Upstash Redis

### (D) Rate limit / Fallback
- climate.gg 자체에 명시된 제한 없음. 보수적으로 5 req/sec 권장
- 실패 시: 시드 fixture → 데모값 격하 순

→ **분석가는 어떤 선택도 강요하지 않습니다.** 개발자가 골라서 구현.

---

## 5. 좌표계 합의 (변경 없음)

- 풀스택은 **EPSG:4326 (WGS84) 만** 사용. VWorld 기반.
- API 가 5186 인 4개 (`selectBuld`, WFS, `selectSunList`, `selectRuleList`) 는 **호출 직전 변환, 응답 직후 변환**.
- 분석가 산출물 (fixture, bundle.json, panels_4326.geojson) 좌표는 모두 4326. 디버깅용 `cell_5186_bbox` 보조 필드만 5186 보존.
- 변환 라이브러리: Python `pyproj`, JS `proj4`.

---

## 6. 알려진 한계 / 리스크

| 항목 | 내용 |
|---|---|
| 약관 | climate.gg 비공식 내부 API. 공식 사용 약관 없음. 본선 후 경기도청 정식 협의 권장. |
| CORS | climate.gg Origin 만 허용 → 백엔드 프록시 필수 (위 §4-A 선택지) |
| 적중률 | 경기도 외 좌표는 응답 부정확. 화성시 내 좌표 적중률은 sweep으로 확인 가능 (`scripts/api_stability_sweep.py`) |
| selectBuldInfo 결손 | 일부 건물은 unq_id 없거나 사용량 데이터 결손 → 빈 응답. UI 빈 상태 처리 필요 |
| 셀-패널 매핑 | 1패널 = 셀 2장 (잠정 가정). sweep으로 검증 권장 |
| 응답 인코딩 | `detail` 필드만 EUC-KR 깨짐. 데이터 필드는 정상 |

---

## 7. 패키지 파일 인덱스

```
solar-power/
├── docs/
│   ├── HANDOFF_PACKAGE.md             ← 이 문서 (입구)
│   ├── api_spec_climate_har.md        ← API 5종 전수 명세
│   ├── DEV_HANDOFF_CLIMATE_APIS.md    ← 좌표계·인터페이스 합의 (참고)
│   └── DELIVERY_TALKING_POINTS.md     ← 분석가 → 개발자 대화 대본
│
├── scripts/
│   ├── mvp_app.py                     ★ Streamlit 라이브 검증 앱 (개발자 시연용)
│   ├── poc_rooftop_pipeline.py        ★ 8단계 함수 (포팅 참고)
│   ├── generate_fixture_batch.py      - 시드 fixture 일괄 생성
│   ├── enrich_buildings_with_wfs.py   - footprint 메타 enrich
│   ├── hwaseong_b2g_aggregates.py     - B2G 발표 자료
│   └── api_stability_sweep.py         - API 안정성 검증
│
├── apps/web/public/fixtures/poc/      ★ 시연용 사전계산 fixture
│   ├── index.json
│   └── L1_41110_065203/...
│
├── data/processed/
│   ├── hwaseong_buildings_v1.geojson  (기존, 변경 없음)
│   └── b2g/                            (발표용)
│
├── services/climate_proxy/            (참고 구현 — REFERENCE_ONLY)
│   └── REFERENCE_ONLY.md              ← 분석가가 운영하지 않음 명시
│
└── supabase/
    ├── schema.sql                      (메인, 변경 최소)
    └── reference_bundle_cache.sql      (참고 구현 채택 시에만)
```

---

## 8. 기 전달된 임시 작업 (검토 후 처리 부탁)

분석가가 검증 과정에서 `apps/web` 에 다음 변경을 임시로 넣었습니다. **그대로 쓰셔도 좋고 다시 작성하셔도 좋습니다**:

| 파일 | 성격 |
|---|---|
| `apps/web/src/types/climateBundle.ts` | bundle 응답 타입 정의 — 그대로 사용 권장 |
| `apps/web/src/lib/fixtureClient.ts` | fixture index 로딩 + 가장 가까운 fixture 매칭 — 그대로 사용 권장 |
| `apps/web/src/pages/RiskMapPage.tsx` | `handleMapSelection` 에 fixture 분기 추가 — 검토 후 그대로/리팩토링/되돌리기 자유 |

---

질문은 카카오톡으로. 명세 미흡한 부분이 발견되면 `docs/api_spec_climate_har.md` 보강해서 재공유합니다.
