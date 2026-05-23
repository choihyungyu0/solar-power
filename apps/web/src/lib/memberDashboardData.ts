import { SELECTED_SIMULATION_RESULT_STORAGE_KEY, type SimulationResultSource } from './simulationResultStorage';

export type DashboardDataSource = SimulationResultSource;

export type DashboardBuilding = {
  roadAddress: string;
  jibunAddress: string;
  buildingId?: string;
};

export type DashboardSolar = {
  annualGenerationKwh: number;
  monthlyGenerationKwh: number[];
  installCapacityKw: number;
  panelCount: number;
  annualSavingKrw: number;
  investmentKrw?: number;
  carbonReductionKg?: number;
  monthlyElectricityKwh?: number | number[];
  electricityPriceKrwPerKwh: number;
};

export type NormalizedDashboardData = {
  building: DashboardBuilding;
  solar: DashboardSolar;
  source: DashboardDataSource;
  isFallbackDemo: boolean;
};

export type ScenarioBarColor = 'orange' | 'yellow' | 'blue' | 'sky';

export type ScenarioComparisonBar = {
  label: string;
  cost?: string;
  value: string;
  color: ScenarioBarColor;
  percent: number;
  group?: '수전' | '발전';
};

export type ScenarioHourSegment = {
  hour: number;
  usagePercent: number;
  generationPercent: number;
};

export type ScenarioDayCard = {
  id: 1 | 2 | 3;
  month: number;
  date: string;
  day: string;
  sourceLabel: string;
  dailyUsageKwh: number;
  previousDailyUsageKwh: number;
  dailyGenerationKwh: number;
  previousDailyGenerationKwh: number;
  dailyBillKrw: number;
  previousDailyBillKrw: number;
  generationRatio: number;
  visualGenerationRatio: number;
  stage: string;
  stageColor: 'green' | 'yellow';
  temp: string;
  tooltip: string;
  segments: ScenarioHourSegment[];
  bars: ScenarioComparisonBar[];
};

type UnknownRecord = Record<string, unknown>;

type DashboardStoragePayload = {
  raw: unknown;
  storageKey: string | null;
  addressOnly: boolean;
};

const CONSULTATION_INQUIRY_STORAGE_KEY = 'solarmate:consultationInquiry';
const DEFAULT_ELECTRICITY_PRICE_KRW_PER_KWH = 165;
const SCENARIO_YEAR = 2026;

const riskMapResultStorageKeys = [
  'solarmate:latestRiskMapAnalysis',
  'solarmate:riskMapLatestAnalysis',
  'solarmate:riskMapClimateLiveResult',
  'solarmate:latestClimateLiveResult',
  'solarmate:latestPvAnalysisResult',
];

const fallbackDashboardData: NormalizedDashboardData = {
  building: {
    roadAddress: '경기도 수원시 팔달구 경수대로 464',
    jibunAddress: '경기 수원시 팔달구 인계동 1017',
  },
  solar: {
    annualGenerationKwh: 32_041,
    installCapacityKw: 23,
    panelCount: 46,
    annualSavingKrw: 6_087_790,
    monthlyGenerationKwh: [1258, 1229, 2479, 3302, 3822, 3864, 3133, 2645, 1775, 1265, 1008, 1112],
    electricityPriceKrwPerKwh: DEFAULT_ELECTRICITY_PRICE_KRW_PER_KWH,
  },
  source: 'demo',
  isFallbackDemo: true,
};

const seasonalSolarDistribution = [0.06, 0.06, 0.09, 0.11, 0.12, 0.13, 0.12, 0.1, 0.08, 0.06, 0.04, 0.04];

const usageHourlyProfile = [
  0.74, 0.66, 0.58, 0.52, 0.5, 0.58, 0.78, 1.05, 1.16, 1.08, 0.96, 0.9, 0.88, 0.92, 1.02, 1.14, 1.2,
  1.28, 1.42, 1.5, 1.38, 1.18, 0.96, 0.82,
];

const generationHourlyProfile = [
  0, 0, 0, 0, 0, 0.04, 0.13, 0.32, 0.56, 0.82, 1.0, 1.12, 1.18, 1.1, 0.9, 0.68, 0.42, 0.18, 0.04, 0, 0, 0,
  0, 0,
];

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSessionJson(storageKey: string) {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const rawValue = window.sessionStorage.getItem(storageKey);

    return rawValue ? (JSON.parse(rawValue) as unknown) : null;
  } catch {
    return null;
  }
}

export function loadSelectedSimulationResult(): DashboardStoragePayload | null {
  const selectedSimulationResult = readSessionJson(SELECTED_SIMULATION_RESULT_STORAGE_KEY);

  if (selectedSimulationResult) {
    return {
      raw: selectedSimulationResult,
      storageKey: SELECTED_SIMULATION_RESULT_STORAGE_KEY,
      addressOnly: false,
    };
  }

  for (const storageKey of riskMapResultStorageKeys) {
    const riskMapResult = readSessionJson(storageKey);

    if (riskMapResult) {
      return {
        raw: riskMapResult,
        storageKey,
        addressOnly: false,
      };
    }
  }

  const consultationInquiry = readSessionJson(CONSULTATION_INQUIRY_STORAGE_KEY);

  if (consultationInquiry) {
    return {
      raw: consultationInquiry,
      storageKey: CONSULTATION_INQUIRY_STORAGE_KEY,
      addressOnly: true,
    };
  }

  return null;
}

export function normalizeDashboardData(rawPayload: unknown): NormalizedDashboardData {
  const payload = getDashboardPayload(rawPayload);

  if (!payload) {
    return fallbackDashboardData;
  }

  const raw = payload.raw;
  const building = normalizeBuilding(raw);
  const source = payload.addressOnly ? 'demo' : normalizeSource(raw);
  const annualGenerationKwh =
    pickNumber(
      getPathValue(raw, ['solar', 'annualGenerationKwh']),
      getPathValue(raw, ['solar', 'annual_generation']),
      getPathValue(raw, ['selectedEstimate', 'annualGenerationKwh']),
      getPathValue(raw, ['pv_analysis_output', 'annual_generation']),
      getPathValue(raw, ['bundle', 'pv_analysis_output', 'annual_generation']),
      getPathValue(raw, ['liveClimateBundle', 'pv_analysis_output', 'annual_generation']),
      getPathValue(raw, ['climateBundle', 'pv_analysis_output', 'annual_generation']),
      getPathValue(raw, ['result', 'annualGenerationKwh']),
      getPathValue(raw, ['pvAnalysisResult', 'annualGenerationKwh']),
    ) ?? fallbackDashboardData.solar.annualGenerationKwh;
  const monthlyGenerationKwh = normalizeMonthlyGeneration(raw, annualGenerationKwh);
  const installCapacityKw =
    pickNumber(
      getPathValue(raw, ['solar', 'installCapacityKw']),
      getPathValue(raw, ['solar', 'install_kw']),
      getPathValue(raw, ['selectedEstimate', 'installCapacityKw']),
      getPathValue(raw, ['pv_analysis_output', 'expected_revenue', 'install_kw']),
      getPathValue(raw, ['bundle', 'pv_analysis_output', 'expected_revenue', 'install_kw']),
      getPathValue(raw, ['liveClimateBundle', 'pv_analysis_output', 'expected_revenue', 'install_kw']),
      getPathValue(raw, ['climateBundle', 'pv_analysis_output', 'expected_revenue', 'install_kw']),
      getPathValue(raw, ['result', 'installKw']),
      getPathValue(raw, ['pvAnalysisResult', 'installKw']),
    ) ?? fallbackDashboardData.solar.installCapacityKw;
  const panelCount =
    pickNumber(
      getPathValue(raw, ['solar', 'panelCount']),
      getPathValue(raw, ['selectedEstimate', 'panelCount']),
      getPathValue(raw, ['pv_analysis_input', 'solar_panel_info', 'panel_count']),
      getPathValue(raw, ['bundle', 'pv_analysis_input', 'solar_panel_info', 'panel_count']),
      getPathValue(raw, ['liveClimateBundle', 'pv_analysis_input', 'solar_panel_info', 'panel_count']),
      getPathValue(raw, ['climateBundle', 'pv_analysis_input', 'solar_panel_info', 'panel_count']),
      getPathValue(raw, ['input', 'panelCount']),
    ) ?? fallbackDashboardData.solar.panelCount;
  const annualSavingKrw =
    pickNumber(
      getPathValue(raw, ['solar', 'annualSavingKrw']),
      getPathValue(raw, ['selectedEstimate', 'annualSavingKrw']),
      getPathValue(raw, ['pv_analysis_output', 'expected_revenue', 'first_year_save_cost']),
      getPathValue(raw, ['bundle', 'pv_analysis_output', 'expected_revenue', 'first_year_save_cost']),
      getPathValue(raw, ['liveClimateBundle', 'pv_analysis_output', 'expected_revenue', 'first_year_save_cost']),
      getPathValue(raw, ['climateBundle', 'pv_analysis_output', 'expected_revenue', 'first_year_save_cost']),
      getPathValue(raw, ['result', 'firstYearSelfConsumptionSavingKrw']),
      getPathValue(raw, ['result', 'firstYearTotalEconomicEffectKrw']),
      getPathValue(raw, ['pvAnalysisResult', 'firstYearSelfConsumptionSavingKrw']),
      getPathValue(raw, ['pvAnalysisResult', 'firstYearTotalEconomicEffectKrw']),
    ) ?? fallbackDashboardData.solar.annualSavingKrw;
  const investmentKrw = pickNumber(
    getPathValue(raw, ['solar', 'investmentKrw']),
    getPathValue(raw, ['selectedEstimate', 'investmentKrw']),
    getPathValue(raw, ['pv_analysis_output', 'expected_revenue', 'expected_investment']),
    getPathValue(raw, ['bundle', 'pv_analysis_output', 'expected_revenue', 'expected_investment']),
    getPathValue(raw, ['liveClimateBundle', 'pv_analysis_output', 'expected_revenue', 'expected_investment']),
    getPathValue(raw, ['climateBundle', 'pv_analysis_output', 'expected_revenue', 'expected_investment']),
    getPathValue(raw, ['result', 'estimatedInvestmentKrw']),
    getPathValue(raw, ['pvAnalysisResult', 'estimatedInvestmentKrw']),
  );
  const carbonReductionKg = pickNumber(
    getPathValue(raw, ['solar', 'carbonReductionKg']),
    getPathValue(raw, ['selectedEstimate', 'carbonReductionKg']),
    getPathValue(raw, ['pv_analysis_output', 'environmental_contribution', 'carbon_reduction']),
    getPathValue(raw, ['bundle', 'pv_analysis_output', 'environmental_contribution', 'carbon_reduction']),
    getPathValue(raw, ['liveClimateBundle', 'pv_analysis_output', 'environmental_contribution', 'carbon_reduction']),
    getPathValue(raw, ['climateBundle', 'pv_analysis_output', 'environmental_contribution', 'carbon_reduction']),
    getPathValue(raw, ['result', 'carbonReductionKg']),
    getPathValue(raw, ['pvAnalysisResult', 'carbonReductionKg']),
  );
  const monthlyElectricityKwh = normalizeMonthlyElectricity(raw);
  const electricityPriceKrwPerKwh =
    pickNumber(
      getPathValue(raw, ['solar', 'electricityPriceKrwPerKwh']),
      getPathValue(raw, ['electricityPriceKrwPerKwh']),
    ) ?? DEFAULT_ELECTRICITY_PRICE_KRW_PER_KWH;

  return {
    building,
    solar: {
      annualGenerationKwh: Math.round(annualGenerationKwh),
      monthlyGenerationKwh,
      installCapacityKw: roundNumber(installCapacityKw, 1),
      panelCount: Math.round(panelCount),
      annualSavingKrw: Math.round(annualSavingKrw),
      investmentKrw: investmentKrw ? Math.round(investmentKrw) : undefined,
      carbonReductionKg: carbonReductionKg ? Math.round(carbonReductionKg) : undefined,
      monthlyElectricityKwh,
      electricityPriceKrwPerKwh,
    },
    source,
    isFallbackDemo: source === 'demo' && payload.storageKey !== SELECTED_SIMULATION_RESULT_STORAGE_KEY,
  };
}

export function buildScenarioDayCards(normalized: NormalizedDashboardData): ScenarioDayCard[] {
  const sortedMonths = normalized.solar.monthlyGenerationKwh
    .map((generationKwh, index) => ({
      month: index + 1,
      generationKwh,
    }))
    .sort((left, right) => left.generationKwh - right.generationKwh);
  const pickedMonths = [sortedMonths[0], sortedMonths[Math.floor((sortedMonths.length - 1) / 2)], sortedMonths[sortedMonths.length - 1]];

  const scenarioCards = pickedMonths.map((monthData, index) => {
    const id = (index + 1) as 1 | 2 | 3;
    const daysInSelectedMonth = getDaysInMonth(monthData.month);
    const dailyGenerationKwh = monthData.generationKwh / daysInSelectedMonth;
    const monthlyUsageKwh = getMonthlyUsageKwh(normalized.solar.monthlyElectricityKwh, monthData.month);
    const dailyUsageKwh = monthlyUsageKwh
      ? monthlyUsageKwh / daysInSelectedMonth
      : Math.max(12, dailyGenerationKwh * 0.7 + 10);
    const previousDailyUsageKwh = dailyUsageKwh * getPreviousUsageMultiplier(id);
    const previousDailyGenerationKwh = dailyGenerationKwh * getPreviousGenerationMultiplier(id);
    const dailyBillKrw = dailyUsageKwh * normalized.solar.electricityPriceKrwPerKwh;
    const previousDailyBillKrw = previousDailyUsageKwh * normalized.solar.electricityPriceKrwPerKwh;
    const segments = buildHourSegments(dailyUsageKwh, dailyGenerationKwh);
    const maxBarValue = Math.max(dailyUsageKwh, previousDailyUsageKwh, dailyGenerationKwh, previousDailyGenerationKwh, 1);
    const stageColor: 'green' | 'yellow' = id === 2 ? 'yellow' : 'green';

    return {
      id,
      month: monthData.month,
      date: `${SCENARIO_YEAR}-${String(monthData.month).padStart(2, '0')}-15`,
      day: `${monthData.month}월`,
      sourceLabel: normalized.isFallbackDemo ? '데모 대시보드 데이터' : '선택 건물 분석값 기반 시나리오',
      dailyUsageKwh,
      previousDailyUsageKwh,
      dailyGenerationKwh,
      previousDailyGenerationKwh,
      dailyBillKrw,
      previousDailyBillKrw,
      generationRatio: 0,
      visualGenerationRatio: 0,
      stage: `시나리오 단가 : ${normalized.solar.electricityPriceKrwPerKwh.toLocaleString('ko-KR')}원/kWh`,
      stageColor,
      temp: getSeasonalTemperatureText(monthData.month),
      tooltip: `${monthData.month}월 대표일 발전 ${formatKwh(dailyGenerationKwh)}`,
      segments,
      bars: buildComparisonBars({
        id,
        dailyUsageKwh,
        previousDailyUsageKwh,
        dailyGenerationKwh,
        previousDailyGenerationKwh,
        dailyBillKrw,
        previousDailyBillKrw,
        maxBarValue,
      }),
    };
  });

  const maxDailyGenerationKwh = Math.max(...scenarioCards.map((card) => card.dailyGenerationKwh), 0);

  return scenarioCards.map((card) => {
    const generationRatio = maxDailyGenerationKwh > 0 ? card.dailyGenerationKwh / maxDailyGenerationKwh : 0;
    const visualGenerationRatio = card.dailyGenerationKwh > 0 ? Math.max(generationRatio, 0.25) : 0;

    return {
      ...card,
      generationRatio,
      visualGenerationRatio,
    };
  });
}

export function formatKwh(value: number) {
  const maximumFractionDigits = Math.abs(value) >= 100 ? 0 : 1;

  return `${value.toLocaleString('ko-KR', { maximumFractionDigits })} kWh`;
}

export function formatKrw(value: number) {
  return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

export function formatKw(value: number) {
  return `${value.toLocaleString('ko-KR', { maximumFractionDigits: 1 })} kW`;
}

function getDashboardPayload(rawPayload: unknown): DashboardStoragePayload | null {
  if (!rawPayload) {
    return null;
  }

  if (isRecord(rawPayload) && 'raw' in rawPayload && 'addressOnly' in rawPayload) {
    return {
      raw: rawPayload.raw,
      storageKey: typeof rawPayload.storageKey === 'string' ? rawPayload.storageKey : null,
      addressOnly: rawPayload.addressOnly === true,
    };
  }

  return {
    raw: rawPayload,
    storageKey: null,
    addressOnly: false,
  };
}

function normalizeBuilding(raw: unknown): DashboardBuilding {
  return {
    roadAddress:
      pickText(
        getPathValue(raw, ['building', 'roadAddress']),
        getPathValue(raw, ['building', 'address']),
        getPathValue(raw, ['selectedBuilding', 'roadAddress']),
        getPathValue(raw, ['selectedBuilding', 'address']),
        getPathValue(raw, ['roadAddress']),
        getPathValue(raw, ['address']),
      ) ?? fallbackDashboardData.building.roadAddress,
    jibunAddress:
      pickText(
        getPathValue(raw, ['building', 'jibunAddress']),
        getPathValue(raw, ['selectedBuilding', 'jibunAddress']),
        getPathValue(raw, ['jibunAddress']),
      ) ?? fallbackDashboardData.building.jibunAddress,
    buildingId:
      pickText(
        getPathValue(raw, ['building', 'buildingId']),
        getPathValue(raw, ['selectedBuildingId']),
        getPathValue(raw, ['selectedBuilding', 'buildingId']),
        getPathValue(raw, ['diagnostics', 'requestSelectedBuildingId']),
      ) ?? undefined,
  };
}

function normalizeSource(raw: unknown): DashboardDataSource {
  const sourceText = pickText(
    getPathValue(raw, ['source']),
    getPathValue(raw, ['analysisSource']),
    getPathValue(raw, ['bundle', 'source']),
  );

  if (sourceText === 'climate-live-hybrid') {
    return 'climate-live-hybrid';
  }

  if (sourceText === 'pv-analysis' || sourceText === 'gyeonggi-climate-platform') {
    return 'pv-analysis';
  }

  if (
    getPathValue(raw, ['bundle', 'pv_analysis_output']) ||
    getPathValue(raw, ['liveClimateBundle', 'pv_analysis_output']) ||
    getPathValue(raw, ['climateBundle', 'pv_analysis_output']) ||
    getPathValue(raw, ['pv_analysis_output'])
  ) {
    return 'climate-live-hybrid';
  }

  if (
    getPathValue(raw, ['result', 'monthlyGenerationSeries']) ||
    getPathValue(raw, ['pvAnalysisResult', 'monthlyGenerationSeries'])
  ) {
    return 'pv-analysis';
  }

  return 'demo';
}

function normalizeMonthlyGeneration(raw: unknown, annualGenerationKwh: number) {
  const candidate =
    getNumberArray(getPathValue(raw, ['solar', 'monthlyGenerationKwh'])) ??
    getNumberArray(getPathValue(raw, ['solar', 'monthlyGeneration'])) ??
    getMonthlyGenerationFromObjects(getPathValue(raw, ['pv_analysis_output', 'monthly_generation']), 'generation') ??
    getMonthlyGenerationFromObjects(getPathValue(raw, ['bundle', 'pv_analysis_output', 'monthly_generation']), 'generation') ??
    getMonthlyGenerationFromObjects(getPathValue(raw, ['liveClimateBundle', 'pv_analysis_output', 'monthly_generation']), 'generation') ??
    getMonthlyGenerationFromObjects(getPathValue(raw, ['climateBundle', 'pv_analysis_output', 'monthly_generation']), 'generation') ??
    getMonthlyGenerationFromObjects(getPathValue(raw, ['result', 'monthlyGenerationSeries']), 'generationKwh') ??
    getMonthlyGenerationFromObjects(getPathValue(raw, ['pvAnalysisResult', 'monthlyGenerationSeries']), 'generationKwh');
  const fallbackMonthlyGeneration = createSeasonalMonthlyGeneration(annualGenerationKwh);

  return Array.from({ length: 12 }, (_, index) => {
    const value = candidate?.[index];

    return Math.max(0, Math.round(typeof value === 'number' && Number.isFinite(value) ? value : fallbackMonthlyGeneration[index]));
  });
}

function normalizeMonthlyElectricity(raw: unknown) {
  return (
    getNumberArray(getPathValue(raw, ['solar', 'monthlyElectricityKwh'])) ??
    getNumberArray(getPathValue(raw, ['monthlyElectricityKwh'])) ??
    getNumberArray(getPathValue(raw, ['usage_monthly', 'electricity_kwh'])) ??
    getNumberArray(getPathValue(raw, ['bundle', 'usage_monthly', 'electricity_kwh'])) ??
    getNumberArray(getPathValue(raw, ['liveClimateBundle', 'usage_monthly', 'electricity_kwh'])) ??
    getNumberValue(getPathValue(raw, ['solar', 'monthlyElectricityKwh'])) ??
    getNumberValue(getPathValue(raw, ['monthlyElectricityKwh'])) ??
    undefined
  );
}

function buildHourSegments(dailyUsageKwh: number, dailyGenerationKwh: number): ScenarioHourSegment[] {
  const usageTotal = usageHourlyProfile.reduce((sum, value) => sum + value, 0);
  const usageByHour = usageHourlyProfile.map((weight) => (dailyUsageKwh * weight) / usageTotal);
  const maxUsageHourKwh = Math.max(1, ...usageByHour);
  const maxGenerationProfileWeight = Math.max(...generationHourlyProfile, 1);

  return usageByHour.map((usageKwh, hour) => ({
    hour,
    usagePercent: Math.max(12, (usageKwh / maxUsageHourKwh) * 100),
    generationPercent:
      dailyGenerationKwh > 0 ? Math.max(0, (generationHourlyProfile[hour] / maxGenerationProfileWeight) * 100) : 0,
  }));
}

function buildComparisonBars({
  id,
  dailyUsageKwh,
  previousDailyUsageKwh,
  dailyGenerationKwh,
  previousDailyGenerationKwh,
  dailyBillKrw,
  previousDailyBillKrw,
  maxBarValue,
}: {
  id: 1 | 2 | 3;
  dailyUsageKwh: number;
  previousDailyUsageKwh: number;
  dailyGenerationKwh: number;
  previousDailyGenerationKwh: number;
  dailyBillKrw: number;
  previousDailyBillKrw: number;
  maxBarValue: number;
}): ScenarioComparisonBar[] {
  const toPercent = (value: number) => Math.max(8, Math.min(100, (value / maxBarValue) * 100));

  if (id === 3) {
    return [
      {
        group: '수전',
        label: '당일',
        cost: formatKrw(dailyBillKrw),
        value: formatKwh(dailyUsageKwh),
        color: 'orange',
        percent: toPercent(dailyUsageKwh),
      },
      {
        group: '수전',
        label: '전일',
        cost: formatKrw(previousDailyBillKrw),
        value: formatKwh(previousDailyUsageKwh),
        color: 'yellow',
        percent: toPercent(previousDailyUsageKwh),
      },
      {
        group: '발전',
        label: '당일',
        value: formatKwh(dailyGenerationKwh),
        color: 'blue',
        percent: toPercent(dailyGenerationKwh),
      },
      {
        group: '발전',
        label: '전일',
        value: formatKwh(previousDailyGenerationKwh),
        color: 'sky',
        percent: toPercent(previousDailyGenerationKwh),
      },
    ];
  }

  return [
    {
      label: '당일',
      cost: formatKrw(dailyBillKrw),
      value: formatKwh(dailyUsageKwh),
      color: 'orange',
      percent: toPercent(dailyUsageKwh),
    },
    {
      label: '전일',
      cost: formatKrw(previousDailyBillKrw),
      value: formatKwh(previousDailyUsageKwh),
      color: 'yellow',
      percent: toPercent(previousDailyUsageKwh),
    },
  ];
}

function createSeasonalMonthlyGeneration(annualGenerationKwh: number) {
  const distributionTotal = seasonalSolarDistribution.reduce((sum, weight) => sum + weight, 0);
  const monthlyGeneration = seasonalSolarDistribution.map((weight) =>
    Math.round((annualGenerationKwh * weight) / distributionTotal),
  );
  const adjustment = Math.round(annualGenerationKwh) - monthlyGeneration.reduce((sum, value) => sum + value, 0);
  const summerPeakIndex = 5;

  monthlyGeneration[summerPeakIndex] = Math.max(0, monthlyGeneration[summerPeakIndex] + adjustment);

  return monthlyGeneration;
}

function getMonthlyGenerationFromObjects(value: unknown, generationKey: 'generation' | 'generationKwh') {
  if (!Array.isArray(value)) {
    return null;
  }

  const monthlyValues = Array.from({ length: 12 }, () => 0);
  let hasAnyValue = false;

  value.forEach((item, index) => {
    if (!isRecord(item)) {
      return;
    }

    const month = getNumberValue(item.month) ?? index + 1;
    const generation = getNumberValue(item[generationKey]);

    if (!generation || month < 1 || month > 12) {
      return;
    }

    monthlyValues[Math.round(month) - 1] = generation;
    hasAnyValue = true;
  });

  return hasAnyValue ? monthlyValues : null;
}

function getMonthlyUsageKwh(monthlyElectricityKwh: number | number[] | undefined, month: number) {
  if (Array.isArray(monthlyElectricityKwh)) {
    const value = monthlyElectricityKwh[month - 1];

    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
  }

  return typeof monthlyElectricityKwh === 'number' && Number.isFinite(monthlyElectricityKwh) && monthlyElectricityKwh > 0
    ? monthlyElectricityKwh
    : null;
}

function getPreviousUsageMultiplier(id: 1 | 2 | 3) {
  if (id === 1) {
    return 0.72;
  }

  if (id === 2) {
    return 1.08;
  }

  return 1.32;
}

function getPreviousGenerationMultiplier(id: 1 | 2 | 3) {
  if (id === 1) {
    return 0.76;
  }

  if (id === 2) {
    return 0.9;
  }

  return 0.22;
}

function getDaysInMonth(month: number) {
  return new Date(SCENARIO_YEAR, month, 0).getDate();
}

function getSeasonalTemperatureText(month: number) {
  const temperatures = [
    [-1, -8],
    [3, -5],
    [10, 1],
    [18, 7],
    [24, 13],
    [28, 18],
    [31, 22],
    [32, 23],
    [27, 17],
    [20, 9],
    [12, 2],
    [4, -4],
  ];
  const [maxTemp, minTemp] = temperatures[month - 1] ?? [25, 15];

  return `계절 가정 최고 ${maxTemp.toFixed(1)}°C / 최저 ${minTemp.toFixed(1)}°C`;
}

function getPathValue(value: unknown, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), value);
}

function getNumberArray(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  const values = value
    .map((item) => getNumberValue(item))
    .filter((item): item is number => item !== null);

  return values.length > 0 ? values : null;
}

function getNumberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function pickNumber(...values: unknown[]) {
  for (const value of values) {
    const numberValue = getNumberValue(value);

    if (numberValue !== null) {
      return numberValue;
    }
  }

  return null;
}

function pickText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function roundNumber(value: number, digits = 0) {
  const scale = 10 ** digits;

  return Math.round(value * scale) / scale;
}
