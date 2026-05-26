import os
import traceback
from hmac import compare_digest
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .pipeline import create_request_diagnostics, debug_geometry_pipeline, run_hybrid_pipeline
from .schemas import (
    AdminConsultationStatusUpdateRequest,
    ClimateAnalysisRequest,
    ConsultationRequest,
    GeometryDebugRequest,
)
from .supabase_client import (
    check_supabase_health,
    list_admin_consultations,
    save_consultation_request,
    update_consultation_status,
)

app = FastAPI(title="SolarMate Climate Backend")

allowed_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "https://solar-power-eta.vercel.app",
]
allowed_origin_regex = r"https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+):\d+"

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=allowed_origin_regex,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AdminAccessError(Exception):
    def __init__(self, status_code: int = 401):
        self.status_code = status_code


@app.exception_handler(AdminAccessError)
async def admin_access_error_handler(_: Request, error: AdminAccessError):
    return JSONResponse(
        status_code=error.status_code,
        content={
            "ok": False,
            "message": "관리자 권한이 필요합니다.",
        },
    )


def require_admin_access(
    x_solarmate_admin_key: str | None = Header(default=None, alias="X-SolarMate-Admin-Key"),
):
    configured_key = os.getenv("SOLARMATE_ADMIN_KEY", "").strip()
    is_development = os.getenv("ENV", "").strip().lower() == "development"

    if not configured_key:
        if is_development:
            return True

        raise AdminAccessError(status_code=503)

    candidate_key = x_solarmate_admin_key.strip() if x_solarmate_admin_key else ""

    if not candidate_key or not compare_digest(candidate_key, configured_key):
        raise AdminAccessError(status_code=401)

    return True


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "solarmate-climate-backend",
    }


@app.get("/api/db-health")
def db_health():
    return check_supabase_health()


@app.get("/api/admin/consultations")
def admin_consultations(_: bool = Depends(require_admin_access)):
    result = list_admin_consultations()

    if result.get("ok") is True and isinstance(result.get("items"), list):
        return result["items"]

    return JSONResponse(
        status_code=503,
        content={
            "ok": False,
            "message": "관리자 상담 정보를 불러오지 못했습니다.",
        },
    )


@app.patch("/api/admin/consultations/{consultation_id}/status")
def admin_update_consultation_status(
    consultation_id: str,
    payload: AdminConsultationStatusUpdateRequest,
    _: bool = Depends(require_admin_access),
):
    result = update_consultation_status(consultation_id, payload.status)

    if result.get("ok") is True:
        return {
            "ok": True,
            "id": result.get("id") or consultation_id,
            "status": result.get("status") or payload.status,
        }

    status_code = 404 if result.get("errorType") == "NotFound" else 503

    return JSONResponse(
        status_code=status_code,
        content={
            "ok": False,
            "message": "상담 상태를 변경하지 못했습니다.",
        },
    )


@app.get("/debug/cors")
def debug_cors():
    return {
        "ok": True,
        "allowed_origins": allowed_origins,
        "message": "CORS debug endpoint",
    }


@app.post("/api/debug-echo")
async def debug_echo(payload: dict[str, Any], request: Request):
    return {
        "ok": True,
        "received": payload,
        "headers": {
            "origin": request.headers.get("origin"),
            "content_type": request.headers.get("content-type"),
        },
    }


@app.post("/api/climate-rooftop-analysis")
async def climate_rooftop_analysis(payload: ClimateAnalysisRequest):
    try:
        return await run_hybrid_pipeline(payload)
    except Exception as error:
        traceback.print_exc()

        return {
            "ok": False,
            "source": "external-fastapi-climate-backend",
            "fallbackRecommended": True,
            "message": "백엔드 climate 분석 중 오류가 발생했습니다. 기본 패널 배치를 유지합니다.",
            "errorType": type(error).__name__,
            "error": str(error),
            "trace": traceback.format_exc().splitlines()[-15:],
            "diagnostics": create_request_diagnostics(payload),
        }


@app.post("/api/consultations")
async def create_consultation(payload: ConsultationRequest):
    name = payload.name.strip() if payload.name else ""
    contact = payload.contact.strip() if payload.contact else ""

    if not name:
        return {
            "ok": False,
            "message": "이름을 입력해주세요.",
            "errorType": "ValidationError",
            "error": "name is required.",
        }

    if not contact:
        return {
            "ok": False,
            "message": "연락처를 입력해주세요.",
            "errorType": "ValidationError",
            "error": "contact is required.",
        }

    if payload.privacyAgreed is not True:
        return {
            "ok": False,
            "message": "개인정보 수집 및 이용에 동의해주세요.",
            "errorType": "ValidationError",
            "error": "privacyAgreed must be true.",
        }

    save_result = save_consultation_request(
        {
            "name": name,
            "contact": contact,
            "email": payload.email.strip() if payload.email else None,
            "consultation_type": payload.consultationType.strip() if payload.consultationType else None,
            "content": payload.content.strip() if payload.content else None,
            "road_address": payload.roadAddress.strip() if payload.roadAddress else None,
            "jibun_address": payload.jibunAddress.strip() if payload.jibunAddress else None,
            "analysis_result_id": payload.analysisResultId.strip() if payload.analysisResultId else None,
            "privacy_agreed": payload.privacyAgreed,
            "third_party_agreed": payload.thirdPartyAgreed,
            "agent_payload": payload.agentPayload,
            "status": "received",
        }
    )

    if save_result.get("ok") is True and isinstance(save_result.get("id"), str):
        return {
            "ok": True,
            "consultationRequestId": save_result["id"],
            "message": "상담 신청이 접수되었습니다.",
        }

    return {
        "ok": False,
        "message": "상담 신청 저장 중 오류가 발생했습니다.",
        "errorType": save_result.get("errorType"),
        "reason": save_result.get("reason"),
        "error": save_result.get("error") or save_result.get("reason") or "consultation save failed.",
    }


@app.post("/api/debug-geometry")
async def debug_geometry(payload: GeometryDebugRequest):
    try:
        return debug_geometry_pipeline(payload)
    except Exception as error:
        traceback.print_exc()

        return {
            "ok": False,
            "errorType": type(error).__name__,
            "error": str(error),
            "trace": traceback.format_exc().splitlines()[-15:],
        }
