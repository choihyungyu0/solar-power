import type {
  ClimateBundlePvOutputRaw,
  ClimateLiveAnalysisRequest,
  ClimateLiveAnalysisResponse,
} from '../types/climateBundle';
import type { PvAnalysisResult } from '../types/pvAnalysis';

const CLIMATE_LIVE_PROXY_PATH = '/api/climate-rooftop-analysis';

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

export function normalizeClimateBundlePvOutput(output: ClimateBundlePvOutputRaw): PvAnalysisResult {
  const expectedRevenue = output.expected_revenue;
  const environmentalContribution = output.environmental_contribution;
  const firstYearRevenue = readNumber(expectedRevenue.first_year_revenue);
  const firstYearSaveCost = readNumber(expectedRevenue.first_year_save_cost);

  return {
    annualGenerationKwh: roundDecimal(Math.max(0, readNumber(output.annual_generation)), 1),
    installKw: roundDecimal(Math.max(0, readNumber(expectedRevenue.install_kw)), 1),
    firstYearTotalEconomicEffectKrw: roundNumber(Math.max(0, firstYearRevenue)),
    firstYearSelfConsumptionSavingKrw: roundNumber(Math.max(0, firstYearSaveCost)),
    estimatedInvestmentKrw: roundNumber(Math.max(0, readNumber(expectedRevenue.expected_investment))),
    estimatedSurplusSalesKrw: roundNumber(firstYearRevenue - firstYearSaveCost),
    carbonReductionKg: roundDecimal(Math.max(0, readNumber(environmentalContribution.carbon_reduction)), 1),
    pineTreeEffect: roundDecimal(Math.max(0, readNumber(environmentalContribution.pine_tree_effect)), 1),
    annualRevenueSeries: output.annual_revenue.map((item) => ({
      year: roundNumber(item.year),
      revenueKrw: roundNumber(Math.max(0, readNumber(item.revenue))),
    })),
    annualSaveCostSeries: output.annual_saveCost.map((item) => ({
      year: roundNumber(item.year),
      saveCostKrw: roundNumber(Math.max(0, readNumber(item.saveCost))),
    })),
    monthlyGenerationSeries: output.monthly_generation.map((item) => ({
      month: roundNumber(item.month),
      generationKwh: roundDecimal(Math.max(0, readNumber(item.generation)), 1),
    })),
  };
}

export async function runClimateRooftopAnalysis(
  input: ClimateLiveAnalysisRequest,
): Promise<ClimateLiveAnalysisResponse> {
  try {
    const response = await fetch(CLIMATE_LIVE_PROXY_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        Accept: 'application/json',
      },
      body: JSON.stringify(input),
    });
    const payload = (await response.json().catch(() => null)) as ClimateLiveAnalysisResponse | null;

    if (payload && typeof payload === 'object' && 'ok' in payload) {
      return payload;
    }
  } catch {
    // The proxy owns external climate.gg details; callers only need a safe failure shape.
  }

  return {
    ok: false,
    source: 'climate.gg-live-hybrid',
    selectedBuildingId: input.selectedBuildingId ?? null,
    selectedAnalysisSessionId: input.selectedAnalysisSessionId ?? null,
    message: 'climate.gg 라이브 분석 프록시 응답을 받지 못했습니다.',
    fallbackRecommended: true,
    diagnostics: {
      requestSelectedBuildingId: input.selectedBuildingId ?? null,
      requestSessionId: input.selectedAnalysisSessionId ?? null,
      ignoredStaleLiveResponse: false,
    },
  };
}
