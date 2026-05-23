# climate.gg Live Hybrid Integration

## 목적

`/risk-map`의 라이브 분석은 이제 `selectBuld.do` 결과에만 의존하지 않는다. 먼저 climate.gg 옥상 polygon 조회를 짧게 시도하고, 지연되거나 미적중하면 사용자가 선택한 VWorld 건물 footprint를 옥상 후보로 사용한다.

Vercel production timeout을 피하기 위해 기본 라이브 분석은 `mode: "fast"`, `includePvAnalysis: false`로 실행한다. 이 요청은 기본 패널 배치를 먼저 유지한 상태에서 shading cell과 패널 GeoJSON만 짧게 시도하고, 성공하면 지도 패널을 climate.gg 음영 셀로 교체한다. 발전량/경제성 계산은 음영 성공 이후 프론트엔드가 `/api/pv-analysis`로 별도 요청한다.

이 기능은 비공식 climate.gg 내부 API와 건물 footprint 기반 추정을 포함한 MVP다. 실제 설치 가능 여부는 현장조사, 구조 검토, 관리주체 협의, 정책 공고 확인이 필요하다.

## 좌표 원칙

- 프론트엔드와 VWorld/Cesium: EPSG:4326 lon/lat
- climate.gg shading cell API: EPSG:5186
- 브라우저는 climate.gg를 직접 호출하지 않는다.
- `/api/climate-rooftop-analysis`가 EPSG:4326 -> EPSG:5186, EPSG:5186 -> EPSG:4326 변환을 담당한다.

EPSG:5186 정의:

```text
+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs
```

## 하이브리드 파이프라인

1. 요청의 lon/lat, `selectedBuildingFeature`, panel 옵션을 검증한다.
2. lon/lat을 EPSG:4326에서 EPSG:5186으로 변환한다.
3. fast mode에서는 `selectBuld.do`를 호출하지 않고 선택 건물 footprint를 바로 옥상 후보로 사용한다.
4. full mode에서만 `selectBuld.do`를 짧게 시도할 수 있다.
5. fast mode의 `roofSource`는 `vworld-building-footprint-fallback`이다.
6. footprint fallback에서는 GeoJSON Polygon 또는 MultiPolygon의 첫 Polygon outer ring을 EPSG:4326에서 EPSG:5186으로 변환한다.
7. EPSG:5186 polygon 내부에 1m x 3.5m 셀을 생성하고 centroid-in-polygon으로 필터링한다.
8. fast mode에서는 셀 수가 180개를 넘으면 결정적 공간 샘플링으로 180개만 분석하고 `maxCellsApplied = true`를 반환한다.
9. `selectSunList.do`에 셀 bbox 목록을 보내 shading score를 받는다.
10. `/api/climate-rooftop-analysis`는 `analysisStage = shading-complete`, `pvAnalysisStatus = skipped`, `pv_analysis_output = null`로 반환한다.
11. roof polygon과 panel cell polygon을 EPSG:4326으로 변환해 프론트엔드에 반환한다.
12. 프론트엔드는 반환된 `pv_analysis_input`으로 `/api/pv-analysis`를 별도 호출해 발전량/경제성 카드를 갱신한다.

기본 fast mode의 `/api/climate-rooftop-analysis` 처리는 Vercel production timeout에 의존하지 않고 내부적으로 7초 제한을 둔다. 프론트엔드는 6초 안에 응답이 없으면 요청을 abort하고 기본 배치를 유지한다.

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

## 정적 POC와 라이브 분석

정적 POC:

- 고정 fixture: `public/data/climate-poc/L1_41110_065203`
- UI: `climate.gg 샘플 음영 분석 보기`
- 선택 건물과 위치가 다를 수 있다.

라이브 하이브리드:

- 선택 건물의 lon/lat과 `selectedBuildingFeature`를 API에 전송한다.
- 선택 건물 기준으로 shading cell을 수행하고 패널 GeoJSON을 먼저 렌더링한다.
- PV 분석은 `/api/pv-analysis` 별도 요청으로 수행한다.
- live 결과가 있으면 static POC보다 우선 표시한다.

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
