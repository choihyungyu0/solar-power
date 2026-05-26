import traceback
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from .pipeline import create_request_diagnostics, debug_geometry_pipeline, run_hybrid_pipeline
from .schemas import ClimateAnalysisRequest, ConsultationRequest, GeometryDebugRequest
from .supabase_client import check_supabase_health, save_consultation_request

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


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "solarmate-climate-backend",
    }


@app.get("/api/db-health")
def db_health():
    return check_supabase_health()


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
