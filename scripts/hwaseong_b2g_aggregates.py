"""화성시 B2G 집계 — 라이브 API 호출 없이 ./data 자산만 사용.

산출:
  data/processed/b2g/hwaseong_admdong_summary.csv      # 행정동별 잠재량/포화도
  data/processed/b2g/hwaseong_priority_cells.geojson   # 우선추진 격자 (4326)
  data/processed/b2g/hwaseong_headline_3cards.json     # 발표 헤드라인 3숫자

의존성:
  pip install rasterio geopandas

실행:
  python scripts/hwaseong_b2g_aggregates.py

주의: rasterio 가 설치되지 않은 환경에서는 헤드라인 카드(CSV 기반)만 생성하고 격자 산출은 스킵됩니다.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
OUT_DIR = ROOT / "data" / "processed" / "b2g"
OUT_DIR.mkdir(parents=True, exist_ok=True)

CSV_MARKET = next(DATA_DIR.glob("**/시장 잠재량 통계*화성시*.csv"), None)
CSV_TECH = next(DATA_DIR.glob("**/기술적 잠재량 통계*화성시*.csv"), None)
CSV_FACILITY = next(DATA_DIR.glob("**/태양광 발전시설 현황*화성시*.csv"), None)
SHP_FACILITY = next(DATA_DIR.glob("**/sunl_fclt_pstn_*.shp"), None)
TIFF_MARKET = next(DATA_DIR.glob("**/시장 잠재량 (옥상)*화성시*/rst_mrkt_*.tif"), None)


def build_headline_cards() -> dict[str, Any]:
    """시군 통계 CSV 기반 헤드라인 3숫자. GRF002 = 옥상형 합계 사용."""
    if not CSV_MARKET:
        return {"error": "시장 잠재량 통계 CSV 미발견"}

    market = pd.read_csv(CSV_MARKET, encoding="cp949")
    market_rooftop = market[market["grnd_rftp_se_cd"] == "GRF002"]
    market_mwh = float(market_rooftop["sum_genqy"].sum()) / 1000.0

    active_mwh = 0.0
    if CSV_FACILITY:
        facility = pd.read_csv(CSV_FACILITY, encoding="cp949")
        if "anl_sr_sum" in facility.columns:
            active_mwh = float(facility["anl_sr_sum"].sum()) / 1000.0
        elif "sunl_fclt_sum_area" in facility.columns:
            active_mwh = float(facility["sunl_fclt_sum_area"].sum()) / 1000.0

    saturation_pct = (active_mwh / market_mwh * 100) if market_mwh > 0 else 0.0

    return {
        "region": "경기도 화성시 (41590)",
        "snapshot_date": "2025-10-21",
        "market_potential_rooftop_mwh": round(market_mwh, 1),
        "active_rooftop_mwh_estimate": round(active_mwh, 1),
        "saturation_pct": round(saturation_pct, 2),
        "headline_text": (
            f"화성시 옥상 태양광 시장잠재량 {market_mwh:,.0f} MWh, "
            f"현재 가동 {active_mwh:,.0f} MWh, 포화도 {saturation_pct:.1f}%"
        ),
    }


def build_admdong_summary() -> pd.DataFrame:
    """행정동별 집계 (시군 통계가 행정동 단위로 없으면 시군 합계 1행만 출력)."""
    rows = []
    if CSV_MARKET:
        market = pd.read_csv(CSV_MARKET, encoding="cp949")
        for _, r in market.iterrows():
            rows.append({
                "level": "sigun",
                "code": r.get("admdst_cd"),
                "ground_or_rooftop": r.get("grnd_rftp_se_cd"),
                "market_potential_kwh": r.get("sum_genqy"),
                "market_potential_area_sqm": r.get("sum_area"),
            })
    return pd.DataFrame(rows)


def build_priority_cells() -> dict[str, Any] | None:
    """시장 잠재량 TIFF 상위 10% × 발전시설 없는 격자. rasterio 필요."""
    try:
        import geopandas as gpd
        import numpy as np
        import rasterio
        from rasterio.features import shapes
        from shapely.geometry import shape as shp_shape
    except ImportError:
        return None

    if not TIFF_MARKET or not SHP_FACILITY:
        return None

    with rasterio.open(TIFF_MARKET) as src:
        arr = src.read(1, masked=True)
        transform = src.transform
        crs = src.crs

        valid = arr.compressed()
        if valid.size == 0:
            return None
        threshold = np.percentile(valid, 90)
        mask = (arr >= threshold).filled(False)

        geoms = []
        for geom, val in shapes(mask.astype("uint8"), mask=mask, transform=transform):
            if val == 1:
                geoms.append(shp_shape(geom))

    if not geoms:
        return None

    gdf = gpd.GeoDataFrame(geometry=geoms, crs=crs)
    facility = gpd.read_file(SHP_FACILITY, encoding="cp949").to_crs(crs)
    gdf["has_facility"] = gdf.geometry.apply(
        lambda g: bool(facility.intersects(g).any())
    )
    priority = gdf[~gdf["has_facility"]].to_crs("EPSG:4326")

    return json.loads(priority.to_json())


def main() -> None:
    headline = build_headline_cards()
    (OUT_DIR / "hwaseong_headline_3cards.json").write_text(
        json.dumps(headline, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"[1/3] headline saved -> {OUT_DIR / 'hwaseong_headline_3cards.json'}")
    print(f"      {headline.get('headline_text', headline)}")

    summary = build_admdong_summary()
    summary.to_csv(OUT_DIR / "hwaseong_admdong_summary.csv", index=False, encoding="utf-8")
    print(f"[2/3] admdong summary saved -> {OUT_DIR / 'hwaseong_admdong_summary.csv'} ({len(summary)} rows)")

    priority = build_priority_cells()
    if priority is None:
        print("[3/3] priority cells SKIP (rasterio/geopandas 미설치 또는 자산 미발견)")
    else:
        (OUT_DIR / "hwaseong_priority_cells.geojson").write_text(
            json.dumps(priority, ensure_ascii=False), encoding="utf-8"
        )
        print(
            f"[3/3] priority cells saved -> {OUT_DIR / 'hwaseong_priority_cells.geojson'} "
            f"({len(priority.get('features', []))} cells)"
        )


if __name__ == "__main__":
    main()
