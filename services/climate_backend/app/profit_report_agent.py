from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


SUBSIDY_PROGRAM_NAME = "경기 주택태양광 지원사업"
SUBSIDY_POLICY_MODE = "gyeonggi_home_solar_only"
SUBSIDY_STACKING_REASON = "경기 주택태양광 지원사업 기준 단일 보조금 산정"
REPORT_TYPE = "solar_profit_report"
SCHEMA_VERSION = "solarmate-profit-report-v1"
DEFAULT_LOAN_YEARS = 5
DEFAULT_LOAN_COVERAGE_RATIO = 0.8


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


def _get_report_input_metrics(agent_payload: dict[str, Any]) -> dict[str, Any]:
    metrics = agent_payload.get("reportInputMetrics")

    return metrics if isinstance(metrics, dict) else {}


def _get_location(agent_payload: dict[str, Any]) -> dict[str, Any] | str:
    location = _get_path(agent_payload, "subsidyRagInput", "location")

    if isinstance(location, (dict, str)):
        return location

    return "경기도"


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
        "preferredLoanYears": int(_clamp(preferred_loan_years, 1, 20)),
        "loanCoverageRatio": _clamp(loan_coverage_ratio, 0, 1),
    }


def build_subsidy_matrix(
    agent_payload: dict[str, Any],
    policy_data: dict[str, Any] | None,
) -> dict[str, Any]:
    metrics = _get_report_input_metrics(agent_payload)
    policy = policy_data if isinstance(policy_data, dict) else {}
    subsidy_estimate_krw = _money(
        policy.get("subsidy_amount_krw")
        or policy.get("max_subsidy_krw")
        or metrics.get("subsidyEstimateKrw")
        or _get_path(agent_payload, "subsidyRagInput", "subsidyEstimateKrw")
    )
    subsidy_rate = policy.get("subsidy_rate")

    return {
        "programName": SUBSIDY_PROGRAM_NAME,
        "policyMode": SUBSIDY_POLICY_MODE,
        "supportType": policy.get("support_type") or "주택태양광 설치 보조금",
        "regionSido": policy.get("region_sido") or "경기도",
        "regionSigungu": policy.get("region_sigungu") or "확인 필요",
        "targetBuildingType": policy.get("target_building_type") or "주택/공동주택 검토",
        "subsidyEstimateKrw": subsidy_estimate_krw,
        "subsidyAmountKrw": _money(policy.get("subsidy_amount_krw")) or None,
        "subsidyRate": _as_float(subsidy_rate) if subsidy_rate is not None else None,
        "maxSubsidyKrw": _money(policy.get("max_subsidy_krw")) or subsidy_estimate_krw,
        "stackingAllowed": False,
        "stackingNote": policy.get("stacking_note") or SUBSIDY_STACKING_REASON,
        "eligibilityNote": policy.get("eligibility_note") or "실제 지원 여부는 최신 공고, 예산 잔여 여부, 대상 요건 확인이 필요합니다.",
        "sourceTitle": policy.get("source_title") or "경기 주택태양광 지원사업 공고 확인 필요",
        "sourceUrl": policy.get("source_url"),
        "sourceYear": policy.get("source_year"),
        "status": "확인 필요",
    }


def build_loan_scenario(
    agent_payload: dict[str, Any],
    user_finance_input: dict[str, Any] | None,
) -> dict[str, Any]:
    metrics = _get_report_input_metrics(agent_payload)
    finance_input = _normalize_finance_input(user_finance_input)
    loan_years = finance_input["preferredLoanYears"]
    loan_coverage_ratio = finance_input["loanCoverageRatio"]
    self_payment_estimate_krw = _money(metrics.get("selfPaymentEstimateKrw"))
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


def _build_four_metrics(report_input_metrics: dict[str, Any]) -> dict[str, Any]:
    return {
        "expectedGeneration": {
            "annualGenerationKwh": _money(report_input_metrics.get("annualGenerationKwh")),
            "monthlyGenerationKwh": report_input_metrics.get("monthlyGenerationKwh") or [],
        },
        "costAndSelfPayment": {
            "estimatedInstallCostKrw": _money(report_input_metrics.get("estimatedInstallCostKrw")),
            "selfPaymentEstimateKrw": _money(report_input_metrics.get("selfPaymentEstimateKrw")),
        },
        "payback": {
            "annualSavingKrw": _money(report_input_metrics.get("annualSavingKrw")),
            "paybackYears": _round(report_input_metrics.get("paybackYears")),
        },
        "subsidyAndSuitability": {
            "subsidyProgramName": SUBSIDY_PROGRAM_NAME,
            "subsidyPolicyMode": SUBSIDY_POLICY_MODE,
            "subsidyStackingAllowed": False,
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
) -> dict[str, str]:
    grade = report_input_metrics.get("installationSuitabilityGrade") or "검토"
    annual_generation = _format_kwh(report_input_metrics.get("annualGenerationKwh"))
    annual_saving = _format_krw(report_input_metrics.get("annualSavingKrw"))
    self_payment = _format_krw(report_input_metrics.get("selfPaymentEstimateKrw"))
    cash_needed = _format_krw(net_investment.get("cashNeededKrw"))
    payback = _format_years(net_investment.get("paybackYears"))
    loan_limit = _format_krw(loan_scenario.get("estimatedLoanLimitKrw"))

    return {
        "headline": f"AI 기준 설치 적합도 {grade}등급, 수익성 검토 가치가 있는 태양광 후보지입니다.",
        "summary": (
            f"예상 연간 발전량은 {annual_generation}, 예상 연간 절감/수익 기준은 {annual_saving}입니다. "
            f"{SUBSIDY_PROGRAM_NAME} 단일 기준 보조금 적용 후 예상 자부담은 {self_payment}이며, "
            f"추정 회수기간은 {payback}입니다."
        ),
        "salesMessage": (
            f"금융 지원 시나리오를 함께 검토하면 예상 대출 검토 한도는 {loan_limit}, "
            f"초기 현금 필요액은 {cash_needed}까지 낮아질 가능성이 있습니다. "
            "보조금 예산이 소진되기 전에 상담을 통해 가능 여부를 확인해보세요."
        ),
        "ctaMessage": "우리 아파트 태양광 설치하기",
    }


def _build_risk_disclaimers(agent_payload: dict[str, Any]) -> list[str]:
    field_checks = agent_payload.get("fieldCheckRequired")
    field_check_text = ", ".join(field_checks) if isinstance(field_checks, list) else "옥상 장애물, 구조안전성, 방수 상태"

    return [
        "본 리포트는 시뮬레이션 기반 예상·추정 결과이며 실제 발전량과 절감액을 보장하지 않습니다.",
        f"{SUBSIDY_PROGRAM_NAME} 지원 여부와 금액은 최신 공고, 예산 잔여 여부, 대상 요건 확인이 필요합니다.",
        "국가 보조금과 경기도 보조금은 중복 합산하지 않았습니다.",
        "대출 가능 금액과 조건은 추정 시나리오이며 실제 승인은 금융기관 심사가 필요합니다.",
        f"{field_check_text}는 AI 확정 항목이 아니며 현장조사와 관리주체 협의가 필요합니다.",
    ]


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
    loan_scenario = build_loan_scenario(agent_payload, user_finance_input)
    net_investment = calculate_net_investment(report_input_metrics, subsidy_matrix, loan_scenario)
    narrative = _build_report_narrative(report_input_metrics, subsidy_matrix, loan_scenario, net_investment)
    risk_disclaimers = _build_risk_disclaimers(agent_payload)

    return {
        "schemaVersion": SCHEMA_VERSION,
        "reportType": REPORT_TYPE,
        "generatedAt": _now_iso(),
        "source": {
            "aiSimulationModelVersion": ai_simulation_result.get("modelVersion"),
            "analysisResultId": agent_payload.get("analysisResultId") or ai_simulation_result.get("analysisResultId"),
            "generator": "deterministic_profit_report_agent",
            "llmPolishEnabled": False,
            "llmPolishNote": "TODO: OPENAI_API_KEY와 ENABLE_LLM_PROFIT_REPORT=true 설정 시 숫자 재계산 없이 문장 다듬기만 연결 가능",
        },
        "buildingSummary": _build_building_summary(ai_simulation_result, agent_payload),
        "fourMetrics": _build_four_metrics(report_input_metrics),
        "subsidyMatrix": subsidy_matrix,
        "loanSupportScenario": loan_scenario,
        "netInvestment": net_investment,
        "reportNarrative": narrative,
        "riskDisclaimers": risk_disclaimers,
        "cta": {
            "label": "상담 신청하기",
            "primaryMessage": "우리 아파트 태양광 설치하기",
            "nextAction": "보조금 공고와 현장 확인 항목을 상담으로 검토",
        },
    }


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
            f"{SUBSIDY_PROGRAM_NAME} 단일 기준"
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
        "## 확인 필요",
        "",
        *[f"- {item}" for item in disclaimers],
    ]

    return "\n".join(lines).strip()
