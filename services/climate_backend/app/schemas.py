from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class ClimateAnalysisRequest(BaseModel):
    longitude: float
    latitude: float
    selectedBuildingId: Optional[str] = None
    selectedAnalysisSessionId: Optional[str] = None
    selectedBuildingFeature: Optional[dict[str, Any]] = None
    panelCapacityW: int = 640
    panelAngle: int = 35
    panelType: int = 1
    cellsPerPanel: int = 2
    mode: Literal["fast", "full"] = "fast"


class ClimateAnalysisResponse(BaseModel):
    ok: bool
    source: str = "external-fastapi-climate-backend"
    selectedBuildingId: Optional[str] = None
    selectedAnalysisSessionId: Optional[str] = None
    analysisResultId: Optional[str] = None
    dbSaveStatus: Optional[dict[str, Any]] = None
    message: Optional[str] = None
    roofSource: Optional[str] = None
    roofPolygon4326: Optional[dict[str, Any]] = None
    roofAreaM2: Optional[float] = None
    bundle: Optional[dict[str, Any]] = None
    panelsGeojson: Optional[dict[str, Any]] = None
    aiSimulationResult: Optional[dict[str, Any]] = None
    agentPayload: Optional[dict[str, Any]] = None
    aiModelMetadata: Optional[dict[str, Any]] = None
    fallbackRecommended: bool = False
    diagnostics: dict[str, Any] = Field(default_factory=dict)


class GeometryDebugRequest(BaseModel):
    selectedBuildingId: Optional[str] = None
    selectedBuildingFeature: dict[str, Any]


class ConsultationRequest(BaseModel):
    name: Optional[str] = None
    contact: Optional[str] = None
    email: Optional[str] = None
    consultationType: Optional[str] = None
    content: Optional[str] = None
    roadAddress: Optional[str] = None
    jibunAddress: Optional[str] = None
    analysisResultId: Optional[str] = None
    privacyAgreed: bool = False
    thirdPartyAgreed: bool = False
    agentPayload: Optional[dict[str, Any]] = None
