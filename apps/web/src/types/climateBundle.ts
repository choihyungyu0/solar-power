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
  annual_generation: number;
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

export type ClimateBundle = {
  meta: ClimateBundleMeta;
  roof_polygon_4326: { type: 'Polygon'; coordinates: number[][][] };
  roof_area_sqm_5186: number;
  shading: ClimateBundleShading;
  usage_monthly: ClimateBundleUsage;
  regulation_hits: Array<[string, number]>;
  pv_analysis_input: ClimateBundlePvInput;
  pv_analysis_output: ClimateBundlePvOutputRaw;
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
};

export type ClimateLiveAnalysisDiagnostics = {
  inputWgs84?: { longitude: number; latitude: number };
  input5186?: { x: number; y: number };
  requestSelectedBuildingId?: string | null;
  requestSessionId?: string | null;
  selectedFeatureBuildingId?: string | null;
  ignoredStaleLiveResponse?: boolean;
  roofAreaM2?: number;
  cellCount?: number;
  shadingCellCount?: number;
  shadingAverage?: number;
  panelCount?: number;
  roofSource?: ClimateLiveRoofSource;
  overallTimeoutMs?: number;
  elapsedMs?: number;
  timedOutStep?: string | null;
  selectBuldStatus?: ClimateLiveSelectBuldStatus;
  selectSunListStatus?: 'success' | 'timeout' | 'failed' | 'skipped' | 'fallback';
  pvAnalysisStatus?: 'success' | 'timeout' | 'failed' | 'skipped' | 'fallback';
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
  [key: string]: unknown;
};

export type ClimateLiveAnalysisSuccessResponse = {
  ok: true;
  source: ClimateLiveApiSource;
  selectedBuildingId?: string | null;
  selectedAnalysisSessionId?: string | null;
  selectedFeatureBuildingId?: string | null;
  roofSource: ClimateLiveRoofSource;
  bundle: ClimateBundle;
  panelsGeojson: ClimatePanelsGeoJson;
  diagnostics: ClimateLiveAnalysisDiagnostics;
};

export type ClimateLiveAnalysisFailureResponse = {
  ok: false;
  source: ClimateLiveApiSource;
  selectedBuildingId?: string | null;
  selectedAnalysisSessionId?: string | null;
  selectedFeatureBuildingId?: string | null;
  roofSource?: ClimateLiveRoofSource;
  message: string;
  fallbackRecommended: true;
  diagnostics: ClimateLiveAnalysisDiagnostics;
};

export type ClimateLiveAnalysisResponse =
  | ClimateLiveAnalysisSuccessResponse
  | ClimateLiveAnalysisFailureResponse;
