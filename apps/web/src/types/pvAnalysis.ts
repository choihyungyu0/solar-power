export type PvAnalysisInput = {
  latitude: number;
  longitude: number;
  shading_index_average: number;
  solar_panel_angle: number;
  solar_panel_info: {
    panel_capacity: number;
    panel_count: number;
    panel_type: number;
  };
};

export type PvAnalysisIdentityDiagnostics = {
  requestSelectedBuildingId?: string | null;
  requestSessionId?: string | null;
  ignoredStaleLiveResponse?: boolean;
  pvAnalysisSource?: string;
  pvAnalysisStatus?: string;
  usedVercelPvAnalysis?: boolean;
  backendBaseUrl?: string;
  panelCount?: number;
  installKw?: number;
  shadingAverage?: number;
  roofAreaM2?: number;
};

export type PvAnalysisResponseIdentity = {
  source?: PvAnalysisSource;
  selectedBuildingId?: string | null;
  selectedAnalysisSessionId?: string | null;
  roofSource?: string | null;
  selectedFeatureBuildingId?: string | null;
  diagnostics?: PvAnalysisIdentityDiagnostics;
};

export type PvAnalysisSource =
  | 'gyeonggi-climate-platform'
  | 'render-backend'
  | 'frontend-local-formula'
  | 'backend-pv-analysis'
  | 'local-fallback-formula'
  | 'local-scenario-fallback';

export type ClimateRooftopAnalysisInput = PvAnalysisInput & {
  selectedBuildingId: string;
  selectedAnalysisSessionId: string;
  selectedBuildingFeature?: unknown;
  roofSource?: string;
};

export type PvAnalysisSafeInputSummary = {
  latitude: number;
  longitude: number;
  shadingIndexAverage: number;
  solarPanelAngle: number;
  panelCapacityW: number;
  panelCount: number;
  panelType: number;
};

export type PvAnalysisAnnualRevenuePoint = {
  year: number;
  revenueKrw: number;
};

export type PvAnalysisAnnualSaveCostPoint = {
  year: number;
  saveCostKrw: number;
};

export type PvAnalysisMonthlyGenerationPoint = {
  month: number;
  generationKwh: number;
};

export type PvAnalysisResult = {
  annualGenerationKwh: number;
  installKw: number;
  firstYearTotalEconomicEffectKrw: number;
  firstYearSelfConsumptionSavingKrw: number;
  estimatedInvestmentKrw: number;
  estimatedSurplusSalesKrw: number;
  carbonReductionKg: number;
  pineTreeEffect: number;
  annualRevenueSeries: PvAnalysisAnnualRevenuePoint[];
  annualSaveCostSeries: PvAnalysisAnnualSaveCostPoint[];
  monthlyGenerationSeries: PvAnalysisMonthlyGenerationPoint[];
};

export type PvAnalysisSuccessResponse = {
  ok: true;
  source: PvAnalysisSource;
  input: PvAnalysisSafeInputSummary;
  result: PvAnalysisResult;
} & PvAnalysisResponseIdentity;

export type PvAnalysisFallbackResponse = {
  ok: false;
  fallback: true;
  message: string;
  input?: PvAnalysisSafeInputSummary;
  result: PvAnalysisResult;
} & PvAnalysisResponseIdentity;

export type PvAnalysisProxyResponse = PvAnalysisSuccessResponse | PvAnalysisFallbackResponse;
