from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any

from .subsidy_table import classify_housing_type, estimate_subsidy


DEFAULT_SUBSIDY_PROGRAM_NAME = "보조금 공고 확인 필요"
DEFAULT_SUBSIDY_POLICY_MODE = "housing_type_based_policy"
DEFAULT_SUBSIDY_STACKING_REASON = "주택 유형별 적용 제도를 분기하며 중복 합산하지 않음"
REPORT_TYPE = "solar_profit_report"
SCHEMA_VERSION = "solarmate-profit-report-v1"
DEFAULT_LOAN_YEARS = 5
DEFAULT_LOAN_COVERAGE_RATIO = 0.4
DEFAULT_OPENAI_MODEL = "gpt-4o-mini"
APARTMENT_POLICY_MODE = "knrec_apartment_low_carbon_module"
DETACHED_POLICY_MODE = "gyeonggi_detached_home_3kw"
LLM_REPORT_NARRATIVE_SOURCE = "llm-structured-output"
DETERMINISTIC_REPORT_NARRATIVE_SOURCE = "deterministic-template"
LLM_UNSAFE_CLAIM_PATTERNS = (
    "보장됩니다",
    "확정됩니다",
    "무조건",
    "반드시 지원",
    "반드시 승인",
    "보조금 지급 확정",
    "대출 승인 확정",
    "절감 보장",
    "수익 보장",
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_record(value: Any) -> bool:
    return isinstance(value, dict)


def _as_float(value: Any, fallback: float = 0) -> float:
    if isinstance(value, bool):
        return fallback

    if isinstance(value, (int, float)):
        return float(value)

    if isinstance(value, str):
        try:
            return float(value.replace(",", "").strip())
        except ValueError:
            return fallback

    return fallback


def _as_int(value: Any, fallback: int = 0) -> int:
    return round(_as_float(value, fallback))


def _clamp(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(max_value, value))


def _money(value: Any) -> int:
    return max(0, _as_int(value))


def _round(value: Any, digits: int = 1) -> float:
    return round(_as_float(value), digits)


def _get_path(value: dict[str, Any], *keys: str) -> Any:
    current: Any = value

    for key in keys:
        if not isinstance(current, dict):
            return None

        current = current.get(key)

    return current


def _is_llm_profit_report_enabled() -> bool:
    return False


def _get_openai_model_name() -> str:
    return os.getenv("OPENAI_MODEL", "").strip() or DEFAULT_OPENAI_MODEL


def _get_report_input_metrics(agent_payload: dict[str, Any]) -> dict[str, Any]:
    metrics = agent_payload.get("reportInputMetrics")

    return metrics if isinstance(metrics, dict) else {}


def _get_location(agent_payload: dict[str, Any]) -> dict[str, Any] | str:
    location = _get_path(agent_payload, "subsidyRagInput", "location")

    if isinstance(location, (dict, str)):
        return location

    return "경기도"


def _location_to_text(location: Any) -> str:
    if isinstance(location, dict):
        return " ".join(
            str(location.get(key) or "")
            for key in ("roadAddress", "jibunAddress", "address", "regionSido", "regionSigungu")
        ).strip()

    return str(location or "").strip()


def _resolve_report_housing_type(agent_payload: dict[str, Any], metrics: dict[str, Any]) -> str:
    subsidy_rag_input = _get_path(agent_payload, "subsidyRagInput")
    subsidy_rag_input = subsidy_rag_input if isinstance(subsidy_rag_input, dict) else {}

    for value in (subsidy_rag_input.get("housingType"), metrics.get("housingType")):
        if value in ("apartment", "detached"):
            return str(value)

    location_text = _location_to_text(_get_location(agent_payload))
    candidate_text = " ".join(
        str(value or "")
        for value in (
            subsidy_rag_input.get("buildingUsage"),
            subsidy_rag_input.get("buildingName"),
            metrics.get("buildingUsage"),
            location_text,
        )
    )
    classified_type = classify_housing_type(candidate_text)

    if classified_type in ("apartment", "detached"):
        return classified_type

    if metrics.get("subsidyPolicyMode") == APARTMENT_POLICY_MODE or subsidy_rag_input.get("subsidyPolicyMode") == APARTMENT_POLICY_MODE:
        return "apartment"

    # Existing stored payloads sometimes marked unknown buildings as detached
    # because the old fallback used the 3kW Gyeonggi home-solar path. For this
    # apartment/public-housing product, unknown housing data should stay on the
    # apartment/common-housing subsidy path until field documents say otherwise.
    return "apartment"


def _resolve_install_capacity_kw(agent_payload: dict[str, Any], metrics: dict[str, Any]) -> float:
    subsidy_rag_input = _get_path(agent_payload, "subsidyRagInput")
    subsidy_rag_input = subsidy_rag_input if isinstance(subsidy_rag_input, dict) else {}

    return _as_float(
        metrics.get("installCapacityKw")
        or subsidy_rag_input.get("installCapacityKw")
        or _get_path(agent_payload, "reportInputMetrics", "installCapacityKw")
    )


def _format_krw(value: Any) -> str:
    return f"{_money(value):,}원"


def _format_kwh(value: Any) -> str:
    return f"{_money(value):,}kWh"


def _format_years(value: Any) -> str:
    years = _as_float(value)

    if years <= 0:
        return "확인 필요"

    return f"{years:.1f}년"


def _normalize_finance_input(user_finance_input: dict[str, Any] | None) -> dict[str, Any]:
    source = user_finance_input if isinstance(user_finance_input, dict) else {}
    preferred_loan_years = _as_int(source.get("preferredLoanYears"), DEFAULT_LOAN_YEARS)
    loan_coverage_ratio = _as_float(source.get("loanCoverageRatio"), DEFAULT_LOAN_COVERAGE_RATIO)

    if loan_coverage_ratio > 1:
        loan_coverage_ratio = loan_coverage_ratio / 100

    return {
        "availableCashKrw": _money(source.get("availableCashKrw")),
        "preferredLoanYears": int(_clamp(preferred_loan_years, 1, 10)),
        "loanCoverageRatio": _clamp(loan_coverage_ratio, 0, 1),
    }


def build_subsidy_matrix(
    agent_payload: dict[str, Any],
    policy_data: dict[str, Any] | None,
) -> dict[str, Any]:
    metrics = _get_report_input_metrics(agent_payload)
    policy = policy_data if isinstance(policy_data, dict) else {}
    subsidy_rag_input = _get_path(agent_payload, "subsidyRagInput")
    subsidy_rag_input = subsidy_rag_input if isinstance(subsidy_rag_input, dict) else {}
    housing_type = _resolve_report_housing_type(agent_payload, metrics)
    install_cost_krw = _money(
        policy.get("estimated_install_cost_krw")
        or metrics.get("estimatedInstallCostKrw")
        or subsidy_rag_input.get("estimatedInstallCostKrw")
    )
    install_capacity_kw = _resolve_install_capacity_kw(agent_payload, metrics)
    subsidy_detail = estimate_subsidy(
        install_cost_krw,
        policy.get("region_sigungu") or _location_to_text(_get_location(agent_payload)),
        housing_type=housing_type,
        capacity_kw=install_capacity_kw,
    )
    program_name = (
        policy.get("program_name")
        or policy.get("source_title")
        or subsidy_detail.get("program")
        or metrics.get("subsidyProgramName")
        or subsidy_rag_input.get("subsidyProgramName")
        or DEFAULT_SUBSIDY_PROGRAM_NAME
    )
    policy_mode = (
        policy.get("policy_mode")
        or (APARTMENT_POLICY_MODE if housing_type == "apartment" else DETACHED_POLICY_MODE)
        or DEFAULT_SUBSIDY_POLICY_MODE
    )
    stacking_note = (
        policy.get("stacking_note")
        or subsidy_detail.get("disclaimer")
        or metrics.get("subsidyStackingReason")
        or subsidy_rag_input.get("subsidyStackingReason")
        or DEFAULT_SUBSIDY_STACKING_REASON
    )
    subsidy_estimate_krw = _money(
        policy.get("subsidy_amount_krw")
        or policy.get("max_subsidy_krw")
        or subsidy_detail.get("subsidyKrw")
    )
    subsidy_rate = policy.get("subsidy_rate")

    return {
        "programName": program_name,
        "policyMode": policy_mode,
        "supportType": policy.get("support_type") or "주택태양광 설치 보조금",
        "regionSido": policy.get("region_sido") or ("전국" if housing_type == "apartment" else "경기도"),
        "regionSigungu": policy.get("region_sigungu") or (subsidy_detail.get("sigungu") or "확인 필요"),
        "targetBuildingType": policy.get("target_building_type") or ("공동주택/아파트" if housing_type == "apartment" else "단독주택"),
        "subsidyEstimateKrw": subsidy_estimate_krw,
        "subsidyAmountKrw": _money(policy.get("subsidy_amount_krw")) or subsidy_estimate_krw or None,
        "subsidyRate": _as_float(subsidy_rate) if subsidy_rate is not None else None,
        "maxSubsidyKrw": _money(policy.get("max_subsidy_krw")) or subsidy_estimate_krw,
        "stackingAllowed": False,
        "stackingNote": stacking_note,
        "eligibilityNote": policy.get("eligibility_note")
        or subsidy_detail.get("disclaimer")
        or "실제 지원 여부는 최신 공고, 예산 잔여 여부, 대상 요건 확인이 필요합니다.",
        "sourceTitle": policy.get("source_title") or f"{program_name} 공고 확인 필요",
        "sourceUrl": policy.get("source_url"),
        "sourceYear": policy.get("source_year"),
        "status": "확인 필요",
        "housingType": housing_type,
        "subsidyDetail": subsidy_detail,
    }


def build_loan_scenario(
    agent_payload: dict[str, Any],
    user_finance_input: dict[str, Any] | None,
    subsidy_matrix: dict[str, Any] | None = None,
) -> dict[str, Any]:
    metrics = _get_report_input_metrics(agent_payload)
    finance_input = _normalize_finance_input(user_finance_input)
    loan_years = finance_input["preferredLoanYears"]
    loan_coverage_ratio = finance_input["loanCoverageRatio"]
    install_cost_krw = _money(metrics.get("estimatedInstallCostKrw"))
    subsidy_estimate_krw = _money(subsidy_matrix.get("subsidyEstimateKrw")) if isinstance(subsidy_matrix, dict) else 0
    corrected_self_payment_krw = max(0, install_cost_krw - subsidy_estimate_krw) if install_cost_krw > 0 else 0
    self_payment_estimate_krw = corrected_self_payment_krw or _money(metrics.get("selfPaymentEstimateKrw"))
    annual_revenue_basis_krw = _money(metrics.get("annualSavingKrw"))
    estimated_loan_limit_krw = min(
        self_payment_estimate_krw,
        _money(annual_revenue_basis_krw * loan_years * loan_coverage_ratio),
    )
    monthly_payment_estimate_krw = (
        round(estimated_loan_limit_krw / (loan_years * 12))
        if loan_years > 0 and estimated_loan_limit_krw > 0
        else 0
    )

    return {
        "loanBasis": "예상 연간 절감액 기반 정책자금/금융 지원 검토 시나리오",
        "loanYears": loan_years,
        "loanCoverageRatio": round(loan_coverage_ratio, 2),
        "estimatedLoanLimitKrw": estimated_loan_limit_krw,
        "annualRevenueBasisKrw": annual_revenue_basis_krw,
        "monthlyPaymentEstimateKrw": monthly_payment_estimate_krw,
        "availableCashKrw": finance_input["availableCashKrw"],
        "loanApprovalStatus": "금융기관 심사 필요",
        "note": "대출 가능 금액과 조건은 추정값이며 실제 승인 여부는 금융기관 심사와 정책자금 공고 확인이 필요합니다.",
    }


def calculate_net_investment(
    report_input_metrics: dict[str, Any],
    subsidy_matrix: dict[str, Any],
    loan_scenario: dict[str, Any],
) -> dict[str, Any]:
    install_cost_krw = _money(report_input_metrics.get("estimatedInstallCostKrw"))
    subsidy_estimate_krw = _money(subsidy_matrix.get("subsidyEstimateKrw"))
    estimated_loan_limit_krw = _money(loan_scenario.get("estimatedLoanLimitKrw"))
    self_payment_before_loan_krw = max(0, install_cost_krw - subsidy_estimate_krw)
    cash_needed_krw = max(0, install_cost_krw - subsidy_estimate_krw - estimated_loan_limit_krw)
    annual_saving_krw = _money(report_input_metrics.get("annualSavingKrw"))
    payback_years = (
        round(self_payment_before_loan_krw / annual_saving_krw, 1)
        if annual_saving_krw > 0 and self_payment_before_loan_krw > 0
        else _round(report_input_metrics.get("paybackYears"))
    )

    return {
        "estimatedInstallCostKrw": install_cost_krw,
        "subsidyEstimateKrw": subsidy_estimate_krw,
        "selfPaymentBeforeLoanKrw": self_payment_before_loan_krw,
        "estimatedLoanLimitKrw": estimated_loan_limit_krw,
        "cashNeededKrw": cash_needed_krw,
        "annualSavingKrw": annual_saving_krw,
        "paybackYears": payback_years,
        "calculation": "installCost - subsidy - estimatedLoanLimit, minimum 0",
    }


def _build_building_summary(
    ai_simulation_result: dict[str, Any],
    agent_payload: dict[str, Any],
) -> dict[str, Any]:
    building = ai_simulation_result.get("building") if isinstance(ai_simulation_result.get("building"), dict) else {}
    roof = ai_simulation_result.get("roof") if isinstance(ai_simulation_result.get("roof"), dict) else {}

    return {
        "buildingName": building.get("buildingName") or building.get("name") or "선택 건물",
        "roadAddress": building.get("roadAddress") or _get_path(agent_payload, "subsidyRagInput", "location", "roadAddress"),
        "jibunAddress": building.get("jibunAddress") or _get_path(agent_payload, "subsidyRagInput", "location", "jibunAddress"),
        "roofAreaM2": roof.get("roofAreaM2"),
        "usableAreaM2": roof.get("usableAreaM2"),
        "location": _get_location(agent_payload),
    }


def _build_four_metrics(report_input_metrics: dict[str, Any], subsidy_matrix: dict[str, Any]) -> dict[str, Any]:
    program_name = subsidy_matrix.get("programName") or report_input_metrics.get("subsidyProgramName") or DEFAULT_SUBSIDY_PROGRAM_NAME
    policy_mode = subsidy_matrix.get("policyMode") or report_input_metrics.get("subsidyPolicyMode") or DEFAULT_SUBSIDY_POLICY_MODE
    install_cost_krw = _money(report_input_metrics.get("estimatedInstallCostKrw"))
    subsidy_estimate_krw = _money(subsidy_matrix.get("subsidyEstimateKrw"))
    self_payment_estimate_krw = max(0, install_cost_krw - subsidy_estimate_krw)

    return {
        "expectedGeneration": {
            "annualGenerationKwh": _money(report_input_metrics.get("annualGenerationKwh")),
            "monthlyGenerationKwh": report_input_metrics.get("monthlyGenerationKwh") or [],
        },
        "costAndSelfPayment": {
            "estimatedInstallCostKrw": install_cost_krw,
            "selfPaymentEstimateKrw": self_payment_estimate_krw,
        },
        "payback": {
            "annualSavingKrw": _money(report_input_metrics.get("annualSavingKrw")),
            "paybackYears": _round(report_input_metrics.get("paybackYears")),
        },
        "subsidyAndSuitability": {
            "subsidyProgramName": program_name,
            "subsidyPolicyMode": policy_mode,
            "subsidyStackingAllowed": report_input_metrics.get("subsidyStackingAllowed") is True,
            "installationSuitabilityScore": _as_int(report_input_metrics.get("installationSuitabilityScore")),
            "installationSuitabilityGrade": report_input_metrics.get("installationSuitabilityGrade") or "확인 필요",
            "installationSuitabilityLabel": report_input_metrics.get("installationSuitabilityLabel") or "검토 필요",
        },
    }


def _build_report_narrative(
    report_input_metrics: dict[str, Any],
    subsidy_matrix: dict[str, Any],
    loan_scenario: dict[str, Any],
    net_investment: dict[str, Any],
) -> dict[str, Any]:
    grade = report_input_metrics.get("installationSuitabilityGrade") or "검토"
    annual_generation = _format_kwh(report_input_metrics.get("annualGenerationKwh"))
    annual_saving = _format_krw(report_input_metrics.get("annualSavingKrw"))
    self_payment = _format_krw(net_investment.get("selfPaymentBeforeLoanKrw"))
    cash_needed = _format_krw(net_investment.get("cashNeededKrw"))
    payback = _format_years(net_investment.get("paybackYears"))
    loan_limit = _format_krw(loan_scenario.get("estimatedLoanLimitKrw"))
    program_name = subsidy_matrix.get("programName") or report_input_metrics.get("subsidyProgramName") or DEFAULT_SUBSIDY_PROGRAM_NAME

    return {
        "headline": f"AI 기준 설치 적합도 {grade}등급, 수익성 검토 가치가 있는 태양광 후보지입니다.",
        "summary": (
            f"예상 연간 발전량은 {annual_generation}, 예상 연간 절감/수익 기준은 {annual_saving}입니다. "
            f"{program_name} 기준 보조금 적용 후 예상 자부담은 {self_payment}이며, "
            f"추정 회수기간은 {payback}입니다."
        ),
        "salesMessage": (
            f"금융 지원 시나리오를 함께 검토하면 예상 대출 검토 한도는 {loan_limit}, "
            f"초기 현금 필요액은 {cash_needed}까지 낮아질 가능성이 있습니다. "
            "보조금 예산이 소진되기 전에 상담을 통해 가능 여부를 확인해보세요."
        ),
        "ctaText": "우리 아파트 태양광 설치하기",
        "ctaMessage": "우리 아파트 태양광 설치하기",
        "riskNotes": [],
    }


def _build_risk_disclaimers(agent_payload: dict[str, Any]) -> list[str]:
    field_checks = agent_payload.get("fieldCheckRequired")
    field_check_text = ", ".join(field_checks) if isinstance(field_checks, list) else "옥상 장애물, 구조안전성, 방수 상태"
    metrics = _get_report_input_metrics(agent_payload)
    program_name = metrics.get("subsidyProgramName") or _get_path(agent_payload, "subsidyRagInput", "subsidyProgramName") or DEFAULT_SUBSIDY_PROGRAM_NAME

    return [
        "본 리포트는 시뮬레이션 기반 예상·추정 결과이며 실제 발전량과 절감액을 보장하지 않습니다.",
        f"{program_name} 지원 여부와 금액은 최신 공고, 예산 잔여 여부, 대상 요건 확인이 필요합니다.",
        "보조금 제도는 유형별로 분기했으며 제도 간 중복 합산하지 않았습니다.",
        "대출 가능 금액과 조건은 추정 시나리오이며 실제 승인은 금융기관 심사가 필요합니다.",
        f"{field_check_text}는 AI 확정 항목이 아니며 현장조사와 관리주체 협의가 필요합니다.",
    ]


def _build_llm_sanitized_input(report_json: dict[str, Any]) -> dict[str, Any]:
    four_metrics = report_json.get("fourMetrics") if isinstance(report_json.get("fourMetrics"), dict) else {}
    generation = four_metrics.get("expectedGeneration") if isinstance(four_metrics.get("expectedGeneration"), dict) else {}
    cost = four_metrics.get("costAndSelfPayment") if isinstance(four_metrics.get("costAndSelfPayment"), dict) else {}
    payback = four_metrics.get("payback") if isinstance(four_metrics.get("payback"), dict) else {}
    suitability = (
        four_metrics.get("subsidyAndSuitability")
        if isinstance(four_metrics.get("subsidyAndSuitability"), dict)
        else {}
    )
    subsidy = report_json.get("subsidyMatrix") if isinstance(report_json.get("subsidyMatrix"), dict) else {}
    loan = report_json.get("loanSupportScenario") if isinstance(report_json.get("loanSupportScenario"), dict) else {}
    net = report_json.get("netInvestment") if isinstance(report_json.get("netInvestment"), dict) else {}
    disclaimers = report_json.get("riskDisclaimers") if isinstance(report_json.get("riskDisclaimers"), list) else []
    rag_context = (
        report_json.get("subsidyRagContext")
        if isinstance(report_json.get("subsidyRagContext"), dict)
        else {}
    )
    references = report_json.get("sourceReferences") if isinstance(report_json.get("sourceReferences"), list) else []
    rag_matches = rag_context.get("matches") if isinstance(rag_context.get("matches"), list) else []
    rag_context = (
        report_json.get("subsidyRagContext")
        if isinstance(report_json.get("subsidyRagContext"), dict)
        else {}
    )
    source_references = (
        report_json.get("sourceReferences")
        if isinstance(report_json.get("sourceReferences"), list)
        else []
    )

    return {
        "suitability": {
            "grade": suitability.get("installationSuitabilityGrade"),
            "score": suitability.get("installationSuitabilityScore"),
            "label": suitability.get("installationSuitabilityLabel"),
        },
        "generation": {
            "annualGenerationKwh": generation.get("annualGenerationKwh"),
            "annualGenerationText": _format_kwh(generation.get("annualGenerationKwh")),
        },
        "cost": {
            "estimatedInstallCostKrw": cost.get("estimatedInstallCostKrw"),
            "estimatedInstallCostText": _format_krw(cost.get("estimatedInstallCostKrw")),
            "subsidyEstimateKrw": subsidy.get("subsidyEstimateKrw"),
            "subsidyEstimateText": _format_krw(subsidy.get("subsidyEstimateKrw")),
            "selfPaymentBeforeLoanKrw": net.get("selfPaymentBeforeLoanKrw"),
            "selfPaymentBeforeLoanText": _format_krw(net.get("selfPaymentBeforeLoanKrw")),
            "cashNeededKrw": net.get("cashNeededKrw"),
            "cashNeededText": _format_krw(net.get("cashNeededKrw")),
        },
        "payback": {
            "annualSavingKrw": payback.get("annualSavingKrw"),
            "annualSavingText": _format_krw(payback.get("annualSavingKrw")),
            "paybackYears": net.get("paybackYears"),
            "paybackYearsText": _format_years(net.get("paybackYears")),
        },
        "subsidyPolicy": {
            "programName": subsidy.get("programName") or DEFAULT_SUBSIDY_PROGRAM_NAME,
            "policyMode": subsidy.get("policyMode") or DEFAULT_SUBSIDY_POLICY_MODE,
            "stackingAllowed": subsidy.get("stackingAllowed") is True,
            "eligibilityNote": subsidy.get("eligibilityNote"),
        },
        "loanScenario": {
            "loanBasis": loan.get("loanBasis"),
            "loanYears": loan.get("loanYears"),
            "loanCoverageRatio": loan.get("loanCoverageRatio"),
            "estimatedLoanLimitKrw": loan.get("estimatedLoanLimitKrw"),
            "estimatedLoanLimitText": _format_krw(loan.get("estimatedLoanLimitKrw")),
            "monthlyPaymentEstimateKrw": loan.get("monthlyPaymentEstimateKrw"),
            "monthlyPaymentEstimateText": _format_krw(loan.get("monthlyPaymentEstimateKrw")),
            "loanApprovalStatus": loan.get("loanApprovalStatus"),
            "note": loan.get("note"),
        },
        "subsidyRagContext": {
            "enabled": rag_context.get("enabled") is True,
            "query": rag_context.get("query"),
            "matches": [
                {
                    "chunkText": match.get("chunkText"),
                    "programName": match.get("programName"),
                    "regionSido": match.get("regionSido"),
                    "regionSigungu": match.get("regionSigungu"),
                    "subsidyAmountKrw": match.get("subsidyAmountKrw"),
                    "maxSubsidyKrw": match.get("maxSubsidyKrw"),
                    "selfPaymentKrw": match.get("selfPaymentKrw"),
                    "stackingAllowed": match.get("stackingAllowed"),
                    "sourceTitle": match.get("sourceTitle"),
                    "sourceYear": match.get("sourceYear"),
                    "similarity": match.get("similarity"),
                }
                for match in rag_context.get("matches", [])
                if isinstance(match, dict)
            ],
        },
        "sourceReferences": [
            reference
            for reference in source_references
            if isinstance(reference, dict)
        ],
        "disclaimers": [str(item) for item in disclaimers if isinstance(item, str)],
        "fixedCta": "우리 아파트 태양광 설치하기",
    }


def _build_llm_narrative_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["headline", "summary", "salesMessage", "ctaText", "riskNotes"],
        "properties": {
            "headline": {
                "type": "string",
            },
            "summary": {
                "type": "string",
            },
            "salesMessage": {
                "type": "string",
            },
            "ctaText": {
                "type": "string",
            },
            "riskNotes": {
                "type": "array",
                "items": {
                    "type": "string",
                },
            },
        },
    }


def _normalize_llm_narrative(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None

    headline = value.get("headline")
    summary = value.get("summary")
    sales_message = value.get("salesMessage")
    cta_text = value.get("ctaText")
    risk_notes = value.get("riskNotes")

    if not all(isinstance(item, str) and item.strip() for item in (headline, summary, sales_message, cta_text)):
        return None

    if not isinstance(risk_notes, list) or not all(isinstance(item, str) and item.strip() for item in risk_notes):
        return None

    normalized = {
        "headline": headline.strip(),
        "summary": summary.strip(),
        "salesMessage": sales_message.strip(),
        "ctaText": cta_text.strip(),
        "ctaMessage": cta_text.strip(),
        "riskNotes": [item.strip() for item in risk_notes],
    }
    combined_text = " ".join(
        [
            normalized["headline"],
            normalized["summary"],
            normalized["salesMessage"],
            normalized["ctaText"],
            " ".join(normalized["riskNotes"]),
        ]
    )

    if any(pattern in combined_text for pattern in LLM_UNSAFE_CLAIM_PATTERNS):
        return None

    return normalized


def generate_llm_report_narrative(report_json: dict[str, Any]) -> dict[str, Any]:
    if not _is_llm_profit_report_enabled():
        return {
            "ok": False,
            "enabled": False,
            "source": DETERMINISTIC_REPORT_NARRATIVE_SOURCE,
            "error": None,
        }

    api_key = os.getenv("OPENAI_API_KEY", "").strip()

    if not api_key:
        return {
            "ok": False,
            "enabled": False,
            "source": DETERMINISTIC_REPORT_NARRATIVE_SOURCE,
            "error": "OPENAI_API_KEY is not configured.",
        }

    try:
        from openai import OpenAI
    except Exception:
        return {
            "ok": False,
            "enabled": True,
            "source": DETERMINISTIC_REPORT_NARRATIVE_SOURCE,
            "error": "OpenAI SDK is not installed.",
        }

    sanitized_input = _build_llm_sanitized_input(report_json)
    model = _get_openai_model_name()
    schema = _build_llm_narrative_schema()

    try:
        client = OpenAI(api_key=api_key, timeout=12)
        completion = client.chat.completions.create(
            model=model,
            temperature=0.35,
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "solarmate_profit_report_narrative",
                    "strict": True,
                    "schema": schema,
                },
            },
            messages=[
                {
                    "role": "system",
                    "content": (
                        "너는 SolarMate의 AI 수익·보조금·금융 리포트 문장 편집자다. "
                        "한국어만 사용한다. 제공된 숫자를 재계산하거나 변경하지 말고, "
                        "제공된 formatted text 값을 그대로 인용한다. "
                        "'예상', '추정', '가능성', '검토', '확인 필요' 표현을 사용한다. "
                        "보조금 설명은 subsidyRagContext의 retrieved chunk와 sourceReferences만 근거로 사용한다. "
                        "retrieved context가 없으면 보조금 근거는 확인 필요라고 말한다. "
                        "검색된 근거에 없는 보조금 사업을 만들지 않는다. "
                        "보조금 제도 간 중복 합산을 하지 않는다. "
                        "보조금, 대출 승인, 절감액, 구조안전성, 장애물 상태를 보장하거나 확정하지 않는다. "
                        "출력은 반드시 요청된 JSON schema만 따른다."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "task": "숫자는 바꾸지 말고 SolarMate 수익 리포트 narrative 필드만 작성하세요.",
                            "allowedCta": "우리 아파트 태양광 설치하기",
                            "input": sanitized_input,
                        },
                        ensure_ascii=False,
                    ),
                },
            ],
        )
        content = completion.choices[0].message.content if completion.choices else None

        if not isinstance(content, str) or not content.strip():
            return {
                "ok": False,
                "enabled": True,
                "source": DETERMINISTIC_REPORT_NARRATIVE_SOURCE,
                "model": model,
                "error": "OpenAI response was empty.",
            }

        narrative = _normalize_llm_narrative(json.loads(content))

        if narrative is None:
            return {
                "ok": False,
                "enabled": True,
                "source": DETERMINISTIC_REPORT_NARRATIVE_SOURCE,
                "model": model,
                "error": "OpenAI response did not match the safe narrative schema.",
            }

        return {
            "ok": True,
            "enabled": True,
            "source": LLM_REPORT_NARRATIVE_SOURCE,
            "model": model,
            "narrative": narrative,
            "error": None,
        }
    except Exception:
        return {
            "ok": False,
            "enabled": True,
            "source": DETERMINISTIC_REPORT_NARRATIVE_SOURCE,
            "model": model,
            "error": "OpenAI narrative generation failed; deterministic template was used.",
        }


def _build_source_references(subsidy_rag_context: dict[str, Any]) -> list[dict[str, Any]]:
    references: list[dict[str, Any]] = []
    seen_keys: set[tuple[str, str, str]] = set()
    matches = subsidy_rag_context.get("matches") if isinstance(subsidy_rag_context.get("matches"), list) else []

    for match in matches:
        if not isinstance(match, dict):
            continue

        source_title = str(match.get("sourceTitle") or "보조금 RAG 근거").strip()
        source_url = str(match.get("sourceUrl") or "").strip()
        source_year = str(match.get("sourceYear") or "").strip()
        key = (source_title, source_url, source_year)

        if key in seen_keys:
            continue

        seen_keys.add(key)
        evidence_parts = [
            str(match.get("programName") or DEFAULT_SUBSIDY_PROGRAM_NAME),
            str(match.get("regionSido") or ""),
            str(match.get("regionSigungu") or ""),
        ]
        evidence_summary = " ".join(part for part in evidence_parts if part).strip()

        subsidy_amount = _money(match.get("subsidyAmountKrw")) if match.get("subsidyAmountKrw") is not None else None
        self_payment = _money(match.get("selfPaymentKrw")) if match.get("selfPaymentKrw") is not None else None

        if subsidy_amount is not None:
            evidence_summary = f"{evidence_summary} 보조금 {subsidy_amount:,}원".strip()

        if self_payment is not None:
            evidence_summary = f"{evidence_summary} 자부담 {self_payment:,}원".strip()

        references.append(
            {
                "sourceTitle": source_title,
                "sourceUrl": source_url or None,
                "sourceYear": match.get("sourceYear"),
                "evidenceSummary": evidence_summary or "보조금 근거 확인 필요",
            }
        )

    return references


def _load_subsidy_rag_context(agent_payload: dict[str, Any], report_input_metrics: dict[str, Any]) -> dict[str, Any]:
    try:
        from .subsidy_rag import (
            build_subsidy_rag_context,
            build_subsidy_rag_query,
            search_subsidy_chunks,
        )

        rag_query = build_subsidy_rag_query(agent_payload, report_input_metrics)
        matches_result = search_subsidy_chunks(
            query=rag_query["query"],
            region_sido=rag_query.get("regionSido"),
            region_sigungu=rag_query.get("regionSigungu"),
            match_count=5,
        )
        context = build_subsidy_rag_context(matches_result)

        if not context.get("query"):
            context["query"] = rag_query["query"]

        return context
    except Exception as error:
        return {
            "enabled": False,
            "ragEnabled": False,
            "query": "",
            "matches": [],
            "message": "보조금 RAG 검색을 건너뛰었습니다.",
            "errorType": type(error).__name__,
        }


def build_profit_report(
    agent_payload: dict[str, Any],
    ai_simulation_result: dict[str, Any],
    user_finance_input: dict[str, Any] | None = None,
    policy_data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    report_input_metrics = _get_report_input_metrics(agent_payload)

    if not report_input_metrics:
        raise ValueError("agentPayload.reportInputMetrics is required.")

    subsidy_matrix = build_subsidy_matrix(agent_payload, policy_data)
    loan_scenario = build_loan_scenario(agent_payload, user_finance_input, subsidy_matrix)
    net_investment = calculate_net_investment(report_input_metrics, subsidy_matrix, loan_scenario)
    narrative = _build_report_narrative(report_input_metrics, subsidy_matrix, loan_scenario, net_investment)
    risk_disclaimers = _build_risk_disclaimers(agent_payload)
    subsidy_rag_context = _load_subsidy_rag_context(agent_payload, report_input_metrics)
    source_references = _build_source_references(subsidy_rag_context)
    report = {
        "schemaVersion": SCHEMA_VERSION,
        "reportType": REPORT_TYPE,
        "generatedAt": _now_iso(),
        "source": {
            "aiSimulationModelVersion": ai_simulation_result.get("modelVersion"),
            "analysisResultId": agent_payload.get("analysisResultId") or ai_simulation_result.get("analysisResultId"),
            "generator": "deterministic_profit_report_agent",
            "llmPolishEnabled": False,
        },
        "buildingSummary": _build_building_summary(ai_simulation_result, agent_payload),
        "fourMetrics": _build_four_metrics(report_input_metrics, subsidy_matrix),
        "subsidyMatrix": subsidy_matrix,
        "loanSupportScenario": loan_scenario,
        "netInvestment": net_investment,
        "subsidyRagContext": subsidy_rag_context,
        "sourceReferences": source_references,
        "reportNarrative": narrative,
        "reportNarrativeSource": DETERMINISTIC_REPORT_NARRATIVE_SOURCE,
        "llmEnabled": False,
        "riskDisclaimers": risk_disclaimers,
        "cta": {
            "label": "상담 신청하기",
            "primaryMessage": "우리 아파트 태양광 설치하기",
            "nextAction": "보조금 공고와 현장 확인 항목을 상담으로 검토",
        },
    }
    llm_result = generate_llm_report_narrative(report)
    report["llmEnabled"] = llm_result.get("enabled") is True

    if llm_result.get("ok") is True and isinstance(llm_result.get("narrative"), dict):
        report["reportNarrative"] = llm_result["narrative"]
        report["reportNarrativeSource"] = LLM_REPORT_NARRATIVE_SOURCE
        report["source"] = {
            **report["source"],
            "generator": "deterministic_profit_report_agent_with_llm_narrative",
            "llmPolishEnabled": True,
            "llmModel": llm_result.get("model"),
        }
    else:
        report["reportNarrativeSource"] = DETERMINISTIC_REPORT_NARRATIVE_SOURCE
        report["source"] = {
            **report["source"],
            "llmPolishEnabled": report["llmEnabled"],
            "llmPolishFallback": report["llmEnabled"],
        }

        if isinstance(llm_result.get("model"), str):
            report["source"]["llmModel"] = llm_result["model"]

        if isinstance(llm_result.get("error"), str) and llm_result["error"]:
            report["llmError"] = llm_result["error"]

    return report


def build_profit_report_markdown(report_json: dict[str, Any]) -> str:
    narrative = report_json.get("reportNarrative") if isinstance(report_json.get("reportNarrative"), dict) else {}
    four_metrics = report_json.get("fourMetrics") if isinstance(report_json.get("fourMetrics"), dict) else {}
    generation = four_metrics.get("expectedGeneration") if isinstance(four_metrics.get("expectedGeneration"), dict) else {}
    cost = four_metrics.get("costAndSelfPayment") if isinstance(four_metrics.get("costAndSelfPayment"), dict) else {}
    payback = four_metrics.get("payback") if isinstance(four_metrics.get("payback"), dict) else {}
    suitability = (
        four_metrics.get("subsidyAndSuitability")
        if isinstance(four_metrics.get("subsidyAndSuitability"), dict)
        else {}
    )
    loan = report_json.get("loanSupportScenario") if isinstance(report_json.get("loanSupportScenario"), dict) else {}
    net = report_json.get("netInvestment") if isinstance(report_json.get("netInvestment"), dict) else {}
    disclaimers = report_json.get("riskDisclaimers") if isinstance(report_json.get("riskDisclaimers"), list) else []
    rag_context = (
        report_json.get("subsidyRagContext")
        if isinstance(report_json.get("subsidyRagContext"), dict)
        else {}
    )
    rag_matches = rag_context.get("matches") if isinstance(rag_context.get("matches"), list) else []
    references = report_json.get("sourceReferences") if isinstance(report_json.get("sourceReferences"), list) else []
    subsidy_program_name = suitability.get("subsidyProgramName") or DEFAULT_SUBSIDY_PROGRAM_NAME

    lines = [
        "# AI 수익·보조금·금융 리포트",
        "",
        f"## {narrative.get('headline') or '태양광 도입 수익성 검토 리포트'}",
        "",
        str(narrative.get("summary") or ""),
        "",
        "## 4대 핵심 지표",
        "",
        f"- 예상 발전량: {_format_kwh(generation.get('annualGenerationKwh'))}",
        f"- 투입 비용 / 자부담: {_format_krw(cost.get('estimatedInstallCostKrw'))} / {_format_krw(cost.get('selfPaymentEstimateKrw'))}",
        f"- 회수기간: {_format_years(payback.get('paybackYears'))}",
        (
            "- 보조금 적용 가능성 / 설치 적합도: "
            f"{suitability.get('installationSuitabilityGrade') or '확인 필요'}등급, "
            f"{subsidy_program_name} 기준"
        ),
        "",
        "## 금융 지원 시나리오",
        "",
        f"- 예상 대출 검토 한도: {_format_krw(loan.get('estimatedLoanLimitKrw'))}",
        f"- 월 상환 추정액: {_format_krw(loan.get('monthlyPaymentEstimateKrw'))}",
        f"- 초기 현금 필요액: {_format_krw(net.get('cashNeededKrw'))}",
        "",
        "## 상담 메시지",
        "",
        str(narrative.get("salesMessage") or ""),
        "",
        "## 보조금 RAG 근거",
        "",
        (
            "보조금 RAG 근거가 검색되었습니다."
            if rag_context.get("enabled") is True and rag_matches
            else "보조금 RAG 근거가 없어 정책 매트릭스 기준으로 표시합니다."
        ),
        "",
        *[
            f"- {reference.get('sourceTitle') or '보조금 근거'}"
            + (f" ({reference.get('sourceYear')})" if reference.get("sourceYear") else "")
            + (f": {reference.get('evidenceSummary')}" if reference.get("evidenceSummary") else "")
            for reference in references
            if isinstance(reference, dict)
        ],
        "",
        "## 확인 필요",
        "",
        *[f"- {item}" for item in disclaimers],
    ]

    return "\n".join(lines).strip()
