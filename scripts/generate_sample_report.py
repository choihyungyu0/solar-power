"""샘플 태양광 분석 보고서 생성 (시연/공유용).

흐름: 화성 동탄 샘플 건물 입력 -> 개발자 백엔드의 build_ai_simulation_result()
      -> report_agent.build_solar_report() -> HTML + JSON 저장.

실행:
    python scripts/generate_sample_report.py
출력:
    docs/sample_report_hwaseong.html   (브라우저로 열어 공유)
    docs/sample_report_hwaseong.json   (구조화 데이터)
"""
from __future__ import annotations

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "services", "climate_backend"))

from app.ai_simulation import build_ai_simulation_result  # noqa: E402
from app.report_agent import build_solar_report  # noqa: E402


# 화성 동탄 현대하이페리온 (37층 아파트) — sample_coords.csv 검증 좌표 기반 대표 입력
SAMPLE_AI_INPUT = {
    "buildingId": "L1_41590_067829",
    "buildingName": "동탄 현대하이페리온",
    "roadAddress": "경기도 화성시 동탄반석로 ...",
    "jibunAddress": "경기도 화성시 반송동 ...",
    "latitude": 37.2025,
    "longitude": 127.0715,
    "buildingUsage": "공동주택(아파트)",
    "geometryType": "Polygon",
    "roofAreaM2": 1180.0,
    "usableAreaM2": 742.0,
    "roofSource": "climate.gg-selectBuld",
    "isPreciseRoofData": True,
    "originalCellCount": 280,
    "usedCellCount": 212,
    "shadingAverage": 3.02,
    "greenCellRatio": 0.62,
    "yellowCellRatio": 0.25,
    "redCellRatio": 0.13,
    "greenCellCount": 131,
    "yellowCellCount": 53,
    "redCellCount": 28,
    "cellCount": 212,
    "panelCapacityW": 640,
    "panelAngleDeg": 35,
    "panelType": 1,
    "panelCountCandidate": 140,
    "panelCountSelected": 106,
    "installCapacityKw": 67.8,
    "annualGenerationKwh": 88200,
    "monthlyGenerationKwh": 7350,
    "estimatedInstallCostKrw": 81_360_000,
    "subsidyEstimateKrw": 0,          # report_agent 가 시군 데이터로 재계산
    "annualSavingKrw": 13_230_000,
    "policyLoanLimitKrw": 0,          # report_agent 가 재계산
    "paybackYears": 6.1,
}


def main() -> None:
    ai_result = build_ai_simulation_result(SAMPLE_AI_INPUT)
    report = build_solar_report(ai_result, sigungu="화성시")

    html_path = os.path.join(ROOT, "docs", "sample_report_hwaseong.html")
    json_path = os.path.join(ROOT, "docs", "sample_report_hwaseong.json")

    with open(html_path, "w", encoding="utf-8") as f:
        f.write(report["reportHtml"])
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(report["reportData"], f, ensure_ascii=False, indent=2)

    data = report["reportData"]
    econ = data["economics"]
    print("=== 보고서 생성 완료 ===")
    print("건물:", data["building"]["name"], "/ 시군:", data["building"]["sigungu"])
    print("적합도:", data["suitability"]["grade"], "등급", data["suitability"]["score"], "점", "/", data["suitability"]["cluster"])
    print("연간 발전량:", f"{data['generation']['annualKwh']:,} kWh", "/ 신뢰도:", data["generation"]["confidenceLabel"])
    print("설치비:", f"{econ['installCostKrw']:,}원")
    sub = econ["subsidy"]
    print("보조금:", f"{econ['subsidyKrw']:,}원", f"({sub.get('program')} / regime={sub.get('regime')})")
    print("자부담:", f"{econ['selfPaymentAfterSubsidyKrw']:,}원", "/ 대출한도:", f"{econ['loan']['limitKrw']:,}원")
    print("실투자금:", f"{econ['netInvestmentKrw']:,}원")
    print("회수기간(전/후):", econ["paybackYearsRaw"], "년 ->", econ["paybackYearsNet"], "년")
    print()
    print("HTML:", html_path)
    print("JSON:", json_path)


if __name__ == "__main__":
    main()
