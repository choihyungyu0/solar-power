from services.solar_calculator import SolarInput, calculate_solar_plan


def test_calculate_solar_plan_returns_positive_values():
    payload = SolarInput(
        address="경기도 성남시 분당구 샘플아파트",
        buildingType="apartment",
        householdCount=420,
        roofAreaM2=2400,
        monthlyElectricBillKrw=7200000,
        shadeScore=82,
    )
    result = calculate_solar_plan(payload)["result"]
    assert result["recommendedCapacityKw"] > 0
    assert result["annualGenerationKwh"] > 0
    assert result["annualSavingsKrw"] > 0
    assert result["suitabilityScore"] > 0
