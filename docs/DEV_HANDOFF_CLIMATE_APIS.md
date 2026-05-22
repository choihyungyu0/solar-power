# 개발자 핸드오프 — climate.gg API 연동 사양

> **작성**: 2026-05-22 (데이터분석가 → 풀스택 최현규)
> **상위**: `docs/api_spec_climate_har.md` (API 명세), `scripts/poc_rooftop_pipeline.py` (재현 노트북: `.ipynb`)
> **현재 코드**: `apps/web/src/pages/RiskMapPage.tsx`, `apps/web/api/pv-analysis.ts`
> **PoC 검증**: GLOBAL HEIM (수원, `unq_id=L1_41110_065203`, 9층 40.2m) 8단계 전 구간 라이브 호출 성공

---

## 0. 한 줄 합의

- **좌표계**: 풀스택/지도/UI 모두 **EPSG:4326 (WGS84)** 만 사용. 분석가가 climate.gg API 응답의 EPSG:5186 좌표를 **모두 4326 으로 변환해서 전달**.
- **현재 코드 변경 범위**: `lib/solarSimulation.ts` 의 하드코딩 5종 제거 + `pv-analysis.ts` 외에 **API 프록시 4개 추가** + `RiskMapPage` 에서 fixture/live 토글.
- **단계적 적용**: 1차는 **fixture 기반 (정적 JSON)**, 2차는 **라이브 프록시 (Vercel functions)** — 1차 모드로 PoC 시연 가능.

---

## 1. 무엇이 바뀌는가 (Before / After)

### Before (현재 코드)

```ts
// apps/web/src/pages/RiskMapPage.tsx
PV_DEFAULT_SHADING_INDEX_AVERAGE = 3.36   // 하드코드
PV_DEFAULT_PANEL_ANGLE = 30                // 하드코드
PV_DEFAULT_PANEL_CAPACITY_W = 500          // 하드코드
PV_DEFAULT_PANEL_COUNT = 204               // 하드코드
PV_DEFAULT_PANEL_TYPE = 1                  // 하드코드
// 건물 footprint = roof 로 가정 (estimateRoofPolygonFromFootprint)
// 옥상 높이는 deriveRoofHeightMFromFeature() 추정
```

### After (PoC 검증 기준)

```ts
// 좌표 클릭 → 백엔드 1회 호출 (또는 fixture 조회) → 다음 번들 수신:
{
  meta: {
    unq_id, bldg_nm, bldg_hgt, bdar, bldg_nofl,
    use_aprv_ymd, bldg_usg_cd, sigun_cd
  },
  roof_polygon_4326: GeoJSON Polygon,        // 옥상 (footprint 대체)
  shading: { score_mean, cells_total, ... },
  usage_monthly: { labels, electricity_kwh, gas_m3 },
  regulation_hits: [["layer_code", count], ...],
  pv_analysis_input: { ... },                 // 실제 호출에 쓴 입력
  pv_analysis_output: { ... },                // 발전·경제성 (이미 사용 중)
}
// + 별도 파일: panels_4326.geojson (셀별 음영 히트맵)
```

---

## 2. 좌표계 합의 (★ 가장 중요)

| 위치 | 좌표계 | 책임 |
|---|---|---|
| 사용자 클릭 (지도) | EPSG:4326 | 풀스택 |
| 분석가에게 전달 | EPSG:4326 | 풀스택 (변환 없음) |
| climate.gg API 입력 | EPSG:5186 (selectBuld/SunList/RuleList/WFS) + EPSG:4326 (pv/analysis) | **분석가가 백엔드에서 변환** |
| 분석가 → 풀스택 응답 | **EPSG:4326 only** | **분석가** |
| 지도 렌더 | EPSG:4326 | 풀스택 (변경 없음) |

→ **풀스택은 5186 좌표를 한 번도 보지 않는다**. 변환 책임은 모두 분석가 측 백엔드 (Vercel function 또는 사전계산 fixture) 에 있다.

PoC 노트북 (`scripts/poc_rooftop_pipeline.py`) 의 `to_4326 = Transformer.from_crs('EPSG:5186','EPSG:4326', always_xy=True)` 를 그대로 사용. JS 측에서 동일 변환이 필요할 경우 `proj4js` 권장 (이미 VWorld 코드에 들어 있을 가능성 있음 — 확인 요).

---

## 3. 인터페이스 명세 — 2단계 전략

### Phase A — Fixture 기반 (이번 주, MVP 시연용)

분석가가 **시연 시군의 옥상 N건**을 사전계산해 정적 JSON으로 떨굼. 풀스택은 fetch 만.

**디렉토리**:
```
apps/web/public/fixtures/poc/
  ├── index.json                       # 가용 건물 목록 (id, name, click_wgs84, file)
  ├── L1_41110_065203/
  │     ├── bundle.json
  │     └── panels_4326.geojson
  ├── L1_41590_xxxxxx/                # 화성시 사례 추가
  │     ├── ...
  └── ...
```

**index.json 스키마**:
```ts
type FixtureIndex = {
  generated_at: string;             // ISO datetime, 분석가 마지막 갱신 시각
  buildings: Array<{
    unq_id: string;
    bldg_nm: string;
    sigun_cd: string;
    click_wgs84: { longitude: number; latitude: number };
    bundle_path: string;            // "L1_41110_065203/bundle.json"
    panels_path: string;            // "L1_41110_065203/panels_4326.geojson"
  }>;
};
```

**클릭 → 가장 가까운 fixture 매칭** 로직만 풀스택에서 구현. 매칭 미스 시 기존 mock fallback.

이 모드로 **데이터·UI 풀체인 시연 가능**. climate.gg API 장애나 CORS 협의 전 안전판 역할.

---

### Phase B — 라이브 프록시 (본선 직전 또는 안정성 확인 후)

분석가의 PoC Python 로직을 **TypeScript Vercel function 5개**로 포팅. 또는 분석가가 별도 Python 백엔드(Render/Railway) 운영 후 풀스택은 그쪽으로 fetch.

**권장 안 (TypeScript 포팅)**:

```
apps/web/api/
  ├── pv-analysis.ts          # 기존 (변경 최소)
  ├── select-buld.ts          # NEW
  ├── select-buld-info.ts     # NEW
  ├── select-sun-list.ts      # NEW  (셀 격자 생성 포함)
  ├── select-rule-list.ts     # NEW
  ├── wfs-bldg-info.ts        # NEW
  └── building-bundle.ts      # NEW (위 6개를 묶어 1회 호출로 bundle 반환)
```

`building-bundle.ts` 1개만 풀스택이 호출. 입력: `{longitude, latitude}`, 출력: 위 §1 의 `bundle` + `panels_4326.geojson` 본체.

좌표 변환은 `proj4` npm 패키지 사용:
```ts
import proj4 from 'proj4';
proj4.defs('EPSG:5186', '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs');
const [x5186, y5186] = proj4('EPSG:4326', 'EPSG:5186', [lon, lat]);
```

---

## 4. 풀스택 코드 변경 포인트 (Phase A 기준 최소 변경)

| 파일 | 변경 |
|---|---|
| `apps/web/src/pages/RiskMapPage.tsx` | `handleMapSelection` 에 fixture 매칭 추가. 매칭 성공 시 새 `bundle` 으로 `selectedBuilding` 상태 채움. |
| `apps/web/src/lib/solarSimulation.ts` | 하드코드 상수 5종 제거. `bundle.pv_analysis_output` 을 그대로 사용. fallback 함수는 유지. |
| `apps/web/src/lib/buildingFootprints.ts` | (선택) 기존 GeoJSON 로딩 유지 + fixture polygon 우선 적용. |
| `apps/web/api/pv-analysis.ts` | Phase A 에서는 미사용. Phase B 에서 그대로 사용. |
| `apps/web/src/components/VWorldSolarPanelLayer.tsx` | `panels_4326.geojson` 의 `properties.shading_score` 로 셀 색상 결정 (히트맵). |
| (신규) `apps/web/src/lib/fixtureClient.ts` | `loadFixtureIndex()`, `findNearestFixture(lon,lat)`, `loadBundle(id)` |
| (신규) `apps/web/src/types/climateBundle.ts` | 위 §1 타입 정의 |

---

## 5. 새로 사용 가능해진 UI 요소

| 요소 | 출처 필드 | 적용 위치 (현재 코드) |
|---|---|---|
| 건물명·층수·높이 | `meta.bldg_nm`, `bldg_nofl`, `bldg_hgt` | `SelectedBuilding` 카드 상단 |
| 옥상 폴리곤 (정확) | `roof_polygon_4326` | `VWorldSelectedBuildingLayer` |
| 옥상 셀별 음영 히트맵 | `panels_4326.geojson` `properties.shading_score` | `VWorldSolarPanelLayer` (색상 매핑) |
| 음영 평균 지표 | `shading.score_mean` | 위험 진단 패널 신규 카드 "옥상 평균 음영지수" |
| 월별 실측 사용량 | `usage_monthly.electricity_kwh` | "현재 월 평균 전기 사용량" 자동 표시 (현재 사용자 입력 폼 대체) |
| 규제 경고 | `regulation_hits` | 신규 알림 띠 "확인 필요 규제 N건" |
| 정확한 발전·경제성 | `pv_analysis_output.*` | 기존 카드들 그대로, 단 source 가 fixture |

---

## 6. 분석가 산출물 일정 (Phase A 기준)

| 작업 | 기한 | 산출 |
|---|---|---|
| PoC 노트북 안정성 sweep (반복 호출, 좌표 변형) | D+1 | sweep CSV + 결정론성 메모 |
| 시연 시군 옥상 5건 fixture 생성 (수원/화성 각 2-3건) | D+2 | `apps/web/public/fixtures/poc/*` |
| `index.json` 작성 + 풀스택 PR review | D+3 | 위 동일 |
| 라이브 프록시 TypeScript 포팅 (Phase B) | D+5 | Vercel functions 6종 |

---

## 7. 미해결·확인 필요

1. **셀-패널 매핑 비율** (`CELLS_PER_PANEL = 2` 가정) — climate.gg 가 실제로 어떻게 셀과 모듈을 매핑하는지 sweep으로 확인. panel_count 의 정확도에 직결.
2. **selectBuldInfo 가 주거용 건물에서도 동작하는지** — PoC 건물은 비주거. 화성시 주거용 좌표로 추가 캡처 필요.
3. **CORS 정책 우회**: 5개 API 모두 `Origin: climate.gg.go.kr` 만 허용 → Phase B 진입 시 백엔드 프록시 필수. 약관 명시 부재 → 본선 후 경기도청 정식 협의 필요.
4. **proj4js vs 백엔드 변환**: 풀스택이 클라이언트에서 5186 변환을 시도하지 말 것 (기존 합의 유지). 변환은 분석가 측에서.
5. **VWorld 빌딩 레이어와 climate.gg 옥상 polygon 간 오프셋** 발생 가능. 1차 시각적 검증 후 결정.

---

## 8. 의존성 (한 줄)

- 풀스택: 변경 없음 (Phase A) / `npm i proj4` (Phase B)
- 분석가: `requests`, `pyproj`, `shapely` — 이미 보유

---

**문서 끝.** Phase A 의 fixture 5건이 완성되면 풀스택은 `fetch('/fixtures/poc/index.json')` 한 줄로 즉시 연동 시작 가능.
