"""화성 footprint GeoJSON 의 각 건물 centroid 좌표로 WFS TM_BLDG_INFO 일괄 호출 → unq_id 등 메타 추가.

입력:  data/processed/hwaseong_buildings_v1.geojson
출력:  data/processed/hwaseong_buildings_v2_enriched.geojson
중간:  data/processed/.wfs_enrich_progress.jsonl  (재시작 가능)

특징:
- 건물별 1회 WFS 호출 → 추가 컬럼: unq_id, bldg_nm, bldg_hgt, bdar, bldg_nofl, bldg_usg_cd, use_aprv_ymd, sigun_cd
- 진행 상황을 JSONL 로 적재. 중단 후 재실행 시 이미 처리한 건물 스킵.
- climate.gg rate limit 보호: 5 req/sec 슬리프.

실행:
  cd C:\\Users\\insung\\solar-power
  python scripts/enrich_buildings_with_wfs.py

소요 (참고): 화성시 약 10만 채 가정 시 약 6시간 (5 req/sec). 야간 배치 권장.
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any

import requests
from pyproj import Transformer
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[1]
INPUT_FP = ROOT / "data" / "processed" / "hwaseong_buildings_v1.geojson"
OUTPUT_FP = ROOT / "data" / "processed" / "hwaseong_buildings_v2_enriched.geojson"
PROGRESS_FP = ROOT / "data" / "processed" / ".wfs_enrich_progress.jsonl"

WFS_BASE = (
    "https://climate.gg.go.kr/geoserver/spggcee/ows"
    "?service=WFS&version=1.0.0&request=GetFeature"
    "&typeName=spggcee:TM_BLDG_INFO&outputFormat=application/json&SRS=EPSG:5186"
)
HEADERS = {"User-Agent": "solarmate-enrich/0.1"}

to_5186 = Transformer.from_crs("EPSG:4326", "EPSG:5186", always_xy=True)

WFS_KEEP_KEYS = ("unq_id", "bldg_nm", "bldg_hgt", "bdar", "bldg_nofl",
                 "bldg_usg_cd", "use_aprv_ymd", "sigun_cd")


def load_progress() -> dict[str, dict[str, Any]]:
    if not PROGRESS_FP.exists():
        return {}
    out: dict[str, dict[str, Any]] = {}
    with PROGRESS_FP.open("r", encoding="utf-8") as f:
        for line in f:
            try:
                row = json.loads(line)
                out[row["fid"]] = row
            except Exception:
                continue
    return out


def append_progress(row: dict[str, Any]) -> None:
    with PROGRESS_FP.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def call_wfs(x5186: float, y5186: float, timeout: float = 10.0) -> dict[str, Any]:
    url = f"{WFS_BASE}&CQL_FILTER=INTERSECTS(shape,%20Point({x5186}%20{y5186}))"
    r = requests.get(url, headers=HEADERS, timeout=timeout)
    r.raise_for_status()
    features = r.json().get("features", [])
    if not features:
        return {}
    props = features[0].get("properties", {}) or {}
    return {k: props.get(k) for k in WFS_KEEP_KEYS}


def feature_centroid_wgs84(feature: dict[str, Any]) -> tuple[float, float] | None:
    try:
        geom = shape(feature["geometry"])
        c = geom.centroid
        return (float(c.x), float(c.y))
    except Exception:
        return None


def feature_id(feature: dict[str, Any], idx: int) -> str:
    props = feature.get("properties") or {}
    for key in ("bld_id", "id", "fid", "BLD_ID"):
        if props.get(key):
            return str(props[key])
    if feature.get("id"):
        return str(feature["id"])
    return f"idx_{idx}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0, help="처리할 최대 건물 수 (0=전체)")
    parser.add_argument("--rate", type=float, default=5.0, help="초당 호출 상한 (기본 5)")
    parser.add_argument("--input", type=Path, default=INPUT_FP)
    parser.add_argument("--output", type=Path, default=OUTPUT_FP)
    args = parser.parse_args()

    if not args.input.exists():
        raise SystemExit(f"입력 파일 없음: {args.input}")

    print(f"[load] {args.input}")
    geojson = json.loads(args.input.read_text(encoding="utf-8"))
    features = geojson.get("features", [])
    total = len(features)
    print(f"[load] features={total:,}")

    progress = load_progress()
    print(f"[resume] 이미 처리: {len(progress):,}")

    interval = 1.0 / max(0.1, args.rate)
    target_features = features if args.limit == 0 else features[: args.limit]
    enriched_features: list[dict[str, Any]] = []

    hits, misses, errors = 0, 0, 0
    t_start = time.monotonic()

    for idx, feat in enumerate(target_features):
        fid = feature_id(feat, idx)

        if fid in progress:
            wfs_props = progress[fid].get("wfs") or {}
        else:
            centroid = feature_centroid_wgs84(feat)
            if centroid is None:
                wfs_props = {}
                append_progress({"fid": fid, "wfs": {}, "error": "no_centroid"})
                errors += 1
            else:
                x5186, y5186 = to_5186.transform(centroid[0], centroid[1])
                try:
                    wfs_props = call_wfs(x5186, y5186)
                    if wfs_props.get("unq_id"):
                        hits += 1
                    else:
                        misses += 1
                    append_progress({"fid": fid, "wfs": wfs_props})
                except Exception as exc:
                    errors += 1
                    append_progress({"fid": fid, "wfs": {}, "error": str(exc)[:200]})
                    wfs_props = {}
                time.sleep(interval)

        new_props = dict(feat.get("properties") or {})
        for k in WFS_KEEP_KEYS:
            if wfs_props.get(k) is not None:
                new_props[f"wfs_{k}"] = wfs_props[k]
        enriched_features.append({**feat, "properties": new_props})

        if (idx + 1) % 100 == 0:
            elapsed = time.monotonic() - t_start
            rate = (idx + 1) / elapsed if elapsed > 0 else 0
            eta_sec = (len(target_features) - idx - 1) / rate if rate > 0 else 0
            print(
                f"[{idx + 1:>7,}/{len(target_features):,}] hits={hits} misses={misses} "
                f"errors={errors} rate={rate:.1f}/s eta={eta_sec / 60:.1f}min"
            )

    out_payload = {"type": "FeatureCollection", "features": enriched_features}
    args.output.write_text(
        json.dumps(out_payload, ensure_ascii=False), encoding="utf-8"
    )
    elapsed = time.monotonic() - t_start
    print(
        f"\n[done] saved={args.output} "
        f"processed={len(target_features):,} hits={hits} misses={misses} errors={errors} "
        f"elapsed={elapsed / 60:.1f}min"
    )


if __name__ == "__main__":
    main()
