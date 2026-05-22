"""seed CSV → fixture 일괄 생성. apps/web/public/fixtures/poc/index.json 자동 갱신.

입력:  data/processed/seed_buildings_v1.csv  (분석가가 template 복사 후 좌표 수동 선정)
출력:  apps/web/public/fixtures/poc/{unq_id}/bundle.json
       apps/web/public/fixtures/poc/{unq_id}/panels_4326.geojson
       apps/web/public/fixtures/poc/index.json

실행:
  python scripts/generate_fixture_batch.py
  # 일부만:
  python scripts/generate_fixture_batch.py --only case_01,case_02
"""
from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from poc_rooftop_pipeline import result_to_bundle, run_pipeline

ROOT = Path(__file__).resolve().parents[1]
SEED_CSV = ROOT / "data" / "processed" / "seed_buildings_v1.csv"
FIXTURE_DIR = ROOT / "apps" / "web" / "public" / "fixtures" / "poc"
INDEX_FP = FIXTURE_DIR / "index.json"


def load_seeds(path: Path, only: set[str] | None) -> list[dict[str, Any]]:
    rows = []
    with path.open("r", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if only and row["case_id"] not in only:
                continue
            try:
                row["longitude"] = float(row["longitude"])
                row["latitude"] = float(row["latitude"])
            except ValueError:
                continue
            rows.append(row)
    return rows


def save_fixture(unq_id: str, bundle: dict[str, Any], panels: dict[str, Any]) -> tuple[str, str]:
    out_dir = FIXTURE_DIR / unq_id
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "bundle.json").write_text(
        json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (out_dir / "panels_4326.geojson").write_text(
        json.dumps(panels, ensure_ascii=False), encoding="utf-8"
    )
    return f"{unq_id}/bundle.json", f"{unq_id}/panels_4326.geojson"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed-csv", type=Path, default=SEED_CSV)
    parser.add_argument("--only", type=str, default="", help="콤마구분 case_id 화이트리스트")
    parser.add_argument("--skip-rules", action="store_true", default=True)
    parser.add_argument("--match-radius-m", type=int, default=80)
    args = parser.parse_args()

    only = {x.strip() for x in args.only.split(",") if x.strip()} or None

    if not args.seed_csv.exists():
        raise SystemExit(
            f"seed CSV 없음: {args.seed_csv}\n"
            f"template 복사: cp {args.seed_csv.with_suffix('.template.csv')} {args.seed_csv}"
        )

    seeds = load_seeds(args.seed_csv, only)
    print(f"[seeds] {len(seeds)}건")

    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)

    entries: list[dict[str, Any]] = []
    success, failed = 0, 0

    for seed in seeds:
        cid = seed["case_id"]
        lon, lat = seed["longitude"], seed["latitude"]
        print(f"\n[{cid}] {seed['category']} / {seed['admdong_hint']} ({lon}, {lat})")

        try:
            res = run_pipeline(lon=lon, lat=lat, skip_rule_check=args.skip_rules)
        except Exception as exc:
            print(f"  ERROR: {exc}")
            failed += 1
            continue

        if not res.roof_polygon_4326:
            print(f"  SKIP: 건물 미적중 ({res.errors})")
            failed += 1
            continue

        unq_id = (res.meta or {}).get("unq_id") or f"fallback_{cid}"
        bundle = result_to_bundle(res)
        bundle_path, panels_path = save_fixture(unq_id, bundle, res.panels_geojson)

        entries.append({
            "unq_id": unq_id,
            "case_id": cid,
            "category": seed["category"],
            "admdong_hint": seed["admdong_hint"],
            "bldg_nm": res.meta.get("bldg_nm"),
            "sigun_cd": res.meta.get("sigun_cd"),
            "click_wgs84": {"longitude": lon, "latitude": lat},
            "bundle_path": bundle_path,
            "panels_path": panels_path,
        })
        success += 1
        print(
            f"  OK: {res.meta.get('bldg_nm')} "
            f"area={res.roof_area_sqm:.0f}㎡ cells={len(res.cells)} "
            f"shading_avg={(res.shading_stats or {}).get('mean', 0):.2f}"
        )

    index_payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "match_radius_m": args.match_radius_m,
        "buildings": entries,
    }
    INDEX_FP.write_text(
        json.dumps(index_payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\n[done] success={success} failed={failed}, index={INDEX_FP}")


if __name__ == "__main__":
    main()
