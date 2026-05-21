# 화성시 건물 Polygon 연동 가이드

## 목적

`/risk-map`의 VWorld 3D 지도 클릭 좌표를 기준으로 화성시 실제 건물 polygon을 선택하고, 선택된 건물 footprint 안에서 태양광 패널 배치를 추정하기 위한 연동 문서입니다.

이 연동은 정확한 옥상 분석이 아닙니다. UI에는 반드시 `건물 footprint 기반 옥상 추정`, `예상`, `추정`, `시나리오 기준` 표현을 사용합니다.

## 데이터팀 제공 필요 항목

데이터팀은 아래 두 방식 중 하나를 제공하면 됩니다.

1. 건물 polygon API
2. 화성시 건물 footprint GeoJSON 파일

공통 요구사항:

- CRS는 `EPSG:4326`이어야 합니다.
- 좌표 순서는 반드시 `[longitude, latitude]`입니다.
- geometry는 `Polygon` 또는 `MultiPolygon`이어야 합니다.
- 건물 식별자와 주소 속성을 포함해야 합니다.
- 샘플/가짜 건물은 실데이터로 사용하지 않습니다.

## 환경 변수

GeoJSON 모드:

```env
VITE_BUILDING_POLYGON_SOURCE=geojson
VITE_BUILDING_FOOTPRINT_GEOJSON_URL=/data/buildings/hwaseong-buildings.geojson
BUILDING_POLYGON_API_URL=
BUILDING_POLYGON_API_KEY=
```

API 모드:

```env
VITE_BUILDING_POLYGON_SOURCE=api
VITE_BUILDING_FOOTPRINT_GEOJSON_URL=
BUILDING_POLYGON_API_URL=https://data-team.example.com/building-polygon
BUILDING_POLYGON_API_KEY=your_server_side_key
```

## API 연동

프론트엔드는 외부 API를 직접 호출하지 않습니다. 브라우저는 항상 내부 프록시만 호출합니다.

```text
POST /api/building-polygon
```

내부 프록시는 서버 환경 변수 `BUILDING_POLYGON_API_URL`로 데이터팀 API를 호출합니다.

요청 body:

```json
{
  "longitude": 126.84823800176633,
  "latitude": 37.46991840702113
}
```

데이터팀 API 권장 응답:

```json
{
  "ok": true,
  "data": {
    "type": "Feature",
    "id": "building-123",
    "properties": {
      "building_id": "building-123",
      "address": "경기도 화성시 ..."
    },
    "geometry": {
      "type": "Polygon",
      "coordinates": [
        [
          [126.8481, 37.4698],
          [126.8484, 37.4698],
          [126.8484, 37.47],
          [126.8481, 37.47],
          [126.8481, 37.4698]
        ]
      ]
    }
  }
}
```

허용되는 변형:

- 최상위가 GeoJSON `Feature`
- `data`, `feature`, `building`, `result` 아래에 `Feature`
- `features`, `data.features`, `result.features` 형태의 Feature 배열

배열로 여러 건물이 오면 프록시가 클릭 좌표에 대해 point-in-polygon을 다시 수행합니다.

## GeoJSON 연동

파일 위치:

```text
apps/web/public/data/buildings/hwaseong-buildings.geojson
```

브라우저 접근 URL:

```text
/data/buildings/hwaseong-buildings.geojson
```

GeoJSON 스키마:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "id": "building-123",
      "properties": {
        "building_id": "building-123",
        "address": "경기도 화성시 ..."
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [126.8481, 37.4698],
            [126.8484, 37.4698],
            [126.8484, 37.47],
            [126.8481, 37.47],
            [126.8481, 37.4698]
          ]
        ]
      }
    }
  ]
}
```

주소 속성 후보 키:

```text
address, addr, road_address, jibun_address, rn_addr, bd_addr
```

건물 ID 속성 후보 키:

```text
id, building_id, bldg_id, pnu, PNU, gis_id
```

## 현재 앱 처리 흐름

1. 사용자가 `/risk-map`의 VWorld 3D 지도에서 건물을 클릭합니다.
2. 앱이 클릭 좌표 `lon/lat`를 받습니다.
3. `VITE_BUILDING_POLYGON_SOURCE=api`이면 `/api/building-polygon`을 호출합니다.
4. `VITE_BUILDING_POLYGON_SOURCE=geojson`이면 `/data/buildings/hwaseong-buildings.geojson`을 로드합니다.
5. GeoJSON 모드에서는 `@turf/turf`의 `booleanPointInPolygon`으로 클릭 좌표가 포함된 건물을 찾습니다.
6. 선택된 건물 footprint를 안쪽으로 축소해 옥상 후보 polygon을 추정합니다.
7. 옥상 후보 polygon 안에 태양광 패널 polygon을 생성합니다.
8. 오른쪽 패널에 데이터 소스, 건물 ID, 주소, geometry type, 예상 패널 수, 예상 설치용량을 표시합니다.
9. 사용자가 `발전량 분석 실행`을 누르면 PV 분석 프록시를 호출합니다.

## 데이터 미연결 상태

실데이터가 없거나 설정이 비어 있으면 앱은 다음 문구를 표시합니다.

```text
화성시 건물 polygon 데이터가 아직 연결되지 않았습니다.
```

이때 샘플 건물을 자동 생성하거나 가짜 CSS overlay를 실데이터처럼 표시하지 않습니다.

