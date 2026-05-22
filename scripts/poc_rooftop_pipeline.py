"""
PoC: climate.gg.go.kr 5개 API + WFS 8단계 옥상 파이프라인.

- 좌표 1점(WGS84) -> 옥상 polygon + 셀별 음영 + 발전·경제성 시뮬까지 끝.
- 모듈로 import: from poc_rooftop_pipeline import run_pipeline
- 직접 실행: python scripts/poc_rooftop_pipeline.py  (HAR 검증 좌표로 1회 실행 + bundle 저장)

좌표계 규약: 외부 API 호출 직전에만 5186 으로 변환. 산출물은 모두 4326.
"""
from __future__ import annotations

import json
import os
import statistics
from dataclasses import dataclass, field
from typing import Any, Iterable

import requests
from pyproj import Transformer
from shapely.geometry import box, shape
from shapely.geometry.base import BaseGeometry

# ----------------------------- 상수 -----------------------------
BASE = "https://climate.gg.go.kr"
HEADERS = {
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "X-Requested-With": "XMLHttpRequest",
    "Origin": BASE,
    "Referer": BASE + "/",
    "User-Agent": "solarmate-poc/0.1",
}
FORM_HDR = {**HEADERS, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"}
JSON_HDR = {**HEADERS, "Content-Type": "application/json; charset=UTF-8"}

CELL_W_DEFAULT = 1.0
CELL_H_DEFAULT = 3.5

to_5186 = Transformer.from_crs("EPSG:4326", "EPSG:5186", always_xy=True)
to_4326 = Transformer.from_crs("EPSG:5186", "EPSG:4326", always_xy=True)


# ----------------------------- 결과 컨테이너 -----------------------------
@dataclass
class PipelineResult:
    click_wgs84: tuple[float, float]                  # (lon, lat)
    click_5186: tuple[float, float]                    # (x, y)
    roof_polygon_5186: BaseGeometry | None = None
    roof_polygon_4326: dict[str, Any] | None = None    # GeoJSON Polygon
    roof_area_sqm: float = 0.0
    meta: dict[str, Any] = field(default_factory=dict)
    cells: list[tuple[int, float, float, float, float]] = field(default_factory=list)
    shading: dict[int, float] = field(default_factory=dict)
    shading_stats: dict[str, float] = field(default_factory=dict)
    usage: dict[str, Any] = field(default_factory=dict)
    regulation_hits: list[tuple[str, int]] = field(default_factory=list)
    pv_input: dict[str, Any] = field(default_factory=dict)
    pv_output: dict[str, Any] = field(default_factory=dict)
    panels_geojson: dict[str, Any] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)


# ----------------------------- 개별 API 함수 -----------------------------
def transform_click_to_5186(lon: float, lat: float) -> tuple[float, float]:
    x, y = to_5186.transform(lon, lat)
    return float(x), float(y)


def select_buld(x5186: float, y5186: float, timeout: float = 15.0) -> BaseGeometry | None:
    """좌표 -> 옥상 polygon (EPSG:5186 Shapely geometry). 미적중 시 None."""
    r = requests.post(
        f"{BASE}/gcs/book/cmm/selectBuld.do",
        data={"x": f"{x5186}", "y": f"{y5186}", "type": "PANEL"},
        headers=FORM_HDR,
        timeout=timeout,
    )
    r.raise_for_status()
    body = json.loads(r.text)
    if not body.get("buld"):
        return None
    feature = json.loads(body["buld"]["feature"])
    return shape(feature["geometry"])


def wfs_bldg_info(x5186: float, y5186: float, timeout: float = 15.0) -> dict[str, Any]:
    """좌표 -> 건물 메타 (unq_id, bldg_hgt 등)."""
    url = (
        f"{BASE}/geoserver/spggcee/ows?service=WFS&version=1.0.0&request=GetFeature"
        f"&typeName=spggcee:TM_BLDG_INFO&outputFormat=application/json&SRS=EPSG:5186"
        f"&CQL_FILTER=INTERSECTS(shape,%20Point({x5186}%20{y5186}))"
    )
    r = requests.get(url, headers=HEADERS, timeout=timeout)
    r.raise_for_status()
    features = r.json().get("features", [])
    return features[0]["properties"] if features else {}


def generate_cells(
    roof: BaseGeometry,
    cell_w: float = CELL_W_DEFAULT,
    cell_h: float = CELL_H_DEFAULT,
) -> list[tuple[int, float, float, float, float]]:
    """옥상 polygon 내부에 들어가는 1m x 3.5m 셀 리스트.

    Returns: [(panel_id, minx, miny, maxx, maxy), ...]  (모두 EPSG:5186)
    """
    minx, miny, maxx, maxy = roof.bounds
    cells: list[tuple[int, float, float, float, float]] = []
    pid = 0
    y = miny
    while y + cell_h <= maxy:
        x = minx
        while x + cell_w <= maxx:
            cell = box(x, y, x + cell_w, y + cell_h)
            if roof.contains(cell.centroid):
                cells.append((pid, x, y, x + cell_w, y + cell_h))
            pid += 1
            x += cell_w
        y += cell_h
    return cells


def select_sun_list(
    cells: Iterable[tuple[int, float, float, float, float]],
    timeout: float = 30.0,
) -> dict[int, float]:
    """셀 목록 -> 셀별 음영점수 {panel_id: score}."""
    panel_params = [("panel", f"{pid}-{x1},{y1},{x2},{y2}") for pid, x1, y1, x2, y2 in cells]
    panel_params.append(("type", "build"))
    r = requests.post(
        f"{BASE}/gcs/panel/selectSunList.do",
        data=panel_params,
        headers=FORM_HDR,
        timeout=timeout,
    )
    r.raise_for_status()
    payload = json.loads(r.text)
    out: dict[int, float] = {}
    for item in payload:
        try:
            k, v = item.split("|")
            out[int(k)] = float(v)
        except (ValueError, AttributeError):
            continue
    return out


def select_buld_info(unq_id: str, timeout: float = 15.0) -> dict[str, Any]:
    """unq_id -> 월별 전력/가스 사용량 (raw 형식 유지)."""
    if not unq_id:
        return {}
    r = requests.post(
        f"{BASE}/gcs/panel/selectBuldInfo.do",
        data={"unq_id": unq_id},
        headers=FORM_HDR,
        timeout=timeout,
    )
    r.raise_for_status()
    body = json.loads(r.text)
    rows = body.get("list", [])
    return rows[0] if rows else {}


def parse_usage(raw_row: dict[str, Any]) -> dict[str, Any]:
    """selectBuldInfo raw -> {labels, electricity_kwh, gas_m3} 정규화."""
    if not raw_row or not raw_row.get("elpwr_usqty"):
        return {"labels": [], "electricity_kwh": [], "gas_m3": []}
    labels = (raw_row.get("use_ym") or "").replace("\n", "-").split(",")
    el = [int(v) for v in (raw_row.get("elpwr_usqty") or "").split(",") if v]
    gas = [int(v) for v in (raw_row.get("gas_usqty") or "").split(",") if v]
    return {"labels": labels, "electricity_kwh": el, "gas_m3": gas}


def select_rule_list(roof: BaseGeometry, timeout: float = 15.0) -> list[tuple[str, int]]:
    """옥상 polygon -> 19종 규제 매칭 (cnt > 0 만 반환)."""
    ring = (
        roof.exterior.coords
        if roof.geom_type == "Polygon"
        else list(roof.geoms)[0].exterior.coords
    )
    coords_str = ", ".join(f"{x} {y}" for x, y in ring)
    wkt = f"MULTIPOLYGON((({coords_str})))"
    r = requests.post(
        f"{BASE}/gcs/panel/selectRuleList.do",
        data={"text": wkt},
        headers=FORM_HDR,
        timeout=timeout,
    )
    r.raise_for_status()
    rules = json.loads(r.text).get("list", [])
    return [(item["layer"], item["cnt"]) for item in rules if item.get("cnt", 0) > 0]


def call_pv_analysis(
    lon: float,
    lat: float,
    shading_avg: float,
    panel_count: int,
    panel_capacity_w: int = 640,
    panel_type: int = 1,
    angle: str | int = "35",
    timeout: float = 15.0,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """발전·경제성 시뮬. (input_payload, raw_data) 반환."""
    payload = {
        "latitude": lat,
        "longitude": lon,
        "shading_index_average": shading_avg,
        "solar_panel_angle": angle,
        "solar_panel_info": {
            "panel_capacity": panel_capacity_w,
            "panel_count": max(1, panel_count),
            "panel_type": panel_type,
        },
    }
    r = requests.post(f"{BASE}/spsvc/pv/analysis", json=payload, headers=JSON_HDR, timeout=timeout)
    r.raise_for_status()
    return payload, json.loads(r.text)["data"]


# ----------------------------- 좌표 변환 헬퍼 -----------------------------
def roof_to_geojson_4326(roof: BaseGeometry) -> dict[str, Any]:
    ring = [list(to_4326.transform(x, y)) for x, y in roof.exterior.coords]
    return {"type": "Polygon", "coordinates": [ring]}


def cells_to_geojson_4326(
    cells: list[tuple[int, float, float, float, float]],
    shading: dict[int, float],
) -> dict[str, Any]:
    features = []
    for pid, x1, y1, x2, y2 in cells:
        if pid not in shading:
            continue
        ring = [(x1, y1), (x2, y1), (x2, y2), (x1, y2), (x1, y1)]
        ring_4326 = [list(to_4326.transform(px, py)) for px, py in ring]
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [ring_4326]},
                "properties": {
                    "cell_id": pid,
                    "shading_score": shading[pid],
                    "cell_5186_bbox": [x1, y1, x2, y2],
                },
            }
        )
    return {"type": "FeatureCollection", "features": features}


# ----------------------------- 풀 파이프라인 -----------------------------
def run_pipeline(
    lon: float,
    lat: float,
    cell_w: float = CELL_W_DEFAULT,
    cell_h: float = CELL_H_DEFAULT,
    panel_capacity_w: int = 640,
    panel_type: int = 1,
    cells_per_panel: int = 2,
    angle: str | int = "35",
    skip_rule_check: bool = False,
) -> PipelineResult:
    """좌표 1점 -> 8단계 전 구간 실행."""
    res = PipelineResult(click_wgs84=(lon, lat), click_5186=transform_click_to_5186(lon, lat))
    x5186, y5186 = res.click_5186

    # 1. selectBuld
    try:
        roof = select_buld(x5186, y5186)
    except Exception as exc:
        res.errors.append(f"selectBuld 실패: {exc}")
        return res
    if roof is None:
        res.errors.append("selectBuld: 좌표에 건물 미적중")
        return res
    res.roof_polygon_5186 = roof
    res.roof_polygon_4326 = roof_to_geojson_4326(roof)
    res.roof_area_sqm = float(roof.area)

    # 2. WFS
    try:
        res.meta = wfs_bldg_info(x5186, y5186)
    except Exception as exc:
        res.errors.append(f"WFS 실패: {exc}")

    # 3. 셀 격자
    res.cells = generate_cells(roof, cell_w=cell_w, cell_h=cell_h)
    if not res.cells:
        res.errors.append("셀 0개 (옥상이 셀 크기보다 작음)")
        return res

    # 4. selectSunList
    try:
        res.shading = select_sun_list(res.cells)
    except Exception as exc:
        res.errors.append(f"selectSunList 실패: {exc}")
        return res
    vals = list(res.shading.values())
    if vals:
        res.shading_stats = {
            "min": min(vals),
            "mean": statistics.mean(vals),
            "max": max(vals),
            "count": len(vals),
            "missing": len(res.cells) - len(vals),
        }

    # 5. selectBuldInfo
    unq_id = res.meta.get("unq_id") if res.meta else None
    if unq_id:
        try:
            res.usage = parse_usage(select_buld_info(unq_id))
        except Exception as exc:
            res.errors.append(f"selectBuldInfo 실패: {exc}")

    # 6. selectRuleList (MVP 에서는 스킵 가능)
    if not skip_rule_check:
        try:
            res.regulation_hits = select_rule_list(roof)
        except Exception as exc:
            res.errors.append(f"selectRuleList 실패: {exc}")

    # 7. pv/analysis
    shading_avg = res.shading_stats.get("mean", 3.36)
    panel_count = max(1, len(res.cells) // cells_per_panel)
    try:
        res.pv_input, res.pv_output = call_pv_analysis(
            lon=lon,
            lat=lat,
            shading_avg=shading_avg,
            panel_count=panel_count,
            panel_capacity_w=panel_capacity_w,
            panel_type=panel_type,
            angle=angle,
        )
    except Exception as exc:
        res.errors.append(f"pv/analysis 실패: {exc}")

    # 8. 패널 GeoJSON (4326)
    res.panels_geojson = cells_to_geojson_4326(res.cells, res.shading)
    return res


# ----------------------------- 번들 직렬화 (스크립트 모드 저장용) -----------------------------
def result_to_bundle(res: PipelineResult) -> dict[str, Any]:
    """PipelineResult -> 저장용 dict (mvp_app 과 분석가-개발자 인터페이스 공용)."""
    meta = res.meta or {}
    sh = res.shading_stats or {}
    return {
        "meta": {
            "unq_id": meta.get("unq_id"),
            "bldg_nm": meta.get("bldg_nm"),
            "bldg_hgt": meta.get("bldg_hgt"),
            "bdar": meta.get("bdar"),
            "bldg_nofl": meta.get("bldg_nofl"),
            "use_aprv_ymd": meta.get("use_aprv_ymd"),
            "bldg_usg_cd": meta.get("bldg_usg_cd"),
            "sigun_cd": meta.get("sigun_cd"),
            "click_wgs84": {"longitude": res.click_wgs84[0], "latitude": res.click_wgs84[1]},
        },
        "roof_polygon_4326": res.roof_polygon_4326,
        "roof_area_sqm_5186": round(res.roof_area_sqm, 2),
        "shading": {
            "cell_w_m": CELL_W_DEFAULT,
            "cell_h_m": CELL_H_DEFAULT,
            "cells_total": len(res.cells),
            "cells_with_score": sh.get("count", 0),
            "score_min": sh.get("min"),
            "score_mean": sh.get("mean"),
            "score_max": sh.get("max"),
        },
        "usage_monthly": res.usage or {"labels": [], "electricity_kwh": [], "gas_m3": []},
        "regulation_hits": res.regulation_hits,
        "pv_analysis_input": res.pv_input,
        "pv_analysis_output": res.pv_output,
    }


# ----------------------------- __main__ -----------------------------
CLICK_WGS_DEFAULT = (127.02948714, 37.26726989)
OUT_BASE = "C:/Users/insung/solar-power/data/processed/poc"


def _main() -> None:
    lon, lat = CLICK_WGS_DEFAULT
    print(f"[run_pipeline] click=({lon}, {lat})")
    res = run_pipeline(lon, lat)

    for err in res.errors:
        print(f"  ERROR: {err}")
    if res.meta:
        print(
            f"  meta: unq_id={res.meta.get('unq_id')}, bldg_nm={res.meta.get('bldg_nm')}, "
            f"bldg_hgt={res.meta.get('bldg_hgt')}m"
        )
    print(f"  roof area={res.roof_area_sqm:.1f}sqm, cells={len(res.cells)}")
    if res.shading_stats:
        print(
            f"  shading: min={res.shading_stats['min']:.3f} "
            f"mean={res.shading_stats['mean']:.3f} max={res.shading_stats['max']:.3f}"
        )
    if res.pv_output:
        er = res.pv_output["expected_revenue"]
        print(
            f"  pv: install_kw={er['install_kw']}, "
            f"annual_gen={res.pv_output['annual_generation']:.0f}kWh, "
            f"first_year_revenue={er['first_year_revenue']:,}KRW"
        )

    unq_id = (res.meta or {}).get("unq_id") or "unknown"
    out_dir = f"{OUT_BASE}/{unq_id}"
    os.makedirs(out_dir, exist_ok=True)
    bundle = result_to_bundle(res)
    with open(f"{out_dir}/bundle.json", "w", encoding="utf-8") as f:
        json.dump(bundle, f, ensure_ascii=False, indent=2)
    with open(f"{out_dir}/panels_4326.geojson", "w", encoding="utf-8") as f:
        json.dump(res.panels_geojson, f, ensure_ascii=False)
    print(f"  saved: {out_dir}/bundle.json, panels_4326.geojson")


if __name__ == "__main__":
    _main()
