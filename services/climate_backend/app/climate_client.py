import statistics
from urllib.parse import urlencode

import httpx

BASE = "https://climate.gg.go.kr"

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
