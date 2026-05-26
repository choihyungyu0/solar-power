import os
import traceback
from hmac import compare_digest
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .pipeline import create_request_diagnostics, debug_geometry_pipeline, run_hybrid_pipeline
from .profit_report_agent import build_profit_report, build_profit_report_markdown
from .schemas import (
    AdminConsultationStatusUpdateRequest,
    ClimateAnalysisRequest,
    ConsultationRequest,
    GeometryDebugRequest,
    ProfitReportRequest,
)
from .supabase_client import (
    check_supabase_health,
    find_recent_duplicate_consultation_request,
    get_consultation_profit_report,
    get_analysis_result_by_id,
    get_latest_profit_report_by_analysis_result,
    get_latest_subsidy_program,
    list_admin_consultations,
    save_consultation_request,
    save_loan_scenario,
    save_profit_report,
    update_consultation_status,
)

app = FastAPI(title="SolarMate Climate Backend")
MANUAL_TEST_SOURCE = "manual-production-test"
CONSULTATION_DUPLICATE_WINDOW_MINUTES = 5
CONSULTATION_FIELD_LIMITS = {
    "name": 50,
    "contact": 50,
    "email": 120,
    "content": 2000,
}

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


def _is_record(value: Any) -> bool:
    return isinstance(value, dict)


def _compact_save_status(prefix: str, save_result: dict[str, Any]) -> dict[str, Any]:
    status = {
        f"{prefix}Ok": save_result.get("ok") is True,
        f"{prefix}Id": save_result.get("id") if isinstance(save_result.get("id"), str) else None,
    }

    if save_result.get("ok") is not True:
        if save_result.get("errorType"):
            status[f"{prefix}ErrorType"] = str(save_result.get("errorType"))

        if save_result.get("reason"):
            status[f"{prefix}Reason"] = str(save_result.get("reason"))

    return status


def _read_persistence_marker(payload: Any, default_source: str) -> tuple[bool, str]:
    is_test = getattr(payload, "isTest", False) is True
    source = getattr(payload, "source", None)

    if isinstance(source, str) and source.strip():
        return is_test, source.strip()

    return is_test, MANUAL_TEST_SOURCE if is_test else default_source


def _validate_text_limit(label: str, value: str | None, max_length: int) -> dict[str, Any] | None:
    if value is not None and len(value) > max_length:
        return {
            "ok": False,
            "message": f"{label}은(는) 최대 {max_length}자까지 입력할 수 있습니다.",
            "errorType": "ValidationError",
        }

    return None


def _extract_region_for_subsidy(agent_payload: dict[str, Any]) -> tuple[str, str | None]:
    location = None
    subsidy_rag_input = agent_payload.get("subsidyRagInput")

    if isinstance(subsidy_rag_input, dict):
        location = subsidy_rag_input.get("location")

    address = ""

    if isinstance(location, dict):
        address = str(location.get("roadAddress") or location.get("jibunAddress") or "")
    elif isinstance(location, str):
        address = location

    region_sido = "경기도" if "경기" in address or not address else address.split()[0]
    region_sigungu = None

    parts = address.split()
    if len(parts) >= 2 and parts[0].startswith("경기"):
        region_sigungu = parts[1]

    return region_sido, region_sigungu


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


@app.get("/api/admin/consultations/{consultation_id}/profit-report")
def admin_consultation_profit_report(
    consultation_id: str,
    _: bool = Depends(require_admin_access),
):
    result = get_consultation_profit_report(consultation_id)

    if result.get("ok") is True and isinstance(result.get("row"), dict):
        row = result["row"]
        report = row.get("report_json") if isinstance(row.get("report_json"), dict) else {}
        report_markdown = row.get("report_markdown")
        loan_scenario = row.get("loan_scenario") if isinstance(row.get("loan_scenario"), dict) else None

        if loan_scenario is None and isinstance(report.get("loanSupportScenario"), dict):
            loan_scenario = report["loanSupportScenario"]

        return {
            "ok": True,
            "consultationId": result.get("consultationId") or consultation_id,
            "analysisResultId": result.get("analysisResultId"),
            "profitReportId": row.get("id"),
            "report": report,
            "reportMarkdown": report_markdown if isinstance(report_markdown, str) else "",
            "loanScenario": loan_scenario,
            "createdAt": row.get("created_at"),
        }

    if result.get("errorType") == "NotFound" and result.get("analysisResultId"):
        message = "연결된 수익 리포트가 없습니다."
    elif result.get("errorType") == "NoLinkedAnalysis":
        message = "연결된 분석 결과가 없습니다."
    elif result.get("errorType") == "NotFound":
        message = "상담 신청을 찾을 수 없습니다."
    else:
        message = "연결된 수익 리포트를 불러오지 못했습니다."

    return JSONResponse(
        status_code=404 if result.get("errorType") in {"NotFound", "NoLinkedAnalysis"} else 503,
        content={
            "ok": False,
            "message": message,
            "errorType": result.get("errorType"),
        },
    )


@app.post("/api/ai-profit-report")
async def create_ai_profit_report(payload: ProfitReportRequest):
    analysis_result_id = payload.analysisResultId.strip() if payload.analysisResultId else None
    ai_simulation_result = payload.aiSimulationResult if isinstance(payload.aiSimulationResult, dict) else None
    agent_payload = payload.agentPayload if isinstance(payload.agentPayload, dict) else None
    is_test, persistence_source = _read_persistence_marker(payload, "ai-profit-report-agent")
    loaded_analysis_row: dict[str, Any] | None = None

    if analysis_result_id:
        load_result = get_analysis_result_by_id(analysis_result_id)

        if load_result.get("ok") is True and isinstance(load_result.get("row"), dict):
            loaded_analysis_row = load_result["row"]
            ai_simulation_result = (
                ai_simulation_result
                if _is_record(ai_simulation_result)
                else loaded_analysis_row.get("ai_simulation_result")
            )
            agent_payload = (
                agent_payload
                if _is_record(agent_payload)
                else loaded_analysis_row.get("agent_payload")
            )
        elif not _is_record(ai_simulation_result) or not _is_record(agent_payload):
            return JSONResponse(
                status_code=404 if load_result.get("errorType") == "NotFound" else 503,
                content={
                    "ok": False,
                    "message": "분석 결과를 불러오지 못했습니다.",
                    "errorType": load_result.get("errorType"),
                    "reason": load_result.get("reason"),
                },
            )

    if not _is_record(ai_simulation_result):
        return JSONResponse(
            status_code=400,
            content={
                "ok": False,
                "message": "aiSimulationResult가 필요합니다.",
                "errorType": "ValidationError",
            },
        )

    if not _is_record(agent_payload):
        candidate_agent_payload = ai_simulation_result.get("agentPayload")
        agent_payload = candidate_agent_payload if _is_record(candidate_agent_payload) else None

    if not _is_record(agent_payload) or not _is_record(agent_payload.get("reportInputMetrics")):
        return JSONResponse(
            status_code=400,
            content={
                "ok": False,
                "message": "agentPayload.reportInputMetrics가 필요합니다.",
                "errorType": "ValidationError",
            },
        )

    if analysis_result_id:
        agent_payload["analysisResultId"] = analysis_result_id
        ai_simulation_result["analysisResultId"] = analysis_result_id

        if payload.forceRegenerate is not True:
            existing_report_result = get_latest_profit_report_by_analysis_result(analysis_result_id)

            if (
                existing_report_result.get("ok") is True
                and isinstance(existing_report_result.get("row"), dict)
            ):
                existing_row = existing_report_result["row"]
                existing_report = existing_row.get("report_json")
                existing_markdown = existing_row.get("report_markdown")

                if isinstance(existing_report, dict):
                    if not isinstance(existing_markdown, str) or not existing_markdown:
                        existing_markdown = build_profit_report_markdown(existing_report)

                    return {
                        "ok": True,
                        "profitReportId": existing_row.get("id") if isinstance(existing_row.get("id"), str) else None,
                        "report": existing_report,
                        "reportMarkdown": existing_markdown,
                        "dbSaveStatus": {
                            "enabled": True,
                            "profitReportOk": True,
                            "profitReportId": existing_row.get("id") if isinstance(existing_row.get("id"), str) else None,
                            "loanScenarioOk": True,
                            "reusedExisting": True,
                        },
                    }

    region_sido, region_sigungu = _extract_region_for_subsidy(agent_payload)
    subsidy_program_result = get_latest_subsidy_program(
        region_sido=region_sido,
        region_sigungu=region_sigungu,
        target_building_type=None,
    )
    policy_data = (
        subsidy_program_result.get("row")
        if subsidy_program_result.get("ok") is True and isinstance(subsidy_program_result.get("row"), dict)
        else None
    )
    user_finance_input = payload.userFinanceInput.dict(exclude_none=True) if payload.userFinanceInput else None

    try:
        report = build_profit_report(
            agent_payload=agent_payload,
            ai_simulation_result=ai_simulation_result,
            user_finance_input=user_finance_input,
            policy_data=policy_data,
        )
        report_markdown = build_profit_report_markdown(report)
    except Exception as error:
        return JSONResponse(
            status_code=400,
            content={
                "ok": False,
                "message": "AI 수익 리포트를 생성하지 못했습니다.",
                "errorType": type(error).__name__,
                "reason": str(error),
            },
        )

    disclaimer = "\n".join(report.get("riskDisclaimers", []))
    profit_save_result = save_profit_report(
        {
            "analysis_result_id": analysis_result_id,
            "consultation_request_id": None,
            "report_type": report.get("reportType") or "solar_profit_report",
            "report_status": "generated",
            "input_payload": {
                "analysisResultId": analysis_result_id,
                "agentPayload": agent_payload,
                "userFinanceInput": user_finance_input,
                "isTest": is_test,
                "source": persistence_source,
                "loadedAnalysisCreatedAt": loaded_analysis_row.get("created_at") if loaded_analysis_row else None,
            },
            "is_test": is_test,
            "source": persistence_source,
            "subsidy_matrix": report.get("subsidyMatrix"),
            "loan_scenario": report.get("loanSupportScenario"),
            "report_json": report,
            "report_markdown": report_markdown,
            "disclaimer": disclaimer,
        }
    )
    loan_scenario = report.get("loanSupportScenario") if isinstance(report.get("loanSupportScenario"), dict) else {}
    loan_save_result = save_loan_scenario(
        {
            "analysis_result_id": analysis_result_id,
            "loan_basis": loan_scenario.get("loanBasis"),
            "loan_years": loan_scenario.get("loanYears"),
            "loan_coverage_ratio": loan_scenario.get("loanCoverageRatio"),
            "estimated_loan_limit_krw": loan_scenario.get("estimatedLoanLimitKrw"),
            "annual_revenue_basis_krw": loan_scenario.get("annualRevenueBasisKrw"),
            "monthly_payment_estimate_krw": loan_scenario.get("monthlyPaymentEstimateKrw"),
            "note": loan_scenario.get("note"),
            "raw_payload": loan_scenario,
            "is_test": is_test,
            "source": persistence_source,
        }
    )
    db_save_status = {
        "enabled": profit_save_result.get("enabled") is True or loan_save_result.get("enabled") is True,
        **_compact_save_status("profitReport", profit_save_result),
        **_compact_save_status("loanScenario", loan_save_result),
    }

    return {
        "ok": True,
        "profitReportId": profit_save_result.get("id") if isinstance(profit_save_result.get("id"), str) else None,
        "report": report,
        "reportMarkdown": report_markdown,
        "dbSaveStatus": db_save_status,
    }


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
    email = payload.email.strip() if payload.email else None
    content = payload.content.strip() if payload.content else None
    road_address = payload.roadAddress.strip() if payload.roadAddress else None
    jibun_address = payload.jibunAddress.strip() if payload.jibunAddress else None
    analysis_result_id = payload.analysisResultId.strip() if payload.analysisResultId else None
    is_test, persistence_source = _read_persistence_marker(payload, "consultation-form")

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

    for validation_error in (
        _validate_text_limit("이름", name, CONSULTATION_FIELD_LIMITS["name"]),
        _validate_text_limit("연락처", contact, CONSULTATION_FIELD_LIMITS["contact"]),
        _validate_text_limit("이메일", email, CONSULTATION_FIELD_LIMITS["email"]),
        _validate_text_limit("상담 내용", content, CONSULTATION_FIELD_LIMITS["content"]),
    ):
        if validation_error:
            return validation_error

    duplicate_result = find_recent_duplicate_consultation_request(
        contact=contact,
        analysis_result_id=analysis_result_id,
        road_address=road_address,
        window_minutes=CONSULTATION_DUPLICATE_WINDOW_MINUTES,
    )

    if duplicate_result.get("ok") is True and isinstance(duplicate_result.get("id"), str):
        return {
            "ok": True,
            "consultationRequestId": duplicate_result["id"],
            "message": "이미 접수된 상담 신청입니다.",
        }

    agent_payload = payload.agentPayload if isinstance(payload.agentPayload, dict) else {}

    if payload.profitReportId:
        agent_payload = {
            **agent_payload,
            "profitReportId": payload.profitReportId.strip(),
        }

    save_result = save_consultation_request(
        {
            "name": name,
            "contact": contact,
            "email": email,
            "consultation_type": payload.consultationType.strip() if payload.consultationType else None,
            "content": content,
            "road_address": road_address,
            "jibun_address": jibun_address,
            "analysis_result_id": analysis_result_id,
            "privacy_agreed": payload.privacyAgreed,
            "third_party_agreed": payload.thirdPartyAgreed,
            "agent_payload": agent_payload or None,
            "status": "received",
            "is_test": is_test,
            "source": persistence_source,
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
