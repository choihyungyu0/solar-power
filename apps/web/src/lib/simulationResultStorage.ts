import type { ClimateBundle, ClimateDbSaveStatus, ProfitReportDbSaveStatus, ProfitReportJson } from '../types/climateBundle';
import type { PvAnalysisResult } from '../types/pvAnalysis';
import {
  isSimulationAiResult,
  type SimulationAiAgentPayload,
  type SimulationAiModelMetadata,
  type SimulationAiResult,
} from './simulationAiResult';

export const SELECTED_SIMULATION_RESULT_STORAGE_KEY = 'solarmate:selectedSimulationResult';
export const SELECTED_AI_SIMULATION_RESULT_STORAGE_KEY = 'solarmate:aiSimulationResult';
export const SELECTED_AGENT_PAYLOAD_STORAGE_KEY = 'solarmate:agentPayload';
export const SELECTED_AI_MODEL_METADATA_STORAGE_KEY = 'solarmate:aiModelMetadata';
export const PROFIT_REPORT_STORAGE_KEY = 'solarmate:profitReport';

export type SimulationResultSource = 'climate-live-hybrid' | 'pv-analysis' | 'demo';

export type StoredSimulationBuilding = {
  name: string;
  roadAddress: string;
  jibunAddress: string;
  buildingId: string;
};

export type StoredSimulationSolar = {
  panelCount: number;
  installCapacityKw: number;
  annualGenerationKwh: number;
  annualSavingKrw: number;
  paybackYears: number;
  investmentKrw: number;
  subsidyMaxKrw: number;
  selfPaymentKrw: number;
  loanLimitKrw: number;
  carbonReductionKg: number;
  pineTreeEffect: number;
  monthlyGeneration: number[];
  monthlyGenerationKwh?: number[];
  yearlyRevenue: number[];
  firstYearSavingKrw?: number;
  tenYearSavingKrw?: number;
  twentyYearSavingKrw?: number;
};

export type StoredSimulationResult = {
  building: StoredSimulationBuilding;
  solar: StoredSimulationSolar;
  source: SimulationResultSource;
  storedAt: string;
  analysisResultId?: string | null;
  dbSaveStatus?: ClimateDbSaveStatus | null;
  consultationRequestId?: string | null;
  aiSimulationResult?: SimulationAiResult | null;
  agentPayload?: SimulationAiAgentPayload | null;
  aiModelMetadata?: SimulationAiModelMetadata | null;
};

export type StoredProfitReport = {
  profitReportId?: string | null;
  report: ProfitReportJson;
  reportMarkdown: string;
  dbSaveStatus?: ProfitReportDbSaveStatus | null;
  storedAt: string;
};

type SimulationResultSnapshotInput = {
  building: Partial<StoredSimulationBuilding>;
  liveClimateBundle?: ClimateBundle | null;
  aiSimulationResult?: SimulationAiResult | null;
  analysisResultId?: string | null;
  dbSaveStatus?: ClimateDbSaveStatus | null;
  pvAnalysisResult?: PvAnalysisResult | null;
  selectedEstimate?: Partial<{
    panelCount: number;
    installCapacityKw: number;
    annualGenerationKwh: number;
    annualSavingKrw: number;
    paybackYears: number;
    investmentKrw: number;
    carbonReductionKg: number;
    pineTreeEffect: number;
    monthlyGeneration: number[];
    yearlyRevenue: number[];
  }>;
};

const FALLBACK_INVESTMENT_KRW = 27_000_000;
const FALLBACK_SUBSIDY_MAX_KRW = 13_000_000;
const FALLBACK_PANEL_COUNT = 46;
const FALLBACK_INSTALL_CAPACITY_KW = 23;
const FALLBACK_ANNUAL_GENERATION_KWH = 32_041;
const FALLBACK_ANNUAL_SAVING_KRW = 6_087_790;
const FALLBACK_CARBON_REDUCTION_KG = 15_319;
const FALLBACK_PINE_TREE_EFFECT = 109_684;

function toFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function roundNumber(value: number, digits = 0) {
  const scale = 10 ** digits;

  return Math.round(value * scale) / scale;
}

function createMonthlyGenerationFallback(annualGenerationKwh: number) {
  const seasonalWeights = [0.052, 0.057, 0.077, 0.094, 0.109, 0.116, 0.109, 0.095, 0.084, 0.074, 0.063, 0.07];
  const weightTotal = seasonalWeights.reduce((sum, weight) => sum + weight, 0);

  return seasonalWeights.map((weight) => Math.round((annualGenerationKwh * weight) / weightTotal));
}

function createYearlyRevenueFallback(annualSavingKrw: number) {
  return Array.from({ length: 20 }, (_, index) => Math.round(annualSavingKrw * Math.max(0.86, 1 - index * 0.006)));
}

function normalizeNumberArray(value: unknown, fallback: number[]) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const numbers = value
    .map((item) => toFiniteNumber(item))
    .filter((item): item is number => item !== null);

  return numbers.length > 0 ? numbers : fallback;
}

function buildSolarPayload(
  values: Partial<StoredSimulationSolar>,
  selectedEstimate?: SimulationResultSnapshotInput['selectedEstimate'],
) {
  const panelCount =
    toFiniteNumber(values.panelCount) ?? toFiniteNumber(selectedEstimate?.panelCount) ?? FALLBACK_PANEL_COUNT;
  const installCapacityKw =
    toFiniteNumber(values.installCapacityKw) ??
    toFiniteNumber(selectedEstimate?.installCapacityKw) ??
    FALLBACK_INSTALL_CAPACITY_KW;
  const annualGenerationKwh =
    toFiniteNumber(values.annualGenerationKwh) ??
    toFiniteNumber(selectedEstimate?.annualGenerationKwh) ??
    FALLBACK_ANNUAL_GENERATION_KWH;
  const annualSavingKrw =
    toFiniteNumber(values.annualSavingKrw) ??
    toFiniteNumber(selectedEstimate?.annualSavingKrw) ??
    FALLBACK_ANNUAL_SAVING_KRW;
  const investmentKrw =
    toFiniteNumber(values.investmentKrw) ?? toFiniteNumber(selectedEstimate?.investmentKrw) ?? FALLBACK_INVESTMENT_KRW;
  const subsidyMaxKrw = toFiniteNumber(values.subsidyMaxKrw) ?? FALLBACK_SUBSIDY_MAX_KRW;
  const selfPaymentKrw = Math.max(0, investmentKrw - subsidyMaxKrw);
  const loanLimitKrw = Math.round(selfPaymentKrw * 0.75);
  const paybackCandidate = toFiniteNumber(values.paybackYears) ?? toFiniteNumber(selectedEstimate?.paybackYears);
  const paybackYears =
    annualSavingKrw > 0
      ? roundNumber(paybackCandidate && paybackCandidate > 0 ? paybackCandidate : investmentKrw / annualSavingKrw, 1)
      : 0;
  const monthlyFallback = createMonthlyGenerationFallback(annualGenerationKwh);
  const yearlyFallback = createYearlyRevenueFallback(annualSavingKrw);

  const monthlyGeneration = normalizeNumberArray(
    values.monthlyGeneration ?? selectedEstimate?.monthlyGeneration,
    monthlyFallback,
  );

  return {
    panelCount: Math.round(panelCount),
    installCapacityKw: roundNumber(installCapacityKw, 1),
    annualGenerationKwh: Math.round(annualGenerationKwh),
    annualSavingKrw: Math.round(annualSavingKrw),
    paybackYears,
    investmentKrw: Math.round(investmentKrw),
    subsidyMaxKrw: Math.round(subsidyMaxKrw),
    selfPaymentKrw,
    loanLimitKrw,
    carbonReductionKg:
      Math.round(
        toFiniteNumber(values.carbonReductionKg) ??
          toFiniteNumber(selectedEstimate?.carbonReductionKg) ??
          FALLBACK_CARBON_REDUCTION_KG,
      ),
    pineTreeEffect:
      Math.round(
        toFiniteNumber(values.pineTreeEffect) ??
          toFiniteNumber(selectedEstimate?.pineTreeEffect) ??
          FALLBACK_PINE_TREE_EFFECT,
      ),
    monthlyGeneration,
    monthlyGenerationKwh: monthlyGeneration,
    yearlyRevenue: normalizeNumberArray(values.yearlyRevenue ?? selectedEstimate?.yearlyRevenue, yearlyFallback),
  };
}

function buildClimateSolarPayload(bundle: ClimateBundle, selectedEstimate?: SimulationResultSnapshotInput['selectedEstimate']) {
  const pvOutput = bundle.pv_analysis_output;

  if (!pvOutput) {
    const panelCapacityW = bundle.pv_analysis_input.solar_panel_info.panel_capacity;
    const panelCount = bundle.pv_analysis_input.solar_panel_info.panel_count;
    const installCapacityKw = (panelCapacityW * panelCount) / 1000;

    return buildSolarPayload(
      {
        panelCount,
        installCapacityKw,
      },
      selectedEstimate,
    );
  }

  const expectedRevenue = pvOutput.expected_revenue;
  const environmental = pvOutput.environmental_contribution;

  return buildSolarPayload({
    panelCount: bundle.pv_analysis_input.solar_panel_info.panel_count,
    installCapacityKw: expectedRevenue.install_kw,
    annualGenerationKwh: pvOutput.annual_generation,
    annualSavingKrw: expectedRevenue.first_year_save_cost,
    investmentKrw: expectedRevenue.expected_investment,
    carbonReductionKg: environmental.carbon_reduction,
    pineTreeEffect: environmental.pine_tree_effect,
    monthlyGeneration: pvOutput.monthly_generation.map((item) => item.generation),
    yearlyRevenue: pvOutput.annual_saveCost.map((item) => item.saveCost),
  });
}

function applyAiSimulationToSolarPayload(solar: StoredSimulationSolar, aiSimulationResult: SimulationAiResult | null) {
  if (!aiSimulationResult) {
    return solar;
  }

  const generation = aiSimulationResult.generationPrediction;
  const economics = aiSimulationResult.economics ?? {};
  const annualGenerationKwh = toFiniteNumber(generation.annualGenerationKwh) ?? solar.annualGenerationKwh;
  const annualSavingKrw = toFiniteNumber(economics.annualSavingKrw) ?? solar.annualSavingKrw;
  const investmentKrw = toFiniteNumber(economics.estimatedInstallCostKrw) ?? solar.investmentKrw;
  const subsidyMaxKrw = toFiniteNumber(economics.subsidyEstimateKrw) ?? solar.subsidyMaxKrw;
  const selfPaymentKrw = toFiniteNumber(economics.estimatedSelfPaymentKrw) ?? Math.max(0, investmentKrw - subsidyMaxKrw);
  const loanLimitKrw = toFiniteNumber(economics.policyLoanLimitKrw) ?? Math.round(selfPaymentKrw * 0.75);
  const paybackYears = toFiniteNumber(economics.paybackYears) ?? solar.paybackYears;
  const monthlyGeneration =
    solar.monthlyGeneration.length === 12
      ? solar.monthlyGeneration.map((value) => {
          const currentTotal = solar.monthlyGeneration.reduce((sum, item) => sum + item, 0);

          return currentTotal > 0 ? Math.round((value / currentTotal) * annualGenerationKwh) : value;
        })
      : createMonthlyGenerationFallback(annualGenerationKwh);

  return {
    ...solar,
    annualGenerationKwh: Math.round(annualGenerationKwh),
    annualSavingKrw: Math.round(annualSavingKrw),
    paybackYears: roundNumber(paybackYears, 1),
    investmentKrw: Math.round(investmentKrw),
    subsidyMaxKrw: Math.round(subsidyMaxKrw),
    selfPaymentKrw: Math.round(selfPaymentKrw),
    loanLimitKrw: Math.round(loanLimitKrw),
    monthlyGeneration,
    monthlyGenerationKwh: monthlyGeneration,
  };
}

function buildPvSolarPayload(result: PvAnalysisResult, selectedEstimate?: SimulationResultSnapshotInput['selectedEstimate']) {
  return buildSolarPayload(
    {
      panelCount: selectedEstimate?.panelCount,
      installCapacityKw: result.installKw,
      annualGenerationKwh: result.annualGenerationKwh,
      annualSavingKrw: result.firstYearSelfConsumptionSavingKrw || result.firstYearTotalEconomicEffectKrw,
      investmentKrw: result.estimatedInvestmentKrw,
      carbonReductionKg: result.carbonReductionKg,
      pineTreeEffect: result.pineTreeEffect,
      monthlyGeneration: result.monthlyGenerationSeries.map((item) => item.generationKwh),
      yearlyRevenue:
        result.annualSaveCostSeries.length > 0
          ? result.annualSaveCostSeries.map((item) => item.saveCostKrw)
          : result.annualRevenueSeries.map((item) => item.revenueKrw),
    },
    selectedEstimate,
  );
}

function resolveSimulationAiResult(input: SimulationResultSnapshotInput) {
  if (input.aiSimulationResult && isSimulationAiResult(input.aiSimulationResult)) {
    return input.aiSimulationResult;
  }

  const bundleAiResult = input.liveClimateBundle?.ai_simulation_result;

  return isSimulationAiResult(bundleAiResult) ? bundleAiResult : null;
}

function buildAiPayloadFields(aiSimulationResult: SimulationAiResult | null) {
  return aiSimulationResult
    ? {
        aiSimulationResult,
        agentPayload: aiSimulationResult.agentPayload,
        aiModelMetadata: aiSimulationResult.aiModelMetadata ?? null,
      }
    : {};
}

function pickString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function resolveAnalysisResultId(
  input: SimulationResultSnapshotInput,
  aiSimulationResult: SimulationAiResult | null,
) {
  return pickString(
    input.analysisResultId,
    input.liveClimateBundle?.analysisResultId,
    input.liveClimateBundle?.analysis_result_id,
    aiSimulationResult?.analysisResultId,
    aiSimulationResult?.agentPayload?.analysisResultId,
  );
}

function resolveDbSaveStatus(input: SimulationResultSnapshotInput) {
  return input.dbSaveStatus ?? input.liveClimateBundle?.dbSaveStatus ?? null;
}

export function buildStoredSimulationResult(input: SimulationResultSnapshotInput): StoredSimulationResult {
  const building: StoredSimulationBuilding = {
    name: input.building.name || '선택 아파트',
    roadAddress: input.building.roadAddress || '도로명주소 확인 필요',
    jibunAddress: input.building.jibunAddress || '지번 정보 확인 필요',
    buildingId: input.building.buildingId || 'demo-building',
  };

  const aiSimulationResult = resolveSimulationAiResult(input);
  const aiPayloadFields = buildAiPayloadFields(aiSimulationResult);
  const analysisResultId = resolveAnalysisResultId(input, aiSimulationResult);
  const dbSaveStatus = resolveDbSaveStatus(input);
  const persistenceFields = {
    analysisResultId,
    dbSaveStatus,
  };

  if (input.liveClimateBundle) {
    const solar = applyAiSimulationToSolarPayload(
      buildClimateSolarPayload(input.liveClimateBundle, input.selectedEstimate),
      aiSimulationResult,
    );

    return {
      building,
      solar,
      source: 'climate-live-hybrid',
      storedAt: new Date().toISOString(),
      ...persistenceFields,
      ...aiPayloadFields,
    };
  }

  if (input.pvAnalysisResult) {
    const solar = applyAiSimulationToSolarPayload(
      buildPvSolarPayload(input.pvAnalysisResult, input.selectedEstimate),
      aiSimulationResult,
    );

    return {
      building,
      solar,
      source: 'pv-analysis',
      storedAt: new Date().toISOString(),
      ...persistenceFields,
      ...aiPayloadFields,
    };
  }

  return {
    building,
    solar: applyAiSimulationToSolarPayload(buildSolarPayload({}, input.selectedEstimate), aiSimulationResult),
    source: 'demo',
    storedAt: new Date().toISOString(),
    ...persistenceFields,
    ...aiPayloadFields,
  };
}

export function saveSimulationResultToSession(result: StoredSimulationResult) {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    const currentValue = window.sessionStorage.getItem(SELECTED_SIMULATION_RESULT_STORAGE_KEY);
    const currentResult = currentValue ? (JSON.parse(currentValue) as Partial<StoredSimulationResult>) : null;
    const isFallbackDemoResult = result.source === 'demo' && result.storedAt === 'demo';

    if (isFallbackDemoResult && currentResult?.source && currentResult.source !== 'demo') {
      return true;
    }

    const monthlyGenerationKwh = result.solar.monthlyGenerationKwh ?? result.solar.monthlyGeneration;
    const dashboardCompatibleResult: StoredSimulationResult = {
      ...result,
      solar: {
        ...result.solar,
        monthlyGenerationKwh,
      },
    };

    window.sessionStorage.setItem(SELECTED_SIMULATION_RESULT_STORAGE_KEY, JSON.stringify(dashboardCompatibleResult));

    if (dashboardCompatibleResult.aiSimulationResult) {
      window.sessionStorage.setItem(
        SELECTED_AI_SIMULATION_RESULT_STORAGE_KEY,
        JSON.stringify(dashboardCompatibleResult.aiSimulationResult),
      );
    }

    if (dashboardCompatibleResult.agentPayload) {
      window.sessionStorage.setItem(
        SELECTED_AGENT_PAYLOAD_STORAGE_KEY,
        JSON.stringify(dashboardCompatibleResult.agentPayload),
      );
    }

    if (dashboardCompatibleResult.aiModelMetadata) {
      window.sessionStorage.setItem(
        SELECTED_AI_MODEL_METADATA_STORAGE_KEY,
        JSON.stringify(dashboardCompatibleResult.aiModelMetadata),
      );
    }

    return true;
  } catch {
    return false;
  }
}

export function attachConsultationRequestIdToStoredSimulationResult(consultationRequestId: string) {
  if (typeof window === 'undefined' || !consultationRequestId.trim()) {
    return false;
  }

  try {
    const rawValue = window.sessionStorage.getItem(SELECTED_SIMULATION_RESULT_STORAGE_KEY);

    if (!rawValue) {
      return false;
    }

    const parsedValue = JSON.parse(rawValue) as Partial<StoredSimulationResult>;

    if (!parsedValue || typeof parsedValue !== 'object' || !parsedValue.building || !parsedValue.solar) {
      return false;
    }

    window.sessionStorage.setItem(
      SELECTED_SIMULATION_RESULT_STORAGE_KEY,
      JSON.stringify({
        ...parsedValue,
        consultationRequestId,
      }),
    );

    return true;
  } catch {
    return false;
  }
}

export function readSimulationResultFromSession() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const rawValue = window.sessionStorage.getItem(SELECTED_SIMULATION_RESULT_STORAGE_KEY);

    if (!rawValue) {
      return null;
    }

    const parsedValue = JSON.parse(rawValue) as Partial<StoredSimulationResult>;

    if (!parsedValue || typeof parsedValue !== 'object' || !parsedValue.building || !parsedValue.solar) {
      return null;
    }

    if (
      parsedValue.source !== 'climate-live-hybrid' &&
      parsedValue.source !== 'pv-analysis' &&
      parsedValue.source !== 'demo'
    ) {
      return null;
    }

    const storedResult = parsedValue as StoredSimulationResult;

    if (!storedResult.aiModelMetadata && storedResult.aiSimulationResult?.aiModelMetadata) {
      storedResult.aiModelMetadata = storedResult.aiSimulationResult.aiModelMetadata;
    }

    if (!storedResult.agentPayload && storedResult.aiSimulationResult?.agentPayload) {
      storedResult.agentPayload = storedResult.aiSimulationResult.agentPayload;
    }

    return storedResult;
  } catch {
    return null;
  }
}

export function saveProfitReportToSession(report: Omit<StoredProfitReport, 'storedAt'> & { storedAt?: string }) {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    window.sessionStorage.setItem(
      PROFIT_REPORT_STORAGE_KEY,
      JSON.stringify({
        ...report,
        storedAt: report.storedAt ?? new Date().toISOString(),
      }),
    );

    return true;
  } catch {
    return false;
  }
}

export function readProfitReportFromSession() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const rawValue = window.sessionStorage.getItem(PROFIT_REPORT_STORAGE_KEY);

    if (!rawValue) {
      return null;
    }

    const parsedValue = JSON.parse(rawValue) as Partial<StoredProfitReport>;

    if (!parsedValue || typeof parsedValue !== 'object' || !parsedValue.report || !parsedValue.reportMarkdown) {
      return null;
    }

    return parsedValue as StoredProfitReport;
  } catch {
    return null;
  }
}
