# 개발자에게 — climate.gg API 발견·예시·데이터 패키지

> 분석가 양인성 → 개발자 최현규 (2026-05-22)
> 화면 공유 시연에서 보여드린 climate.gg 5개 API 통합 결과물입니다.
> 이 문서 한 장만 보고 어디부터 손대면 되는지 알 수 있게 정리했습니다.

---

## 30초 요약

- climate.gg 가 내부적으로 쓰는 **5개 API** 를 다 발견·검증했고, 그중 4개가 우리 서비스에 추가로 쓸 수 있는 데이터(옥상 polygon · 셀별 음영 · 건물 메타 · 월별 실측 사용량)를 줍니다.
- 검증은 **Streamlit 앱(`scripts/mvp_app.py`)** 으로 끝까지 시연 가능. 화면 공유 때 보신 그 앱입니다.
- 어떤 API 를 어떻게 호출하는지는 **`docs/api_spec_climate_har.md`** 에 전수 명세.
- 서비스 아키텍처·캐시·rate limit·호출 시점 등 **구현 결정은 모두 개발자(현규님) 자유**. 분석가는 발견·데이터 전달만.

---

## 받으신 파일

| 파일 | 무엇 |
|---|---|
| `scripts/mvp_app.py` | 화면 공유 시연 앱 (Streamlit + folium 히트맵) |
| `scripts/poc_rooftop_pipeline.py` | mvp_app 이 쓰는 8단계 함수 본체 (TypeScript 등으로 포팅 시 참고) |
| `docs/api_spec_climate_har.md` | 5개 API 전수 명세 (요청·응답·헤더·좌표계) |
| `data/processed/sample_coords.csv` | 검증된 화성 동탄 좌표 5건 (mvp_app 즉시 테스트용) |
| `data/processed/har_extracted/*.json` | HAR 에서 추출한 5개 API + WFS + 카카오 raw 응답 (직접 호출 없이 응답 형식 확인용) |
| `data/processed/poc/L1_41110_065203/{bundle.json, panels_4326.geojson}` | 8단계 통합 결과 1건 사전계산본 (응답 직렬화 예시) |

---

## 추천 읽기 순서 (10~30분)

1. **(1분)** `docs/api_spec_climate_har.md` §0 헤드라인 + §1 인벤토리 → 큰 그림
2. **(5분)** mvp_app 띄우기 → 좌표 프리셋 클릭 → 음영 히트맵 직접 보기
   ```powershell
   cd C:\Users\insung\solar-power
   pip install streamlit streamlit-folium folium branca requests pyproj shapely
   streamlit run scripts/mvp_app.py
   ```
3. **(5분)** `data/processed/har_extracted/` 의 raw 응답 1~2개 열어보기 — selectSunList 응답 포맷이 어떻게 생겼는지
4. **(필요 시)** `scripts/poc_rooftop_pipeline.py` 의 `run_pipeline` → 다른 언어 포팅 참고

---

## 좌표계

- 풀스택(VWorld) 은 **EPSG:4326 (WGS84)** 만 사용 — 변경 없음.
- climate.gg 5개 API 중 4개가 **EPSG:5186 (Korea 2000 Central Belt)** 입력/출력. `/spsvc/pv/analysis` 만 4326.
- 변환은 백엔드에서 수행 (Python `pyproj`, JS 라면 `proj4`). `poc_rooftop_pipeline.py` 가 변환 로직 그대로 사용 중.

---

## 카카오 API 관련

- climate.gg 자체 UI 는 "주소 입력 → 카카오 좌표변환 → API 호출" 흐름이지만, 우리 서비스는 **지도 클릭(좌표 직접)** 이라 **카카오 API 키 불필요**.
- 만약 주소 검색 박스를 추가한다면 그때 카카오 REST API 키 (일 30만 건 무료) 발급 필요.

---

## 개발자가 자유롭게 결정할 것

| 항목 | 옵션 |
|---|---|
| 백엔드 형태 | Vercel function (TS/Python) / 별도 백엔드 / 클라이언트 직접 (CORS 우회 필요) |
| 호출 시점 | 클릭 즉시 5개 / 단계적 (클릭 후 1·2 → 분석 실행 누르면 3·4·5) |
| 캐시 | 없음 / 메모리 / Supabase / KV |
| Rate limit | climate.gg 명시 제한 없음. 보수적 5 req/sec 권장 |
| Fallback | 시드 fixture / 데모값 격하 |

→ 분석가는 강요하지 않습니다. 골라서 구현하시면 됩니다.

---

## 화성시 전체 적용 시 알아둘 것

- 약 10만 채. **사전 일괄 수집 불가능** (5~7일 가동 필요 + climate.gg 약관 리스크).
- 따라서 **"클릭 시 라이브 호출 + 시드 fixture 폴백"** 이 유일한 현실적 모델.
- 화성 동탄 일대만 시범 적중 검증 완료. 다른 시군은 작동은 하나 정확도 미검증.

---

## 알려진 한계

- climate.gg 비공식 내부 API. 본선 후 경기도청 정식 협의 권장.
- CORS 가 climate.gg Origin 만 허용 → 클라이언트 직접 호출 불가.
- `selectBuldInfo` 는 일부 건물 unq_id 결손으로 빈 응답. UI 빈 상태 처리 필요.
- 셀 1m×3.5m 는 climate.gg 음영 계산 단위. 실제 패널 모듈 크기는 아님. 1패널 ≈ 셀 2장 잠정 가정.

---

## 분석가 부담 가능한 후속 작업 (요청 주시면 처리)

- 시드 fixture 추가 생성 (카테고리별 좌표 확정 후)
- footprint 메타 enrich (`unq_id` 매핑 야간 배치)
- B2G 발표용 화성시 집계 데이터
- API 안정성 sweep 보고서
- 새 API 발견·데이터 가공 요청

---

## 더 자세한 참고 문서 (선택)

- `docs/HANDOFF_PACKAGE.md` — 전체 패키지 인덱스
- `docs/DEV_HANDOFF_CLIMATE_APIS.md` — 좌표계·인터페이스 합의
- `services/climate_proxy/` — FastAPI 참고 구현 (분석가 운영 안 함, 채택 시 참고만)

---

질문은 카카오톡으로. 부족한 부분 알려주시면 보강해서 재공유합니다.
