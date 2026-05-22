"""FastAPI 엔트리. POST /api/v1/building-bundle 한 개로 풀스택이 클릭 1회 = 1번 호출."""
from __future__ import annotations

import asyncio
import os
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from cache import BundleCache
from grid_key import make_grid_key
from pipeline import result_to_bundle, run_pipeline
from rate_limiter import SlidingWindowRateLimiter

app = FastAPI(title="Solarmate Climate Proxy", version="1.0.0")

cors_origins = os.environ.get(
    "CORS_ORIGINS",
    "http://localhost:5173,http://localhost:3000,http://localhost:8501",
).split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

cache = BundleCache()
rate_limiter = SlidingWindowRateLimiter(
    max_calls=int(os.environ.get("CLIMATE_GG_RATE_LIMIT", "5")),
    window_sec=1.0,
)


class BundleRequest(BaseModel):
    longitude: float = Field(..., ge=124, le=132)
    latitude: float = Field(..., ge=33, le=43)
    panel_capacity_w: int = 640
    panel_type: int = 1
    panel_angle: str = "35"
    cells_per_panel: int = 2
    skip_rule_check: bool = True
    bypass_cache: bool = False


class BundleResponse(BaseModel):
    bundle: dict[str, Any]
    panels_geojson: dict[str, Any]
    cache_hit: bool
    grid_key: str
    errors: list[str] = []


@app.get("/api/v1/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "cache_mode": cache.mode,
    }


@app.post("/api/v1/building-bundle", response_model=BundleResponse)
async def building_bundle(req: BundleRequest) -> BundleResponse:
    key = make_grid_key(req.longitude, req.latitude)

    if not req.bypass_cache:
        cached = cache.get(key)
        if cached:
            return BundleResponse(
                bundle=cached["bundle"],
                panels_geojson=cached["panels_geojson"],
                cache_hit=True,
                grid_key=key,
            )

    await rate_limiter.acquire()

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None,
        lambda: run_pipeline(
            lon=req.longitude,
            lat=req.latitude,
            panel_capacity_w=req.panel_capacity_w,
            panel_type=req.panel_type,
            cells_per_panel=req.cells_per_panel,
            angle=req.panel_angle,
            skip_rule_check=req.skip_rule_check,
        ),
    )

    if not result.roof_polygon_4326:
        raise HTTPException(
            status_code=404,
            detail={
                "message": "selectBuld: 좌표에 건물 미적중",
                "errors": result.errors,
                "grid_key": key,
            },
        )

    bundle = result_to_bundle(result)
    panels_geojson = result.panels_geojson

    cache.set(key, bundle, panels_geojson, source="live")

    return BundleResponse(
        bundle=bundle,
        panels_geojson=panels_geojson,
        cache_hit=False,
        grid_key=key,
        errors=result.errors,
    )
