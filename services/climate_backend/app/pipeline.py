import time
import traceback
from typing import Any

from shapely.geometry import mapping

from .ai_simulation import build_ai_simulation_result, calculate_shading_ratios
from .climate_client import call_pv_analysis, call_select_buld, call_select_sun_list
from .geometry import (
    cell_to_geojson_polygon_4326,
    cells_to_geojson_4326,
    geom_4326_to_5186,
    geom_5186_to_4326,
    lonlat_to_5186,
    make_cells_in_polygon,
    normalize_geojson_polygon_4326,
)
from .supabase_client import save_analysis_result, save_training_sample


PIPELINE_SOURCE = "external-fastapi-climate-backend"
DEFAULT_MAX_CELLS = 300
FULL_MAX_CELLS = 2500
SELECT_BULD_TIMEOUT_SECONDS = 8
SELECT_BULD_MATCH_DISTANCE_M = 15
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


def _elapsed_ms(started: float) -> int:
    return int((time.time() - started) * 1000)


def _read_geometry(selected_building_feature: dict[str, Any] | None):
    if not selected_building_feature:
        return None

    geometry = selected_building_feature.get("geometry")

    return geometry if isinstance(geometry, dict) else None


def _find_coordinate_sample(value):
    if isinstance(value, (list, tuple)):
        if (
            len(value) >= 2
            and isinstance(value[0], (int, float))
            and isinstance(value[1], (int, float))
        ):
            return [value[0], value[1]]

        for item in value:
            sample = _find_coordinate_sample(item)

            if sample:
                return sample

    return None


def _coordinate_sample_from_geometry(geometry: dict[str, Any] | None):
    if not geometry:
        return None

    sample = _find_coordinate_sample(geometry.get("coordinates"))

    if sample:
        return sample

    for child in geometry.get("geometries") or []:
        if isinstance(child, dict):
            sample = _coordinate_sample_from_geometry(child)

            if sample:
                return sample

    return None


def _read_feature_property(feature: dict[str, Any] | None, keys: list[str], fallback: str = ""):
    if not isinstance(feature, dict):
        return fallback

    properties = feature.get("properties")

    if not isinstance(properties, dict):
        return fallback

    for key in keys:
        value = properties.get(key)

        if isinstance(value, str) and value.strip():
            return value.strip()

        if isinstance(value, (int, float)):
            return str(value)

    return fallback


def create_request_diagnostics(request) -> dict[str, Any]:
    selected_building_feature = getattr(request, "selectedBuildingFeature", None)
    geometry = _read_geometry(selected_building_feature)

    return {
        "hasSelectedBuildingFeature": bool(selected_building_feature),
        "selectedBuildingId": getattr(request, "selectedBuildingId", None),
        "selectedAnalysisSessionId": getattr(request, "selectedAnalysisSessionId", None),
        "geometryType": geometry.get("type") if geometry else None,
        "coordinateSample": _coordinate_sample_from_geometry(geometry),
        "mode": getattr(request, "mode", None),
        "includePvAnalysis": getattr(request, "includePvAnalysis", None),
        "panelCapacityW": getattr(request, "panelCapacityW", None),
        "panelAngle": getattr(request, "panelAngle", None),
        "cellsPerPanel": getattr(request, "cellsPerPanel", None),
    }


def _pipeline_error_response(step: str, started: float, diagnostics: dict[str, Any], error: Exception):
    next_diagnostics = {
        **diagnostics,
        "step": step,
        "elapsedMs": _elapsed_ms(started),
        "errorType": type(error).__name__,
        "error": str(error),
    }

    return {
        "ok": False,
        "source": PIPELINE_SOURCE,
        "selectedBuildingId": diagnostics.get("selectedBuildingId"),
        "selectedAnalysisSessionId": diagnostics.get("selectedAnalysisSessionId"),
        "fallbackRecommended": True,
        "message": f"백엔드 climate 분석 중 {step} 단계에서 오류가 발생했습니다.",
        "errorType": type(error).__name__,
        "error": str(error),
        "trace": traceback.format_exc().splitlines()[-15:],
        "diagnostics": next_diagnostics,
    }


def create_fallback_pv_output(panel_capacity_w: int, panel_count: int, shading_average: float):
    install_kw = panel_capacity_w * panel_count / 1000
    shading_factor = max(0.45, min(1.0, shading_average / 3.5 if shading_average else 0.6))
    annual_generation_kwh = install_kw * 365 * 3.6 * shading_factor
    annual_saving_krw = annual_generation_kwh * 150
    expected_investment_krw = install_kw * 1_200_000
    carbon_reduction = annual_generation_kwh * 0.4594

    return {
        "source": "local-fallback-formula",
        "annual_generation": round(annual_generation_kwh),
        "annual_generation_kwh": round(annual_generation_kwh),
        "annual_saving_krw": round(annual_saving_krw),
        "expected_investment_krw": round(expected_investment_krw),
        "expected_revenue": {
            "install_kw": round(install_kw, 1),
            "first_year_revenue": round(annual_saving_krw),
            "first_year_save_cost": round(annual_saving_krw),
            "expected_investment": round(expected_investment_krw),
        },
        "environmental_contribution": {
            "pine_tree_effect": round(carbon_reduction / 6.6, 1),
            "carbon_reduction": round(carbon_reduction, 1),
        },
        "annual_revenue": [],
        "annual_saveCost": [
            {
                "year": year,
                "saveCost": round(annual_saving_krw),
            }
            for year in range(1, 21)
        ],
        "monthly_generation": [
            {
                "month": index + 1,
                "generation": round(annual_generation_kwh * weight, 1),
            }
            for index, weight in enumerate(MONTHLY_GENERATION_WEIGHTS)
        ],
    }


def _coerce_float(value: Any, fallback: float):
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _coerce_optional_float(value: Any):
    try:
        next_value = float(value)
    except (TypeError, ValueError):
        return None

    return next_value if next_value == next_value else None


def _coerce_optional_int(value: Any):
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return None


def _read_nested(mapping_value: dict[str, Any] | None, *keys: str):
    current: Any = mapping_value

    for key in keys:
        if not isinstance(current, dict):
            return None

        current = current.get(key)

    return current


def _select_buld_match_diagnostics(select_buld_5186, selected_roof_5186):
    centroid = select_buld_5186.centroid
    centroid_inside = selected_roof_5186.covers(centroid)
    centroid_distance = 0.0 if centroid_inside else centroid.distance(selected_roof_5186)
    centroid_4326 = geom_5186_to_4326(centroid)

    return {
        "matchesSelectedBuilding": centroid_inside or centroid_distance <= SELECT_BULD_MATCH_DISTANCE_M,
        "centroidInsideSelectedBuilding": bool(centroid_inside),
        "centroidDistanceToSelectedBuildingM": round(float(centroid_distance), 2),
        "centroidWgs84": {
            "longitude": float(centroid_4326.x),
            "latitude": float(centroid_4326.y),
        },
    }


def _safe_db_status(save_result: dict[str, Any]) -> dict[str, Any]:
    analysis_result_id = save_result.get("id") if isinstance(save_result.get("id"), str) else None
    status = {
        "enabled": save_result.get("enabled") is True,
        "analysisResultOk": save_result.get("ok") is True,
        "analysisResultId": analysis_result_id,
        "ok": save_result.get("ok") is True,
    }

    if save_result.get("ok") is not True:
        if save_result.get("errorType"):
            status["errorType"] = str(save_result.get("errorType"))

        if save_result.get("reason"):
            status["reason"] = str(save_result.get("reason"))

        if save_result.get("error"):
            status["error"] = str(save_result.get("error"))

    return status


def _safe_training_db_status(save_result: dict[str, Any]) -> dict[str, Any]:
    status = {
        "enabled": save_result.get("enabled") is True,
        "trainingSampleOk": save_result.get("ok") is True,
        "trainingSampleId": save_result.get("id") if isinstance(save_result.get("id"), str) else None,
    }

    if save_result.get("ok") is not True:
        if save_result.get("errorType"):
            status["trainingSampleErrorType"] = str(save_result.get("errorType"))

        if save_result.get("reason"):
            status["trainingSampleReason"] = str(save_result.get("reason"))

        if save_result.get("error"):
            status["trainingSampleError"] = str(save_result.get("error"))

    return status


def _build_analysis_result_row(
    *,
    selected_building_id: str | None,
    request,
    ai_input: dict[str, Any],
    ai_simulation_result: dict[str, Any],
    agent_payload: dict[str, Any] | None,
    pv_input: dict[str, Any],
    pv_output: dict[str, Any] | None,
    panels_geojson: dict[str, Any],
    roof_polygon_4326: dict[str, Any],
    diagnostics: dict[str, Any],
) -> dict[str, Any]:
    suitability = ai_simulation_result.get("suitability") if isinstance(ai_simulation_result, dict) else {}

    if not isinstance(suitability, dict):
        suitability = {}

    return {
        "building_id": selected_building_id,
        "building_name": ai_input.get("buildingName"),
        "road_address": ai_input.get("roadAddress"),
        "jibun_address": ai_input.get("jibunAddress"),
        "latitude": request.latitude,
        "longitude": request.longitude,
        "roof_area_m2": _coerce_optional_float(ai_input.get("roofAreaM2")),
        "usable_area_m2": _coerce_optional_float(ai_input.get("usableAreaM2")),
        "panel_count": _coerce_optional_int(ai_input.get("panelCountSelected")),
        "install_capacity_kw": _coerce_optional_float(ai_input.get("installCapacityKw")),
        "annual_generation_kwh": _coerce_optional_float(_read_nested(ai_simulation_result, "generationPrediction", "annualGenerationKwh"))
        or _coerce_optional_float(ai_input.get("annualGenerationKwh")),
        "annual_saving_krw": _coerce_optional_int(_read_nested(ai_simulation_result, "economics", "annualSavingKrw"))
        or _coerce_optional_int(ai_input.get("annualSavingKrw")),
        "suitability_score": _coerce_optional_int(suitability.get("score")),
        "suitability_grade": suitability.get("grade"),
        "suitability_label": suitability.get("label"),
        "ai_simulation_result": ai_simulation_result,
        "agent_payload": agent_payload,
        "raw_result": {
            "source": PIPELINE_SOURCE,
            "selectedBuildingId": selected_building_id,
            "selectedAnalysisSessionId": getattr(request, "selectedAnalysisSessionId", None),
            "roofSource": diagnostics.get("roofSource"),
            "roofPolygon4326": roof_polygon_4326,
            "pvAnalysisInput": pv_input,
            "pvAnalysisOutput": pv_output,
            "panelsGeojson": panels_geojson,
            "diagnostics": diagnostics,
        },
    }


def _build_training_sample_row(
    *,
    selected_building_id: str | None,
    ai_input: dict[str, Any],
    ai_simulation_result: dict[str, Any],
) -> dict[str, Any]:
    roof_area_m2 = _coerce_optional_float(ai_input.get("roofAreaM2")) or 0
    usable_area_m2 = _coerce_optional_float(ai_input.get("usableAreaM2")) or 0
    usable_ratio = round(usable_area_m2 / roof_area_m2, 3) if roof_area_m2 > 0 else 0

    return {
        "building_id": selected_building_id,
        "roof_area_m2": roof_area_m2,
        "usable_area_m2": usable_area_m2,
        "usable_ratio": usable_ratio,
        "shading_average": _coerce_optional_float(ai_input.get("shadingAverage")),
        "green_cell_ratio": _coerce_optional_float(ai_input.get("greenCellRatio")),
        "yellow_cell_ratio": _coerce_optional_float(ai_input.get("yellowCellRatio")),
        "red_cell_ratio": _coerce_optional_float(ai_input.get("redCellRatio")),
        "panel_count": _coerce_optional_int(ai_input.get("panelCountSelected")),
        "install_capacity_kw": _coerce_optional_float(ai_input.get("installCapacityKw")),
        "panel_angle_deg": _coerce_optional_int(ai_input.get("panelAngleDeg")),
        "panel_capacity_w": _coerce_optional_int(ai_input.get("panelCapacityW")),
        "estimated_install_cost_krw": _coerce_optional_int(_read_nested(ai_simulation_result, "economics", "estimatedInstallCostKrw"))
        or _coerce_optional_int(ai_input.get("estimatedInstallCostKrw")),
        "subsidy_estimate_krw": _coerce_optional_int(_read_nested(ai_simulation_result, "economics", "subsidyEstimateKrw"))
        or _coerce_optional_int(ai_input.get("subsidyEstimateKrw")),
        "annual_generation_kwh": _coerce_optional_float(_read_nested(ai_simulation_result, "generationPrediction", "annualGenerationKwh"))
        or _coerce_optional_float(ai_input.get("annualGenerationKwh")),
        "annual_saving_krw": _coerce_optional_int(_read_nested(ai_simulation_result, "economics", "annualSavingKrw"))
        or _coerce_optional_int(ai_input.get("annualSavingKrw")),
        "payback_years": _coerce_optional_float(_read_nested(ai_simulation_result, "economics", "paybackYears"))
        or _coerce_optional_float(ai_input.get("paybackYears")),
        "source": "render-backend-simulation-ai",
    }


def normalize_backend_pv_output(raw: Any, panel_capacity_w: int, panel_count: int, shading_average: float):
    fallback = create_fallback_pv_output(panel_capacity_w, panel_count, shading_average)

    if not isinstance(raw, dict):
        return fallback

    data = raw.get("data") if isinstance(raw.get("data"), dict) else raw

    if not isinstance(data, dict) or not isinstance(data.get("expected_revenue"), dict):
        return fallback

    expected_revenue = data["expected_revenue"]
    annual_generation = data.get("annual_generation", data.get("annual_generation_kwh"))
    first_year_save_cost = expected_revenue.get("first_year_save_cost", data.get("annual_saving_krw"))
    expected_investment = expected_revenue.get("expected_investment", data.get("expected_investment_krw"))

    data["source"] = "backend-pv-analysis"
    data["annual_generation"] = round(_coerce_float(annual_generation, fallback["annual_generation"]))
    data["annual_generation_kwh"] = data["annual_generation"]
    data["annual_saving_krw"] = round(_coerce_float(first_year_save_cost, fallback["annual_saving_krw"]))
    data["expected_investment_krw"] = round(_coerce_float(expected_investment, fallback["expected_investment_krw"]))
    expected_revenue.setdefault("install_kw", fallback["expected_revenue"]["install_kw"])
    expected_revenue.setdefault("first_year_revenue", data["annual_saving_krw"])
    expected_revenue["first_year_save_cost"] = data["annual_saving_krw"]
    expected_revenue["expected_investment"] = data["expected_investment_krw"]
    data.setdefault("environmental_contribution", fallback["environmental_contribution"])
    data.setdefault("annual_revenue", fallback["annual_revenue"])
    data.setdefault("annual_saveCost", fallback["annual_saveCost"])
    data.setdefault("monthly_generation", fallback["monthly_generation"])

    return data


def _build_monthly_generation_kwh(pv_output: dict[str, Any] | None, annual_generation_kwh: float):
    if isinstance(pv_output, dict) and isinstance(pv_output.get("monthly_generation"), list):
        values = []

        for item in pv_output["monthly_generation"]:
            if isinstance(item, dict):
                values.append(_coerce_float(item.get("generation"), 0))

        if values:
            return round(sum(values) / len(values))

    return round(annual_generation_kwh / 12) if annual_generation_kwh > 0 else 0


async def run_hybrid_pipeline(request):
    started = time.time()
    step = "validate-request"
    selected_building_id = getattr(request, "selectedBuildingId", None)
    selected_analysis_session_id = getattr(request, "selectedAnalysisSessionId", None)
    roof_source = "vworld-building-footprint-fallback"
    diagnostics = {
        **create_request_diagnostics(request),
        "step": step,
        "elapsedMs": 0,
        "roofSource": roof_source,
        "selectBuldStatus": "skipped",
    }

    try:
        selected_building_feature = request.selectedBuildingFeature

        if not selected_building_feature:
            raise ValueError("selectedBuildingFeature가 없어 분석할 건물 polygon이 없습니다.")

        geometry = _read_geometry(selected_building_feature)

        if not geometry:
            raise ValueError("selectedBuildingFeature.geometry가 없습니다.")

        step = "parse-geometry"
        diagnostics["step"] = step
        diagnostics["geometryTypeBefore"] = geometry.get("type")
        roof_4326 = normalize_geojson_polygon_4326(geometry)
        diagnostics["geometryTypeAfter"] = roof_4326.geom_type
        diagnostics["roofGeometryType"] = roof_4326.geom_type

        step = "project-geometry"
        diagnostics["step"] = step
        roof_5186 = geom_4326_to_5186(geometry)
        selected_roof_5186 = roof_5186

        if request.mode == "full":
            step = "select-buld"
            diagnostics["step"] = step
            x5186, y5186 = lonlat_to_5186(request.longitude, request.latitude)
            select_buld_result = await call_select_buld(
                x5186,
                y5186,
                timeout_seconds=SELECT_BULD_TIMEOUT_SECONDS,
            )
            diagnostics.update(select_buld_result.get("diagnostics") or {})
            diagnostics["selectBuldStatus"] = select_buld_result.get("status")

            select_buld_5186 = select_buld_result.get("geometry_5186")

            if select_buld_5186 is not None:
                match_status = _select_buld_match_diagnostics(select_buld_5186, selected_roof_5186)
                diagnostics["selectBuldRoofMatchesSelectedBuilding"] = match_status["matchesSelectedBuilding"]
                diagnostics["selectBuldCentroidInsideSelectedBuilding"] = match_status[
                    "centroidInsideSelectedBuilding"
                ]
                diagnostics["selectBuldCentroidDistanceToSelectedBuildingM"] = match_status[
                    "centroidDistanceToSelectedBuildingM"
                ]
                diagnostics["selectBuldCentroidWgs84"] = match_status["centroidWgs84"]

                if match_status["matchesSelectedBuilding"]:
                    roof_5186 = select_buld_5186
                    roof_4326 = geom_5186_to_4326(roof_5186)
                    roof_source = "climate.gg-selectBuld"
                    diagnostics["roofSource"] = roof_source
                    diagnostics["roofGeometryType"] = roof_4326.geom_type
                    diagnostics["geometryTypeAfter"] = roof_4326.geom_type
                else:
                    diagnostics["selectBuldStatus"] = "mismatch_selected_building"
                    diagnostics["selectBuldLastError"] = "selectBuld centroid did not match selected building"

        roof_area = roof_5186.area
        diagnostics["roofAreaM2"] = round(roof_area, 2)

        step = "generate-cells"
        diagnostics["step"] = step
        max_cells = FULL_MAX_CELLS if request.mode == "full" else DEFAULT_MAX_CELLS
        cells, original_count = make_cells_in_polygon(
            roof_5186,
            cell_w=1.0,
            cell_h=3.5,
            max_cells=max_cells,
        )
        diagnostics["originalCellCount"] = original_count
        diagnostics["usedCellCount"] = len(cells)
        diagnostics["maxCellsApplied"] = original_count > len(cells)

        if not cells:
            raise ValueError("건물 polygon 내부에 분석 셀을 생성하지 못했습니다.")

        step = "select-sun-list"
        diagnostics["step"] = step
        sun = await call_select_sun_list(cells)
        diagnostics["selectSunListRawCount"] = sun["raw_count"]
        diagnostics["selectSunListParsedCount"] = sun["parsed_count"]
        diagnostics["selectSunListSkippedCount"] = sun["skipped_count"]
        diagnostics["shadingAverage"] = sun["score_mean"]

        shading = sun["shading"]
        panel_count = max(1, len(shading) // request.cellsPerPanel)
        install_kw = request.panelCapacityW * panel_count / 1000
        diagnostics["panelCount"] = panel_count
        diagnostics["installKw"] = round(install_kw, 1)
        diagnostics["installCapacityKw"] = round(install_kw, 1)

        pv_input = {
            "latitude": request.latitude,
            "longitude": request.longitude,
            "shading_index_average": sun["score_mean"],
            "solar_panel_angle": request.panelAngle,
            "solar_panel_info": {
                "panel_capacity": request.panelCapacityW,
                "panel_count": panel_count,
                "panel_type": request.panelType,
            },
        }

        pv_output = None
        pv_status = "skipped"

        if request.includePvAnalysis:
            try:
                pv_output = normalize_backend_pv_output(
                    await call_pv_analysis(pv_input, timeout_seconds=15),
                    request.panelCapacityW,
                    panel_count,
                    sun["score_mean"],
                )
                pv_status = "success"
            except Exception as error:
                pv_output = create_fallback_pv_output(
                    request.panelCapacityW,
                    panel_count,
                    sun["score_mean"],
                )
                pv_status = f"fallback:{type(error).__name__}"
        else:
            pv_output = create_fallback_pv_output(
                request.panelCapacityW,
                panel_count,
                sun["score_mean"],
            )
            pv_status = "local-fallback-no-pv-analysis"

        step = "build-geojson"
        diagnostics["step"] = step
        roof_4326_result = geom_5186_to_4326(roof_5186)
        panels_geojson = cells_to_geojson_4326(cells, shading)
        roof_polygon_4326 = mapping(roof_4326_result)
        first_panel_coordinates = None

        if panels_geojson["features"]:
            first_panel_coordinates = panels_geojson["features"][0]["geometry"]["coordinates"]

        diagnostics["selectedBuildingId"] = selected_building_id
        diagnostics["selectedAnalysisSessionId"] = selected_analysis_session_id
        diagnostics["roofSource"] = roof_source
        diagnostics["roofAreaM2"] = round(roof_area, 2)
        diagnostics["firstPanelCoordinates"] = first_panel_coordinates
        diagnostics["panelCount"] = panel_count
        diagnostics["shadingAverage"] = sun["score_mean"]
        shading_ratios = calculate_shading_ratios(panels_geojson)
        expected_revenue = (
            pv_output.get("expected_revenue")
            if isinstance(pv_output, dict) and isinstance(pv_output.get("expected_revenue"), dict)
            else {}
        )
        annual_generation_kwh = _coerce_float(
            pv_output.get("annual_generation_kwh", pv_output.get("annual_generation")) if isinstance(pv_output, dict) else None,
            0,
        )
        annual_saving_krw = _coerce_float(
            (
                pv_output.get("annual_saving_krw")
                if isinstance(pv_output, dict)
                else None
            ),
            _coerce_float(expected_revenue.get("first_year_save_cost"), 0),
        )
        estimated_install_cost_krw = _coerce_float(
            (
                pv_output.get("expected_investment_krw")
                if isinstance(pv_output, dict)
                else None
            ),
            _coerce_float(expected_revenue.get("expected_investment"), 0),
        )
        install_capacity_kw = _coerce_float(expected_revenue.get("install_kw"), install_kw)
        monthly_generation_kwh = _build_monthly_generation_kwh(pv_output, annual_generation_kwh)
        subsidy_estimate_krw = round(min(estimated_install_cost_krw * 0.45, 30_000_000))
        self_payment_estimate_krw = max(0, round(estimated_install_cost_krw - subsidy_estimate_krw))
        policy_loan_limit_krw = round(self_payment_estimate_krw * 0.75)
        payback_years = (
            round(estimated_install_cost_krw / annual_saving_krw, 1)
            if annual_saving_krw > 0 and estimated_install_cost_krw > 0
            else 0
        )
        used_cell_count = len(shading)
        usable_area_m2 = round(used_cell_count * 3.5, 2)
        ai_input = {
            "buildingId": selected_building_id,
            "buildingName": _read_feature_property(
                selected_building_feature,
                ["name", "building_name", "bldg_nm", "bldg_name", "apartment_name", "dong_name"],
                "선택 건물",
            ),
            "roadAddress": _read_feature_property(
                selected_building_feature,
                ["road_address", "rn_addr", "address", "addr", "bd_addr", "A3", "A4"],
                "",
            ),
            "jibunAddress": _read_feature_property(
                selected_building_feature,
                ["jibun_address", "jibun", "address", "addr", "A4"],
                "",
            ),
            "latitude": request.latitude,
            "longitude": request.longitude,
            "buildingUsage": _read_feature_property(
                selected_building_feature,
                ["buildingUsage", "usage_name", "bldg_usg_cd", "main_purps_cd_nm", "mainPurpsCdNm"],
                "확인 필요",
            ),
            "geometryType": roof_4326.geom_type,
            "roofAreaM2": round(roof_area, 2),
            "usableAreaM2": usable_area_m2,
            "roofSource": roof_source,
            "isPreciseRoofData": roof_source != "vworld-building-footprint-fallback",
            "originalCellCount": original_count,
            "usedCellCount": used_cell_count,
            "shadingAverage": sun["score_mean"],
            **shading_ratios,
            "panelCapacityW": request.panelCapacityW,
            "panelAngleDeg": request.panelAngle,
            "panelType": request.panelType,
            "panelCountCandidate": max(1, original_count // request.cellsPerPanel),
            "panelCountSelected": panel_count,
            "installCapacityKw": round(install_capacity_kw, 1),
            "annualGenerationKwh": round(annual_generation_kwh),
            "monthlyGenerationKwh": monthly_generation_kwh,
            "estimatedInstallCostKrw": round(estimated_install_cost_krw),
            "subsidyEstimateKrw": subsidy_estimate_krw,
            "annualSavingKrw": round(annual_saving_krw),
            "policyLoanLimitKrw": policy_loan_limit_krw,
            "paybackYears": payback_years,
        }
        ai_simulation_result = build_ai_simulation_result(ai_input)
        agent_payload = (
            ai_simulation_result.get("agentPayload")
            if isinstance(ai_simulation_result.get("agentPayload"), dict)
            else None
        )
        diagnostics["greenCellRatio"] = shading_ratios["greenCellRatio"]
        diagnostics["yellowCellRatio"] = shading_ratios["yellowCellRatio"]
        diagnostics["redCellRatio"] = shading_ratios["redCellRatio"]
        diagnostics["aiSuitabilityScore"] = ai_simulation_result["suitability"]["score"]
        diagnostics["aiSuitabilityGrade"] = ai_simulation_result["suitability"]["grade"]
        diagnostics["aiSuitabilityCluster"] = (
            ai_simulation_result.get("buildingSuitability", {})
            .get("cluster", {})
            .get("clusterName")
        )
        diagnostics["aiGenerationModelType"] = ai_simulation_result.get("generationPrediction", {}).get("modelType")
        diagnostics["aiModelStatus"] = ai_simulation_result.get("aiModelMetadata", {}).get("modelStatus")

        step = "build-bundle"
        diagnostics["step"] = step
        bundle = {
            "meta": {
                "unq_id": selected_building_id,
                "bldg_nm": None,
                "bldg_hgt": None,
                "bdar": None,
                "bldg_nofl": None,
                "use_aprv_ymd": None,
                "bldg_usg_cd": None,
                "sigun_cd": None,
                "click_wgs84": {
                    "longitude": request.longitude,
                    "latitude": request.latitude,
                },
            },
            "roof_polygon_4326": roof_polygon_4326,
            "roof_area_sqm_5186": round(roof_area, 2),
            "shading": {
                "cell_w_m": 1,
                "cell_h_m": 3.5,
                "cells_total": original_count,
                "cells_with_score": len(shading),
                "score_min": sun["score_min"],
                "score_mean": sun["score_mean"],
                "score_max": sun["score_max"],
            },
            "usage_monthly": {
                "labels": [],
                "electricity_kwh": [],
                "gas_m3": [],
            },
            "regulation_hits": [],
            "pv_analysis_input": pv_input,
            "pv_analysis_output": pv_output,
            "ai_simulation_result": ai_simulation_result,
        }

        analysis_save_result = save_analysis_result(
            _build_analysis_result_row(
                selected_building_id=selected_building_id,
                request=request,
                ai_input=ai_input,
                ai_simulation_result=ai_simulation_result,
                agent_payload=agent_payload,
                pv_input=pv_input,
                pv_output=pv_output,
                panels_geojson=panels_geojson,
                roof_polygon_4326=roof_polygon_4326,
                diagnostics=diagnostics,
            )
        )
        db_save_status = _safe_db_status(analysis_save_result)
        analysis_result_id = db_save_status["analysisResultId"]
        bundle["dbSaveStatus"] = db_save_status

        if analysis_result_id:
            bundle["analysisResultId"] = analysis_result_id
            bundle["analysis_result_id"] = analysis_result_id
            ai_simulation_result["analysisResultId"] = analysis_result_id

            if agent_payload is not None:
                agent_payload["analysisResultId"] = analysis_result_id

        training_save_result = save_training_sample(
            _build_training_sample_row(
                selected_building_id=selected_building_id,
                ai_input=ai_input,
                ai_simulation_result=ai_simulation_result,
            )
        )
        training_db_save_status = _safe_training_db_status(training_save_result)
        db_save_status = {
            **db_save_status,
            **{
                key: value
                for key, value in training_db_save_status.items()
                if key != "enabled"
            },
        }
        bundle["dbSaveStatus"] = db_save_status

        diagnostics["pvAnalysisStatus"] = pv_status
        diagnostics["pvAnalysisSource"] = (
            pv_output.get("source") if isinstance(pv_output, dict) else None
        )
        diagnostics["usedVercelPvAnalysis"] = False
        diagnostics["dbSaveStatus"] = db_save_status
        diagnostics["trainingSampleDbSaveStatus"] = training_db_save_status
        diagnostics["elapsedMs"] = _elapsed_ms(started)

        return {
            "ok": True,
            "source": PIPELINE_SOURCE,
            "selectedBuildingId": selected_building_id,
            "selectedAnalysisSessionId": selected_analysis_session_id,
            "analysisResultId": analysis_result_id,
            "dbSaveStatus": db_save_status,
            "roofSource": roof_source,
            "roofPolygon4326": roof_polygon_4326,
            "roofAreaM2": round(roof_area, 2),
            "bundle": bundle,
            "panelsGeojson": panels_geojson,
            "aiSimulationResult": ai_simulation_result,
            "agentPayload": agent_payload,
            "aiModelMetadata": ai_simulation_result.get("aiModelMetadata"),
            "diagnostics": diagnostics,
        }
    except Exception as error:
        return _pipeline_error_response(step, started, diagnostics, error)


def debug_geometry_pipeline(request):
    started = time.time()
    geometry = _read_geometry(request.selectedBuildingFeature)
    geometry_type_before = geometry.get("type") if geometry else None

    try:
        if not geometry:
            raise ValueError("selectedBuildingFeature.geometry가 없습니다.")

        roof_4326 = normalize_geojson_polygon_4326(geometry)
        roof_5186 = geom_4326_to_5186(geometry)
        cells, original_count = make_cells_in_polygon(
            roof_5186,
            cell_w=1.0,
            cell_h=3.5,
            max_cells=DEFAULT_MAX_CELLS,
        )
        first_cell = cells[0] if cells else None

        return {
            "ok": True,
            "selectedBuildingId": request.selectedBuildingId,
            "geometryTypeBefore": geometry_type_before,
            "geometryTypeAfter": roof_4326.geom_type,
            "roofAreaM2": round(roof_5186.area, 2),
            "originalCellCount": original_count,
            "usedCellCount": len(cells),
            "firstCell": list(first_cell) if first_cell else None,
            "firstCell4326": cell_to_geojson_polygon_4326(first_cell) if first_cell else None,
            "elapsedMs": _elapsed_ms(started),
        }
    except Exception as error:
        return {
            "ok": False,
            "selectedBuildingId": request.selectedBuildingId,
            "geometryTypeBefore": geometry_type_before,
            "geometryTypeAfter": None,
            "errorType": type(error).__name__,
            "error": str(error),
            "trace": traceback.format_exc().splitlines()[-15:],
            "elapsedMs": _elapsed_ms(started),
        }
