import time
import traceback
from typing import Any

from shapely.geometry import mapping

from .climate_client import call_pv_analysis, call_select_sun_list
from .geometry import (
    cell_to_geojson_polygon_4326,
    cells_to_geojson_4326,
    geom_4326_to_5186,
    geom_5186_to_4326,
    make_cells_in_polygon,
    normalize_geojson_polygon_4326,
)


PIPELINE_SOURCE = "external-fastapi-climate-backend"
DEFAULT_MAX_CELLS = 300
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


def create_request_diagnostics(request) -> dict[str, Any]:
    selected_building_feature = getattr(request, "selectedBuildingFeature", None)
    geometry = _read_geometry(selected_building_feature)

    return {
        "hasSelectedBuildingFeature": bool(selected_building_feature),
        "selectedBuildingId": getattr(request, "selectedBuildingId", None),
        "geometryType": geometry.get("type") if geometry else None,
        "coordinateSample": _coordinate_sample_from_geometry(geometry),
        "mode": getattr(request, "mode", None),
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


async def run_hybrid_pipeline(request):
    started = time.time()
    step = "validate-request"
    diagnostics = {
        **create_request_diagnostics(request),
        "step": step,
        "elapsedMs": 0,
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

        step = "project-geometry"
        diagnostics["step"] = step
        roof_5186 = geom_4326_to_5186(geometry)
        roof_area = roof_5186.area
        diagnostics["roofAreaM2"] = round(roof_area, 2)

        step = "generate-cells"
        diagnostics["step"] = step
        cells, original_count = make_cells_in_polygon(
            roof_5186,
            cell_w=1.0,
            cell_h=3.5,
            max_cells=DEFAULT_MAX_CELLS,
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

        if request.mode == "full":
            try:
                pv_output = await call_pv_analysis(pv_input, timeout_seconds=15)
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
            pv_status = "local-fallback-fast-mode"

        step = "build-geojson"
        diagnostics["step"] = step
        roof_4326_result = geom_5186_to_4326(roof_5186)
        panels_geojson = cells_to_geojson_4326(cells, shading)

        step = "build-bundle"
        diagnostics["step"] = step
        bundle = {
            "meta": {
                "unq_id": request.selectedBuildingId,
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
            "roof_polygon_4326": mapping(roof_4326_result),
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
        }

        diagnostics["pvAnalysisStatus"] = pv_status
        diagnostics["elapsedMs"] = _elapsed_ms(started)

        return {
            "ok": True,
            "source": PIPELINE_SOURCE,
            "roofSource": "vworld-building-footprint-fallback",
            "bundle": bundle,
            "panelsGeojson": panels_geojson,
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
