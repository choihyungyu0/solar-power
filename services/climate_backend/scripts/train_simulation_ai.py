from __future__ import annotations

import csv
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
APP_DIR = ROOT_DIR / "app"
DATA_DIR = ROOT_DIR / "data"
MODEL_DIR = APP_DIR / "models"
TRAINING_SAMPLE_PATH = DATA_DIR / "simulation_training_samples.csv"

sys.path.insert(0, str(ROOT_DIR))
os.environ.setdefault("LOKY_MAX_CPU_COUNT", "1")

try:
    import joblib
    from sklearn.cluster import KMeans
    from sklearn.ensemble import RandomForestRegressor
    from sklearn.preprocessing import StandardScaler
except ModuleNotFoundError as error:
    raise SystemExit(
        "scikit-learn/joblib is required. Run `python -m pip install -r requirements.txt` "
        "from services/climate_backend, then retry this script."
    ) from error

from app.ml_simulation_model import FEATURE_COLUMNS, MODEL_VERSION, TRAINING_DATA_SOURCE


TARGET_GENERATION = "annual_generation_kwh"
TARGET_PAYBACK = "payback_years"


def clamp(value: float, min_value: float, max_value: float):
    return min(max_value, max(min_value, value))


def round_krw(value: float):
    return int(round(value / 10_000) * 10_000)


def generate_seed_samples():
    rows = []
    building_index = 1
    roof_areas = [95, 140, 190, 260, 360, 520, 740, 980]
    shading_profiles = [
        (3.42, 0.72, 0.21, 0.07),
        (3.12, 0.58, 0.31, 0.11),
        (2.78, 0.43, 0.39, 0.18),
        (2.35, 0.27, 0.45, 0.28),
        (1.88, 0.14, 0.36, 0.50),
    ]

    for roof_area in roof_areas:
        for shading_average, green_ratio, yellow_ratio, red_ratio in shading_profiles:
            usable_ratio = clamp(0.34 + green_ratio * 0.22 + yellow_ratio * 0.08 - red_ratio * 0.16, 0.16, 0.68)
            usable_area = roof_area * usable_ratio
            panel_capacity_w = 640 if building_index % 3 != 0 else 500
            panel_angle = [25, 30, 35][building_index % 3]
            panel_count = max(4, int(usable_area / 3.5 / 2))
            install_kw = panel_count * panel_capacity_w / 1000
            angle_factor = clamp(1 - abs(panel_angle - 32) / 100, 0.78, 1.0)
            shading_factor = clamp(shading_average / 3.5, 0.45, 1.04)
            cell_mix_factor = clamp(0.87 + green_ratio * 0.18 + yellow_ratio * 0.04 - red_ratio * 0.17, 0.55, 1.05)
            annual_generation = install_kw * 365 * 3.65 * shading_factor * angle_factor * cell_mix_factor
            install_cost = install_kw * (1_230_000 + (80_000 if roof_area < 200 else 0))
            subsidy = min(install_cost * (0.45 if green_ratio >= 0.35 else 0.35), 30_000_000)
            annual_saving = annual_generation * 155
            payback_years = install_cost / annual_saving if annual_saving > 0 else 0

            rows.append(
                {
                    "building_id": f"seed-{building_index:03d}",
                    "roof_area_m2": round(roof_area, 2),
                    "usable_area_m2": round(usable_area, 2),
                    "usable_ratio": round(usable_ratio, 3),
                    "shading_average": round(shading_average, 2),
                    "green_cell_ratio": round(green_ratio, 3),
                    "yellow_cell_ratio": round(yellow_ratio, 3),
                    "red_cell_ratio": round(red_ratio, 3),
                    "panel_count": panel_count,
                    "install_capacity_kw": round(install_kw, 1),
                    "panel_angle_deg": panel_angle,
                    "panel_capacity_w": panel_capacity_w,
                    "estimated_install_cost_krw": round_krw(install_cost),
                    "subsidy_estimate_krw": round_krw(subsidy),
                    "annual_generation_kwh": round(annual_generation),
                    "annual_saving_krw": round_krw(annual_saving),
                    "payback_years": round(payback_years, 1),
                }
            )
            building_index += 1

    return rows


def ensure_seed_samples():
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    if TRAINING_SAMPLE_PATH.exists():
        return

    rows = generate_seed_samples()

    with TRAINING_SAMPLE_PATH.open("w", newline="", encoding="utf-8") as output:
        writer = csv.DictWriter(output, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def read_training_samples():
    ensure_seed_samples()

    with TRAINING_SAMPLE_PATH.open(newline="", encoding="utf-8") as source:
        rows = list(csv.DictReader(source))

    if len(rows) < 12:
        raise ValueError("At least 12 simulation training rows are required.")

    return rows


def to_float(row: dict[str, str], column: str):
    return float(row[column])


def make_matrix(rows: list[dict[str, str]]):
    return [[to_float(row, column) for column in FEATURE_COLUMNS] for row in rows]


def make_target(rows: list[dict[str, str]], column: str):
    return [to_float(row, column) for row in rows]


def mean(values: list[float]):
    return sum(values) / len(values) if values else 0


def build_cluster_label_map(kmeans: KMeans, scaler: StandardScaler):
    centers = scaler.inverse_transform(kmeans.cluster_centers_)
    centroid_rows: dict[int, dict[str, float]] = {
        index: {column: float(value) for column, value in zip(FEATURE_COLUMNS, center)}
        for index, center in enumerate(centers)
    }
    remaining = set(centroid_rows)
    cluster_label_map: dict[str, dict[str, object]] = {}

    def assign(label_key: str, cluster_index: int):
        if cluster_index not in remaining:
            return False

        labels = {
            "priority": (
                "설치 우선형",
                "설치 용량과 녹색 셀 비율이 높고 회수기간이 비교적 짧은 군집입니다.",
            ),
            "shading": (
                "음영 주의형",
                "붉은 음영 셀 비율이 높아 패널 배치와 현장 음영 검토가 필요한 군집입니다.",
            ),
            "area": (
                "면적 부족형",
                "사용 가능 면적 또는 패널 수가 부족해 설치 규모 검토가 필요한 군집입니다.",
            ),
            "economics": (
                "경제성 검토형",
                "비용 또는 회수기간 부담이 커 보조금과 정책자금 검토가 중요한 군집입니다.",
            ),
        }
        cluster_name, description = labels[label_key]
        centroid = centroid_rows[cluster_index]
        cluster_label_map[str(cluster_index)] = {
            "clusterName": cluster_name,
            "description": description,
            "centroidSignals": {
                "installCapacityKw": round(centroid["install_capacity_kw"], 1),
                "greenCellRatio": round(centroid["green_cell_ratio"], 3),
                "redCellRatio": round(centroid["red_cell_ratio"], 3),
                "usableAreaM2": round(centroid["usable_area_m2"], 1),
                "estimatedInstallCostKrw": round(centroid["estimated_install_cost_krw"]),
            },
        }
        remaining.remove(cluster_index)
        return True

    priority_scores = {
        index: (
            row["install_capacity_kw"] / 40
            + row["green_cell_ratio"] * 1.8
            - row["red_cell_ratio"] * 1.2
            - row["estimated_install_cost_krw"] / 120_000_000
        )
        for index, row in centroid_rows.items()
    }
    assign("priority", max(priority_scores, key=priority_scores.get))

    if remaining:
        assign("shading", max(remaining, key=lambda index: centroid_rows[index]["red_cell_ratio"]))

    if remaining:
        area_scores = {
            index: centroid_rows[index]["usable_area_m2"] + centroid_rows[index]["panel_count"] * 4
            for index in remaining
        }
        assign("area", min(area_scores, key=area_scores.get))

    if remaining:
        cost_scores = {
            index: centroid_rows[index]["estimated_install_cost_krw"] + centroid_rows[index]["subsidy_estimate_krw"] * 0.25
            for index in remaining
        }
        assign("economics", max(cost_scores, key=cost_scores.get))

    for index in list(remaining):
        assign("economics", index)

    return cluster_label_map


def train():
    rows = read_training_samples()
    x = make_matrix(rows)
    y_generation = make_target(rows, TARGET_GENERATION)
    y_payback = make_target(rows, TARGET_PAYBACK)

    generation_model = RandomForestRegressor(
        n_estimators=160,
        max_depth=8,
        min_samples_leaf=2,
        random_state=42,
    )
    generation_model.fit(x, y_generation)

    payback_model = RandomForestRegressor(
        n_estimators=140,
        max_depth=8,
        min_samples_leaf=2,
        random_state=43,
    )
    payback_model.fit(x, y_payback)

    scaler = StandardScaler()
    x_scaled = scaler.fit_transform(x)
    cluster_count = min(4, len(rows))
    kmeans = KMeans(n_clusters=cluster_count, random_state=44, n_init=10)
    kmeans.fit(x_scaled)
    cluster_label_map = build_cluster_label_map(kmeans, scaler)

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(generation_model, MODEL_DIR / "generation_model.joblib")
    joblib.dump(payback_model, MODEL_DIR / "payback_model.joblib")
    joblib.dump(
        {
            "model": kmeans,
            "scaler": scaler,
            "clusterLabelMap": cluster_label_map,
        },
        MODEL_DIR / "suitability_cluster.joblib",
    )

    metadata = {
        "modelVersion": MODEL_VERSION,
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "trainingDataSource": TRAINING_DATA_SOURCE,
        "isMeasuredGenerationModel": False,
        "rowCount": len(rows),
        "featureColumns": FEATURE_COLUMNS,
        "targetColumns": [TARGET_GENERATION, TARGET_PAYBACK],
        "modelTypes": {
            "generation": "RandomForestRegressor",
            "payback": "RandomForestRegressor",
            "suitabilityCluster": "KMeans",
        },
        "trainingSummary": {
            "annualGenerationKwhMean": round(mean(y_generation), 1),
            "paybackYearsMean": round(mean(y_payback), 2),
            "annualGenerationKwhMin": round(min(y_generation), 1),
            "annualGenerationKwhMax": round(max(y_generation), 1),
        },
        "clusterLabelMap": cluster_label_map,
        "limitations": [
            "현재 모델은 실측 발전량이 아닌 시뮬레이션 파생 seed data로 학습되었습니다.",
            "시뮬레이션 기반 대리 회귀 모델이므로 현장 장애물, 구조안전성, 계통연계 조건을 직접 보증하지 않습니다.",
            "실측 데이터 누적 시 고도화 가능하며, 현재 결과는 상담 우선순위와 설명 가능한 AI 점수화에 사용합니다.",
        ],
    }
    (MODEL_DIR / "model_metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(
        json.dumps(
            {
                "ok": True,
                "rowCount": len(rows),
                "trainingDataSource": TRAINING_DATA_SOURCE,
                "isMeasuredGenerationModel": False,
                "modelDir": str(MODEL_DIR),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    train()
