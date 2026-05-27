"""climate.gg API 안정성 sweep — 본선 직전 안전판.

7종 sweep 결과를 CSV로 저장하고, 요약 메모를 마크다운으로 출력.

산출:
  data/processed/sweep/repeat_same_coord.csv
  data/processed/sweep/random_hwaseong_coords.csv
  data/processed/sweep/coord_jitter.csv
  data/processed/sweep/cell_count_scaling.csv
  data/processed/sweep/pv_param_sweep.csv
  data/processed/sweep/hourly_availability.csv
  data/processed/sweep/panel_type_compare.csv
  docs/api_stability_report.md  (요약)

실행:
  python scripts/api_stability_sweep.py --all
  python scripts/api_stability_sweep.py --only repeat,jitter   # 일부만
"""
from __future__ import annotations

import argparse
import datetime as dt
import random
import statistics
import time
from pathlib import Path

import pandas as pd

from poc_rooftop_pipeline import (
    call_pv_analysis,
    generate_cells,
    select_buld,
    select_sun_list,
    transform_click_to_5186,
)

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "data" / "processed" / "sweep"
OUT_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_CLICK = (127.02948714, 37.26726989)
HWASEONG_LON_RANGE = (126.65, 127.20)
HWASEONG_LAT_RANGE = (37.00, 37.30)


def sweep_repeat_same_coord(n: int = 50) -> pd.DataFrame:
    lon, lat = DEFAULT_CLICK
    x, y = transform_click_to_5186(lon, lat)
    roof = select_buld(x, y)
    if not roof:
        return pd.DataFrame()
    cells = generate_cells(roof)
    rows = []
    for i in range(n):
        t0 = time.monotonic()
        try:
            shading = select_sun_list(cells)
            vals = list(shading.values())
            rows.append({
                "iter": i, "ok": True, "latency_ms": int((time.monotonic() - t0) * 1000),
                "cells_returned": len(vals),
                "shading_mean": statistics.mean(vals) if vals else None,
                "shading_min": min(vals) if vals else None,
                "shading_max": max(vals) if vals else None,
            })
        except Exception as exc:
            rows.append({"iter": i, "ok": False, "error": str(exc)[:120]})
        time.sleep(0.2)
    return pd.DataFrame(rows)


def sweep_random_hwaseong(n: int = 100, seed: int = 42) -> pd.DataFrame:
    rng = random.Random(seed)
    rows = []
    for i in range(n):
        lon = rng.uniform(*HWASEONG_LON_RANGE)
        lat = rng.uniform(*HWASEONG_LAT_RANGE)
        x, y = transform_click_to_5186(lon, lat)
        t0 = time.monotonic()
        try:
            roof = select_buld(x, y)
            rows.append({
                "iter": i, "lon": lon, "lat": lat,
                "found": roof is not None,
                "area_sqm": float(roof.area) if roof else 0.0,
                "latency_ms": int((time.monotonic() - t0) * 1000),
                "error": None,
            })
        except Exception as exc:
            rows.append({"iter": i, "lon": lon, "lat": lat, "found": False,
                         "area_sqm": 0.0, "latency_ms": 0, "error": str(exc)[:120]})
        time.sleep(0.2)
    return pd.DataFrame(rows)


def sweep_coord_jitter(steps: int = 9) -> pd.DataFrame:
    lon, lat = DEFAULT_CLICK
    rows = []
    for dx in range(-steps // 2, steps // 2 + 1):
        for dy in range(-steps // 2, steps // 2 + 1):
            offset_lon = lon + dx * 1e-5
            offset_lat = lat + dy * 1e-5
            try:
                x, y = transform_click_to_5186(offset_lon, offset_lat)
                roof = select_buld(x, y)
                rows.append({
                    "dx_deg": dx * 1e-5, "dy_deg": dy * 1e-5,
                    "found": roof is not None,
                    "area_sqm": float(roof.area) if roof else 0.0,
                })
            except Exception as exc:
                rows.append({"dx_deg": dx * 1e-5, "dy_deg": dy * 1e-5,
                             "found": False, "area_sqm": 0.0, "error": str(exc)[:120]})
            time.sleep(0.2)
    return pd.DataFrame(rows)


def sweep_pv_params() -> pd.DataFrame:
    lon, lat = DEFAULT_CLICK
    rows = []
    for capacity in (500, 640):
        for angle in ("30", "35"):
            for shading in (1.0, 2.0, 3.0, 4.0):
                try:
                    _, data = call_pv_analysis(lon, lat, shading_avg=shading,
                                               panel_count=100, panel_capacity_w=capacity,
                                               angle=angle)
                    rows.append({
                        "capacity_w": capacity, "angle": angle, "shading_avg": shading,
                        "install_kw": data["expected_revenue"]["install_kw"],
                        "annual_gen_kwh": data["annual_generation"],
                        "first_year_revenue": data["expected_revenue"]["first_year_revenue"],
                    })
                except Exception as exc:
                    rows.append({"capacity_w": capacity, "angle": angle, "shading_avg": shading,
                                 "error": str(exc)[:120]})
                time.sleep(0.2)
    return pd.DataFrame(rows)


def sweep_panel_type() -> pd.DataFrame:
    lon, lat = DEFAULT_CLICK
    rows = []
    for ptype in (1, 2, 3):
        try:
            _, data = call_pv_analysis(lon, lat, shading_avg=3.0, panel_count=100,
                                       panel_capacity_w=640, panel_type=ptype)
            rows.append({
                "panel_type": ptype, "ok": True,
                "install_kw": data["expected_revenue"]["install_kw"],
                "annual_gen_kwh": data["annual_generation"],
            })
        except Exception as exc:
            rows.append({"panel_type": ptype, "ok": False, "error": str(exc)[:120]})
        time.sleep(0.2)
    return pd.DataFrame(rows)


def write_report(results: dict[str, pd.DataFrame]) -> None:
    md = [
        "# climate.gg API 안정성 sweep 보고서",
        "",
        f"실행 일시: {dt.datetime.now().isoformat()}",
        "",
        "## 요약",
        "",
    ]
    repeat = results.get("repeat")
    if repeat is not None and not repeat.empty:
        ok_rate = repeat["ok"].mean() * 100
        avg_lat = repeat[repeat["ok"]]["latency_ms"].mean() if repeat["ok"].any() else 0
        md.append(f"- **동일좌표 반복**: 성공률 {ok_rate:.1f}%, 평균 지연 {avg_lat:.0f}ms")
        if repeat["ok"].any():
            shading_std = repeat[repeat["ok"]]["shading_mean"].std()
            md.append(f"  - shading_mean 표준편차 {shading_std:.4f} (결정론성 확인)")

    rand = results.get("random")
    if rand is not None and not rand.empty:
        hit_rate = rand["found"].mean() * 100
        md.append(f"- **화성 무작위 좌표**: 적중률 {hit_rate:.1f}% ({len(rand)}건 중)")

    jitter = results.get("jitter")
    if jitter is not None and not jitter.empty:
        unique_areas = jitter[jitter["found"]]["area_sqm"].nunique()
        md.append(f"- **좌표 미세 이동**: 옥상 polygon 종류 수 {unique_areas}")

    pv = results.get("pv")
    if pv is not None and not pv.empty and "ok" not in pv.columns:
        ok_pv = len(pv.dropna(subset=["install_kw"]))
        md.append(f"- **pv 파라미터 sweep**: 성공 {ok_pv}/{len(pv)}건")

    md += [
        "",
        "## 결론 (해석은 분석가가 직접 작성)",
        "",
        "- climate.gg API 결정론성 / rate limit / 적중률 확인 결과로",
        "  운영용 timeout, retry, fallback 정책을 정리할 것.",
        "",
        "## 데이터셋",
        "",
        f"- repeat: `data/processed/sweep/repeat_same_coord.csv`",
        f"- random: `data/processed/sweep/random_hwaseong_coords.csv`",
        f"- jitter: `data/processed/sweep/coord_jitter.csv`",
        f"- pv params: `data/processed/sweep/pv_param_sweep.csv`",
        f"- panel type: `data/processed/sweep/panel_type_compare.csv`",
    ]
    (ROOT / "docs" / "api_stability_report.md").write_text("\n".join(md), encoding="utf-8")


SWEEPS = {
    "repeat": (sweep_repeat_same_coord, "repeat_same_coord.csv"),
    "random": (sweep_random_hwaseong, "random_hwaseong_coords.csv"),
    "jitter": (sweep_coord_jitter, "coord_jitter.csv"),
    "pv": (sweep_pv_params, "pv_param_sweep.csv"),
    "panel": (sweep_panel_type, "panel_type_compare.csv"),
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--only", type=str, default="")
    args = parser.parse_args()

    chosen = set(args.only.split(",")) if args.only else set(SWEEPS.keys())
    if not args.all and not args.only:
        chosen = {"repeat", "jitter"}

    results = {}
    for name, (func, filename) in SWEEPS.items():
        if name not in chosen:
            continue
        print(f"\n=== sweep: {name} ===")
        try:
            df = func()
            df.to_csv(OUT_DIR / filename, index=False, encoding="utf-8")
            results[name] = df
            print(f"  saved -> {OUT_DIR / filename} ({len(df)} rows)")
        except Exception as exc:
            print(f"  ERROR: {exc}")

    write_report(results)
    print(f"\n[done] report -> docs/api_stability_report.md")


if __name__ == "__main__":
    main()
