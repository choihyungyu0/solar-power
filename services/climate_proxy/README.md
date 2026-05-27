# climate_proxy (참고 구현)

> ⚠️ **현재 채택된 운영 형태가 아닙니다.** `REFERENCE_ONLY.md` 참조.
> 운영 채택 시 책임은 **개발자(최현규)** 에게 있으며 분석가는 운영하지 않습니다.

climate.gg 5개 API 를 묶는 FastAPI 참고 구현. 분석가가 직접 개발자에게 "이런 식으로 백엔드를 만들 수 있다" 는 참고용으로 보존한 코드입니다.

## 빠른 시작 (분석가 로컬)

```powershell
cd C:\Users\insung\solar-power\services\climate_proxy
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt

# (선택) Supabase 캐시 사용: 환경변수 설정
$env:SUPABASE_URL="https://xxx.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="..."

# 캐시 없이 로컬 파일 캐시로만 동작도 가능 (기본)
uvicorn main:app --reload --port 8000
```

확인:
- http://localhost:8000/api/v1/health
- http://localhost:8000/docs  (Swagger UI 자동 생성)

## 호출 예시

```bash
curl -X POST http://localhost:8000/api/v1/building-bundle \
  -H "Content-Type: application/json" \
  -d '{"longitude":127.02948714,"latitude":37.26726989}'
```

응답: `poc_rooftop_pipeline.result_to_bundle()` 와 동일 스키마 + `panels_geojson` 동봉.

## 배포 (Render 무료 티어 권장)

`render.yaml` 참고. 환경변수 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` 설정 후 `git push` 시 자동 배포.

## 아키텍처

```
[client]
   ↓ POST /api/v1/building-bundle  {lon, lat}
[main.py]
   ↓ grid_key (5m 정규화)
[cache.py] Supabase or 로컬 파일
   ├─ HIT → return bundle
   └─ MISS
        ↓ rate_limiter (5 req/sec)
        ↓ pipeline.run_pipeline(lon, lat)  ← scripts/poc_rooftop_pipeline.py 재사용
        ↓ cache write
        ↓ return bundle
```

## 의존 자산

- `../../scripts/poc_rooftop_pipeline.py` — 8단계 함수 본체 (수정 시 본 서비스가 즉시 반영)
- `../../docs/api_spec_climate_har.md` — climate.gg API 명세
