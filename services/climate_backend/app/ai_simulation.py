from __future__ import annotations

from typing import Any

from .ml_simulation_model import (
    build_model_metadata,
    classify_building_cluster,
    get_feature_importance,
    predict_generation,
    predict_payback,
)


GRADE_LABELS = {
    "S": "최우선 설치 후보",
    "A": "설치 우선 검토",
    "B": "설치 가능성 양호",
    "C": "조건부 검토",
    "D": "설치 신중 검토",
}

MONTHLY_GENERATION_WEIGHTS = [
    0.072,
    0.079,
    0.092,
    0.101,
    0.107,
    0.104,
    0.097,
    0.096,
    0.087,
    0.073,
    0.049,
    0.043,
]
SUBSIDY_PROGRAM_NAME = "경기 주택태양광 지원사업"
SUBSIDY_POLICY_MODE = "gyeonggi_home_solar_only"
SUBSIDY_STACKING_REASON = "경기 주택태양광 지원사업 기준 단일 보조금 산정"
FIELD_CHECK_REQUIRED = [
    "옥상 장애물",
    "구조안전성",
    "방수 상태",
    "관리주체 협의",
    "실제 공고 및 예산 잔여 여부",
]


def clamp(value, min_value, max_value):
    return min(max_value, max(min_value, value))


def _as_float(value: Any, fallback: float = 0) -> float:
    try:
        next_value = float(value)
    except (TypeError, ValueError):
        return fallback

    return next_value if next_value == next_value else fallback


def _as_int(value: Any, fallback: int = 0) -> int:
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return fallback


def _round(value: float, digits: int = 1):
    return round(value, digits)


def _money(value: Any):
    return round(_as_float(value))


def _monthly_generation_series(annual_generation_kwh: float):
    return [round(annual_generation_kwh * weight) for weight in MONTHLY_GENERATION_WEIGHTS]


def _usable_ratio(input: dict[str, Any]):
    roof_area_m2 = _as_float(input.get("roofAreaM2"))
    usable_area_m2 = _as_float(input.get("usableAreaM2"))

    return _round(usable_area_m2 / roof_area_m2, 3) if roof_area_m2 > 0 else 0


def calculate_shading_ratios(panels_geojson):
    features = []

    if isinstance(panels_geojson, dict):
        features = panels_geojson.get("features") or []

    scores: list[float] = []

    for feature in features:
        if not isinstance(feature, dict):
            continue

        properties = feature.get("properties") or {}

        if not isinstance(properties, dict):
            continue

        score = _as_float(properties.get("shading_score"), -1)

        if score >= 0:
            scores.append(score)

    total = len(scores)

    if total == 0:
        return {
            "greenCellRatio": 0,
            "yellowCellRatio": 0,
            "redCellRatio": 0,
            "greenCellCount": 0,
            "yellowCellCount": 0,
            "redCellCount": 0,
            "cellCount": 0,
        }

    green = len([score for score in scores if score >= 3.0])
    yellow = len([score for score in scores if 1.5 <= score < 3.0])
    red = total - green - yellow

    return {
        "greenCellRatio": _round(green / total, 3),
        "yellowCellRatio": _round(yellow / total, 3),
        "redCellRatio": _round(red / total, 3),
        "greenCellCount": green,
        "yellowCellCount": yellow,
        "redCellCount": red,
        "cellCount": total,
    }


def _get_grade(score: float):
    if score >= 90:
        return "S"

    if score >= 80:
        return "A"

    if score >= 70:
        return "B"

    if score >= 60:
        return "C"

    return "D"


def _build_warnings(input: dict[str, Any]):
    warnings: list[str] = []

    if _as_float(input.get("redCellRatio")) > 0.4:
        warnings.append("음영이 높은 영역이 많아 패널 배치 조정이 필요합니다.")

    if _as_float(input.get("paybackYears")) > 12:
        warnings.append("예상 회수기간이 길어 보조금/정책자금 검토가 필요합니다.")

    if _as_int(input.get("panelCountSelected")) < 10:
        warnings.append("설치 가능한 패널 수가 적어 경제성이 낮을 수 있습니다.")

    if not bool(input.get("isPreciseRoofData")):
        warnings.append("실제 옥상 polygon이 아닌 건물 footprint 기반 추정입니다.")

    return warnings


def _build_reasons(input: dict[str, Any]):
    reasons: list[str] = []
    green_cell_ratio = _as_float(input.get("greenCellRatio"))
    usable_area_m2 = _as_float(input.get("usableAreaM2"))
    annual_generation_kwh = _as_float(input.get("annualGenerationKwh"))
    payback_years = _as_float(input.get("paybackYears"))
    install_capacity_kw = _as_float(input.get("installCapacityKw"))

    if green_cell_ratio >= 0.6:
        reasons.append("음영이 낮은 녹색 셀 비중이 높아 배치 품질이 양호한 것으로 추정됩니다.")
    elif green_cell_ratio >= 0.35:
        reasons.append("음영이 낮은 셀을 우선 활용하면 발전량 확보 가능성이 있습니다.")

    if usable_area_m2 >= 200:
        reasons.append("추정 사용 가능 면적이 충분해 공동주택 규모 설치 검토에 유리합니다.")
    elif usable_area_m2 >= 80:
        reasons.append("일부 공용부하 절감을 목표로 한 소규모 설치 검토가 가능합니다.")

    if annual_generation_kwh >= 30_000:
        reasons.append("예상 연간 발전량이 높아 공용 전기요금 절감 효과가 기대됩니다.")
    elif annual_generation_kwh >= 10_000:
        reasons.append("예상 연간 발전량이 일정 수준 이상으로 산정되었습니다.")

    if 0 < payback_years <= 8:
        reasons.append("예상 단순 회수기간이 비교적 합리적인 범위로 추정됩니다.")
    elif 8 < payback_years <= 12:
        reasons.append("보조금 조건을 함께 검토하면 예상 회수기간 개선 여지가 있습니다.")

    if install_capacity_kw >= 20:
        reasons.append("권장 설치용량이 공동주택 공용부하 대응에 의미 있는 규모로 추정됩니다.")
    elif install_capacity_kw >= 5:
        reasons.append("권장 설치용량이 시범 설치 검토 가능한 규모로 추정됩니다.")

    if not reasons:
        reasons.append("현재 입력값 기준으로 현장조사와 정책자금 검토가 우선 필요합니다.")

    return reasons


def calculate_suitability_score(input):
    shading_average = _as_float(input.get("shadingAverage"))
    green_cell_ratio = _as_float(input.get("greenCellRatio"))
    yellow_cell_ratio = _as_float(input.get("yellowCellRatio"))
    red_cell_ratio = _as_float(input.get("redCellRatio"))
    usable_area_m2 = _as_float(input.get("usableAreaM2"))
    panel_count_selected = _as_int(input.get("panelCountSelected"))
    install_capacity_kw = _as_float(input.get("installCapacityKw"))
    annual_generation_kwh = _as_float(input.get("annualGenerationKwh"))
    annual_saving_krw = _as_float(input.get("annualSavingKrw"))
    payback_years = _as_float(input.get("paybackYears"))
    original_cell_count = _as_float(input.get("originalCellCount"))
    used_cell_count = _as_float(input.get("usedCellCount"))

    shading_average_factor = clamp((shading_average - 1.0) / 2.5, 0, 1)
    shading_ratio_factor = clamp(green_cell_ratio + yellow_cell_ratio * 0.45 - red_cell_ratio * 0.35, 0, 1)
    shading_quality = 35 * (shading_average_factor * 0.5 + shading_ratio_factor * 0.5)

    area_factor = clamp(usable_area_m2 / 220, 0, 1)
    panel_count_factor = clamp(panel_count_selected / 40, 0, 1)
    usable_area = 20 * (area_factor * 0.65 + panel_count_factor * 0.35)

    capacity_factor = clamp(install_capacity_kw / 25, 0, 1)
    generation_factor = clamp(annual_generation_kwh / 32_000, 0, 1)
    generation_potential = 20 * (capacity_factor * 0.35 + generation_factor * 0.65)

    if payback_years <= 0:
        payback_factor = 0.25
    elif payback_years <= 6:
        payback_factor = 1
    elif payback_years <= 12:
        payback_factor = 1 - ((payback_years - 6) / 6) * 0.55
    else:
        payback_factor = clamp(0.35 - ((payback_years - 12) / 10) * 0.25, 0.05, 0.35)

    saving_factor = clamp(annual_saving_krw / 5_000_000, 0, 1)
    economic_value = 15 * (payback_factor * 0.7 + saving_factor * 0.3)

    risk_penalty = 0

    if red_cell_ratio > 0.4:
        risk_penalty -= min(4, (red_cell_ratio - 0.4) * 10)

    if not bool(input.get("isPreciseRoofData")):
        risk_penalty -= 2

    if original_cell_count > 0:
        used_ratio = used_cell_count / original_cell_count

        if used_ratio < 0.5:
            risk_penalty -= 2
        elif used_ratio < 0.75:
            risk_penalty -= 1

    if payback_years > 12:
        risk_penalty -= 2

    if 0 < panel_count_selected < 10:
        risk_penalty -= 2

    risk_penalty = clamp(risk_penalty, -10, 0)
    positive_raw_score = shading_quality + usable_area + generation_potential + economic_value
    score = clamp((positive_raw_score / 90) * 100 + risk_penalty, 0, 100)
    rounded_score = round(score)
    grade = _get_grade(rounded_score)

    return {
        "score": rounded_score,
        "grade": grade,
        "label": GRADE_LABELS[grade],
        "featureScores": {
            "shadingQuality": _round(shading_quality, 1),
            "usableArea": _round(usable_area, 1),
            "generationPotential": _round(generation_potential, 1),
            "economicValue": _round(economic_value, 1),
            "riskPenalty": _round(risk_penalty, 1),
            "positiveRawScore": _round(positive_raw_score, 1),
        },
        "reasons": _build_reasons(input),
        "warnings": _build_warnings(input),
    }


def build_generation_prediction(input):
    ml_prediction = predict_generation(input)
    annual_generation_kwh = round(_as_float(ml_prediction.get("annualGenerationKwh")))
    monthly_generation_kwh = _as_float(ml_prediction.get("monthlyGenerationKwh"))

    if monthly_generation_kwh <= 0 and annual_generation_kwh > 0:
        monthly_generation_kwh = round(annual_generation_kwh / 12)

    confidence = _as_float(ml_prediction.get("confidence"), 0.75)
    red_cell_ratio = _as_float(input.get("redCellRatio"))
    original_cell_count = _as_float(input.get("originalCellCount"))
    used_cell_count = _as_float(input.get("usedCellCount"))

    if not bool(input.get("isPreciseRoofData")):
        confidence -= 0.1

    if red_cell_ratio > 0.4:
        confidence -= 0.12
    elif red_cell_ratio > 0.25:
        confidence -= 0.06

    if original_cell_count > 0:
        used_ratio = used_cell_count / original_cell_count

        if used_ratio < 0.5:
            confidence -= 0.1
        elif used_ratio < 0.75:
            confidence -= 0.05

    confidence = _round(clamp(confidence, 0.35, 0.92), 2)

    if confidence >= 0.8:
        confidence_label = "높음"
    elif confidence >= 0.6:
        confidence_label = "중간"
    else:
        confidence_label = "낮음"

    feature_importance = get_feature_importance().get("generation", [])

    return {
        "modelType": ml_prediction.get("modelType") or "fallback-formula-v1",
        "modelStatus": ml_prediction.get("modelStatus") or "fallback-no-model-file",
        "annualGenerationKwh": annual_generation_kwh,
        "monthlyGenerationKwh": round(monthly_generation_kwh),
        "confidence": confidence,
        "confidenceLabel": confidence_label,
        "featureImportance": feature_importance[:6],
        "isMeasuredGenerationModel": False,
        "trainingDataSource": ml_prediction.get("trainingDataSource") or "simulation-derived-seed-data",
        "assumptions": [
            "시뮬레이션 기반 대리 회귀 모델로 경기 기후 플랫폼 음영 셀과 패널 배치 결과를 기반으로 한 예상값입니다.",
            "패널 출력, 설치각, 음영 평균, 선택 셀 수를 반영한 설명 가능한 AI 점수화 보조 모델입니다.",
            "실측 발전량 학습 모델이 아니며 실측 데이터 누적 시 고도화 가능하도록 설계했습니다.",
            "옥상 장애물, 구조안전성, 방수 상태는 AI가 확정하지 않으며 현장 확인 항목입니다.",
            "실제 발전량은 현장 확인, 계통연계 조건, 유지관리 상태에 따라 달라질 수 있습니다.",
        ],
    }


def build_panel_optimization_summary(input):
    candidate_count = _as_int(input.get("panelCountCandidate"))
    selected_count = _as_int(input.get("panelCountSelected"))
    excluded_count = max(0, candidate_count - selected_count)
    green_cell_ratio = _as_float(input.get("greenCellRatio"))
    red_cell_ratio = _as_float(input.get("redCellRatio"))

    if green_cell_ratio >= 0.6:
        summary = "녹색 셀 비중이 높아 음영이 낮은 영역 중심의 배치를 권장합니다."
    elif red_cell_ratio > 0.4:
        summary = "붉은 음영 셀을 제외하고 발전량이 높은 구역 위주로 패널 수를 조정하는 검토가 필요합니다."
    else:
        summary = "녹색 및 노란색 셀을 우선 사용하고 붉은 음영 셀은 후순위로 두는 배치를 권장합니다."

    return {
        "modelType": "shading_aware_optimizer_v1",
        "strategy": "green-first-shading-aware",
        "objective": "음영이 낮은 셀을 우선 선택해 예상 발전량을 최대화",
        "selectedPanelCount": selected_count,
        "excludedPanelCount": excluded_count,
        "optimizationSummary": summary,
        "constraints": [
            "옥상 장애물과 피난 동선은 현장조사에서 추가 검토가 필요합니다.",
            "구조안전성, 방수층, 관리주체 협의 결과에 따라 실제 배치가 달라질 수 있습니다.",
            "초기 MVP에서는 음영 점수와 패널 수 기반의 설명형 최적화 요약을 제공합니다.",
        ],
    }


def build_agent_payload(input):
    score_result = input.get("buildingSuitability") if isinstance(input.get("buildingSuitability"), dict) else None
    score_result = score_result or (input.get("suitability") if isinstance(input.get("suitability"), dict) else None)
    score = score_result or calculate_suitability_score(input)
    self_payment_estimate_krw = max(
        0,
        round(_as_float(input.get("estimatedInstallCostKrw")) - _as_float(input.get("subsidyEstimateKrw"))),
    )
    location = {
        "roadAddress": input.get("roadAddress") or "",
        "jibunAddress": input.get("jibunAddress") or "",
        "latitude": input.get("latitude"),
        "longitude": input.get("longitude"),
    }
    install_capacity_kw = _as_float(input.get("installCapacityKw"))
    payback_years = _as_float(input.get("paybackYears"))
    annual_generation_kwh = round(_as_float(input.get("annualGenerationKwh")))
    monthly_generation_kwh = _monthly_generation_series(annual_generation_kwh)
    estimated_install_cost_krw = round(_as_float(input.get("estimatedInstallCostKrw")))
    subsidy_estimate_krw = round(_as_float(input.get("subsidyEstimateKrw")))
    annual_saving_krw = round(_as_float(input.get("annualSavingKrw")))
    warnings = score.get("warnings", [])
    reasons = score.get("reasons", [])
    cluster = score.get("cluster") if isinstance(score.get("cluster"), dict) else {}
    cluster_name = cluster.get("clusterName") if isinstance(cluster.get("clusterName"), str) else "군집 확인 필요"
    report_input_metrics = {
        "annualGenerationKwh": annual_generation_kwh,
        "monthlyGenerationKwh": monthly_generation_kwh,
        "estimatedInstallCostKrw": estimated_install_cost_krw,
        "subsidyEstimateKrw": subsidy_estimate_krw,
        "selfPaymentEstimateKrw": self_payment_estimate_krw,
        "annualSavingKrw": annual_saving_krw,
        "paybackYears": _round(payback_years, 1),
        "subsidyProgramName": SUBSIDY_PROGRAM_NAME,
        "subsidyPolicyMode": SUBSIDY_POLICY_MODE,
        "subsidyStackingAllowed": False,
        "subsidyStackingReason": SUBSIDY_STACKING_REASON,
        "installationSuitabilityScore": score["score"],
        "installationSuitabilityGrade": score["grade"],
        "installationSuitabilityLabel": score["label"],
        "recommendedAction": _build_recommended_action(score),
    }

    return {
        "summaryForCounselor": (
            f"해당 건물은 예상 연간 발전량 {annual_generation_kwh:,}kWh, "
            f"예상 자부담 {self_payment_estimate_krw:,}원, "
            f"예상 회수기간 {_round(payback_years, 1)}년 기준으로 "
            f"AI 설치 적합도 {score['grade']}등급입니다. "
            f"보조금은 {SUBSIDY_PROGRAM_NAME} 단일 기준으로 산정했으며 "
            f"실제 지원 여부는 공고와 예산 잔여 여부 확인이 필요합니다."
        ),
        "reportInputMetrics": report_input_metrics,
        "fieldCheckRequired": FIELD_CHECK_REQUIRED,
        "fieldCheckAffectsScore": False,
        "questionsToAskUser": [
            "최근 12개월 공용부 전기요금 고지서 또는 사용량 자료가 있나요?",
            "옥상 장애물, 방수 상태, 피난 동선 등 현장 확인 항목을 확인할 수 있나요?",
            "입주자대표회의 또는 관리주체의 사전 검토 일정이 있나요?",
            "경기 주택태양광 지원사업 공고 확인과 신청 상담을 진행해도 괜찮나요?",
        ],
        "requiredDocuments": [
            "건축물대장 또는 건물 기본 정보",
            "공용부 전기요금 고지서",
            "옥상 평면도 또는 현장 사진",
            "관리주체 또는 입주자대표회의 검토 자료",
        ],
        "nextStep": "현장 확인 항목과 경기 주택태양광 지원사업 최신 공고 및 예산 잔여 여부를 확인한 뒤 설치 규모와 자부담 범위를 재검토하는 것을 권장합니다.",
        "subsidyRagInput": {
            "location": location,
            "buildingUsage": input.get("buildingUsage") or "확인 필요",
            "installCapacityKw": _round(install_capacity_kw, 1),
            "estimatedInstallCostKrw": estimated_install_cost_krw,
            "subsidyEstimateKrw": subsidy_estimate_krw,
            "selfPaymentEstimateKrw": self_payment_estimate_krw,
            "paybackYears": _round(payback_years, 1),
            "suitabilityGrade": score["grade"],
            "suitabilityCluster": cluster_name,
            "subsidyProgramName": SUBSIDY_PROGRAM_NAME,
            "subsidyPolicyMode": SUBSIDY_POLICY_MODE,
            "subsidyStackingAllowed": False,
            "subsidyStackingReason": SUBSIDY_STACKING_REASON,
            "modelDisclosure": "시뮬레이션 기반 대리 회귀 모델이며 실측 데이터 누적 시 고도화 가능",
        },
        "counselingHints": {
            "topReasons": reasons[:3],
            "warnings": [
                *warnings,
                "옥상 장애물, 구조안전성, 방수 상태는 AI 확정 항목이 아니며 현장 확인이 필요합니다.",
                "보조금은 경기 주택태양광 지원사업 단일 기준 추정이며 실제 지원 여부는 공고와 예산 잔여 여부 확인이 필요합니다.",
            ],
        },
    }


def _build_recommended_action(score_result: dict[str, Any]):
    grade = score_result["grade"]

    if grade in ("S", "A"):
        return "현장조사와 보조금 공고 확인을 병행하며 우선 상담을 권장합니다."

    if grade == "B":
        return "설치 가능성은 양호하므로 음영 구역 조정과 경제성 재검토를 권장합니다."

    if grade == "C":
        return "보조금, 정책자금, 실제 옥상 제약을 확인한 뒤 조건부로 검토하는 것이 좋습니다."

    return "현재 조건만으로는 신중한 검토가 필요하며 대체 배치나 규모 축소 검토를 권장합니다."


def _build_building_snapshot(input: dict[str, Any]):
    return {
        "buildingId": input.get("buildingId"),
        "buildingName": input.get("buildingName") or "선택 건물",
        "roadAddress": input.get("roadAddress") or "",
        "jibunAddress": input.get("jibunAddress") or "",
        "buildingUsage": input.get("buildingUsage") or "확인 필요",
        "latitude": input.get("latitude"),
        "longitude": input.get("longitude"),
    }


def _build_roof_snapshot(input: dict[str, Any]):
    return {
        "roofAreaM2": _round(_as_float(input.get("roofAreaM2")), 2),
        "usableAreaM2": _round(_as_float(input.get("usableAreaM2")), 2),
        "usableRatio": _usable_ratio(input),
        "roofSource": input.get("roofSource") or "확인 필요",
        "geometryType": input.get("geometryType") or "확인 필요",
        "isPreciseRoofData": bool(input.get("isPreciseRoofData")),
        "originalCellCount": _as_int(input.get("originalCellCount")),
        "usedCellCount": _as_int(input.get("usedCellCount")),
    }


def _build_shading_snapshot(input: dict[str, Any]):
    return {
        "shadingAverage": _round(_as_float(input.get("shadingAverage")), 2),
        "greenCellRatio": _as_float(input.get("greenCellRatio")),
        "yellowCellRatio": _as_float(input.get("yellowCellRatio")),
        "redCellRatio": _as_float(input.get("redCellRatio")),
        "greenCellCount": _as_int(input.get("greenCellCount")),
        "yellowCellCount": _as_int(input.get("yellowCellCount")),
        "redCellCount": _as_int(input.get("redCellCount")),
        "cellCount": _as_int(input.get("cellCount")),
    }


def _build_economics_snapshot(input: dict[str, Any], payback_prediction: dict[str, Any]):
    estimated_install_cost_krw = _money(input.get("estimatedInstallCostKrw"))
    subsidy_estimate_krw = _money(input.get("subsidyEstimateKrw"))
    self_payment_estimate_krw = max(0, estimated_install_cost_krw - subsidy_estimate_krw)

    return {
        "estimatedInstallCostKrw": estimated_install_cost_krw,
        "subsidyEstimateKrw": subsidy_estimate_krw,
        "estimatedSelfPaymentKrw": self_payment_estimate_krw,
        "policyLoanLimitKrw": _money(input.get("policyLoanLimitKrw")),
        "annualSavingKrw": _money(input.get("annualSavingKrw")),
        "paybackYears": _round(_as_float(payback_prediction.get("paybackYears")), 1),
        "subsidyProgramName": SUBSIDY_PROGRAM_NAME,
        "subsidyPolicyMode": SUBSIDY_POLICY_MODE,
        "subsidyStackingAllowed": False,
        "subsidyStackingReason": SUBSIDY_STACKING_REASON,
        "paybackModelType": payback_prediction.get("modelType"),
        "paybackModelStatus": payback_prediction.get("modelStatus"),
        "notice": "예상·추정 값이며 경기 주택태양광 지원사업 실제 공고 및 예산 잔여 여부 확인 필요",
    }


def build_ai_simulation_result(input):
    generation_prediction = build_generation_prediction(input)
    annual_generation_kwh = _as_float(generation_prediction.get("annualGenerationKwh"))
    base_generation_kwh = _as_float(input.get("annualGenerationKwh"))
    base_annual_saving_krw = _as_float(input.get("annualSavingKrw"))
    saving_per_kwh = base_annual_saving_krw / base_generation_kwh if base_generation_kwh > 0 else 155
    annual_saving_krw = round(annual_generation_kwh * saving_per_kwh) if annual_generation_kwh > 0 else round(base_annual_saving_krw)
    payback_prediction = predict_payback(
        {
            **input,
            "annualGenerationKwh": annual_generation_kwh,
            "annualSavingKrw": annual_saving_krw,
        }
    )
    score_input = {
        **input,
        "annualGenerationKwh": annual_generation_kwh,
        "monthlyGenerationKwh": generation_prediction.get("monthlyGenerationKwh"),
        "annualSavingKrw": annual_saving_krw,
        "paybackYears": payback_prediction.get("paybackYears"),
        "usableRatio": _usable_ratio(input),
    }
    score_result = calculate_suitability_score(score_input)
    cluster_result = classify_building_cluster(score_input)
    building_suitability = {
        "modelType": "explainable_score_plus_kmeans_v1",
        **score_result,
        "cluster": cluster_result,
    }
    panel_optimization = build_panel_optimization_summary(score_input)
    economics = _build_economics_snapshot(score_input, payback_prediction)
    ai_model_metadata = {
        **build_model_metadata(),
        "featureImportance": get_feature_importance(),
    }
    agent_payload = build_agent_payload(
        {
            **score_input,
            "buildingSuitability": building_suitability,
            "suitability": building_suitability,
        }
    )

    return {
        "modelVersion": "solarmate-ml-backed-simulation-ai-v1",
        "summary": "공공데이터, 음영 분석, 패널 배치, 발전량/경제성 추정값 기반의 시뮬레이션 기반 대리 회귀 모델 및 설명 가능한 AI 점수화 결과입니다.",
        "building": _build_building_snapshot(score_input),
        "roof": _build_roof_snapshot(score_input),
        "shading": _build_shading_snapshot(score_input),
        "panelOptimization": panel_optimization,
        "generationPrediction": generation_prediction,
        "economics": economics,
        "buildingSuitability": building_suitability,
        "suitability": building_suitability,
        "aiModelMetadata": ai_model_metadata,
        "recommendedAction": _build_recommended_action(building_suitability),
        "agentPayload": agent_payload,
    }
