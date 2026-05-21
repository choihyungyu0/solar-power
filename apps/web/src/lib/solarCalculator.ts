import type { SolarRequestFormValues, SolarSimulationResult } from './solarTypes';

const PANEL_CAPACITY_KW = 0.5;
const PANEL_AREA_M2 = 2.35;
const ROOF_UTILIZATION_RATIO = 0.42;
const YEARLY_GENERATION_KWH_PER_KW = 1220;
const COMMON_ELECTRIC_VALUE_KRW_PER_KWH = 165;
const INSTALL_COST_KRW_PER_KW = 1350000;
const MAX_SUBSIDY_RATIO = 0.42;
const MAX_SUBSIDY_KRW = 120000000;
const POLICY_LOAN_RATIO = 0.6;
const POLICY_LOAN_LIMIT_KRW = 150000000;

function roundTo(value: number, digits: number) {
  const unit = 10 ** digits;
  return Math.round(value * unit) / unit;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function calculateSuitabilityScore(values: SolarRequestFormValues, capacityKw: number) {
  const roofScore = clamp((values.roofAreaM2 / 1200) * 34, 8, 34);
  const householdScore = clamp((values.householdCount / 600) * 22, 6, 22);
  const billScore = clamp((values.monthlyElectricBillKrw / 4500000) * 24, 7, 24);
  const scaleScore = clamp((capacityKw / 150) * 20, 5, 20);

  return Math.round(roofScore + householdScore + billScore + scaleScore);
}

function getSuitabilityGrade(score: number) {
  if (score >= 82) {
    return '우선 검토';
  }

  if (score >= 68) {
    return '검토 권장';
  }

  if (score >= 50) {
    return '조건 확인';
  }

  return '추가 정보 필요';
}

export function calculateSolarSimulation(values: SolarRequestFormValues): SolarSimulationResult {
  const usableRoofAreaM2 = values.roofAreaM2 * ROOF_UTILIZATION_RATIO;
  const panelCount = Math.max(8, Math.floor(usableRoofAreaM2 / PANEL_AREA_M2));
  const recommendedCapacityKw = roundTo(panelCount * PANEL_CAPACITY_KW, 1);
  const expectedYearlyGenerationKwh = Math.round(recommendedCapacityKw * YEARLY_GENERATION_KWH_PER_KW);
  const expectedMonthlyGenerationKwh = Math.round(expectedYearlyGenerationKwh / 12);
  const yearlyBillLimit = Math.round(values.monthlyElectricBillKrw * 12 * 0.78);
  const generationValue = Math.round(expectedYearlyGenerationKwh * COMMON_ELECTRIC_VALUE_KRW_PER_KWH);
  const expectedYearlySavingKrw = Math.min(generationValue, yearlyBillLimit);
  const estimatedInstallCostKrw = Math.round(recommendedCapacityKw * INSTALL_COST_KRW_PER_KW);
  const estimatedSubsidyKrw = Math.min(Math.round(estimatedInstallCostKrw * MAX_SUBSIDY_RATIO), MAX_SUBSIDY_KRW);
  const estimatedSelfPaymentKrw = Math.max(0, estimatedInstallCostKrw - estimatedSubsidyKrw);
  const policyLoanLimitKrw = Math.min(Math.round(estimatedSelfPaymentKrw * POLICY_LOAN_RATIO), POLICY_LOAN_LIMIT_KRW);
  const paybackYears =
    expectedYearlySavingKrw > 0 ? roundTo(estimatedSelfPaymentKrw / expectedYearlySavingKrw, 1) : 0;
  const suitabilityScore = calculateSuitabilityScore(values, recommendedCapacityKw);
  const householdMonthlyBenefitKrw =
    values.householdCount > 0 ? Math.round(expectedYearlySavingKrw / 12 / values.householdCount) : 0;

  return {
    recommendedCapacityKw,
    panelCount,
    expectedMonthlyGenerationKwh,
    expectedYearlyGenerationKwh,
    expectedYearlySavingKrw,
    estimatedInstallCostKrw,
    estimatedSubsidyKrw,
    estimatedSelfPaymentKrw,
    policyLoanLimitKrw,
    paybackYears,
    suitabilityScore,
    suitabilityGrade: getSuitabilityGrade(suitabilityScore),
    householdMonthlyBenefitKrw,
    demoFormulaNote:
      '데모 산식 기반 추정입니다. 실제 설치 가능 여부, 구조 안전, 음영, 전기요금제, 공고 조건은 현장 조사와 실제 공고 확인이 필요합니다.',
  };
}

export const solarCalculatorAssumptions = {
  panelCapacityKw: PANEL_CAPACITY_KW,
  panelAreaM2: PANEL_AREA_M2,
  roofUtilizationRatio: ROOF_UTILIZATION_RATIO,
  yearlyGenerationKwhPerKw: YEARLY_GENERATION_KWH_PER_KW,
  commonElectricValueKrwPerKwh: COMMON_ELECTRIC_VALUE_KRW_PER_KWH,
  installCostKrwPerKw: INSTALL_COST_KRW_PER_KW,
  maxSubsidyRatio: MAX_SUBSIDY_RATIO,
};
