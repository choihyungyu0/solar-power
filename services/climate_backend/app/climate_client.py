import json
import statistics
import time
from urllib.parse import urlencode

import httpx
from shapely.geometry import shape

from .geometry import pick_largest_polygon

BASE = "https://climate.gg.go.kr"
SELECT_BULD_URL = f"{BASE}/gcs/book/cmm/selectBuld.do"

HEADERS = {
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "X-Requested-With": "XMLHttpRequest",
    "Origin": BASE,
    "Referer": BASE + "/",
    "User-Agent": "solarmate-climate-backend/0.1",
}

FORM_HEADERS = {
    **HEADERS,
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
}

JSON_HEADERS = {
    **HEADERS,
    "Content-Type": "application/json; charset=UTF-8",
}


def _preview_text(value: str, max_length=500):
    return value[:max_length]


def _extract_select_buld_geometry(payload: object, diagnostics: dict):
    diagnostics["selectBuldRawKeys"] = list(payload.keys()) if isinstance(payload, dict) else None
    buld = payload.get("buld") if isinstance(payload, dict) else None
    diagnostics["selectBuldHasBuld"] = isinstance(buld, dict)

    if not isinstance(buld, dict):
        diagnostics["selectBuldFeatureParseStatus"] = "missing-buld"
        return None

    diagnostics["selectBuldBuldKeys"] = list(buld.keys())
    feature_text = buld.get("feature")

    if not isinstance(feature_text, str) or not feature_text.strip():
        diagnostics["selectBuldFeatureParseStatus"] = "missing-feature-string"
        return None

    try:
        feature = json.loads(feature_text)
    except Exception as error:
        diagnostics["selectBuldFeatureParseStatus"] = f"feature-json-parse-failed:{type(error).__name__}"
        return None

    geometry = feature.get("geometry") if isinstance(feature, dict) else None

    if not isinstance(geometry, dict):
        diagnostics["selectBuldFeatureParseStatus"] = "missing-feature-geometry"
        return None

    try:
        polygon = pick_largest_polygon(shape(geometry))
    except Exception as error:
        diagnostics["selectBuldFeatureParseStatus"] = f"unsupported-feature-geometry:{type(error).__name__}"
        return None

    diagnostics["selectBuldFeatureParseStatus"] = "parsed"

    return {
        "feature": feature,
        "geometry_5186": polygon,
    }


async def call_select_buld(x: float, y: float, timeout_seconds=8):
    request_body = urlencode({"x": str(x), "y": str(y), "type": "PANEL"})
    started = time.time()
    diagnostics = {
        "selectBuldUrl": SELECT_BULD_URL,
        "selectBuldRequestBody": request_body,
        "selectBuldAttemptCount": 1,
        "selectBuldTimeoutMs": int(timeout_seconds * 1000),
        "selectBuldAttemptTimingsMs": [],
    }

    try:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.post(
                SELECT_BULD_URL,
                content=request_body,
                headers=FORM_HEADERS,
            )

        raw_text = response.text
        diagnostics["selectBuldAttemptTimingsMs"].append(int((time.time() - started) * 1000))
        diagnostics["selectBuldHttpStatus"] = response.status_code
        diagnostics["selectBuldContentType"] = response.headers.get("content-type")
        diagnostics["selectBuldRawTextPreview"] = _preview_text(raw_text)

        if response.status_code >= 400:
            diagnostics["selectBuldFeatureParseStatus"] = "http-error"
            diagnostics["selectBuldLastError"] = f"HTTP {response.status_code}"
            return {
                "status": "not_found",
                "geometry_5186": None,
                "feature": None,
                "diagnostics": diagnostics,
            }

        try:
            payload = response.json()
        except Exception as error:
            diagnostics["selectBuldFeatureParseStatus"] = "response-json-parse-failed"
            diagnostics["selectBuldLastError"] = type(error).__name__
            return {
                "status": "not_found",
                "geometry_5186": None,
                "feature": None,
                "diagnostics": diagnostics,
            }

        extracted = _extract_select_buld_geometry(payload, diagnostics)

        if extracted is None:
            diagnostics.setdefault("selectBuldLastError", diagnostics.get("selectBuldFeatureParseStatus"))
            return {
                "status": "not_found",
                "geometry_5186": None,
                "feature": None,
                "diagnostics": diagnostics,
            }

        return {
            "status": "success",
            "geometry_5186": extracted["geometry_5186"],
            "feature": extracted["feature"],
            "diagnostics": diagnostics,
        }
    except httpx.TimeoutException:
        diagnostics["selectBuldAttemptTimingsMs"].append(int((time.time() - started) * 1000))
        diagnostics["selectBuldFeatureParseStatus"] = "request-timeout"
        diagnostics["selectBuldLastError"] = "request-timeout"
        return {
            "status": "timeout",
            "geometry_5186": None,
            "feature": None,
            "diagnostics": diagnostics,
        }
    except Exception as error:
        diagnostics["selectBuldAttemptTimingsMs"].append(int((time.time() - started) * 1000))
        diagnostics["selectBuldFeatureParseStatus"] = "request-failed"
        diagnostics["selectBuldLastError"] = f"{type(error).__name__}: {error}"
        return {
            "status": "not_found",
            "geometry_5186": None,
            "feature": None,
            "diagnostics": diagnostics,
        }


async def call_select_sun_list(cells, timeout_seconds=15):
    form_items = []

    for cell_id, x1, y1, x2, y2 in cells:
        form_items.append(("panel", f"{cell_id}-{x1},{y1},{x2},{y2}"))

    form_items.append(("type", "build"))

    encoded_form = urlencode(form_items)

    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        response = await client.post(
            f"{BASE}/gcs/panel/selectSunList.do",
            content=encoded_form,
            headers=FORM_HEADERS,
        )

    preview = response.text[:500]

    if response.status_code >= 400:
        raise RuntimeError(f"selectSunList HTTP {response.status_code}: {preview}")

    try:
        raw = response.json()
    except Exception as error:
        raise RuntimeError(
            f"selectSunList JSON parse failed: {type(error).__name__}, preview={preview}"
        ) from error

    if not isinstance(raw, list):
        raise RuntimeError(f"selectSunList unexpected response type: {type(raw).__name__}, preview={preview}")

    shading: dict[int, float] = {}
    skipped_count = 0

    for item in raw:
        item_text = str(item)

        if "|" not in item_text:
            skipped_count += 1
            continue

        try:
            cell_id, score = item_text.split("|", 1)
            shading[int(cell_id)] = float(score)
        except (TypeError, ValueError):
            skipped_count += 1

    values = list(shading.values())

    if not values:
        raise RuntimeError(f"selectSunList returned no shading scores. preview={preview}")

    return {
        "shading": shading,
        "score_min": min(values) if values else 0,
        "score_mean": statistics.mean(values) if values else 0,
        "score_max": max(values) if values else 0,
        "raw_count": len(raw),
        "parsed_count": len(shading),
        "skipped_count": skipped_count,
    }


async def call_pv_analysis(payload: dict, timeout_seconds=15):
    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        response = await client.post(
            f"{BASE}/spsvc/pv/analysis",
            json=payload,
            headers=JSON_HEADERS,
        )

    response.raise_for_status()

    try:
        return response.json()
    except Exception:
        return None
