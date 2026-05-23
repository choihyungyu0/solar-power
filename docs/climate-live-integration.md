# climate.gg Live Hybrid Integration

## 목적

`/risk-map`의 production 기본 동작은 VWorld 3D 지도, 화성시 건물 선택, 선택 건물 highlight, 건물 footprint 기반 자체 패널 배치, 선택적인 static climate.gg POC 샘플 표시다.

Vercel Function 기반 `/api/climate-rooftop-analysis` 라이브 호출은 production UI에서 비활성화되어 있다. future live 분석은 별도 백엔드 서버에서 timeout, retry, cache를 갖춘 뒤 `VITE_ENABLE_CLIMATE_LIVE_BACKEND=true`와 `VITE_CLIMATE_BACKEND_BASE_URL`로 연결한다.

이 기능은 비공식 climate.gg 내부 API와 건물 footprint 기반 추정을 포함한 MVP다. 실제 설치 가능 여부는 현장조사, 구조 검토, 관리주체 협의, 정책 공고 확인이 필요하다.

## 2026-05 rollback decision

- Vercel Function에서 climate.gg `selectSunList`/`selectBuld`를 직접 호출하는 방식은 production에서 지연과 timeout이 반복되어 사용자 경험을 막았다.
- production UI는 더 이상 `/api/climate-rooftop-analysis`를 호출하지 않는다.
- Vercel route 자체도 `ENABLE_EXPERIMENTAL_CLIMATE_LIVE_API=true`가 없으면 즉시 disabled 응답을 반환한다.
- 현재 production은 안정적인 건물 footprint 기반 자체 패널 배치와 `/api/pv-analysis` 또는 로컬 fallback을 사용한다.
- static POC는 `/data/climate-poc/L1_41110_065203/bundle.json`, `/data/climate-poc/L1_41110_065203/panels_4326.geojson`을 사용하는 별도 샘플 시각화로 유지한다.
- live climate API는 별도 백엔드 서버로 옮긴 뒤 timeout, retry, cache, 호출량 제한을 구현해 다시 연결한다.

## 좌표 원칙

- 프론트엔드와 VWorld/Cesium: EPSG:4326 lon/lat
- climate.gg shading cell API: EPSG:5186
- 브라우저는 climate.gg를 직접 호출하지 않는다.
- experimental `/api/climate-rooftop-analysis` 또는 future backend가 EPSG:4326 -> EPSG:5186, EPSG:5186 -> EPSG:4326 변환을 담당한다.

EPSG:5186 정의:

```text
+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs
```

## Experimental pipeline

이 파이프라인은 현재 production UI에서 호출하지 않는다. 별도 backend server 전환 시 참고한다.

1. 요청의 lon/lat, `selectedBuildingFeature`, panel 옵션을 검증한다.
2. lon/lat을 EPSG:4326에서 EPSG:5186으로 변환한다.
3. fast mode에서는 `selectBuld.do`를 호출하지 않고 선택 건물 footprint를 바로 옥상 후보로 사용한다.
4. full mode에서만 `selectBuld.do`를 짧게 시도할 수 있다.
5. fast mode의 `roofSource`는 `vworld-building-footprint-fallback`이다.
6. footprint fallback에서는 GeoJSON Polygon 또는 MultiPolygon의 첫 Polygon outer ring을 EPSG:4326에서 EPSG:5186으로 변환한다.
7. EPSG:5186 polygon 내부에 1m x 3.5m 셀을 생성하고 centroid-in-polygon으로 필터링한다.
8. fast mode에서는 셀 수가 180개를 넘으면 결정적 공간 샘플링으로 180개만 분석하고 `maxCellsApplied = true`를 반환한다.
9. `selectSunList.do`에 셀 bbox 목록을 보내 shading score를 받는다.
10. experimental route 또는 future backend는 `analysisStage = shading-complete`, `pvAnalysisStatus = skipped`, `pv_analysis_output = null`로 반환할 수 있다.
11. roof polygon과 panel cell polygon을 EPSG:4326으로 변환해 프론트엔드에 반환한다.
12. 프론트엔드는 반환된 `pv_analysis_input`으로 `/api/pv-analysis`를 별도 호출해 발전량/경제성 카드를 갱신한다.

experimental Vercel route를 수동으로 켤 경우에도 production timeout에 의존하지 않고 내부적으로 7초 제한을 둔다. 다만 production UI 기본값은 이 route를 호출하지 않는다.

- 전체 fast 요청: 7초
- `selectBuld.do`: fast mode에서는 skip
- `selectSunList.do`: 5초
- fast mode 셀 상한: 180개
- 프론트엔드 abort: 6초
- fast mode에서는 WFS 건물 메타데이터, `selectBuldInfo.do`, `selectRuleList.do`, `pv/analysis`를 호출하지 않는다.

`includePvAnalysis: true`를 명시하면 기존 full 동작을 허용한다. 이 경우에도 전체 요청은 25초 이내에 끝나도록 제한하고, 기본값으로 사용하지 않는다.

## 응답 구분

성공 응답의 `source`는 항상 다음 값이다.

```text
climate.gg-live-hybrid
```

`roofSource`는 다음 둘 중 하나다.

```text
climate.gg-selectBuld
vworld-building-footprint-fallback
```

프론트엔드는 live 결과를 다음처럼 표시한다.

- 패널 배치 데이터 소스: `선택 건물 footprint + climate.gg 음영 분석`
- 상태: `AI/공공데이터 기반 음영 분석`
- 발전량 카드: `/api/pv-analysis` 응답 전까지 `발전량은 별도 계산 중` 또는 `계산 중...`

footprint fallback일 때는 정확한 옥상 분석이라고 표현하지 않고 `건물 footprint 기반 옥상 추정`으로 안내한다.

## 실패와 fallback

`selectBuld.do` 실패는 전체 실패가 아니다. 선택 건물 footprint가 있으면 계속 진행한다.

`selectSunList.do`가 실패하거나 지연되면 shading score가 없으므로 API는 `ok:false`, `fallbackRecommended:true`, `analysisStage: shading-timeout`을 반환한다. 이때 메시지는 `climate.gg 음영 분석 응답 지연으로 기본 패널 배치를 유지합니다.`이며, 프론트엔드는 기존 건물 footprint 기반 자체 패널 grid fallback을 유지한다.

`/api/pv-analysis`가 실패하거나 지연되면 이미 만든 bundle/panel geometry는 버리지 않는다. 프론트엔드는 다음 로컬 시나리오 산식으로 발전량 카드를 채우고 `발전량 API 응답 지연으로 시나리오 산식을 사용했습니다.`라고 표시한다.

```text
installKw = panelCapacityW * panelCount / 1000
shadingFactor = clamp(shadingAverage / 3.5, 0.45, 1.0)
annualGenerationKwh = installKw * 365 * 3.6 * shadingFactor
annualSavingKrw = annualGenerationKwh * 150
```

## Static POC and future live analysis

정적 POC:

- 고정 fixture: `public/data/climate-poc/L1_41110_065203`
- UI: `climate.gg 샘플 음영 분석 보기`
- 현재 선택 건물과 별개의 1개 사전계산 샘플이다.

Future live backend:

- `VITE_ENABLE_CLIMATE_LIVE_BACKEND=true`일 때만 선택 건물의 lon/lat과 `selectedBuildingFeature`를 별도 backend server에 전송한다.
- 선택 건물 기준으로 shading cell을 수행하고 패널 GeoJSON을 먼저 렌더링한다.
- PV 분석은 `/api/pv-analysis` 별도 요청으로 수행한다.
- backend 응답 지연 시 UI는 기본 건물 footprint 패널 배치를 유지한다.

## 주요 진단값

- `source`
- `roofSource`
- `selectBuldStatus`
- `liveHybridMode`
- `roofAreaM2`
- `cellCount`
- `originalCellCount`
- `usedCellCount`
- `shadingCellCount`
- `shadingAverage`
- `panelCount`
- `includePvAnalysis`
- `maxCellsApplied`
- `apiTimingsMs`
- `overallTimeoutMs`
- `elapsedMs`
- `timedOutStep`
- `selectSunListStatus`
- `pvAnalysisStatus`
- `pvAnalysisSource`
- `fallbackReason`

## 운영 제한

- climate.gg 내부 API는 비공식이며 지연, timeout, 응답 형식 변경이 있을 수 있다.
- 선택 건물 footprint는 실제 사용 가능한 옥상면과 다를 수 있다.
- 1m x 3.5m 셀은 shading 분석용 cell이며 실제 패널 배치 확정안이 아니다.
- 공개 운영 전에는 서버 측 캐시, 사용자 단위 throttling, 호출량 제한이 필요하다.
