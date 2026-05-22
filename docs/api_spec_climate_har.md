# climate.gg.go.kr 내부 API 전수 명세 (HAR 캡처 기반)

> **작성**: 2026-05-22 (데이터분석가)
> **원본**: `data/processed/climate.gg.go.kr.har` (85 entries, 2026-05-20 캡처)
> **추출본**: `data/processed/har_extracted/*.json` (엔드포인트별 요청/응답 raw)
> **상위 문서**: `api_spec_simul_v1.md` (pv/analysis 전용 명세, 이미 전달)
> **목적**: 5개 핵심 API + 보조 리소스(WFS, 카카오, 타일)의 전수 명세화.

---

## 0. 헤드라인 (3줄)

1. **selectSunList 가 climate.gg 그 자체** — 패널 1장(1m×3.5m 셀, EPSG:5186) 단위 음영점수를 그대로 돌려준다.
2. **WFS `TM_BLDG_INFO` 가 옥상 polygon + 건물 높이(`bldg_hgt`) + 연면적 + 용도코드 + `unq_id` 를 한 번에 준다** — 우리가 현재 별도로 가공 중인 화성시 footprint GeoJSON이 사실 climate.gg 공개 WFS로 대체 가능.
3. **selectBuldInfo 가 건물별 월별 전력·가스 실측 사용량(10개월) 을 준다** — 사용자에게 "현재 사용량"을 물어보지 않고도 자동 표시 가능 (누적시뮬에 직결).

→ 결론: **음영·옥상·사용량·규제 4종이 이미 다 API로 존재**. 우리가 새로 가공해야 할 것은 **(a) 보조금 매트릭스, (b) 차등요금제 시뮬, (c) 위험점수** 정도로 줄어든다.

---

## 1. 캡처 인벤토리 (85 entries 분포)

| 종류 | 건수 | URL 패턴 |
|---|---:|---|
| **핵심 POST API** | 9 | `climate.gg.go.kr/gcs/...` 및 `/spsvc/pv/analysis` |
| WFS GetFeature | 1 | `climate.gg.go.kr/geoserver/spggcee/ows` |
| 카카오 역지오코딩 | 1 | `dapi.kakao.com/v2/local/geo/coord2address.json` |
| DEM 타일 (`dem/`) | 36 | `gcsNode/tile.sqlite/dem/{z}/{x}/{y}.wgl` — 1차 표고 타일 |
| DEM3 타일 (`dem3/`) | 9 | `gcsNode/tile.sqlite/dem3/{z}/{x}/{y}.wgl` — 고해상도 타일(추정) |
| 건물 타일 (`buld2/`) | 18 | `gcsNode/tile.sqlite/buld2/{z}/{x}/{y}.wgl` — 3D 건물 타일 |
| GA 추적 | 2 | `google-analytics.com/g/collect` (무시) |

**5개 핵심 API 호출 순서 (사용자 1회 시뮬 1세션)**:

```
[지도 클릭/팬]
  → selectSunList (initial)             # 화면 격자 음영 미리보기
  → pv/analysis (initial)               # 화면 좌표 기준 발전 미리보기
  → selectRuleList (initial)            # 규제 매칭(생략 무방)
  → DEM/buld2 타일 다수 (3D 렌더)
[건물 선택]
  → selectBuld (좌표→폴리곤)
  → WFS TM_BLDG_INFO (좌표→건물메타+unq_id)
  → kakao coord2address (좌표→도로명주소)
  → selectBuldInfo (unq_id→월별 사용량)
  → DEM3/buld2 타일 추가 로드 (확대 시)
[패널 배치 확정]
  → selectSunList (final, type=build)   # 확정 패널 셋 음영
  → pv/analysis (final)                  # 최종 발전 리포트
  → selectRuleList (final)               # 옥상 polygon 기준 규제
```

좌표계는 모두 **EPSG:5186 (Korea 2000 / Central Belt 2010)**. 카카오만 WGS84.

---

## 2. 공통 요청 헤더 (5개 API 동일)

```
Content-Type: application/x-www-form-urlencoded; charset=UTF-8
  (단, /spsvc/pv/analysis 만 application/json; charset=UTF-8)
Accept: application/json, text/javascript, */*; q=0.01
X-Requested-With: XMLHttpRequest
Origin: https://climate.gg.go.kr
Referer: https://climate.gg.go.kr/...
User-Agent: (브라우저 UA, 무관)
```

**인증 헤더·세션 쿠키·Referer 검사 없음** (4xx 발생 0건, 2026-05-20 캡처 기준). Origin/Referer는 형식상 보내지면 됨. CORS만 `climate.gg.go.kr` 도메인 제한 → **서버사이드 프록시 필수** (이미 `apps/web/api/pv-analysis.ts` 패턴 보유).

---

## 3. 엔드포인트별 상세

### 3.1 `POST /gcs/book/cmm/selectBuld.do` — 좌표 → 건물 polygon

| 항목 | 값 |
|---|---|
| 호출 시점 | 사용자가 지도에서 건물 좌표 클릭 시 |
| HAR entry | #68 (적중 성공) |

**요청 (form-data)**:

| 필드 | 타입 | 필수 | 의미 | 예시 |
|---|---|---|---|---|
| `x` | float | ✅ | EPSG:5186 X (m) | `202428.152` |
| `y` | float | ✅ | EPSG:5186 Y (m) | `518672.967` |
| `type` | string | ✅ | 호출 종류 | `PANEL` |

**응답 (JSON)**:

```json
{
  "buld": {
    "feature": "{ GeoJSON Feature, crs=EPSG:5186, Polygon }",
    "st_x": null, "st_y": null, ... (대부분 null)
  }
}
```

좌표가 어떤 건물도 적중하지 못하면 `{"buld": null}` 반환. 적중 시 `feature` 문자열을 JSON parse → 건물 footprint polygon (EPSG:5186).

> ⚠️ `feature` 는 **문자열로 한 번 감싼 GeoJSON** (이중 인코딩). `json.loads(resp['buld']['feature'])` 로 2단 디코딩 필요.

**활용**: 현재 우리가 `hwaseong_buildings_v1.geojson` 으로 self-host 하는 footprint를 좌표 입력만으로 즉시 받을 수 있음. **전국 어디든 적용 가능**한 것이 우리 GeoJSON 대비 장점.

---

### 3.2 `GET /geoserver/spggcee/ows` (WFS) — 좌표 → 건물 메타+높이

| 항목 | 값 |
|---|---|
| 호출 시점 | selectBuld 직후, 건물 메타 조회용 |
| HAR entry | #69 |

**요청 (Query String)**:

```
service=WFS
version=1.0.0
request=GetFeature
typeName=spggcee:TM_BLDG_INFO
maxFeatures=50
outputFormat=application/json
SRS=EPSG:5186
CQL_FILTER=INTERSECTS(shape, Point(202428.152 518672.967))
```

**응답 (GeoJSON FeatureCollection)** — 건물별 properties:

| 필드 | 타입 | 의미 |
|---|---|---|
| `unq_id` | string | climate.gg 내부 건물 ID (`L1_41110_065712` 형식, 다른 API에서 키로 사용) ⭐ |
| `pnu` | string | 필지고유번호 (19자리) |
| `bldg_nm` | string | 건물명 (예: "경기벤처빌딩") |
| `dtl_bldg_nm` | string | 상세동명 |
| `bldg_usg_cd`, `new_usg_cd` | string | 용도코드 (`BDU003` 등) |
| `bldg_se_cd` | string | 건물구분코드 |
| `bldg_hgt` | float | 건물 높이(m) — 예: `45.6` |
| `bldg_nofl`, `grnd_nofl`, `udgd_nofl` | int | 층수(전체/지상/지하) |
| `bdar` | float | 건축면적(㎡) |
| `tfar`, `siar` | float | 연면적/대지면적 |
| `use_aprv_ymd` | string | 사용승인일 (YYYYMMDD) |
| `road_nm_cd`, `bmno`, `bsno` | string/int | 도로명·본번·부번 |
| `sigun_cd` | string | 시군코드 (`41110` = 수원시) |
| `engy_use_unq_id` | string | 에너지사용 unq_id (대부분 unq_id와 동일) |
| `geometry` | MultiPolygon | 건물 폴리곤 (EPSG:5186, selectBuld 결과보다 단순화된 LoD0) |

**활용**:
- 현재 코드의 `deriveRoofHeightMFromFeature()` 가 한 추정을 **실측값으로 대체** (`bldg_hgt`).
- `unq_id` 가 있어야 `selectBuldInfo` 로 사용량 조회 가능.
- 용도코드(`bldg_usg_cd`) 로 보조금 매트릭스의 용도구분과 자동 매핑.

---

### 3.3 `POST /gcs/panel/selectBuldInfo.do` — unq_id → 월별 사용량

| 항목 | 값 |
|---|---|
| 호출 시점 | 건물 선택 직후 |
| HAR entry | #71 |

**요청 (form-data)**:

```
unq_id=L1_41110_065712
```

**응답 (JSON)**:

```json
{
  "list": [{
    "use_ym": "2024\n09,2024\n10,...,2025\n06",   // 10개월 ISO-like
    "elpwr_usqty": "74074,49406,...,76489",         // 월별 전력 사용량 (kWh)
    "gas_usqty": "585202,158970,...,445298",        // 월별 가스 사용량 (m³)
    "cnt": 0,
    ... (나머지 null)
  }]
}
```

| 필드 | 타입 | 단위 | 의미 |
|---|---|---|---|
| `use_ym` | string | YYYY\nMM, 콤마구분 | 최근 10개월 라벨 |
| `elpwr_usqty` | string | kWh, 콤마구분 | 월별 전력 |
| `gas_usqty` | string | m³, 콤마구분 | 월별 도시가스 |

> ⚠️ 모든 수치가 **문자열(쉼표 join)** 로 옴. `split(',')` + `int()` 변환 필수. 줄바꿈은 라벨에 끼어 있으니 `replace('\n','-')`.

**활용**:
- A2 차등요금제 누적 시뮬의 **"현재 사용량" 입력을 자동 조회** → 사용자에게 안 물어봐도 됨.
- 단, 캡처 건물은 비주거(`bdar=862㎡, 10층`)라 값이 크다. **주거용 unq_id 케이스**도 캡처해 응답 형식 차이 검증 필요.
- 사용량은 **건물 단위 합계**라 세대 단위가 아님 → 아파트는 동 전체 공용+전유 합산값일 가능성. 명확화 필요.

---

### 3.4 `POST /gcs/panel/selectSunList.do` — 패널 격자 → 음영점수 ⭐

| 항목 | 값 |
|---|---|
| 호출 시점 | (1) 화면 진입 시 기본 격자, (2) 패널 배치 확정 후 |
| HAR entry | #0 (initial, 95 panels), #82 (final, 203 panels + `type=build`) |

**요청 (form-data, panel 키 반복)**:

각 패널 1장 = 1개 `panel` 필드, 형식 `{panel_id}-{minx},{miny},{maxx},{maxy}` (EPSG:5186):

```
panel=28-202608.89062491,518662.96904667,202609.89062491,518666.46904667
panel=29-202609.89062491,518662.96904667,202610.89062491,518666.46904667
panel=30-...
panel=...
type=build           # final 호출에만 부착
```

**패널 셀 1장의 물리 규격** (HAR 실측):
- 폭(x): **1.0 m**
- 높이(y): **3.5 m**

→ 이는 **실제 패널 모듈 크기가 아니라 climate.gg가 음영 계산을 수행하는 "셀(cell)" 크기**로 보임. 실제 패널 1장은 보통 1.1m×1.8m 이므로, 1장을 **셀 2장(상·하)** 에 매핑해서 평균 음영을 사용하는 구조로 추정됨.

**응답 (JSON, 문자열 배열)**:

```json
["28|2.6732585", "29|2.5528707", "30|2.0201115", ...]
```

각 원소 = `"{panel_id}|{shading_score}"`. **점수 범위 실측: 약 0.96 ~ 3.78** (HAR 두 호출 기준). 의미 추정:

- climate.gg 시뮬 API 입력의 `shading_index_average` 단위와 동일 (`api_spec_simul_v1.md` 예시 `3.36`도 같은 스케일).
- **물리적 의미 추정**: 일평균 또는 시간단위 **"유효 일조시간(h)"** 또는 **"음영을 제외한 normalized 일사지수"**. 단조성 sweep으로 확정 필요.
- 점수가 **높을수록 발전에 유리** (`api_spec_simul_v1.md` 의 `shading_index_average=3.36` 입력 시 정상 발전량 응답 → 평균치). 우리 캡처 평균은 셀별 0.96~3.78 → 옥상 가장자리 그림자 셀이 낮고 중앙이 높음 패턴과 일치.

**우리 시뮬 입력으로의 매핑**:

```python
shading_index_average = mean(shading_scores)   # 옥상 polygon 내 모든 셀
panel_count           = len(panels_in_roof)    # 음영 점수 임계치 이상 셀만 카운트
```

**활용**:
1. selectSunList 가 climate.gg 음영 모델 그 자체를 반환.
2. 옥상 polygon → 1m×3.5m 셀 격자 분할 → 셀별 minx/miny/maxx/maxy 페이로드 → 응답 평균 → API 입력.
3. 화면에 셀별 점수 컬러맵으로 표시 가능 (climate.gg와 동일한 음영 히트맵 UI).

> ⚠️ "panel_id" 는 우리가 정해 보내는 임의 정수. 응답에 그대로 echo되어 셀 좌표 매칭에 사용. ID 누락된 셀이 있으면 음영 0 = 완전 그림자라는 뜻일 수 있음 (확인 필요).

---

### 3.5 `POST /gcs/panel/selectRuleList.do` — polygon → 규제 매칭

| 항목 | 값 |
|---|---|
| 호출 시점 | 패널 배치/건물 선택 후 |
| HAR entry | #2, #84 |

**요청 (form-data)**:

```
text=MULTIPOLYGON(((202618.99 518659.46, 202604.95 518664.00, ...)))
```

`text` 필드 1개, 값은 **WKT MULTIPOLYGON** (EPSG:5186). URL 인코딩으로 `+` 가 좌표 사이 구분자.

**응답 (JSON)** — `list` 배열, 19개 레이어 각각의 매칭 카운트:

```json
{"list":[
  {"layer":"ldsld_grd1", "cnt":0},
  {"layer":"landscape", "cnt":0},
  ...
]}
```

**19개 규제 레이어**:

| layer code | 의미 |
|---|---|
| `ldsld_grd1` | 산사태 1등급 위험지역 |
| `landscape` | 경관지구 |
| `watershed_conservation_area` | 수계보전구역 |
| `forest_genetic_resource_protection_area` | 산림유전자원보호구역 |
| `disaster_prevention_protection_area` | 재해방지보호구역 |
| `national_cultural_property` | 국가문화재 |
| `national_cultural_property_zone` | 국가문화재 보호구역 |
| `national_registered_property` | 국가등록문화재 |
| `local_cultural_property` | 지방문화재 |
| `local_cultural_property_zone` | 지방문화재 보호구역 |
| `national_park` | 국립공원 |
| `provincial_park` | 도립공원 |
| `county_park` | 군립공원 |
| `provincial_ecological_landscape_conservation_area` | 도지정 생태경관보전지역 |
| `wildlife_protection_area` | 야생생물보호구역 |
| `drinking_water_protection_area` | 상수원보호구역 |
| `riparian_zone` | 수변구역 |
| `wetland_protection_area` | 습지보호구역 |
| `eco1_mgmt_area` | 생태자연도 1등급 권역 |

`cnt > 0` 인 레이어가 있으면 해당 polygon이 그 규제 영역과 교차 → 설치 제약/검토 사유.

**활용**:
- "설치 가능" / "검토 필요" 자동 판정 UI에 직접 사용.
- 우리 코드에 현재 없는 기능.

---

### 3.6 `POST /spsvc/pv/analysis` — 시뮬 결과

이미 `api_spec_simul_v1.md` 에 전수 정리됨.

**HAR 캡처 입력 예**:
```json
{
  "latitude": 37.26726989, "longitude": 127.02948714,
  "shading_index_average": 3.4034437,    // selectSunList 평균
  "solar_panel_angle": "35",              // 문자열로 옴 (캡처 기준)
  "solar_panel_info": {
    "panel_capacity": 640,                // 640W 모델
    "panel_count": 43,
    "panel_type": 1
  }
}
```

→ `api_spec_simul_v1.md` 표 대비 변경 사항:
- `solar_panel_angle` 는 **문자열도 허용** (`"35"`)
- `panel_capacity` 는 **640W도 지원** (`api_spec_simul_v1.md` 는 500W 예시) — `panel_type` 코드와의 매핑은 별도 sweep 필요
- 응답 `detail` 인코딩 깨짐 동일


---

### 3.7 카카오 `GET /v2/local/geo/coord2address.json` — 좌표→도로명

| 항목 | 값 |
|---|---|
| 호출 시점 | 건물 선택 직후 표시용 |
| HAR entry | #70 |

```
GET https://dapi.kakao.com/v2/local/geo/coord2address.json
    ?x=127.02732836884516
    &y=37.26736938333499
    &input_coord=WGS84
```

응답: `road_address.address_name` (도로명), `address.address_name` (지번). HAR에는 카카오 API 키 헤더가 비어있는데, climate.gg 서버가 프록시로 가린 것으로 추정. **우리는 카카오 디벨로퍼스에서 자체 키 발급 필요** (REST API 키, 일 30만건 무료).

좌표가 **WGS84** 임에 주의 — climate.gg가 5186으로 받아 WGS84로 변환해 카카오에 던지는 구조.

---

### 3.8 타일 리소스 (참고)

| 타입 | URL | 설명 |
|---|---|---|
| `dem/` | `gcsNode/tile.sqlite/dem/{z}/{x}/{y}.wgl` | 1차 표고 타일 (z 6~11) |
| `dem3/` | `gcsNode/tile.sqlite/dem3/{z}/{x}/{y}.wgl` | 고해상도 표고 (z 8~12, 건물 선택 시만 로드) |
| `buld2/` | `gcsNode/tile.sqlite/buld2/{z}/{x}/{y}.wgl` | 3D 건물 모델 타일 |

확장자 `.wgl` 은 climate.gg 자체 포맷 (WebGL 바이너리 추정). **우리가 직접 디코딩할 가치는 낮음** — DSM은 selectSunList 응답으로 이미 우리에게 전달되기 때문.

---

## 4. "데이터 부족"으로 잘못 판단했던 항목 재평가

개발자와의 대화에서 "옥상 polygon · 음영 · 일사량 · 주변 건물 높이가 필요" 라고 정리했지만, HAR을 보면 **상당수가 climate.gg API로 해결 가능**:

| 항목 | 1차 판단 | HAR 재평가 | 결론 |
|---|---|---|---|
| 옥상 polygon | DSM 가공 필요 | `selectBuld` + WFS `TM_BLDG_INFO` | **API로 해결** (전국) |
| 건물 높이 | DSM/건축물대장 | WFS `bldg_hgt` | **API로 해결** |
| 옥상 음영 | DSM raycast 자체구현 | `selectSunList` 셀별 점수 | **API로 해결** (경기도 한정, 셀 1m×3.5m) |
| 주변 건물 높이 | 별도 DSM | selectSunList 음영에 이미 반영됨 | **API에 내재** |
| 월별 일사량 | KIER/NASA POWER | climate.gg는 내부적으로 적용, 응답 `monthly_generation` 으로만 노출 | **부분 API** (직접 일사값은 못 받음) |
| 월별 실측 사용량 | 한전 API/사용자 입력 | `selectBuldInfo` | **API로 해결** (10개월) |
| 규제 매칭 | 별도 GIS | `selectRuleList` 19종 | **API로 해결** |
| 보조금 매칭 | 분석가 수기 | API 없음 | **수기 유지** (분석가가 목업 데이터 전달 예정) |
| 차등요금제 시뮬 | 분석가 수기 | API 없음 | **수기 유지** (분석가가 목업 데이터 전달 예정) | 
| 위험점수 | 분석가 수기 | API 없음 | **수기 유지** (해당 기능 구현할 것인지 논의 필요) |


---

## 5. 통합 호출 시퀀스 (우리 서비스 적용안)

```python
# Pseudocode
def analyze_building(longitude_wgs84, latitude_wgs84):
    x5186, y5186 = transform_wgs84_to_5186(longitude_wgs84, latitude_wgs84)

    # 1. 건물 폴리곤 + 메타
    buld    = climate_post('/gcs/book/cmm/selectBuld.do',  {'x':x5186, 'y':y5186, 'type':'PANEL'})
    meta    = climate_get_wfs(typeName='spggcee:TM_BLDG_INFO',
                              cql=f'INTERSECTS(shape, Point({x5186} {y5186}))')

    # 2. 옥상 polygon → 패널 셀(1m×3.5m) 격자 분할
    roof_polygon_5186 = parse_geojson(buld['feature'])
    cells = grid_to_cells(roof_polygon_5186, cell_w=1.0, cell_h=3.5)

    # 3. 음영 조회 (climate.gg 모델 그대로)
    panels = [f'{i}-{c.minx},{c.miny},{c.maxx},{c.maxy}' for i,c in enumerate(cells)]
    sunlist = climate_post('/gcs/panel/selectSunList.do',
                           [('panel', p) for p in panels] + [('type','build')])
    cell_shading = parse_sunlist(sunlist)            # {id: score}

    # 4. 음영 임계치 이상 셀만 채택 → 패널 개수
    valid_cells = [c for c in cells if cell_shading[c.id] >= SHADING_THRESHOLD]
    panel_count = len(valid_cells) // CELLS_PER_PANEL   # 1패널 = 셀 2장(추정)
    shading_avg = mean([cell_shading[c.id] for c in valid_cells])

    # 5. 규제 매칭 (사용하지 않아도 될 듯 함..)
    rules = climate_post('/gcs/panel/selectRuleList.do',
                         {'text': polygon_to_wkt(roof_polygon_5186)})
    regulation_hits = [r['layer'] for r in rules['list'] if r['cnt'] > 0]

    # 6. 사용량
    usage = climate_post('/gcs/panel/selectBuldInfo.do',
                        {'unq_id': meta['unq_id']})

    # 7. 시뮬
    pv = climate_post_json('/spsvc/pv/analysis', {
        'latitude': latitude_wgs84,
        'longitude': longitude_wgs84,
        'shading_index_average': shading_avg,
        'solar_panel_angle': '35',
        'solar_panel_info': {
            'panel_capacity': 640,
            'panel_count': panel_count,
            'panel_type': 1,
        },
    })

    # 8. 우리 부가 분석
    a2 = simulate_tariff_scenarios(usage, pv)        # 분석가 산출
    a3 = match_subsidies(meta, pv['expected_revenue']['install_kw'])
    a1 = risk_score(usage, a2, regulation_hits)

    return assemble_report(buld, meta, cells, cell_shading, pv, a1, a2, a3, regulation_hits)
```

---

## 6. 즉시 액션 (분석가 사이드)

| 우선 | 작업 | 산출 |
|---|---|---|
| **P0** | `scripts/poc_rooftop_pipeline.ipynb` — 위 시퀀스 8단계 Python으로 재현, 화성시 옥상 1동에 적용 | 노트북 + 결과 JSON |
| P0 | selectSunList **셀-패널 매핑 검증** (1패널=셀 2장 가정 확인) | 1쪽 메모 |
| P0 | selectSunList **호출 안정성 sweep** (동일 좌표 10회, 좌표 미세 변경 sweep) — API 결정론성·rate limit 확인 | sweep CSV |
| P1 | selectBuldInfo **주거용 unq_id 케이스** 추가 캡처 → 응답 포맷 변화 확인 | HAR 추가 |
| P1 | `api_spec_simul_v1.md` 에 `solar_panel_angle` 문자열 허용 + 640W 지원 1줄 추가 | 문서 수정 |
| P1 | 풀스택과 백엔드 프록시 설계 협의 — 4개 API 추가 프록시 필요 | 인터페이스 명세 |
| P2 | DSM 자체구현 트랙 보류 결정 공식화 (회의록) | 회의 |

---

## 7. 알려진 제약·리스크

1. **비공식 내부 API**: 약관 명시 없음. 본선 발표 후 경기도청과 정식 협의 필요.
2. **CORS 차단**: `Origin: climate.gg.go.kr` 만 허용 → 백엔드 프록시 필수 (이미 보유 패턴).
3. **경기도 외 좌표**: selectSunList·selectRuleList 동작 확인 필요 (도내 한정 가능성).
4. **selectBuldInfo 의 unq_id 결손**: WFS 응답에 `unq_id`가 비어있는 건물(소규모/누락 데이터)에서는 사용량 조회 실패. fallback 산식 필요.
5. **음영 점수 단위 미문서화**: 정확한 물리 단위 미상. **단조성 sweep**으로 시뮬 입력 영향만 캘리브레이션하면 실용 OK.
6. **응답 `detail` 인코딩 깨짐**: EUC-KR 추정. 무시해도 결과 데이터에는 영향 없음.

---

## 8. 빠른 참조

- 원본 HAR: `data/processed/climate.gg.go.kr.har`
- 엔드포인트별 raw: `data/processed/har_extracted/{name}_{idx}.json`
- 보조 명세: `api_spec_simul_v1.md`, `DATA_CONTEXT.md`
- 현재 활용 코드: `apps/web/api/pv-analysis.ts`, `apps/web/src/lib/pvAnalysisClient.ts`
