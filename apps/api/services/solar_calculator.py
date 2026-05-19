from __future__ import annotations

from math import exp
from typing import Literal

from pydantic import BaseModel, Field


class SolarInput(BaseModel):
    address: str = Field(..., description="설치 후보 주소")
    buildingType: Literal["apartment", "public_housing", "commercial", "single_house"] = "apartment"
    householdCount: int = Field(100, ge=1, le=5000)
    roofAreaM2: float = Field(800, ge=10, le=200000)
    monthlyElectricBillKrw: int = Field(1800000, ge=10000)
    shadeScore: int = Field(78, ge=0, le=100, description="음영이 적을수록 높은 점수")
    roofUsableRatio: float = Field(0.42, ge=0.05, le=0.9)
    averageDailySunHours: float = Field(3.7, ge=1.0, le=6.5)
    electricityPriceKrwPerKwh: float = Field(165, ge=50, le=500)


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(value, high))


def calculate_solar_plan(payload: SolarInput) -> dict:
    """Simple deterministic MVP calculator.

    실제 서비스에서는 일사량, DSM/음영, 건물에너지, 전기요금 단가, 정책 DB를 연결한다.
    현재 계산식은 데모·기획 검증용이다.
    """
    shade_factor = payload.shadeScore / 100
    usable_roof_area = payload.roofAreaM2 * payload.roofUsableRatio * shade_factor

    # 일반적으로 모듈/간격/보행공간 등을 고려해 kW당 약 6~8㎡가 필요하다고 가정한 데모값.
    capacity_kw = usable_roof_area / 6.8

    # 공동주택은 공용부/자가소비 중심 데모이므로 과도한 용량을 제한.
    demand_cap_kw = max(10, payload.householdCount * 0.85)
    capacity_kw = clamp(capacity_kw, 1, demand_cap_kw)

    system_efficiency = 0.82
    annual_generation_kwh = capacity_kw * payload.averageDailySunHours * 365 * system_efficiency

    annual_bill_before = payload.monthlyElectricBillKrw * 12
    annual_savings_krw = min(
        annual_generation_kwh * payload.electricityPriceKrwPerKwh,
        annual_bill_before * 0.72,
    )

    install_cost_per_kw = 1_700_000
    estimated_install_cost_krw = capacity_kw * install_cost_per_kw

    # MVP 보조금 추정: 실제 금액은 정책 DB로 교체. 현재는 데모용 후보 금액만 계산.
    mvp_subsidy_ratio = 0.28 if payload.buildingType in ["apartment", "public_housing"] else 0.18
    estimated_policy_support_krw = estimated_install_cost_krw * mvp_subsidy_ratio
    owner_payment_krw = max(0, estimated_install_cost_krw - estimated_policy_support_krw)
    payback_years = owner_payment_krw / annual_savings_krw if annual_savings_krw else None

    # 적합도: 음영, 면적, 요금절감 잠재력의 조합.
    area_score = clamp((payload.roofAreaM2 / max(payload.householdCount, 1)) * 16, 0, 100)
    bill_score = clamp((payload.monthlyElectricBillKrw / max(payload.householdCount, 1)) / 350, 0, 100)
    suitability_score = round((payload.shadeScore * 0.45) + (area_score * 0.35) + (bill_score * 0.20), 1)

    if suitability_score >= 80:
        grade = "매우 적합"
    elif suitability_score >= 65:
        grade = "검토 적합"
    elif suitability_score >= 45:
        grade = "조건부 검토"
    else:
        grade = "부적합 가능성"

    co2_reduction_kg = annual_generation_kwh * 0.424

    return {
        "input": payload.model_dump(),
        "result": {
            "suitabilityScore": suitability_score,
            "suitabilityGrade": grade,
            "usableRoofAreaM2": round(usable_roof_area, 1),
            "recommendedCapacityKw": round(capacity_kw, 1),
            "annualGenerationKwh": round(annual_generation_kwh),
            "annualSavingsKrw": round(annual_savings_krw),
            "estimatedInstallCostKrw": round(estimated_install_cost_krw),
            "estimatedPolicySupportKrw": round(estimated_policy_support_krw),
            "ownerPaymentKrw": round(owner_payment_krw),
            "simplePaybackYears": round(payback_years, 1) if payback_years else None,
            "co2ReductionKg": round(co2_reduction_kg),
            "policyNotice": "정책지원 금액은 MVP 추정치입니다. 실제 금액은 연도별 경기도/시군/한국에너지공단 공고 연동 후 확정해야 합니다.",
            "nextActions": [
                "입주자대표회의 또는 관리주체 동의 여부 확인",
                "건축물대장/옥상 구조/방수 상태 확인",
                "일사량·음영·규제 데이터 정밀 검토",
                "경기도/시군/한국에너지공단 지원사업 공고 확인",
                "카카오톡/SMS 알림으로 신청 시작일 수신",
            ],
        },
    }
