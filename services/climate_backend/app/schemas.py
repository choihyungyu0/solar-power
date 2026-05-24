from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class ClimateAnalysisRequest(BaseModel):
    longitude: float
    latitude: float
    selectedBuildingId: Optional[str] = None
    selectedBuildingFeature: Optional[dict[str, Any]] = None
    panelCapacityW: int = 640
    panelAngle: int = 35
    panelType: int = 1
    cellsPerPanel: int = 2
    mode: Literal["fast", "full"] = "fast"


class ClimateAnalysisResponse(BaseModel):
    ok: bool
    source: str = "external-fastapi-climate-backend"
    message: Optional[str] = None
    roofSource: Optional[str] = None
    bundle: Optional[dict[str, Any]] = None
    panelsGeojson: Optional[dict[str, Any]] = None
    fallbackRecommended: bool = False
    diagnostics: dict[str, Any] = Field(default_factory=dict)


class GeometryDebugRequest(BaseModel):
    selectedBuildingId: Optional[str] = None
    selectedBuildingFeature: dict[str, Any]
