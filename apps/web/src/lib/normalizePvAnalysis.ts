import type {
  PvAnalysisAnnualRevenuePoint,
  PvAnalysisAnnualSaveCostPoint,
  PvAnalysisInput,
  PvAnalysisMonthlyGenerationPoint,
  PvAnalysisResult,
  PvAnalysisSafeInputSummary,
} from '../types/pvAnalysis';

const DEFAULT_PANEL_CAPACITY_W = 500;
const DEFAULT_PANEL_COUNT = 204;
const DEFAULT_PANEL_TYPE = 1;
const DEFAULT_SHADING_INDEX_AVERAGE = 3.36;
const DEFAULT_SOLAR_PANEL_ANGLE = 30;
const ANNUAL_GENERATION_KWH_PER_KW = 1265;
const ELECTRICITY_VALUE_KRW_PER_KWH = 150;
const FRONTEND_LOCAL_INVESTMENT_KRW_PER_KW = 1_200_000;
const FALLBACK_PAYBACK_YEARS = 6.8;
const CARBON_REDUCTION_KG_PER_KWH = 0.4594;
const PINE_TREE_KG_CO2_PER_YEAR = 6.6;
const MONTHLY_GENERATION_WEIGHTS = [0.072, 0.079, 0.092, 0.101, 0.107, 0.104, 0.097, 0.096, 0.087, 0.073, 0.049, 0.043];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

function readNumber(value: unknown, fallback = 0) {
  return Number.isFinite(value) && typeof value === 'number' ? value : fallback;
}

function roundNumber(value: number) {
  return Math.round(value);
}

function roundMoney(value: number) {
  return Math.round(value);
}

function roundDecimal(value: number, digits = 1) {
  const multiplier = 10 ** digits;

  return Math.round(value * multiplier) / multiplier;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function createSafeSeriesValue(value: unknown, fallback = 0) {
  return roundMoney(Math.max(0, readNumber(value, fallback)));
}

function normalizeAnnualRevenueSeries(value: unknown): PvAnalysisAnnualRevenuePoint[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }

      const year = readNumber(item.year);

      if (!Number.isFinite(year) || year <= 0) {
        return null;
      }

      return {
        year: roundNumber(year),
        revenueKrw: createSafeSeriesValue(item.revenue),
      };
    })
    .filter((item): item is PvAnalysisAnnualRevenuePoint => Boolean(item));
}

function normalizeAnnualSaveCostSeries(value: unknown): PvAnalysisAnnualSaveCostPoint[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }

      const year = readNumber(item.year);

      if (!Number.isFinite(year) || year <= 0) {
        return null;
      }

      return {
        year: roundNumber(year),
        saveCostKrw: createSafeSeriesValue(item.saveCost),
      };
    })
    .filter((item): item is PvAnalysisAnnualSaveCostPoint => Boolean(item));
}

function normalizeMonthlyGenerationSeries(value: unknown): PvAnalysisMonthlyGenerationPoint[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }

      const month = readNumber(item.month);

      if (!Number.isFinite(month) || month < 1 || month > 12) {
        return null;
      }

      return {
        month: roundNumber(month),
        generationKwh: roundDecimal(Math.max(0, readNumber(item.generation)), 1),
      };
    })
    .filter((item): item is PvAnalysisMonthlyGenerationPoint => Boolean(item));
}

function normalizePanelCapacity(input?: Partial<PvAnalysisInput>) {
  const panelCapacity = input?.solar_panel_info?.panel_capacity;

  return Number.isFinite(panelCapacity) && typeof panelCapacity === 'number' && panelCapacity > 0
    ? panelCapacity
    : DEFAULT_PANEL_CAPACITY_W;
}

function normalizePanelCount(input?: Partial<PvAnalysisInput>) {
  const panelCount = input?.solar_panel_info?.panel_count;

  return Number.isFinite(panelCount) && typeof panelCount === 'number' && panelCount > 0
    ? Math.round(panelCount)
    : DEFAULT_PANEL_COUNT;
}

function normalizePanelType(input?: Partial<PvAnalysisInput>) {
  const panelType = input?.solar_panel_info?.panel_type;

  return Number.isFinite(panelType) && typeof panelType === 'number' && panelType > 0
    ? Math.round(panelType)
    : DEFAULT_PANEL_TYPE;
}

function createFallbackMonthlyGenerationSeries(annualGenerationKwh: number): PvAnalysisMonthlyGenerationPoint[] {
  return MONTHLY_GENERATION_WEIGHTS.map((weight, index) => ({
    month: index + 1,
    generationKwh: roundDecimal(annualGenerationKwh * weight, 1),
  }));
}

export function createSafePvAnalysisInputSummary(input: PvAnalysisInput): PvAnalysisSafeInputSummary {
  return {
    latitude: roundDecimal(input.latitude, 6),
    longitude: roundDecimal(input.longitude, 6),
    shadingIndexAverage: roundDecimal(input.shading_index_average, 2),
    solarPanelAngle: roundDecimal(input.solar_panel_angle, 1),
    panelCapacityW: roundNumber(input.solar_panel_info.panel_capacity),
    panelCount: roundNumber(input.solar_panel_info.panel_count),
    panelType: roundNumber(input.solar_panel_info.panel_type),
  };
}

export function createFallbackPvAnalysisResult(input?: Partial<PvAnalysisInput>): PvAnalysisResult {
  const panelCapacityW = normalizePanelCapacity(input);
  const panelCount = normalizePanelCount(input);
  const installKw = roundDecimal((panelCapacityW * panelCount) / 1000, 1);
  const annualGenerationKwh = roundNumber(installKw * ANNUAL_GENERATION_KWH_PER_KW);
  const firstYearSelfConsumptionSavingKrw = roundMoney(annualGenerationKwh * ELECTRICITY_VALUE_KRW_PER_KWH);
  const estimatedInvestmentKrw = roundMoney(firstYearSelfConsumptionSavingKrw * FALLBACK_PAYBACK_YEARS);
  const carbonReductionKg = roundDecimal(annualGenerationKwh * CARBON_REDUCTION_KG_PER_KWH, 1);
  const pineTreeEffect = roundDecimal(carbonReductionKg / PINE_TREE_KG_CO2_PER_YEAR, 1);

  return {
    annualGenerationKwh,
    installKw,
    firstYearTotalEconomicEffectKrw: firstYearSelfConsumptionSavingKrw,
    firstYearSelfConsumptionSavingKrw,
    estimatedInvestmentKrw,
    estimatedSurplusSalesKrw: 0,
    carbonReductionKg,
    pineTreeEffect,
    annualRevenueSeries: [],
    annualSaveCostSeries: [],
    monthlyGenerationSeries: createFallbackMonthlyGenerationSeries(annualGenerationKwh),
  };
}

export function createFrontendLocalPvFormulaResult(input?: Partial<PvAnalysisInput>): PvAnalysisResult {
  const fallbackInput = createDefaultPvAnalysisInput(input);
  const panelCapacityW = normalizePanelCapacity(fallbackInput);
  const panelCount = normalizePanelCount(fallbackInput);
  const installKw = roundDecimal((panelCapacityW * panelCount) / 1000, 1);
  const shadingFactor = clampNumber(fallbackInput.shading_index_average / 3.5, 0.45, 1.0);
  const annualGenerationKwh = roundNumber(installKw * 365 * 3.6 * shadingFactor);
  const annualSavingKrw = roundMoney(annualGenerationKwh * ELECTRICITY_VALUE_KRW_PER_KWH);
  const estimatedInvestmentKrw = roundMoney(installKw * FRONTEND_LOCAL_INVESTMENT_KRW_PER_KW);
  const carbonReductionKg = roundDecimal(annualGenerationKwh * CARBON_REDUCTION_KG_PER_KWH, 1);

  return {
    annualGenerationKwh,
    installKw,
    firstYearTotalEconomicEffectKrw: annualSavingKrw,
    firstYearSelfConsumptionSavingKrw: annualSavingKrw,
    estimatedInvestmentKrw,
    estimatedSurplusSalesKrw: 0,
    carbonReductionKg,
    pineTreeEffect: roundDecimal(carbonReductionKg / PINE_TREE_KG_CO2_PER_YEAR, 1),
    annualRevenueSeries: [],
    annualSaveCostSeries: Array.from({ length: 20 }, (_, index) => ({
      year: index + 1,
      saveCostKrw: annualSavingKrw,
    })),
    monthlyGenerationSeries: createFallbackMonthlyGenerationSeries(annualGenerationKwh),
  };
}

export function createDefaultPvAnalysisInput(input?: Partial<PvAnalysisInput>): PvAnalysisInput {
  return {
    latitude: Number.isFinite(input?.latitude) && typeof input?.latitude === 'number' ? input.latitude : 0,
    longitude: Number.isFinite(input?.longitude) && typeof input?.longitude === 'number' ? input.longitude : 0,
    shading_index_average:
      Number.isFinite(input?.shading_index_average) && typeof input?.shading_index_average === 'number'
        ? input.shading_index_average
        : DEFAULT_SHADING_INDEX_AVERAGE,
    solar_panel_angle:
      Number.isFinite(input?.solar_panel_angle) && typeof input?.solar_panel_angle === 'number'
        ? input.solar_panel_angle
        : DEFAULT_SOLAR_PANEL_ANGLE,
    solar_panel_info: {
      panel_capacity: normalizePanelCapacity(input),
      panel_count: normalizePanelCount(input),
      panel_type: normalizePanelType(input),
    },
  };
}

export function normalizePvAnalysisResponse(payload: unknown): PvAnalysisResult | null {
  if (!isRecord(payload) || payload.status_code !== 200 || !isRecord(payload.data)) {
    return null;
  }

  const data = payload.data;

  if (!isRecord(data.expected_revenue) || !isRecord(data.environmental_contribution)) {
    return null;
  }

  const expectedRevenue = data.expected_revenue;
  const environmentalContribution = data.environmental_contribution;
  const firstYearRevenue = readNumber(expectedRevenue.first_year_revenue);
  const firstYearSaveCost = readNumber(expectedRevenue.first_year_save_cost);

  return {
    annualGenerationKwh: roundDecimal(Math.max(0, readNumber(data.annual_generation)), 1),
    installKw: roundDecimal(Math.max(0, readNumber(expectedRevenue.install_kw)), 1),
    firstYearTotalEconomicEffectKrw: roundMoney(Math.max(0, firstYearRevenue)),
    firstYearSelfConsumptionSavingKrw: roundMoney(Math.max(0, firstYearSaveCost)),
    estimatedInvestmentKrw: roundMoney(Math.max(0, readNumber(expectedRevenue.expected_investment))),
    estimatedSurplusSalesKrw: roundMoney(firstYearRevenue - firstYearSaveCost),
    carbonReductionKg: roundDecimal(Math.max(0, readNumber(environmentalContribution.carbon_reduction)), 1),
    pineTreeEffect: roundDecimal(Math.max(0, readNumber(environmentalContribution.pine_tree_effect)), 1),
    annualRevenueSeries: normalizeAnnualRevenueSeries(data.annual_revenue),
    annualSaveCostSeries: normalizeAnnualSaveCostSeries(data.annual_saveCost),
    monthlyGenerationSeries: normalizeMonthlyGenerationSeries(data.monthly_generation),
  };
}

