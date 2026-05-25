from __future__ import annotations

from typing import Any


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
    annual_generation_kwh = round(_as_float(input.get("annualGenerationKwh")))
    monthly_generation_kwh = _as_float(input.get("monthlyGenerationKwh"))

    if monthly_generation_kwh <= 0 and annual_generation_kwh > 0:
        monthly_generation_kwh = round(annual_generation_kwh / 12)

    confidence = 0.75
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

    return {
        "modelType": "explainable-hybrid-regression-v1",
        "annualGenerationKwh": annual_generation_kwh,
        "monthlyGenerationKwh": round(monthly_generation_kwh),
        "confidence": confidence,
        "confidenceLabel": confidence_label,
        "assumptions": [
            "경기 기후 플랫폼 음영 셀과 패널 배치 결과를 기반으로 한 예상값입니다.",
            "패널 출력, 설치각, 음영 평균, 선택 셀 수를 반영한 데모 산식입니다.",
            "실제 발전량은 현장 장애물, 구조안전성, 계통연계 조건, 유지관리 상태에 따라 달라질 수 있습니다.",
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
        "strategy": "green-first-shading-aware",
        "objective": "음영이 낮은 셀을 우선 선택하여 예상 발전량을 높이는 배치",
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
    score_result = input.get("suitability") if isinstance(input.get("suitability"), dict) else None
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
    warnings = score.get("warnings", [])
    reasons = score.get("reasons", [])

    return {
        "summaryForCounselor": (
            f"{input.get('buildingName') or '선택 건물'}은 설명형 AI 기준 {score['grade']}등급 "
            f"({score['score']}점, {score['label']})으로 추정됩니다. "
            f"권장 설치용량은 약 {_round(install_capacity_kw, 1)}kW, 예상 회수기간은 약 {_round(payback_years, 1)}년입니다."
        ),
        "questionsToAskUser": [
            "최근 12개월 공용부 전기요금 고지서 또는 사용량 자료가 있나요?",
            "옥상 방수층, 기계실, 피난 동선 등 패널 설치 제한 구역을 확인할 수 있나요?",
            "입주자대표회의 또는 관리주체의 사전 검토 일정이 있나요?",
            "보조금 신청 시 선호하는 자부담 한도와 정책자금 활용 의향이 있나요?",
        ],
        "requiredDocuments": [
            "건축물대장 또는 건물 기본 정보",
            "공용부 전기요금 고지서",
            "옥상 평면도 또는 현장 사진",
            "관리주체 또는 입주자대표회의 검토 자료",
        ],
        "nextStep": "현장조사와 최신 지자체/공공기관 보조금 공고 확인 후 설치 규모와 자부담 범위를 재검토하는 것을 권장합니다.",
        "subsidyRagInput": {
            "location": location,
            "buildingUsage": input.get("buildingUsage") or "확인 필요",
            "installCapacityKw": _round(install_capacity_kw, 1),
            "estimatedInstallCostKrw": round(_as_float(input.get("estimatedInstallCostKrw"))),
            "selfPaymentEstimateKrw": self_payment_estimate_krw,
            "paybackYears": _round(payback_years, 1),
            "suitabilityGrade": score["grade"],
        },
        "counselingHints": {
            "topReasons": reasons[:3],
            "warnings": warnings,
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


def build_ai_simulation_result(input):
    score_result = calculate_suitability_score(input)
    generation_prediction = build_generation_prediction(input)
    panel_optimization = build_panel_optimization_summary(input)
    agent_payload = build_agent_payload({**input, "suitability": score_result})

    return {
        "modelVersion": "solarmate-explainable-simulation-ai-v1",
        "summary": "공공데이터, 음영 분석, 패널 배치, 발전량/경제성 추정값 기반의 설명형 AI 시뮬레이션 결과입니다.",
        "suitability": score_result,
        "generationPrediction": generation_prediction,
        "panelOptimization": panel_optimization,
        "recommendedAction": _build_recommended_action(score_result),
        "agentPayload": agent_payload,
    }
