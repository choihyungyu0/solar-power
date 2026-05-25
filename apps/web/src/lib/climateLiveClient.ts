import type {
  ClimateBundlePvOutputRaw,
  ClimateLiveAnalysisRequest,
  ClimateLiveAnalysisResponse,
} from '../types/climateBundle';
import type { PvAnalysisResult } from '../types/pvAnalysis';

function readNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function roundNumber(value: number) {
  return Math.round(value);
}

function roundDecimal(value: number, digits = 1) {
  const multiplier = 10 ** digits;

  return Math.round(value * multiplier) / multiplier;
}

function pickNumber(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }

  return 0;
}

function createMonthlyGenerationFallback(annualGenerationKwh: number) {
  const monthlyWeights = [0.072, 0.079, 0.092, 0.101, 0.107, 0.104, 0.097, 0.096, 0.087, 0.073, 0.049, 0.043];

  return monthlyWeights.map((weight, index) => ({
    month: index + 1,
    generation: annualGenerationKwh * weight,
  }));
}

export function normalizeClimateBundlePvOutput(output: ClimateBundlePvOutputRaw): PvAnalysisResult {
  const expectedRevenue = (output.expected_revenue ?? {}) as Partial<ClimateBundlePvOutputRaw['expected_revenue']>;
  const environmentalContribution = (output.environmental_contribution ?? {}) as Partial<
    ClimateBundlePvOutputRaw['environmental_contribution']
  >;
  const firstYearSaveCost = pickNumber(output.annual_saving_krw, expectedRevenue.first_year_save_cost);
  const firstYearRevenue = pickNumber(expectedRevenue.first_year_revenue, firstYearSaveCost);
  const expectedInvestment = pickNumber(output.expected_investment_krw, expectedRevenue.expected_investment);
  const annualGeneration = pickNumber(output.annual_generation_kwh, output.annual_generation);
  const annualRevenue = Array.isArray(output.annual_revenue) ? output.annual_revenue : [];
  const annualSaveCost = Array.isArray(output.annual_saveCost) ? output.annual_saveCost : [];
  const monthlyGeneration =
    Array.isArray(output.monthly_generation) && output.monthly_generation.length > 0
      ? output.monthly_generation
      : createMonthlyGenerationFallback(annualGeneration);

  return {
    annualGenerationKwh: roundDecimal(Math.max(0, annualGeneration), 1),
    installKw: roundDecimal(Math.max(0, readNumber(expectedRevenue.install_kw)), 1),
    firstYearTotalEconomicEffectKrw: roundNumber(Math.max(0, firstYearRevenue)),
    firstYearSelfConsumptionSavingKrw: roundNumber(Math.max(0, firstYearSaveCost)),
    estimatedInvestmentKrw: roundNumber(Math.max(0, expectedInvestment)),
    estimatedSurplusSalesKrw: roundNumber(firstYearRevenue - firstYearSaveCost),
    carbonReductionKg: roundDecimal(Math.max(0, readNumber(environmentalContribution.carbon_reduction)), 1),
    pineTreeEffect: roundDecimal(Math.max(0, readNumber(environmentalContribution.pine_tree_effect)), 1),
    annualRevenueSeries: annualRevenue.map((item) => ({
      year: roundNumber(item.year),
      revenueKrw: roundNumber(Math.max(0, readNumber(item.revenue))),
    })),
    annualSaveCostSeries: annualSaveCost.map((item) => ({
      year: roundNumber(item.year),
      saveCostKrw: roundNumber(Math.max(0, readNumber(item.saveCost))),
    })),
    monthlyGenerationSeries: monthlyGeneration.map((item) => ({
      month: roundNumber(item.month),
      generationKwh: roundDecimal(Math.max(0, readNumber(item.generation)), 1),
    })),
  };
}

export async function runClimateRooftopAnalysis(
  input: ClimateLiveAnalysisRequest,
): Promise<ClimateLiveAnalysisResponse> {
  return {
    ok: false,
    source: 'climate.gg-live-hybrid',
    selectedBuildingId: input.selectedBuildingId ?? null,
    selectedAnalysisSessionId: input.selectedAnalysisSessionId ?? null,
    disabled: true,
    message: 'climate.gg 라이브 분석은 별도 백엔드 서버 연동 예정입니다.',
    fallbackRecommended: true,
    diagnostics: {
      requestSelectedBuildingId: input.selectedBuildingId ?? null,
      requestSessionId: input.selectedAnalysisSessionId ?? null,
      ignoredStaleLiveResponse: false,
      fallbackReason: 'vercel-live-client-disabled',
    },
  };
}
