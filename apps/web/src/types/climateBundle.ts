import type {
  SimulationAiAgentPayload,
  SimulationAiModelMetadata,
  SimulationAiResult,
} from '../lib/simulationAiResult';

export type ClimateBundleMeta = {
  unq_id: string | null;
  bldg_nm: string | null;
  bldg_hgt: number | null;
  bdar: number | null;
  bldg_nofl: number | null;
  use_aprv_ymd: string | null;
  bldg_usg_cd: string | null;
  sigun_cd: string | null;
  click_wgs84: { longitude: number; latitude: number };
};

export type ClimateBundleShading = {
  cell_w_m: number;
  cell_h_m: number;
  cells_total: number;
  cells_with_score: number;
  score_min: number;
  score_mean: number;
  score_max: number;
};

export type ClimateBundleUsage = {
  labels: string[];
  electricity_kwh: number[];
  gas_m3: number[];
};

export type ClimateBundlePvInput = {
  latitude: number;
  longitude: number;
  shading_index_average: number;
  solar_panel_angle: string | number;
  solar_panel_info: {
    panel_capacity: number;
    panel_count: number;
    panel_type: number;
  };
};

export type ClimateBundlePvOutputRaw = {
  source?: 'render-backend' | 'frontend-local-formula' | 'local-fallback-formula' | 'backend-pv-analysis' | string;
  annual_generation: number;
  annual_generation_kwh?: number;
  annual_saving_krw?: number;
  expected_investment_krw?: number;
  expected_revenue: {
    install_kw: number;
    first_year_revenue: number;
    first_year_save_cost: number;
    expected_investment: number;
  };
  environmental_contribution: {
    pine_tree_effect: number;
    carbon_reduction: number;
  };
  annual_revenue: Array<{ year: number; revenue: number }>;
  annual_saveCost: Array<{ year: number; saveCost: number }>;
  monthly_generation: Array<{ month: number; generation: number }>;
};

export type ClimateDbSaveStatus = {
  enabled: boolean;
  analysisResultOk?: boolean;
  analysisResultId: string | null;
  ok: boolean;
  errorType?: string;
  reason?: string;
  error?: string;
  trainingSampleOk?: boolean;
  trainingSampleId?: string | null;
  trainingSampleErrorType?: string;
  trainingSampleReason?: string;
  trainingSampleError?: string;
};

export type ProfitReportUserFinanceInput = {
  availableCashKrw?: number;
  preferredLoanYears?: number;
  loanCoverageRatio?: number;
};

export type ProfitReportFourMetrics = {
  expectedGeneration: {
    annualGenerationKwh: number;
    monthlyGenerationKwh: number[];
  };
  costAndSelfPayment: {
    estimatedInstallCostKrw: number;
    selfPaymentEstimateKrw: number;
  };
  payback: {
    annualSavingKrw: number;
    paybackYears: number;
  };
  subsidyAndSuitability: {
    subsidyProgramName: string;
    subsidyPolicyMode: string;
    subsidyStackingAllowed: boolean;
    installationSuitabilityScore: number;
    installationSuitabilityGrade: string;
    installationSuitabilityLabel: string;
  };
};

export type ProfitReportJson = {
  schemaVersion: string;
  reportType: 'solar_profit_report' | string;
  generatedAt: string;
  source: Record<string, unknown>;
  buildingSummary: Record<string, unknown>;
  fourMetrics: ProfitReportFourMetrics;
  subsidyMatrix: Record<string, unknown>;
  loanSupportScenario: {
    loanBasis?: string;
    loanYears: number;
    loanCoverageRatio: number;
    estimatedLoanLimitKrw: number;
    annualRevenueBasisKrw: number;
    monthlyPaymentEstimateKrw: number;
    availableCashKrw?: number;
    loanApprovalStatus: string;
    note: string;
  };
  netInvestment: {
    estimatedInstallCostKrw: number;
    subsidyEstimateKrw: number;
    selfPaymentBeforeLoanKrw: number;
    estimatedLoanLimitKrw: number;
    cashNeededKrw: number;
    annualSavingKrw: number;
    paybackYears: number;
    calculation?: string;
  };
  reportNarrative: {
    headline: string;
    summary: string;
    salesMessage: string;
    ctaMessage: string;
  };
  riskDisclaimers: string[];
  cta: {
    label: string;
    primaryMessage: string;
    nextAction: string;
  };
};

export type ProfitReportDbSaveStatus = {
  enabled: boolean;
  profitReportOk?: boolean;
  profitReportId?: string | null;
  profitReportErrorType?: string;
  profitReportReason?: string;
  loanScenarioOk?: boolean;
  loanScenarioId?: string | null;
  loanScenarioErrorType?: string;
  loanScenarioReason?: string;
};

export type ProfitReportResponse =
  | {
      ok: true;
      profitReportId?: string | null;
      report: ProfitReportJson;
      reportMarkdown: string;
      dbSaveStatus: ProfitReportDbSaveStatus;
    }
  | {
      ok: false;
      message?: string;
      errorType?: string;
      reason?: string;
    };

export type ClimateBundle = {
  analysisResultId?: string | null;
  analysis_result_id?: string | null;
  dbSaveStatus?: ClimateDbSaveStatus | null;
  meta: ClimateBundleMeta;
  roof_polygon_4326: { type: 'Polygon'; coordinates: number[][][] };
  roof_area_sqm_5186: number;
  shading: ClimateBundleShading;
  usage_monthly: ClimateBundleUsage;
  regulation_hits: Array<[string, number]>;
  pv_analysis_input: ClimateBundlePvInput;
  pv_analysis_output: ClimateBundlePvOutputRaw | null;
  ai_simulation_result?: SimulationAiResult | null;
};

export type ClimatePanelsGeoJson = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: { type: 'Polygon'; coordinates: number[][][] };
    properties: {
      cell_id: number;
      shading_score: number;
      cell_5186_bbox?: [number, number, number, number];
    };
  }>;
};

export type ClimateRoofPolygon4326 = {
  type: 'Polygon';
  coordinates: number[][][];
};

export type ClimateFixtureEntry = {
  unq_id: string;
  bldg_nm: string;
  sigun_cd: string;
  click_wgs84: { longitude: number; latitude: number };
  bundle_path: string;
  panels_path: string;
};

export type ClimateFixtureIndex = {
  generated_at: string;
  match_radius_m: number;
  buildings: ClimateFixtureEntry[];
};

export type ClimateSelectedBuildingFeature = {
  type: 'Feature';
  id?: string | number;
  properties?: Record<string, unknown> | null;
  geometry?: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: unknown;
  } | null;
};

export type ClimateLiveRoofSource = 'climate.gg-selectBuld' | 'vworld-building-footprint-fallback';
export type ClimateLiveSelectBuldStatus =
  | 'success'
  | 'timeout'
  | 'not_found'
  | 'skipped'
  | 'mismatch_selected_building';
export type ClimateLiveApiSource = 'climate.gg-live-hybrid';

export type ClimateLiveAnalysisRequest = {
  longitude: number;
  latitude: number;
  selectedBuildingId?: string;
  selectedAnalysisSessionId?: string;
  selectedBuildingFeature?: ClimateSelectedBuildingFeature;
  panelCapacityW?: 500 | 640;
  panelAngle?: 30 | 35;
  panelType?: number;
  cellsPerPanel?: number;
  includePvAnalysis?: boolean;
  mode?: 'fast' | 'full';
};

export type ClimateLiveAnalysisDiagnostics = {
  inputWgs84?: { longitude: number; latitude: number };
  input5186?: { x: number; y: number };
  requestSelectedBuildingId?: string | null;
  requestSessionId?: string | null;
  staleBackendResponseIgnored?: boolean;
  backendPanelsBuildingId?: string | null;
  currentSelectedBuildingId?: string | null;
  backendPanelsSessionId?: string | null;
  currentSessionId?: string | null;
  sameBuildingForBackendPanels?: boolean | null;
  selectedFeatureBuildingId?: string | null;
  ignoredStaleLiveResponse?: boolean;
  roofAreaM2?: number;
  roofGeometryType?: string | null;
  cellCount?: number;
  shadingCellCount?: number;
  shadingAverage?: number;
  panelCount?: number;
  roofSource?: ClimateLiveRoofSource;
  overallTimeoutMs?: number;
  elapsedMs?: number;
  analysisStage?: 'shading-complete' | 'shading-timeout' | 'pv-complete' | string;
  includePvAnalysis?: boolean;
  mode?: 'fast' | 'full' | string;
  originalCellCount?: number;
  usedCellCount?: number;
  installCapacityKw?: number;
  selectSunListTimeoutMs?: number;
  frontendAbortMs?: number;
  timedOutStep?: string | null;
  selectBuldStatus?: ClimateLiveSelectBuldStatus;
  selectSunListStatus?: 'success' | 'timeout' | 'failed' | 'skipped' | 'fallback';
  pvAnalysisStatus?: 'success' | 'timeout' | 'failed' | 'skipped' | 'fallback' | string;
  pvAnalysisSource?: string;
  usedVercelPvAnalysis?: boolean;
  backendBaseUrl?: string;
  fallbackReason?: string;
  selectBuldRoofMatchesSelectedBuilding?: boolean | null;
  selectBuldCentroidInsideSelectedBuilding?: boolean;
  selectBuldCentroidDistanceToSelectedBuildingM?: number | null;
  selectBuldCentroidWgs84?: { longitude: number; latitude: number } | null;
  liveHybridMode?: boolean;
  maxCellsApplied?: boolean;
  apiTimingsMs?: Record<string, number>;
  warnings?: string[];
  unqId?: string | null;
  selectBuldUrl?: string;
  selectBuldRequestBody?: string;
  selectBuldHttpStatus?: number;
  selectBuldContentType?: string | null;
  selectBuldRawTextPreview?: string;
  selectBuldRawKeys?: string[];
  selectBuldHasBuld?: boolean;
  selectBuldBuldKeys?: string[];
  selectBuldFeatureParseStatus?: string;
  selectBuldAttemptCount?: number;
  selectBuldTimeoutMs?: number;
  selectBuldAttemptTimingsMs?: number[];
  selectBuldLastError?: string;
  backendRoofCentroidInsideSelected?: boolean | null;
  backendRoofDistanceToSelectedM?: number | null;
  backendRoofMatchesSelected?: boolean | null;
  backendPanelCellCountBeforeClip?: number;
  backendPanelCellCountAfterClip?: number;
  backendPanelCellsOutsideSelectedCount?: number;
  panelCellCountAfterClip?: number;
  [key: string]: unknown;
};

export type ClimateLiveAnalysisSuccessResponse = {
  ok: true;
  source: ClimateLiveApiSource;
  selectedBuildingId?: string | null;
  selectedAnalysisSessionId?: string | null;
  selectedFeatureBuildingId?: string | null;
  roofSource: ClimateLiveRoofSource;
  analysisResultId?: string | null;
  dbSaveStatus?: ClimateDbSaveStatus | null;
  roofPolygon4326?: ClimateRoofPolygon4326 | null;
  roofAreaM2?: number | null;
  analysisStage?: 'shading-complete' | 'shading-timeout' | 'pv-complete' | string;
  pvAnalysisStatus?: 'success' | 'timeout' | 'failed' | 'skipped' | 'fallback';
  bundle: ClimateBundle;
  panelsGeojson: ClimatePanelsGeoJson;
  aiSimulationResult?: SimulationAiResult | null;
  agentPayload?: SimulationAiAgentPayload | null;
  aiModelMetadata?: SimulationAiModelMetadata | null;
  diagnostics: ClimateLiveAnalysisDiagnostics;
};

export type ClimateLiveAnalysisFailureResponse = {
  ok: false;
  source: ClimateLiveApiSource;
  selectedBuildingId?: string | null;
  selectedAnalysisSessionId?: string | null;
  selectedFeatureBuildingId?: string | null;
  roofSource?: ClimateLiveRoofSource;
  analysisResultId?: string | null;
  dbSaveStatus?: ClimateDbSaveStatus | null;
  roofPolygon4326?: ClimateRoofPolygon4326 | null;
  roofAreaM2?: number | null;
  disabled?: boolean;
  message: string;
  fallbackRecommended: true;
  analysisStage?: 'shading-complete' | 'shading-timeout' | 'pv-complete' | string;
  aiSimulationResult?: SimulationAiResult | null;
  agentPayload?: SimulationAiAgentPayload | null;
  aiModelMetadata?: SimulationAiModelMetadata | null;
  diagnostics: ClimateLiveAnalysisDiagnostics;
};

export type ClimateLiveAnalysisResponse =
  | ClimateLiveAnalysisSuccessResponse
  | ClimateLiveAnalysisFailureResponse;
