from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

try:
    import joblib
except Exception:  # pragma: no cover - runtime fallback path
    joblib = None


APP_DIR = Path(__file__).resolve().parent
MODEL_DIR = APP_DIR / "models"
GENERATION_MODEL_PATH = MODEL_DIR / "generation_model.joblib"
PAYBACK_MODEL_PATH = MODEL_DIR / "payback_model.joblib"
CLUSTER_MODEL_PATH = MODEL_DIR / "suitability_cluster.joblib"
MODEL_METADATA_PATH = MODEL_DIR / "model_metadata.json"

MODEL_VERSION = "solarmate-simulation-surrogate-rf-kmeans-v1"
TRAINING_DATA_SOURCE = "simulation-derived-seed-data"

FEATURE_COLUMNS = [
    "roof_area_m2",
    "usable_area_m2",
    "usable_ratio",
    "shading_average",
    "green_cell_ratio",
    "yellow_cell_ratio",
    "red_cell_ratio",
    "panel_count",
    "install_capacity_kw",
    "panel_angle_deg",
    "panel_capacity_w",
    "estimated_install_cost_krw",
    "subsidy_estimate_krw",
]

FEATURE_ALIASES = {
    "roof_area_m2": ("roof_area_m2", "roofAreaM2"),
    "usable_area_m2": ("usable_area_m2", "usableAreaM2"),
    "usable_ratio": ("usable_ratio", "usableRatio"),
    "shading_average": ("shading_average", "shadingAverage"),
    "green_cell_ratio": ("green_cell_ratio", "greenCellRatio"),
    "yellow_cell_ratio": ("yellow_cell_ratio", "yellowCellRatio"),
    "red_cell_ratio": ("red_cell_ratio", "redCellRatio"),
    "panel_count": ("panel_count", "panelCount", "panelCountSelected"),
    "install_capacity_kw": ("install_capacity_kw", "installCapacityKw"),
    "panel_angle_deg": ("panel_angle_deg", "panelAngleDeg", "panelAngle"),
    "panel_capacity_w": ("panel_capacity_w", "panelCapacityW"),
    "estimated_install_cost_krw": ("estimated_install_cost_krw", "estimatedInstallCostKrw"),
    "subsidy_estimate_krw": ("subsidy_estimate_krw", "subsidyEstimateKrw"),
}

FEATURE_LABELS = {
    "roof_area_m2": "추정 옥상 면적",
    "usable_area_m2": "패널 배치 가능 면적",
    "usable_ratio": "사용 가능 면적 비율",
    "shading_average": "평균 음영 점수",
    "green_cell_ratio": "녹색 셀 비율",
    "yellow_cell_ratio": "노란색 셀 비율",
    "red_cell_ratio": "붉은 음영 셀 비율",
    "panel_count": "선택 패널 수",
    "install_capacity_kw": "설치 용량",
    "panel_angle_deg": "패널 각도",
    "panel_capacity_w": "패널 단위 출력",
    "estimated_install_cost_krw": "추정 설치비",
    "subsidy_estimate_krw": "추정 보조금",
}

DEFAULT_CLUSTER_LABELS = {
    "priority": {
        "clusterName": "설치 우선형",
        "description": "설치 용량과 녹색 셀 비율이 높고 회수기간이 비교적 짧은 군집입니다.",
    },
    "shading": {
        "clusterName": "음영 주의형",
        "description": "붉은 음영 셀 비율이 높아 패널 배치와 현장 음영 검토가 필요한 군집입니다.",
    },
    "area": {
        "clusterName": "면적 부족형",
        "description": "사용 가능 면적 또는 패널 수가 부족해 설치 규모 검토가 필요한 군집입니다.",
    },
    "economics": {
        "clusterName": "경제성 검토형",
        "description": "비용 또는 회수기간 부담이 커 보조금과 정책자금 검토가 중요한 군집입니다.",
    },
}


def _as_float(value: Any, fallback: float = 0) -> float:
    try:
        next_value = float(value)
    except (TypeError, ValueError):
        return fallback

    return next_value if next_value == next_value else fallback


def _round(value: float, digits: int = 1):
    return round(value, digits)


def _clamp(value: float, min_value: float, max_value: float):
    return min(max_value, max(min_value, value))


def _read_feature(features: dict[str, Any], column: str, fallback: float = 0):
    aliases = FEATURE_ALIASES.get(column, (column,))

    for alias in aliases:
        if alias in features:
            return _as_float(features.get(alias), fallback)

    return fallback


def _feature_map(features: dict[str, Any]):
    values = {column: _read_feature(features, column) for column in FEATURE_COLUMNS}

    if values["usable_ratio"] <= 0 and values["roof_area_m2"] > 0:
        values["usable_ratio"] = values["usable_area_m2"] / values["roof_area_m2"]

    if values["install_capacity_kw"] <= 0 and values["panel_count"] > 0 and values["panel_capacity_w"] > 0:
        values["install_capacity_kw"] = values["panel_count"] * values["panel_capacity_w"] / 1000

    if values["panel_capacity_w"] <= 0:
        values["panel_capacity_w"] = 640

    if values["panel_angle_deg"] <= 0:
        values["panel_angle_deg"] = 35

    return values


def _feature_vector(features: dict[str, Any]):
    values = _feature_map(features)

    return [values[column] for column in FEATURE_COLUMNS]


def _read_metadata_file():
    if not MODEL_METADATA_PATH.exists():
        return {}

    try:
        return json.loads(MODEL_METADATA_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


@lru_cache(maxsize=1)
def load_models():
    metadata = _read_metadata_file()
    base_state = {
        "modelStatus": "loaded",
        "generationModel": None,
        "paybackModel": None,
        "clusterModel": None,
        "metadata": metadata,
        "loadError": None,
    }

    if joblib is None:
        return {
            **base_state,
            "modelStatus": "fallback-no-model-file",
            "loadError": "joblib is not installed; install requirements.txt and run scripts/train_simulation_ai.py.",
        }

    missing_files = [
        str(path.relative_to(APP_DIR))
        for path in [GENERATION_MODEL_PATH, PAYBACK_MODEL_PATH, CLUSTER_MODEL_PATH, MODEL_METADATA_PATH]
        if not path.exists()
    ]

    if missing_files:
        return {
            **base_state,
            "modelStatus": "fallback-no-model-file",
            "missingFiles": missing_files,
        }

    try:
        return {
            **base_state,
            "generationModel": joblib.load(GENERATION_MODEL_PATH),
            "paybackModel": joblib.load(PAYBACK_MODEL_PATH),
            "clusterModel": joblib.load(CLUSTER_MODEL_PATH),
            "metadata": metadata,
        }
    except Exception as error:  # pragma: no cover - corrupt file/dependency fallback
        return {
            **base_state,
            "modelStatus": "fallback-load-error",
            "loadError": f"{type(error).__name__}: {error}",
        }


def _estimate_generation_formula(features: dict[str, Any]):
    values = _feature_map(features)
    existing_generation = _as_float(
        features.get("annualGenerationKwh", features.get("annual_generation_kwh")),
        0,
    )

    if existing_generation > 0:
        return existing_generation

    install_kw = values["install_capacity_kw"]
    shading_factor = _clamp(values["shading_average"] / 3.5 if values["shading_average"] else 0.68, 0.42, 1.08)
    cell_mix_factor = _clamp(
        0.86 + values["green_cell_ratio"] * 0.18 + values["yellow_cell_ratio"] * 0.04 - values["red_cell_ratio"] * 0.18,
        0.55,
        1.05,
    )
    angle_factor = _clamp(1 - abs(values["panel_angle_deg"] - 32) / 100, 0.78, 1.0)

    return max(0, install_kw * 365 * 3.65 * shading_factor * cell_mix_factor * angle_factor)


def _estimate_payback_formula(features: dict[str, Any]):
    existing_payback = _as_float(features.get("paybackYears", features.get("payback_years")), 0)

    if existing_payback > 0:
        return existing_payback

    install_cost = _as_float(
        features.get("estimatedInstallCostKrw", features.get("estimated_install_cost_krw")),
        _read_feature(features, "estimated_install_cost_krw"),
    )
    annual_saving = _as_float(features.get("annualSavingKrw", features.get("annual_saving_krw")), 0)

    if annual_saving <= 0:
        annual_saving = _estimate_generation_formula(features) * 155

    return install_cost / annual_saving if install_cost > 0 and annual_saving > 0 else 0


def _confidence_label(confidence: float):
    if confidence >= 0.8:
        return "높음"

    if confidence >= 0.6:
        return "중간"

    return "낮음"


def _prediction_confidence(features: dict[str, Any], model_loaded: bool):
    red_cell_ratio = _read_feature(features, "red_cell_ratio")
    usable_ratio = _read_feature(features, "usable_ratio")
    confidence = 0.82 if model_loaded else 0.62

    if red_cell_ratio > 0.4:
        confidence -= 0.12
    elif red_cell_ratio > 0.25:
        confidence -= 0.06

    if usable_ratio and usable_ratio < 0.25:
        confidence -= 0.08

    if not bool(features.get("isPreciseRoofData")):
        confidence -= 0.05

    return _round(_clamp(confidence, 0.35, 0.9), 2)


def predict_generation(features: dict[str, Any]):
    state = load_models()
    model = state.get("generationModel")
    model_loaded = state["modelStatus"] == "loaded" and model is not None

    if model_loaded:
        annual_generation_kwh = max(0, float(model.predict([_feature_vector(features)])[0]))
        model_type = "random_forest_surrogate_v1"
    else:
        annual_generation_kwh = _estimate_generation_formula(features)
        model_type = "fallback-formula-v1"

    confidence = _prediction_confidence(features, model_loaded)

    return {
        "modelType": model_type,
        "modelStatus": state["modelStatus"],
        "annualGenerationKwh": round(annual_generation_kwh),
        "monthlyGenerationKwh": round(annual_generation_kwh / 12) if annual_generation_kwh > 0 else 0,
        "confidence": confidence,
        "confidenceLabel": _confidence_label(confidence),
        "trainingDataSource": TRAINING_DATA_SOURCE,
        "isMeasuredGenerationModel": False,
    }


def predict_payback(features: dict[str, Any]):
    state = load_models()
    model = state.get("paybackModel")
    model_loaded = state["modelStatus"] == "loaded" and model is not None

    if model_loaded:
        payback_years = max(0, float(model.predict([_feature_vector(features)])[0]))
        model_type = "random_forest_payback_surrogate_v1"
    else:
        payback_years = _estimate_payback_formula(features)
        model_type = "fallback-payback-formula-v1"

    return {
        "modelType": model_type,
        "modelStatus": state["modelStatus"],
        "paybackYears": _round(payback_years, 1) if payback_years > 0 else 0,
        "trainingDataSource": TRAINING_DATA_SOURCE,
        "isMeasuredGenerationModel": False,
    }


def _fallback_cluster(features: dict[str, Any]):
    values = _feature_map(features)
    payback_years = _estimate_payback_formula(features)

    if values["red_cell_ratio"] >= 0.35:
        label_key = "shading"
    elif values["usable_area_m2"] < 80 or values["panel_count"] < 12:
        label_key = "area"
    elif payback_years > 11 or values["estimated_install_cost_krw"] > 60_000_000:
        label_key = "economics"
    else:
        label_key = "priority"

    label = DEFAULT_CLUSTER_LABELS[label_key]

    return {
        "clusterId": f"fallback-{label_key}",
        "clusterName": label["clusterName"],
        "description": label["description"],
        "modelType": "fallback-rule-cluster-v1",
        "modelStatus": load_models()["modelStatus"],
        "confidence": 0.58,
    }


def classify_building_cluster(features: dict[str, Any]):
    state = load_models()
    cluster_bundle = state.get("clusterModel")

    if state["modelStatus"] != "loaded" or not isinstance(cluster_bundle, dict):
        return _fallback_cluster(features)

    try:
        scaler = cluster_bundle["scaler"]
        model = cluster_bundle["model"]
        label_map = cluster_bundle.get("clusterLabelMap", {})
        cluster_index = int(model.predict(scaler.transform([_feature_vector(features)]))[0])
        cluster_info = label_map.get(str(cluster_index), {})

        return {
            "clusterId": cluster_index,
            "clusterName": cluster_info.get("clusterName") or "설치 유형 확인 필요",
            "description": cluster_info.get("description") or "군집 중심값 해석이 필요한 유형입니다.",
            "modelType": "kmeans_suitability_cluster_v1",
            "modelStatus": state["modelStatus"],
            "confidence": 0.72,
            "centroidSignals": cluster_info.get("centroidSignals", {}),
        }
    except Exception:
        return _fallback_cluster(features)


def _importance_from_model(model: Any):
    if model is None or not hasattr(model, "feature_importances_"):
        return []

    pairs = [
        {
            "feature": column,
            "label": FEATURE_LABELS.get(column, column),
            "importance": _round(float(importance), 4),
        }
        for column, importance in zip(FEATURE_COLUMNS, model.feature_importances_)
    ]

    return sorted(pairs, key=lambda item: item["importance"], reverse=True)


def get_feature_importance():
    state = load_models()

    if state["modelStatus"] == "loaded":
        return {
            "generation": _importance_from_model(state.get("generationModel")),
            "payback": _importance_from_model(state.get("paybackModel")),
        }

    fallback_importance = [
        {"feature": "install_capacity_kw", "label": FEATURE_LABELS["install_capacity_kw"], "importance": 0.32},
        {"feature": "shading_average", "label": FEATURE_LABELS["shading_average"], "importance": 0.24},
        {"feature": "green_cell_ratio", "label": FEATURE_LABELS["green_cell_ratio"], "importance": 0.17},
        {"feature": "red_cell_ratio", "label": FEATURE_LABELS["red_cell_ratio"], "importance": 0.13},
        {"feature": "panel_angle_deg", "label": FEATURE_LABELS["panel_angle_deg"], "importance": 0.08},
    ]

    return {
        "generation": fallback_importance,
        "payback": fallback_importance,
    }


def build_model_metadata():
    state = load_models()
    metadata = state.get("metadata") if isinstance(state.get("metadata"), dict) else {}

    return {
        "modelVersion": metadata.get("modelVersion", MODEL_VERSION),
        "modelStatus": state["modelStatus"],
        "trainingDataSource": metadata.get("trainingDataSource", TRAINING_DATA_SOURCE),
        "isMeasuredGenerationModel": False,
        "disclosure": [
            "시뮬레이션 기반 대리 회귀 모델",
            "설명 가능한 AI 점수화",
            "실측 데이터 누적 시 고도화 가능",
        ],
        "models": {
            "generation": {
                "type": "RandomForestRegressor",
                "runtimeModelType": "random_forest_surrogate_v1"
                if state["modelStatus"] == "loaded"
                else "fallback-formula-v1",
                "target": "annual_generation_kwh",
            },
            "payback": {
                "type": "RandomForestRegressor",
                "runtimeModelType": "random_forest_payback_surrogate_v1"
                if state["modelStatus"] == "loaded"
                else "fallback-payback-formula-v1",
                "target": "payback_years",
            },
            "suitabilityCluster": {
                "type": "KMeans",
                "runtimeModelType": "kmeans_suitability_cluster_v1"
                if state["modelStatus"] == "loaded"
                else "fallback-rule-cluster-v1",
            },
        },
        "featureColumns": metadata.get("featureColumns", FEATURE_COLUMNS),
        "rowCount": metadata.get("rowCount"),
        "trainedAt": metadata.get("trainedAt"),
        "limitations": metadata.get(
            "limitations",
            [
                "현재 모델은 실측 발전량이 아닌 시뮬레이션 파생 seed data로 학습되었습니다.",
                "음영, 구조안전성, 관리주체 협의, 최신 보조금 공고 확인이 필요합니다.",
            ],
        ),
        "loadError": state.get("loadError"),
    }
