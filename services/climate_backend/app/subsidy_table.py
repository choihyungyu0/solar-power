"""주택 태양광 보조금 조회 모듈 (2개 제도 분기).

데이터 출처: docs/경기주택태양광지원사업_시군별_보조금.xlsx + 한국에너지공단 공동주택 보급사업

대상별 적용 제도
  1. 단독주택 → 경기도 주택태양광 지원사업 (시군별)
     - 3kW 표준 설치 기준. 보조금 = 도비 + 시군비 (절대 금액, 화성 = 2,741천원).
     - ★ 설치비에 지원율을 곱하지 않는다. 3kW 패키지의 고정 보조금액이며 상한이다.
  2. 아파트/공동주택 → 한국에너지공단 신재생에너지 보급사업(공동주택)
     - 아파트 1개 동 당 최대 30kW, 저탄소 모듈 kW당 466천원.
     - 예) 30kW 설치 → 30 × 466,000 = 13,980,000원(약 1,400만원).
     - 상한액 존재, 참여기업·당해년도 정부 보조금에 따라 유동적.

대상 주택 요건 (경기 사업 공고문)
  - 일반 아파트는 경기 사업 대상이 아니다. 세대별 전력계량기 분리·구조 독립
    공동주택(땅콩주택·타운하우스)만 단독주택에 준해 대상.
  - 아파트 거주 개인이 단독 설치 희망 시 단독주택 지원으로 신청 가능.

NOTE (이전 버그)
  - 과거 구현은 3kW 지원율(예: 화성 60.36%)을 아파트의 대용량 설치비에 그대로
    곱해 보조금이 실제 상한을 크게 초과했다. 본 모듈은 유형별 절대 산정으로 교체.
"""
from __future__ import annotations

import json
import os
from typing import Any, Optional

_DATA_PATH = os.path.join(os.path.dirname(__file__), "data", "gyeonggi_subsidy_2026.json")


def _load_table() -> dict[str, Any]:
    try:
        with open(_DATA_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {"sigungu": {}, "basis": {}, "program": "보조금 데이터 로드 실패"}


_TABLE = _load_table()
SIGUNGU_TABLE: dict[str, Any] = _TABLE.get("sigungu", {})
PROGRAM_NAME: str = _TABLE.get("program", "경기도 주택태양광 보조금")
PROGRAM_BASIS: dict[str, Any] = _TABLE.get("basis", {})
APARTMENT_PROGRAM: dict[str, Any] = _TABLE.get("apartment_program", {})

DETACHED_ELIGIBILITY = [
    "단독주택(「건축법 시행령」 [별표1] 기준)",
    "세대별 전력계량기로 분리되고 구조적으로 독립된 공동주택(예: 땅콩주택, 타운하우스)",
]
APARTMENT_ELIGIBILITY = [
    "아파트 1개 동 당 최대 30kW까지 지원(저탄소 모듈)",
    "일반 아파트는 경기 시군 사업 대상이 아니며 한국에너지공단 공동주택 보급사업으로 신청",
    "아파트 거주 개인이 단독으로 설치 희망 시 단독주택 지원으로 신청 가능",
]

# 분류 키워드
_APARTMENT_KEYWORDS = ("아파트", "공동주택", "연립", "다세대")
_DETACHED_KEYWORDS = ("단독",)


def classify_housing_type(usage: Optional[str]) -> str:
    """건물 용도 문자열로 주택 유형을 분류한다.

    반환: "apartment" | "detached" | "unknown"
    """
    text = (usage or "").strip()
    if not text:
        return "unknown"
    for kw in _APARTMENT_KEYWORDS:
        if kw in text:
            return "apartment"
    for kw in _DETACHED_KEYWORDS:
        if kw in text:
            return "detached"
    return "unknown"


def normalize_sigungu(raw: Optional[str]) -> Optional[str]:
    """주소 문자열에서 시군명을 추출해 테이블 키와 매칭한다.

    예) "경기도 화성시 동탄..." -> "화성시", "화성" -> "화성시"
    """
    if not raw or not isinstance(raw, str):
        return None

    text = raw.strip()

    if text in SIGUNGU_TABLE:
        return text

    for name in sorted(SIGUNGU_TABLE.keys(), key=len, reverse=True):
        if name in text:
            return name

    for name in SIGUNGU_TABLE:
        base = name[:-1] if name[-1] in ("시", "군") else name
        if base and base in text:
            return name

    return None


def get_subsidy_profile(sigungu: Optional[str]) -> Optional[dict[str, Any]]:
    """시군명/주소로 보조금 프로필을 조회한다. 없으면 None."""
    key = normalize_sigungu(sigungu)
    if key is None:
        return None

    profile = dict(SIGUNGU_TABLE[key])
    profile["sigungu"] = key
    return profile


def _estimate_detached(install_cost: float, sigungu: Optional[str], housing_type: str) -> dict[str, Any]:
    """단독주택: 경기 시군별 3kW 표준 절대 보조금(도비+시군비)."""
    profile = get_subsidy_profile(sigungu)

    if profile is None:
        return {
            "matched": False,
            "regime": "detached",
            "housingType": housing_type,
            "program": PROGRAM_NAME,
            "sigungu": None,
            "subsidyKrw": 0,
            "provinceShareKrw": 0,
            "sigunguShareKrw": 0,
            "basisCapacityKw": PROGRAM_BASIS.get("capacity_kw", 3),
            "eligibility": DETACHED_ELIGIBILITY,
            "disclaimer": "해당 시군 보조금 데이터가 없어 보조금을 추정하지 못했습니다. 실제 공고 확인이 필요합니다.",
        }

    province = float(profile["province_subsidy_krw"])
    sigungu_share = float(profile["sigungu_subsidy_krw"])
    subsidy = round(province + sigungu_share)  # 3kW 패키지 고정 보조금액 = 상한
    if install_cost > 0:
        subsidy = min(subsidy, round(install_cost))

    note = (
        f"{PROGRAM_NAME}의 {profile['sigungu']} 3kW 표준 설치 기준 보조금"
        f"(도비 {round(province):,}원 + 시군비 {round(sigungu_share):,}원)입니다. "
        "설치 용량과 무관하게 3kW 표준 패키지 고정 금액이며, 실제 지원 한도·대상 여부는 해당 연도 공고 확인이 필요합니다."
    )
    if housing_type == "unknown":
        note = "건물 유형 미확인으로 단독주택(3kW 표준) 기준을 보수적으로 적용했습니다. " + note

    return {
        "matched": True,
        "regime": "detached",
        "housingType": housing_type,
        "program": PROGRAM_NAME,
        "sigungu": profile["sigungu"],
        "subsidyKrw": subsidy,
        "provinceShareKrw": round(province),
        "sigunguShareKrw": round(sigungu_share),
        "basisCapacityKw": PROGRAM_BASIS.get("capacity_kw", 3),
        "standardInstallCostKrw": PROGRAM_BASIS.get("standard_install_cost_krw"),
        "basis3kw": {
            "provinceSubsidyKrw": profile["province_subsidy_krw"],
            "sigunguSubsidyKrw": profile["sigungu_subsidy_krw"],
            "selfPaymentKrw": profile["self_payment_krw"],
        },
        "eligibility": DETACHED_ELIGIBILITY,
        "disclaimer": note,
    }


def _estimate_apartment(install_cost: float, capacity_kw: float) -> dict[str, Any]:
    """아파트/공동주택: 한국에너지공단 보급사업. min(용량, 30kW) × 466천원/kW."""
    per_kw = float(APARTMENT_PROGRAM.get("per_kw_krw", 466000))
    max_kw = float(APARTMENT_PROGRAM.get("max_capacity_kw_per_building", 30))
    program = APARTMENT_PROGRAM.get("source", "한국에너지공단 공동주택 보급사업")

    eligible_cap = min(capacity_kw, max_kw) if capacity_kw > 0 else 0.0
    subsidy = round(eligible_cap * per_kw)
    if install_cost > 0:
        subsidy = min(subsidy, round(install_cost))

    capped = capacity_kw > max_kw
    note = (
        f"{program} 기준 추정 보조금입니다(저탄소 모듈 kW당 {round(per_kw):,}원, "
        f"1개 동 최대 {round(max_kw)}kW). "
    )
    if capped:
        note += f"설치 용량 {round(capacity_kw, 1)}kW 중 상한 {round(max_kw)}kW까지만 지원에 반영했습니다. "
    note += "상한액은 참여기업·당해년도 정부 보조금에 따라 유동적이며, 실제 지원 규모는 공고 확인이 필요합니다."

    return {
        "matched": True,
        "regime": "apartment",
        "housingType": "apartment",
        "program": program,
        "sigungu": None,
        "subsidyKrw": subsidy,
        "perKwKrw": round(per_kw),
        "eligibleCapacityKw": round(eligible_cap, 1),
        "maxCapacityKwPerBuilding": round(max_kw),
        "moduleCondition": APARTMENT_PROGRAM.get("module_condition", "저탄소 모듈"),
        "capacityCapped": capped,
        "eligibility": APARTMENT_ELIGIBILITY,
        "disclaimer": note,
    }


def estimate_subsidy(
    install_cost_krw: float,
    sigungu: Optional[str],
    *,
    housing_type: str = "unknown",
    capacity_kw: float = 0.0,
) -> dict[str, Any]:
    """주택 유형별 제도를 분기해 예상 보조금을 산정한다.

    - housing_type="apartment" → 한국에너지공단 (min(용량,30kW)×466천원)
    - housing_type="detached"/"unknown" → 경기 시군별 3kW 절대 보조금(도비+시군비)

    반환 dict 공통: matched, regime, housingType, program, sigungu,
                    subsidyKrw, eligibility, disclaimer (+ 제도별 부가 필드)
    """
    cost = float(install_cost_krw) if install_cost_krw else 0.0
    cap = float(capacity_kw) if capacity_kw else 0.0

    if housing_type == "apartment":
        return _estimate_apartment(cost, cap)
    return _estimate_detached(cost, sigungu, housing_type)
