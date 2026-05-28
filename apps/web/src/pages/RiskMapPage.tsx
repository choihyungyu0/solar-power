import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { booleanPointInPolygon, point } from '@turf/turf';
import VWorldSelectableBuildingLayer, {
  type VWorldSelectableBuildingLayerStatus,
} from '../components/VWorldSelectableBuildingLayer';
import VWorldSelectedBuildingLayer, {
  type VWorldSelectedBuildingLayerStatus,
} from '../components/VWorldSelectedBuildingLayer';
import VWorldSolarPanelLayer, {
  deriveRoofHeightMFromFeature,
  type VWorldSolarPanelLayerStatus,
} from '../components/VWorldSolarPanelLayer';
import SolarMateHeader from '../components/SolarMateHeader';
import ClimatePanelLayer, {
  CLIMATE_PANEL_LEGEND_ITEMS,
  type ClimatePanelLayerStatus,
} from '../components/ClimatePanelLayer';
import {
  focusVWorldMapOnCoordinate,
  createVWorldSelectionFromMouseEvent,
  initVWorld3DMap,
  loadVWorldScript,
  type VWorldMapController,
  type VWorldSelection,
} from '../lib/loadVWorldScript';
import {
  estimateRoofPolygonFromFootprint,
  getPolygonCentroid,
  normalizeGeoJsonPolygon,
  type Coordinate,
  type PolygonCoordinates,
} from '../lib/roofGeometry';
import {
  estimateAnnualGenerationKwh,
  estimateAnnualSavingsKrw,
} from '../lib/solarSimulation';
import {
  DEFAULT_SOLAR_PANEL_LAYOUT_OPTIONS,
  generateSolarPanelLayout,
  type SolarPanelLayoutResult,
} from '../lib/solarPanelLayout';
import { requestPvAnalysis } from '../lib/pvAnalysisClient';
import { createFrontendLocalPvFormulaResult } from '../lib/normalizePvAnalysis';
import { requestSelectedBuildingPolygon } from '../lib/buildingPolygonClient';
import {
  DEFAULT_CLIMATE_POC_ID,
  loadClimateBundle,
  loadClimatePanelGeojson,
  summarizeClimatePanelGeojson,
  type ClimatePocBbox,
  type ClimatePocPanelExtent,
} from '../lib/climateBundleClient';
import {
  getConfiguredClimateBackendBaseUrl,
  isExternalClimateBackendConfigured,
  runExternalClimateBackendAnalysis,
} from '../lib/climateBackendClient';
import { normalizeClimateBundlePvOutput } from '../lib/climateLiveClient';
import {
  createBuildingFootprintDiagnostics,
  getBuildingAdmdongIndexUrl,
  getBuildingFootprintGeoJsonUrl,
  getBuildingMetaUrl,
  getBuildingPolygonSourceLabel,
  getConfiguredBuildingPolygonSource,
  isBuildingAdmdongIndexEnabled,
  loadBuildingFootprints,
  loadBuildingFootprintIndex,
  searchBuildingFootprintsByText,
  summarizeBuildingFootprintCoordinates,
  type BuildingFootprintCollection,
  type BuildingFootprintDiagnostics,
  type BuildingFootprintLoadState,
  type BuildingFootprintMatch,
  type BuildingFootprintSelectionMode,
} from '../lib/buildingFootprints';
import { readLandingAddressDraft, saveLandingAddressDraft } from '../lib/addressDraft';
import { findVisibleCesiumViewer, removeCesiumEntitiesByIdPrefix } from '../lib/vworldCesiumViewer';
import {
  buildVWorldFeatureProxyPath,
  getConfiguredVWorldBuildingDataId,
  getVWorldFeatureDataTypeInfo,
  queryVWorldFeaturesByPoint,
  type VWorldFeature,
  type VWorldFeatureQueryStatus,
} from '../lib/vworldFeatureQuery';
import {
  buildStoredSimulationResult,
  saveProfitReportToSession,
  saveSimulationResultToSession,
} from '../lib/simulationResultStorage';
import { generateProfitReport } from '../lib/profitReportClient';
import { isSimulationAiResult, type SimulationAiResult } from '../lib/simulationAiResult';
import type {
  ClimateBundle,
  ClimateLiveAnalysisDiagnostics,
  ClimateLiveRoofSource,
  ClimatePanelsGeoJson,
  ClimateRoofPolygon4326,
  ClimateSelectedBuildingFeature,
} from '../types/climateBundle';
import type { PvAnalysisInput, PvAnalysisProxyResponse, PvAnalysisResult, PvAnalysisSource } from '../types/pvAnalysis';
import './RiskMapPage.css';

const MAP_CONTAINER_ID = 'vworld-risk-map';
const PV_DEFAULT_SHADING_INDEX_AVERAGE = 3.36;
const PV_DEFAULT_PANEL_ANGLE = 30;
const PV_DEFAULT_PANEL_CAPACITY_W = 500;
const PV_DEFAULT_PANEL_TYPE = 1;
const PV_DEFAULT_PANEL_COUNT = 204;
const NEARBY_BUILDING_OUTLINE_RADIUS_M = 130;
const MAX_NEARBY_BUILDING_OUTLINES = 220;
const TOUCH_TAP_MAX_MOVE_PX = 12;
const TOUCH_GESTURE_SUPPRESS_CLICK_MS = 700;
const MAP_LEFT_CLICK_SELECT_ONLY = import.meta.env.VITE_MAP_LEFT_CLICK_SELECT_ONLY !== 'false';
const MAP_CAMERA_CONTROL_MODE = MAP_LEFT_CLICK_SELECT_ONLY ? 'left-click-select-right-drag-map' : 'default';
const LEFT_CLICK_SELECT_MAX_MOVE_PX = 5;
const ROOF_FOCUS_MIN_HEIGHT_M = 340;
const ROOF_FOCUS_MAX_HEIGHT_M = 1800;
const ROOF_FOCUS_SPAN_MULTIPLIER = 3.2;
const ROOF_FOCUS_HEIGHT_PADDING_M = 180;
const CLIMATE_POC_FOCUS_MIN_HEIGHT_M = 550;
const CLIMATE_POC_FOCUS_MAX_HEIGHT_M = 1800;
const CLIMATE_POC_FOCUS_SPAN_MULTIPLIER = 4;
const CLIMATE_POC_FOCUS_HEIGHT_PADDING_M = 320;
const SIMPLE_PAYBACK_MAX_REASONABLE_YEARS = 100;
const FOOTPRINT_FALLBACK_SIMPLE_PAYBACK_YEARS = 6.8;
const BACKEND_ROOF_MATCH_DISTANCE_THRESHOLD_M = 15;
const CLIMATE_LIVE_ANALYSIS_MODE = import.meta.env.VITE_CLIMATE_LIVE_ANALYSIS_MODE === 'fast' ? 'fast' : 'full';
const DEFAULT_PANEL_PLACEMENT_SOURCE = '건물 footprint 기반 자체 배치';
const BUILDING_DATA_HEALTH_ERROR_MESSAGE =
  '건물 polygon 데이터를 불러오지 못했습니다. 배포 데이터 경로를 확인해주세요.';
const SELECTION_NOT_FOUND_MESSAGE =
  '선택 좌표 주변에서 건물 polygon을 찾지 못했습니다. 지도를 확대하거나 건물 중심을 다시 클릭해주세요.';
const RISK_MAP_SELECTION_ENTITY_PREFIXES = [
  'solarmate-selected-building-',
  'solarmate-backend-panel-',
  'solarmate-backend-roof-',
  'solarmate-self-panel-',
  'solarmate-panel-',
  'solarmate-panel-debug-',
  'solarmate-climate-panel-',
  'solarmate-poc-panel-',
];
const RISK_MAP_SELECTION_OBJECT_IDS = [
  'solarmate-click-selected-building',
  'solarmate-click-selected-building-layer',
];

type MapLoadStatus = 'loading' | 'ready' | 'error';
type RiskPanelTab = 'risk' | 'solar';
type SelectionMode = 'screen-fallback' | 'coordinate-fallback' | 'parcel-fallback' | 'geometry' | 'building_footprint';
type SelectionFeedbackStatus = 'idle' | 'loading' | 'success' | 'not_found' | 'error';
type AddressSearchStatus = 'idle' | 'searching' | 'found' | 'not_found' | 'error';
type BuildingDataHealthStatus = 'idle' | 'loading' | 'ok' | 'error';
type PvAnalysisStatus = 'idle' | 'calculating' | 'success' | 'fallback' | 'backend-result' | 'local-fallback' | 'error';
type ClimatePanelLoadStatus = 'idle' | 'loading' | 'loaded' | 'error';
type LiveClimateStatus = 'idle' | 'loading' | 'success' | 'error';
type LiveShadingStatus = 'idle' | 'trying' | 'success' | 'timeout' | 'fallback';
type SimplePaybackSource = 'climate-live' | 'static-poc' | 'footprint-fallback';
type RiskProcessStepState = 'disabled' | 'complete' | 'active' | 'pending';
type GeometryQueryStatus =
  | 'idle'
  | 'loading'
  | 'found'
  | 'parcel-found'
  | 'unconfigured'
  | 'not-found'
  | 'error';

type FeatureDataInfo = ReturnType<typeof getVWorldFeatureDataTypeInfo> & {
  dataId: string;
};

type MapFocusStatus = {
  message: string;
  method?: string;
  selectionSource?: string;
  selectionMethod?: string;
  moved: boolean;
  markerAdded: boolean;
};

type FeatureQueryDiagnostics = {
  queryStatus: VWorldFeatureQueryStatus;
  featureCount: number;
  rawStatus?: string;
  errorMessage?: string;
  requestedLon?: number;
  requestedLat?: number;
  dataId: string;
  buffer: number;
  requestPath: string;
};

type SelectedBuildingFootprint = {
  buildingId: string;
  analysisSessionId: string;
  address: string;
  name: string;
  geometryType: 'Polygon' | 'MultiPolygon';
  selectionMode?: BuildingFootprintSelectionMode;
  distanceMeters?: number | null;
} | null;

type BuildingDataHealthDiagnostics = {
  buildingIndexStatus: BuildingDataHealthStatus;
  buildingMetaStatus: BuildingDataHealthStatus;
  buildingIndexEntryCount: number;
  buildingDataBaseUrl: string;
  indexUrl: string;
  metaUrl: string;
  message: string;
};

type SelectionClickDiagnostics = {
  clickPickMethod: string;
  clickPickStatus: string;
  selectedLat: number | null;
  selectedLon: number | null;
  pickPositionSupported: boolean;
  cameraHeightM: number | null;
  cameraControlMode: string;
  leftDragNavigationDisabled: boolean;
  rightDragNavigationEnabled: boolean;
  lastPointerMovePx: number;
  lastSelectionIgnoredBecauseDrag: boolean;
};

type SelectableBuildingFeature = {
  type: 'Feature';
  id?: string | number;
  properties?: Record<string, unknown> | null;
  geometry?: {
    type: string;
    coordinates: unknown;
  };
};

type TurfPolygonInput = Parameters<typeof booleanPointInPolygon>[1];

type RiskProcessStep = {
  title: string;
  state: RiskProcessStepState;
  message: string;
};

type SelectedBuilding = {
  apartmentName: string;
  address: string;
  currentMonthlyFee: string;
  monthlyUsage: string;
  riskLevel: '낮음' | '보통' | '높음' | '위험 높음';
  fiveYearExtraCost: string;
  solarPotential: string;
  subsidyReview: string;
  selectionNote: string;
  estimatedRoofAreaM2: number;
  estimatedInstallableAreaM2: number;
  estimatedCapacityKw: number;
  estimatedAnnualGenerationKwh: number;
  estimatedAnnualSavingsKrw: number;
  estimatedPaybackYears: number;
  estimatedPanelCount: number;
  simulationConfidence: string;
  simulationNote: string;
};

const mvpSolarEstimate = {
  estimatedRoofAreaM2: 1520,
  estimatedInstallableAreaM2: 540,
  estimatedCapacityKw: 98,
  estimatedAnnualGenerationKwh: 124000,
  estimatedAnnualSavingsKrw: 18720000,
  estimatedPaybackYears: 6.8,
  estimatedPanelCount: 218,
};

const demoBuilding: SelectedBuilding = {
  apartmentName: '한빛마을 3단지',
  address: '경기도 성남시 분당구 예시로 123',
  currentMonthlyFee: '추정 2,450,000원',
  monthlyUsage: '추정 12,500kWh',
  riskLevel: '위험 높음',
  fiveYearExtraCost: '예상 31,800,000원',
  solarPotential: '절감 가능성 양호',
  subsidyReview: '검토 가능',
  selectionNote: '지도에서 건물을 선택하면 이 영역이 선택 위치 기준 데모 값으로 갱신됩니다.',
  ...mvpSolarEstimate,
  simulationConfidence: '1차 추정',
  simulationNote:
    '실제 설치 가능 여부는 현장조사, 구조안전성, 음영, 관리주체 협의에 따라 달라질 수 있습니다.',
};

function createInitialSelectedBuilding() {
  const addressDraft = readLandingAddressDraft();

  if (!addressDraft) {
    return demoBuilding;
  }

  return {
    ...demoBuilding,
    address: addressDraft.address,
    selectionNote: '첫 화면에서 입력한 주소입니다. 지도 데이터가 준비되면 주소/아파트명 검색으로 실제 건물 polygon을 매칭합니다.',
    simulationConfidence: '입력 주소 대기',
    simulationNote:
      '아직 실제 건물 polygon이 선택되지 않았습니다. 주소 검색 또는 지도 클릭 후 예상·추정 분석이 실제 건물 데이터에 반영됩니다.',
  };
}

const riskLegendItems = [
  { label: '낮음', tone: 'low' },
  { label: '보통', tone: 'medium' },
  { label: '높음', tone: 'high' },
  { label: '위험 높음', tone: 'critical' },
];

const buildingFields = [
  ['아파트명', 'apartmentName'],
  ['주소', 'address'],
  ['현재 월 공용부 전기요금', 'currentMonthlyFee'],
  ['월 전기사용량', 'monthlyUsage'],
  ['전기세 상승 위험 등급', 'riskLevel'],
] as const;

const solarFields = [
  ['예상 패널 수', 'estimatedPanelCount', 'count'],
  ['추정 옥상면적', 'estimatedRoofAreaM2', 'm2'],
  ['예상 설치 가능 면적', 'estimatedInstallableAreaM2', 'm2'],
  ['예상 설치용량', 'estimatedCapacityKw', 'kw'],
  ['예상 연간 발전량', 'estimatedAnnualGenerationKwh', 'kwh'],
  ['예상 연간 절감액', 'estimatedAnnualSavingsKrw', 'krw'],
  ['단순 회수기간 추정', 'estimatedPaybackYears', 'years'],
] as const;

const panelTabs = [
  { id: 'risk', label: '위험 진단' },
  { id: 'solar', label: '태양광 설치' },
] as const;

function formatSolarValue(value: number, unit: (typeof solarFields)[number][2]) {
  if (unit === 'count') {
    return `예상 ${value.toLocaleString('ko-KR')}장`;
  }

  if (unit === 'm2') {
    return `추정 ${value.toLocaleString('ko-KR')}㎡`;
  }

  if (unit === 'kw') {
    return `예상 ${value.toLocaleString('ko-KR')}kW`;
  }

  if (unit === 'kwh') {
    return `예상 ${value.toLocaleString('ko-KR')}kWh`;
  }

  if (unit === 'krw') {
    return `예상 ${value.toLocaleString('ko-KR')}원`;
  }

  return `예상 ${value.toLocaleString('ko-KR')}년`;
}

function formatEstimatedKwh(value: number) {
  return `예상 ${Math.round(value).toLocaleString('ko-KR')}kWh`;
}

function formatEstimatedKw(value: number) {
  return `추정 ${value.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}kW`;
}

function formatEstimatedKrw(value: number) {
  return `추정 ${Math.round(value).toLocaleString('ko-KR')}원`;
}

function toFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeSimplePaybackYears(years: unknown) {
  const value = toFiniteNumber(years);

  if (!value || value <= 0 || value > SIMPLE_PAYBACK_MAX_REASONABLE_YEARS) {
    return null;
  }

  return Math.round(value * 10) / 10;
}

function calculateSimplePaybackYears(estimatedInvestmentKrw: unknown, firstYearSaveCostKrw: unknown) {
  const investment = toFiniteNumber(estimatedInvestmentKrw);
  const firstYearSaveCost = toFiniteNumber(firstYearSaveCostKrw);

  if (!investment || investment <= 0 || !firstYearSaveCost || firstYearSaveCost <= 0) {
    return null;
  }

  return normalizeSimplePaybackYears(investment / firstYearSaveCost);
}

function calculateClimateBundlePaybackYears(bundle: ClimateBundle | null) {
  const expectedRevenue = bundle?.pv_analysis_output?.expected_revenue;

  if (!expectedRevenue) {
    return null;
  }

  return calculateSimplePaybackYears(expectedRevenue.expected_investment, expectedRevenue.first_year_save_cost);
}

function calculatePvResultPaybackYears(result: PvAnalysisResult | null) {
  if (!result) {
    return null;
  }

  return calculateSimplePaybackYears(result.estimatedInvestmentKrw, result.firstYearSelfConsumptionSavingKrw);
}

const LIVE_PV_MONTHLY_GENERATION_WEIGHTS = [
  0.072, 0.079, 0.092, 0.101, 0.107, 0.104, 0.097, 0.096, 0.087, 0.073, 0.049, 0.043,
];

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundDecimal(value: number, digits = 1) {
  const multiplier = 10 ** digits;

  return Math.round(value * multiplier) / multiplier;
}

function createSafePvInputSummary(input: PvAnalysisInput) {
  return {
    latitude: roundDecimal(input.latitude, 6),
    longitude: roundDecimal(input.longitude, 6),
    shadingIndexAverage: roundDecimal(input.shading_index_average, 2),
    solarPanelAngle: roundDecimal(input.solar_panel_angle, 1),
    panelCapacityW: Math.round(input.solar_panel_info.panel_capacity),
    panelCount: Math.round(input.solar_panel_info.panel_count),
    panelType: Math.round(input.solar_panel_info.panel_type),
  };
}

function createLivePvScenarioFallbackResult(input: PvAnalysisInput): PvAnalysisResult {
  const panelCapacityW = input.solar_panel_info.panel_capacity;
  const panelCount = input.solar_panel_info.panel_count;
  const installKw = roundDecimal((panelCapacityW * panelCount) / 1000, 1);
  const shadingFactor = clampNumber(input.shading_index_average / 3.5, 0.45, 1.0);
  const annualGenerationKwh = Math.round(installKw * 365 * 3.6 * shadingFactor);
  const annualSavingKrw = Math.round(annualGenerationKwh * 150);
  const estimatedInvestmentKrw = Math.round(annualSavingKrw * 6.8);
  const carbonReductionKg = roundDecimal(annualGenerationKwh * 0.4594, 1);

  return {
    annualGenerationKwh,
    installKw,
    firstYearTotalEconomicEffectKrw: annualSavingKrw,
    firstYearSelfConsumptionSavingKrw: annualSavingKrw,
    estimatedInvestmentKrw,
    estimatedSurplusSalesKrw: 0,
    carbonReductionKg,
    pineTreeEffect: roundDecimal(carbonReductionKg / 6.6, 1),
    annualRevenueSeries: [],
    annualSaveCostSeries: [],
    monthlyGenerationSeries: LIVE_PV_MONTHLY_GENERATION_WEIGHTS.map((weight, index) => ({
      month: index + 1,
      generationKwh: roundDecimal(annualGenerationKwh * weight, 1),
    })),
  };
}

function getClimatePvOutputSource(output: ClimateBundle['pv_analysis_output']): PvAnalysisSource {
  return output ? 'render-backend' : 'frontend-local-formula';
}

function createPvInputFromClimateBundle({
  bundle,
  diagnostics,
  fallbackPanelCapacityW,
  fallbackPanelAngle,
  fallbackPanelType,
}: {
  bundle: ClimateBundle;
  diagnostics: ClimateLiveAnalysisDiagnostics | null;
  fallbackPanelCapacityW: number;
  fallbackPanelAngle: number;
  fallbackPanelType: number;
}): PvAnalysisInput {
  const bundlePanelInfo = bundle.pv_analysis_input.solar_panel_info;
  const panelCapacityW = toFiniteNumber(bundlePanelInfo.panel_capacity) ?? fallbackPanelCapacityW;
  const diagnosticPanelCount = toFiniteNumber(diagnostics?.panelCount);
  const diagnosticInstallKw =
    toFiniteNumber(diagnostics?.installKw) ?? toFiniteNumber(diagnostics?.installCapacityKw);
  const panelCountFromInstallKw =
    diagnosticInstallKw && panelCapacityW > 0 ? Math.max(1, Math.round((diagnosticInstallKw * 1000) / panelCapacityW)) : null;
  const panelCount =
    diagnosticPanelCount ?? toFiniteNumber(bundlePanelInfo.panel_count) ?? panelCountFromInstallKw ?? PV_DEFAULT_PANEL_COUNT;
  const shadingAverage =
    toFiniteNumber(diagnostics?.shadingAverage) ?? toFiniteNumber(bundle.pv_analysis_input.shading_index_average) ?? PV_DEFAULT_SHADING_INDEX_AVERAGE;

  return {
    latitude: toFiniteNumber(bundle.pv_analysis_input.latitude) ?? bundle.meta.click_wgs84.latitude,
    longitude: toFiniteNumber(bundle.pv_analysis_input.longitude) ?? bundle.meta.click_wgs84.longitude,
    shading_index_average: shadingAverage,
    solar_panel_angle:
      toFiniteNumber(bundle.pv_analysis_input.solar_panel_angle) ?? fallbackPanelAngle,
    solar_panel_info: {
      panel_capacity: panelCapacityW,
      panel_count: panelCount,
      panel_type: toFiniteNumber(bundlePanelInfo.panel_type) ?? fallbackPanelType,
    },
  };
}

function createBackendPvAnalysisResponse({
  bundle,
  diagnostics,
  selectedBuildingId,
  selectedAnalysisSessionId,
  roofSource,
  selectedFeatureBuildingId,
  backendBaseUrl,
  fallbackPanelCapacityW,
  fallbackPanelAngle,
  fallbackPanelType,
}: {
  bundle: ClimateBundle;
  diagnostics: ClimateLiveAnalysisDiagnostics | null;
  selectedBuildingId: string;
  selectedAnalysisSessionId: string;
  roofSource: string;
  selectedFeatureBuildingId?: string | null;
  backendBaseUrl: string;
  fallbackPanelCapacityW: number;
  fallbackPanelAngle: number;
  fallbackPanelType: number;
}): { response: PvAnalysisProxyResponse; status: PvAnalysisStatus } {
  const input = createPvInputFromClimateBundle({
    bundle,
    diagnostics,
    fallbackPanelCapacityW,
    fallbackPanelAngle,
    fallbackPanelType,
  });
  const output = bundle.pv_analysis_output;
  const pvAnalysisSource = getClimatePvOutputSource(output);
  const status: PvAnalysisStatus = output ? 'backend-result' : 'local-fallback';
  const identityDiagnostics = {
    requestSelectedBuildingId: selectedBuildingId,
    requestSessionId: selectedAnalysisSessionId,
    ignoredStaleLiveResponse: false,
    pvAnalysisSource,
    pvAnalysisStatus: status,
    usedVercelPvAnalysis: false,
    backendBaseUrl,
    panelCount: input.solar_panel_info.panel_count,
    installKw: roundDecimal((input.solar_panel_info.panel_capacity * input.solar_panel_info.panel_count) / 1000, 1),
    shadingAverage: input.shading_index_average,
    roofAreaM2: diagnostics?.roofAreaM2 ?? bundle.roof_area_sqm_5186,
  };

  if (output) {
    return {
      status,
      response: {
        ok: true,
        source: pvAnalysisSource,
        selectedBuildingId,
        selectedAnalysisSessionId,
        roofSource,
        selectedFeatureBuildingId: selectedFeatureBuildingId ?? null,
        diagnostics: identityDiagnostics,
        input: createSafePvInputSummary(input),
        result: normalizeClimateBundlePvOutput(output),
      },
    };
  }

  return {
    status,
    response: {
      ok: false,
      fallback: true,
      source: 'frontend-local-formula',
      message: 'Render 백엔드 응답에 PV 출력이 없어 프론트엔드 시나리오 산식으로 발전량을 표시합니다.',
      selectedBuildingId,
      selectedAnalysisSessionId,
      roofSource,
      selectedFeatureBuildingId: selectedFeatureBuildingId ?? null,
      diagnostics: identityDiagnostics,
      input: createSafePvInputSummary(input),
      result: createFrontendLocalPvFormulaResult(input),
    },
  };
}

function formatSimplePaybackYears(years: number | null) {
  return years === null
    ? '계산 불가'
    : `${years.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}년`;
}

function formatEstimatedSquareMeters(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value)
    ? `추정 ${value.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}㎡`
    : '-';
}

function formatEstimatedScore(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value)
    ? `추정 ${value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}`
    : '-';
}

function formatOptionalText(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  return String(value);
}

function formatCoordinate(coordinate: Coordinate | null) {
  if (!coordinate) {
    return '선택된 좌표 없음';
  }

  return `${coordinate[1].toFixed(6)}, ${coordinate[0].toFixed(6)}`;
}

function formatDiagnosticNumber(value: number | null) {
  return typeof value === 'number' ? value.toFixed(7) : '-';
}

function formatDiagnosticMeters(value: number | null) {
  return typeof value === 'number'
    ? `${value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}m`
    : '-';
}

function formatMeters(value: number) {
  return `${value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}m`;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100).toLocaleString('ko-KR')}%`;
}

function formatDiagnosticCount(value: number | null) {
  return typeof value === 'number' ? value.toLocaleString('ko-KR') : '-';
}

function formatDiagnosticBoolean(value: boolean | null) {
  return typeof value === 'boolean' ? String(value) : '-';
}

function formatHealthStatus(status: BuildingDataHealthStatus) {
  if (status === 'ok') {
    return 'ok';
  }

  if (status === 'loading') {
    return 'loading';
  }

  if (status === 'error') {
    return 'error';
  }

  return 'idle';
}

function formatDiagnosticMatch(value: boolean | null) {
  if (value === true) {
    return '같음';
  }

  if (value === false) {
    return '다름';
  }

  return '-';
}

function formatViewerCanvasSize(size: VWorldSolarPanelLayerStatus['viewerCanvasSize']) {
  return size ? `${size.width.toLocaleString('ko-KR')} x ${size.height.toLocaleString('ko-KR')}` : '-';
}

function formatPanelCoordinates(polygon: PolygonCoordinates | null) {
  if (!polygon || polygon.length === 0) {
    return '-';
  }

  return polygon
    .slice(0, 4)
    .map(([longitude, latitude]) => `[${longitude.toFixed(7)}, ${latitude.toFixed(7)}]`)
    .join(' ');
}

function formatClimatePocBbox(bbox: ClimatePocBbox | null) {
  if (!bbox) {
    return '-';
  }

  return [
    `minLon ${bbox.minLongitude.toFixed(7)}`,
    `minLat ${bbox.minLatitude.toFixed(7)}`,
    `maxLon ${bbox.maxLongitude.toFixed(7)}`,
    `maxLat ${bbox.maxLatitude.toFixed(7)}`,
  ].join(' · ');
}

function getGeoJsonDiagnosticSourceStatus(loadState: BuildingFootprintLoadState) {
  if (loadState.status === 'index_loaded' || loadState.status === 'selected' || loadState.diagnostics.indexLoaded) {
    return 'loaded';
  }

  if (loadState.status === 'error' && !loadState.message.includes('찾지 못했습니다')) {
    return 'failed';
  }

  return 'missing';
}

function getRiskProcessStateText(state: RiskProcessStepState) {
  if (state === 'complete') {
    return '완료';
  }

  if (state === 'active') {
    return '진행중';
  }

  if (state === 'disabled') {
    return '비활성';
  }

  return '대기';
}

function createSolarEstimateFromPanelLayout(layoutResult: SolarPanelLayoutResult) {
  const capacity = layoutResult.estimatedCapacityKw;
  const annualGeneration = Math.round(estimateAnnualGenerationKwh(capacity));
  const annualSavings = Math.round(estimateAnnualSavingsKrw(annualGeneration));

  return {
    estimatedRoofAreaM2: Math.round(layoutResult.roofAreaM2),
    estimatedInstallableAreaM2: Math.round(layoutResult.usableAreaM2),
    estimatedCapacityKw: capacity,
    estimatedAnnualGenerationKwh: annualGeneration,
    estimatedAnnualSavingsKrw: annualSavings,
    estimatedPaybackYears: capacity > 0 && annualSavings > 0 ? FOOTPRINT_FALLBACK_SIMPLE_PAYBACK_YEARS : 0,
    estimatedPanelCount: layoutResult.panelCount,
  };
}

function createSelectableBuildingPolygons(features: SelectableBuildingFeature[]) {
  return features.flatMap((feature) => {
    const polygon = normalizeGeoJsonPolygon(feature as VWorldFeature);

    return polygon ? [polygon] : [];
  });
}

function getDistanceMeters(from: Coordinate, to: Coordinate) {
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon = metersPerDegreeLat * Math.cos((from[1] * Math.PI) / 180);
  const deltaX = (to[0] - from[0]) * metersPerDegreeLon;
  const deltaY = (to[1] - from[1]) * metersPerDegreeLat;

  return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
}

function createTurfPolygonInput(feature: SelectableBuildingFeature | null): TurfPolygonInput | null {
  const geometry = feature?.geometry;

  if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) {
    return null;
  }

  return {
    type: 'Feature',
    properties: feature.properties ?? {},
    geometry,
  } as TurfPolygonInput;
}

function isCoordinateInsideSelectedFeature(coordinate: Coordinate, feature: SelectableBuildingFeature | null) {
  const turfPolygonInput = createTurfPolygonInput(feature);

  if (!turfPolygonInput) {
    return false;
  }

  try {
    return booleanPointInPolygon(point(coordinate), turfPolygonInput, { ignoreBoundary: false });
  } catch {
    return false;
  }
}

function getPointToSegmentDistanceMeters(coordinate: Coordinate, segmentStart: Coordinate, segmentEnd: Coordinate) {
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon = metersPerDegreeLat * Math.cos((coordinate[1] * Math.PI) / 180);
  const pointX = coordinate[0] * metersPerDegreeLon;
  const pointY = coordinate[1] * metersPerDegreeLat;
  const startX = segmentStart[0] * metersPerDegreeLon;
  const startY = segmentStart[1] * metersPerDegreeLat;
  const endX = segmentEnd[0] * metersPerDegreeLon;
  const endY = segmentEnd[1] * metersPerDegreeLat;
  const segmentX = endX - startX;
  const segmentY = endY - startY;
  const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;

  if (segmentLengthSquared === 0) {
    return getDistanceMeters(coordinate, segmentStart);
  }

  const projection = Math.max(
    0,
    Math.min(1, ((pointX - startX) * segmentX + (pointY - startY) * segmentY) / segmentLengthSquared),
  );
  const nearestX = startX + projection * segmentX;
  const nearestY = startY + projection * segmentY;
  const deltaX = pointX - nearestX;
  const deltaY = pointY - nearestY;

  return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
}

function getDistanceToPolygonBoundaryMeters(coordinate: Coordinate, polygon: PolygonCoordinates) {
  if (polygon.length < 2) {
    return null;
  }

  let nearestDistanceM = Number.POSITIVE_INFINITY;

  for (let index = 0; index < polygon.length - 1; index += 1) {
    nearestDistanceM = Math.min(nearestDistanceM, getPointToSegmentDistanceMeters(coordinate, polygon[index], polygon[index + 1]));
  }

  return Number.isFinite(nearestDistanceM) ? nearestDistanceM : null;
}

function getDistanceToSelectedFeatureMeters(coordinate: Coordinate, feature: SelectableBuildingFeature | null) {
  const polygon = feature ? normalizeGeoJsonPolygon(feature as VWorldFeature) : null;

  return polygon ? getDistanceToPolygonBoundaryMeters(coordinate, polygon) : null;
}

function normalizeBackendRoofPolygon4326(roofPolygon4326: ClimateRoofPolygon4326 | null | undefined) {
  if (!roofPolygon4326) {
    return null;
  }

  return normalizeGeoJsonPolygon({
    type: 'Feature',
    properties: {},
    geometry: roofPolygon4326,
  });
}

function checkBackendRoofMatchesSelected({
  roofPolygon4326,
  selectedBuildingFeature,
}: {
  roofPolygon4326: ClimateRoofPolygon4326 | null | undefined;
  selectedBuildingFeature: SelectableBuildingFeature | null;
}) {
  const roofPolygon = normalizeBackendRoofPolygon4326(roofPolygon4326);
  const roofCentroid = roofPolygon ? getPolygonCentroid(roofPolygon) : null;

  if (!roofCentroid) {
    return {
      backendRoofCentroidInsideSelected: null,
      backendRoofDistanceToSelectedM: null,
      backendRoofMatchesSelected: null,
    };
  }

  const insideSelected = isCoordinateInsideSelectedFeature(roofCentroid, selectedBuildingFeature);
  const distanceToSelectedM = insideSelected ? 0 : getDistanceToSelectedFeatureMeters(roofCentroid, selectedBuildingFeature);
  const matchesSelected =
    insideSelected ||
    (typeof distanceToSelectedM === 'number' && distanceToSelectedM <= BACKEND_ROOF_MATCH_DISTANCE_THRESHOLD_M);

  return {
    backendRoofCentroidInsideSelected: insideSelected,
    backendRoofDistanceToSelectedM: distanceToSelectedM,
    backendRoofMatchesSelected: matchesSelected,
  };
}

function filterBackendPanelsToSelectedFeature(
  panelsGeojson: ClimatePanelsGeoJson,
  selectedBuildingFeature: SelectableBuildingFeature | null,
) {
  const features = panelsGeojson.features;
  const clippedFeatures = features.filter((feature) => {
    const ring = feature.geometry.coordinates[0];
    const panelPolygon = Array.isArray(ring)
      ? ring
          .filter(
            (coordinate): coordinate is [number, number] =>
              Array.isArray(coordinate) &&
              coordinate.length >= 2 &&
              typeof coordinate[0] === 'number' &&
              typeof coordinate[1] === 'number' &&
              Number.isFinite(coordinate[0]) &&
              Number.isFinite(coordinate[1]),
          )
          .map(([longitude, latitude]) => [longitude, latitude] as Coordinate)
      : [];

    return panelPolygon.length >= 4 && isCoordinateInsideSelectedFeature(getPolygonCentroid(panelPolygon), selectedBuildingFeature);
  });

  return {
    panelsGeojson: {
      ...panelsGeojson,
      features: clippedFeatures,
    },
    backendPanelCellCountBeforeClip: features.length,
    backendPanelCellCountAfterClip: clippedFeatures.length,
    backendPanelCellsOutsideSelectedCount: features.length - clippedFeatures.length,
  };
}

function getPolygonMaxSpanMeters(polygon: PolygonCoordinates) {
  let maxSpanMeters = 0;

  for (let leftIndex = 0; leftIndex < polygon.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < polygon.length; rightIndex += 1) {
      maxSpanMeters = Math.max(maxSpanMeters, getDistanceMeters(polygon[leftIndex], polygon[rightIndex]));
    }
  }

  return maxSpanMeters;
}

function getRoofFocusHeightM(roofPolygon: PolygonCoordinates) {
  const spanMeters = getPolygonMaxSpanMeters(roofPolygon);
  const preferredHeight = spanMeters * ROOF_FOCUS_SPAN_MULTIPLIER + ROOF_FOCUS_HEIGHT_PADDING_M;

  return Math.round(Math.min(ROOF_FOCUS_MAX_HEIGHT_M, Math.max(ROOF_FOCUS_MIN_HEIGHT_M, preferredHeight)));
}

function getClimatePocFocusHeightM(extent: ClimatePocPanelExtent) {
  const bbox = extent.bbox;
  const longitudeSpanMeters = getDistanceMeters(
    [bbox.minLongitude, bbox.minLatitude],
    [bbox.maxLongitude, bbox.minLatitude],
  );
  const latitudeSpanMeters = getDistanceMeters(
    [bbox.minLongitude, bbox.minLatitude],
    [bbox.minLongitude, bbox.maxLatitude],
  );
  const preferredHeight =
    Math.max(longitudeSpanMeters, latitudeSpanMeters) * CLIMATE_POC_FOCUS_SPAN_MULTIPLIER +
    CLIMATE_POC_FOCUS_HEIGHT_PADDING_M;

  return Math.round(
    Math.min(CLIMATE_POC_FOCUS_MAX_HEIGHT_M, Math.max(CLIMATE_POC_FOCUS_MIN_HEIGHT_M, preferredHeight)),
  );
}

function withoutClosingCoordinate(polygon: PolygonCoordinates) {
  if (polygon.length < 2) {
    return polygon;
  }

  const first = polygon[0];
  const last = polygon[polygon.length - 1];

  return first[0] === last[0] && first[1] === last[1] ? polygon.slice(0, -1) : polygon;
}

function areSameFootprintPolygons(left: PolygonCoordinates, right: PolygonCoordinates | null | undefined) {
  if (!right) {
    return false;
  }

  const leftOpen = withoutClosingCoordinate(left);
  const rightOpen = withoutClosingCoordinate(right);

  if (leftOpen.length !== rightOpen.length) {
    return false;
  }

  return leftOpen.every((coordinate, index) => {
    const other = rightOpen[index];

    return Math.abs(coordinate[0] - other[0]) < 0.0000001 && Math.abs(coordinate[1] - other[1]) < 0.0000001;
  });
}

function getNearbyBuildingPolygons(
  polygons: PolygonCoordinates[],
  coordinate: Coordinate | null,
  excludedPolygon?: PolygonCoordinates | null,
) {
  if (!coordinate) {
    return [];
  }

  return polygons
    .map((polygon) => ({
      polygon,
      distanceMeters: getDistanceMeters(coordinate, getPolygonCentroid(polygon)),
    }))
    .filter(
      (item) =>
        item.distanceMeters <= NEARBY_BUILDING_OUTLINE_RADIUS_M &&
        !areSameFootprintPolygons(item.polygon, excludedPolygon),
    )
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, MAX_NEARBY_BUILDING_OUTLINES)
    .map((item) => item.polygon);
}

function createSelectedAnalysisSessionId(selectedBuildingId: string) {
  return `${selectedBuildingId}-${Date.now()}`;
}

function getGeometryStatusText(status: GeometryQueryStatus) {
  if (status === 'idle') {
    return '건물 클릭 후 조회';
  }

  if (status === 'loading') {
    return '화성시 건물 polygon 조회 중';
  }

  if (status === 'found') {
    return '건물 polygon 선택됨';
  }

  if (status === 'unconfigured') {
    return '건물 polygon 데이터 미연결';
  }

  if (status === 'parcel-found') {
    return '필지 도형 조회됨 · roof 아님';
  }

  if (status === 'not-found') {
    return '선택 좌표와 일치하는 건물 없음';
  }

  return '조회 오류';
}

function getSelectionModeText(mode: SelectionMode) {
  if (mode === 'building_footprint') {
    return '건물 footprint';
  }

  if (mode === 'geometry') {
    return '실제 건물 도형 기반';
  }

  if (mode === 'parcel-fallback') {
    return '필지 도형 기반 fallback';
  }

  if (mode === 'coordinate-fallback') {
    return '좌표 기반 fallback';
  }

  return '화면 기준 fallback';
}

function getRoofPolygonStatusText(mode: SelectionMode, roofPolygon: PolygonCoordinates | null) {
  if (!roofPolygon) {
    return 'polygon 없음';
  }

  if (mode === 'parcel-fallback') {
    return '필지 polygon 기반 roof 근사';
  }

  if (mode === 'building_footprint') {
    return '건물 footprint 기반 옥상 추정';
  }

  return '건물 footprint 기반 1차 근사';
}

function createInitialFeatureDataInfo(): FeatureDataInfo {
  const dataId = getConfiguredVWorldBuildingDataId();

  return {
    dataId,
    ...getVWorldFeatureDataTypeInfo(dataId),
  };
}

function createInitialFeatureQueryDiagnostics(): FeatureQueryDiagnostics {
  const dataId = getConfiguredVWorldBuildingDataId();

  return {
    queryStatus: 'idle',
    featureCount: 0,
    dataId,
    buffer: 10,
    requestPath: '/api/vworld-feature',
  };
}

function createInitialBuildingFootprintLoadState(): BuildingFootprintLoadState {
  const sourceMode = getConfiguredBuildingPolygonSource();
  const url = sourceMode === 'admdong_index' ? getBuildingAdmdongIndexUrl() : getBuildingFootprintGeoJsonUrl();
  const message =
    sourceMode === 'admdong_index' ? '행정동 분할 건물 index 로드 대기 중' : '건물 footprint GeoJSON 로드 대기 중';
  const diagnostics = createBuildingFootprintDiagnostics({
    sourceMode,
    status: 'idle',
    indexUrl: getBuildingAdmdongIndexUrl(),
    metaUrl: getBuildingMetaUrl(),
    message,
  });

  return {
    status: 'idle',
    url,
    collection: null,
    index: null,
    diagnostics,
    message,
  };
}

function getBuildingDataBaseUrl(indexUrl: string) {
  const slashIndex = indexUrl.lastIndexOf('/');

  return slashIndex >= 0 ? indexUrl.slice(0, slashIndex + 1) : indexUrl;
}

function readBuildingIndexEntryCount(value: unknown) {
  if (!value || typeof value !== 'object') {
    return 0;
  }

  const files = (value as { files?: unknown }).files;

  return Array.isArray(files) ? files.length : 0;
}

function createInitialBuildingDataHealthDiagnostics(): BuildingDataHealthDiagnostics {
  const indexUrl = getBuildingAdmdongIndexUrl();
  const metaUrl = getBuildingMetaUrl();

  return {
    buildingIndexStatus: 'idle',
    buildingMetaStatus: 'idle',
    buildingIndexEntryCount: 0,
    buildingDataBaseUrl: getBuildingDataBaseUrl(indexUrl),
    indexUrl,
    metaUrl,
    message: '건물 polygon 데이터 경로 확인 대기',
  };
}

function readMapInputDiagnostics() {
  const diagnostics =
    typeof window === 'undefined' ? null : window.__solarMateMapDiagnostics?.selectionInputControls ?? null;

  return {
    cameraControlMode:
      typeof diagnostics?.cameraControlMode === 'string' ? diagnostics.cameraControlMode : MAP_CAMERA_CONTROL_MODE,
    leftDragNavigationDisabled: Boolean(diagnostics?.leftDragNavigationDisabled),
    rightDragNavigationEnabled: Boolean(diagnostics?.rightDragNavigationEnabled),
    lastPointerMovePx:
      typeof diagnostics?.lastPointerMovePx === 'number' && Number.isFinite(diagnostics.lastPointerMovePx)
        ? diagnostics.lastPointerMovePx
        : 0,
    lastSelectionIgnoredBecauseDrag: Boolean(diagnostics?.lastSelectionIgnoredBecauseDrag),
  };
}

function createSelectionClickDiagnostics(selection?: VWorldSelection, coordinate?: Coordinate | null): SelectionClickDiagnostics {
  const inputDiagnostics = readMapInputDiagnostics();

  return {
    clickPickMethod: selection?.clickPickMethod ?? selection?.method ?? '-',
    clickPickStatus:
      selection?.clickPickStatus ??
      (typeof selection?.longitude === 'number' && typeof selection?.latitude === 'number' ? 'success' : 'failed'),
    selectedLat: coordinate?.[1] ?? null,
    selectedLon: coordinate?.[0] ?? null,
    pickPositionSupported: selection?.pickPositionSupported ?? false,
    cameraHeightM: selection?.cameraHeightM ?? null,
    cameraControlMode: selection?.cameraControlMode ?? inputDiagnostics.cameraControlMode,
    leftDragNavigationDisabled:
      selection?.leftDragNavigationDisabled ?? inputDiagnostics.leftDragNavigationDisabled,
    rightDragNavigationEnabled:
      selection?.rightDragNavigationEnabled ?? inputDiagnostics.rightDragNavigationEnabled,
    lastPointerMovePx: selection?.lastPointerMovePx ?? inputDiagnostics.lastPointerMovePx,
    lastSelectionIgnoredBecauseDrag:
      selection?.lastSelectionIgnoredBecauseDrag ?? inputDiagnostics.lastSelectionIgnoredBecauseDrag,
  };
}

function getFootprintSelectionModeText(mode?: BuildingFootprintSelectionMode | null) {
  if (mode === 'polygon') {
    return 'polygon 내부 선택';
  }

  if (mode === 'nearest') {
    return '근접 건물 선택';
  }

  return '-';
}

function clearRiskMapSelectionEntities(map: VWorldMapInstance | null) {
  if (!map) {
    return;
  }

  const viewer = findVisibleCesiumViewer(map);

  if (viewer) {
    removeCesiumEntitiesByIdPrefix(viewer, RISK_MAP_SELECTION_ENTITY_PREFIXES);
  }

  RISK_MAP_SELECTION_OBJECT_IDS.forEach((id) => {
    try {
      map.removeObjectById?.(id);
    } catch {
      // VWorld cleanup APIs differ by SDK build.
    }

    try {
      map.removeLayerElement?.(id);
    } catch {
      // VWorld cleanup APIs differ by SDK build.
    }
  });
}

function getDataTypeDisplayText(featureDataInfo: FeatureDataInfo) {
  if (featureDataInfo.sourceKind === 'parcel-fallback') {
    return '필지 polygon';
  }

  return featureDataInfo.dataTypeLabel;
}

function getBuildingSourceDataId(source: string) {
  if (source === 'api') {
    return '/api/building-polygon';
  }

  if (source === 'admdong_index') {
    return getBuildingAdmdongIndexUrl();
  }

  return getBuildingFootprintGeoJsonUrl();
}

function getBuildingSourceRequestPath(source: string, diagnostics?: BuildingFootprintDiagnostics) {
  if (source === 'api') {
    return '/api/building-polygon';
  }

  if (source === 'admdong_index') {
    return diagnostics?.loadedFileNames.length
      ? diagnostics.loadedFileNames.join(', ')
      : diagnostics?.indexUrl ?? getBuildingAdmdongIndexUrl();
  }

  return getBuildingFootprintGeoJsonUrl();
}

function RiskMapPage() {
  const [mapStatus, setMapStatus] = useState<MapLoadStatus>('loading');
  const [mapErrorMessage, setMapErrorMessage] = useState(
    '브이월드 3D 지도 로드에 실패했습니다. API 키, SDK URL, 허용 도메인을 확인해주세요.',
  );
  const [selectedBuilding, setSelectedBuilding] = useState<SelectedBuilding>(createInitialSelectedBuilding);
  const [addressSearchText, setAddressSearchText] = useState(() => readLandingAddressDraft()?.address ?? '');
  const [addressSearchStatus, setAddressSearchStatus] = useState<AddressSearchStatus>('idle');
  const [addressSearchMessage, setAddressSearchMessage] = useState(() =>
    readLandingAddressDraft()
      ? '첫 화면에서 입력한 주소를 불러왔습니다. 건물 데이터가 준비되면 검색할 수 있습니다.'
      : '',
  );
  const [analysisStatus, setAnalysisStatus] = useState('');
  const [profitReportStatus, setProfitReportStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [profitReportMessage, setProfitReportMessage] = useState('');
  const [activeTab, setActiveTab] = useState<RiskPanelTab>('risk');
  const activeTabRef = useRef<RiskPanelTab>('risk');
  const [pvAnalysisStatus, setPvAnalysisStatus] = useState<PvAnalysisStatus>('idle');
  const [, setPvAnalysisMessage] = useState('');
  const [pvAnalysisResponse, setPvAnalysisResponse] = useState<PvAnalysisProxyResponse | null>(null);
  const [isSolarPanelLayerVisible, setIsSolarPanelLayerVisible] = useState(false);
  const [isClimatePanelModeEnabled, setIsClimatePanelModeEnabled] = useState(false);
  const [climatePanelLoadStatus, setClimatePanelLoadStatus] = useState<ClimatePanelLoadStatus>('idle');
  const [climatePanelLoadMessage, setClimatePanelLoadMessage] = useState(
    'climate.gg POC 샘플은 토글을 켜면 public 정적 파일에서 불러옵니다.',
  );
  const [climateBundle, setClimateBundle] = useState<ClimateBundle | null>(null);
  const [climatePanelGeojson, setClimatePanelGeojson] = useState<ClimatePanelsGeoJson | null>(null);
  const [climatePocExtent, setClimatePocExtent] = useState<ClimatePocPanelExtent | null>(null);
  const [liveShadingStatus, setLiveShadingStatus] = useState<LiveShadingStatus>('idle');
  const [liveClimateStatus, setLiveClimateStatus] = useState<LiveClimateStatus>('idle');
  const [liveClimateStep, setLiveClimateStep] = useState('선택 건물 기준 라이브 분석 대기');
  const [liveClimateError, setLiveClimateError] = useState('');
  const [liveClimateBundle, setLiveClimateBundle] = useState<ClimateBundle | null>(null);
  const [liveClimatePanelGeojson, setLiveClimatePanelGeojson] = useState<ClimatePanelsGeoJson | null>(null);
  const [liveBackendRoofPolygon4326, setLiveBackendRoofPolygon4326] = useState<ClimateRoofPolygon4326 | null>(null);
  const [liveClimateDiagnostics, setLiveClimateDiagnostics] = useState<ClimateLiveAnalysisDiagnostics | null>(null);
  const [aiSimulationResult, setAiSimulationResult] = useState<SimulationAiResult | null>(null);
  const [cameraMoveStatus, setCameraMoveStatus] = useState('climate.gg POC 패널 위치 계산 대기');
  const panelVisibilityUserOverrideRef = useRef(false);
  const climateFocusPocRef = useRef<string | null>(null);
  const hasAutoSearchedAddressRef = useRef(false);
  const [vworldMap, setVworldMap] = useState<VWorldMapInstance | null>(null);
  const vworldMapRef = useRef<VWorldMapInstance | null>(null);
  const lastMapSelectionRef = useRef<{ longitude: number; latitude: number; selectedAt: number } | null>(null);
  const mapSelectionRequestIdRef = useRef(0);
  const selectedBuildingIdRef = useRef<string | null>(null);
  const selectedAnalysisSessionIdRef = useRef<string | null>(null);
  const mapTouchGestureRef = useRef({
    suppressClickUntil: 0,
    wasMultiTouchGesture: false,
    activePointers: new Map<number, { startX: number; startY: number; maxMovePx: number }>(),
    activeLeftPointer: null as {
      pointerId: number;
      startX: number;
      startY: number;
      startedAt: number;
      maxMovePx: number;
    } | null,
    lastPointerMovePx: 0,
    lastSelectionIgnoredBecauseDrag: false,
  });
  const [selectedCoordinate, setSelectedCoordinate] = useState<Coordinate | null>(null);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('screen-fallback');
  const [geometryQueryStatus, setGeometryQueryStatus] = useState<GeometryQueryStatus>('idle');
  const [geometryQueryMessage, setGeometryQueryMessage] = useState('건물을 클릭하면 브이월드 공간정보 조회를 시도합니다.');
  const [selectionFeedbackStatus, setSelectionFeedbackStatus] = useState<SelectionFeedbackStatus>('idle');
  const [selectionFeedbackMessage, setSelectionFeedbackMessage] = useState('지도에서 건물을 클릭해 선택하세요.');
  const [selectionClickDiagnostics, setSelectionClickDiagnostics] = useState<SelectionClickDiagnostics>(
    createSelectionClickDiagnostics,
  );
  const [mapFocusStatus, setMapFocusStatus] = useState<MapFocusStatus>({
    message: '지도에서 건물을 클릭하면 해당 위치로 시점 이동을 시도합니다.',
    moved: false,
    markerAdded: false,
  });
  const [featureDataInfo, setFeatureDataInfo] = useState<FeatureDataInfo>(createInitialFeatureDataInfo);
  const [featureQueryDiagnostics, setFeatureQueryDiagnostics] = useState<FeatureQueryDiagnostics>(
    createInitialFeatureQueryDiagnostics,
  );
  const [buildingFootprints, setBuildingFootprints] = useState<BuildingFootprintCollection | null>(null);
  const [buildingDataHealth, setBuildingDataHealth] = useState<BuildingDataHealthDiagnostics>(
    createInitialBuildingDataHealthDiagnostics,
  );
  const [buildingFootprintLoadState, setBuildingFootprintLoadState] = useState<BuildingFootprintLoadState>(
    createInitialBuildingFootprintLoadState,
  );
  const buildingFootprintUrlRef = useRef(buildingFootprintLoadState.url);
  const buildingFootprintFeatureCountRef = useRef(0);
  const [selectedBuildingFootprint, setSelectedBuildingFootprint] = useState<SelectedBuildingFootprint>(null);
  const [selectedBuildingFeature, setSelectedBuildingFeature] = useState<SelectableBuildingFeature | null>(null);
  const [selectedBuildingGeometry, setSelectedBuildingGeometry] = useState<PolygonCoordinates | null>(null);
  const [selectedRoofPolygon, setSelectedRoofPolygon] = useState<PolygonCoordinates | null>(null);
  const [selectableBuildingPolygons, setSelectableBuildingPolygons] = useState<PolygonCoordinates[]>([]);
  const [solarPanelPolygons, setSolarPanelPolygons] = useState<PolygonCoordinates[]>([]);
  const [selectableLayerStatus, setSelectableLayerStatus] = useState<VWorldSelectableBuildingLayerStatus>({
    state: 'idle',
    message: '선택 가능한 건물 테두리는 후보 파일 로드 후 표시됩니다.',
    candidateEntityCount: 0,
    renderMethod: '-',
    viewerDebugId: null,
    viewerEntityCount: null,
  });
  const [selectedBuildingLayerStatus, setSelectedBuildingLayerStatus] = useState<VWorldSelectedBuildingLayerStatus>({
    state: 'idle',
    message: '건물 polygon을 선택하면 선택 건물을 지도에 강조 표시합니다.',
    selectedBuildingEntityStatus: '대기',
    renderMethod: '-',
    viewerDebugId: null,
    viewerEntityCount: null,
  });
  const [panelLayerStatus, setPanelLayerStatus] = useState<VWorldSolarPanelLayerStatus>({
    state: 'idle',
    message: '태양광 패널 지도 레이어가 꺼져 있습니다.',
    panelPolygonCount: 0,
    panelEntityCount: 0,
    firstPanelCoordinates: null,
    entityCountBefore: null,
    entityCountAfter: null,
    terrainHeightM: null,
    roofHeightM: 20,
    finalPanelHeightM: null,
    renderMethod: '-',
    renderMode: '-',
    depthTestAgainstTerrain: null,
    viewerCanvasSize: null,
    viewerEntityCount: null,
    viewerDebugId: null,
    debugEntityAdded: false,
    debugLiftApplied: false,
  });
  const [climatePanelLayerStatus, setClimatePanelLayerStatus] = useState<ClimatePanelLayerStatus>({
    state: 'idle',
    message: 'climate.gg POC 패널 레이어가 꺼져 있습니다.',
    climatePanelFeatureCount: 0,
    climatePanelEntityCount: 0,
    firstPanelCoordinates: null,
    climatePanelRenderStatus: 'idle',
    renderMethod: '-',
    viewerDebugId: null,
    viewerEntityCount: null,
  });
  const isDeveloperDiagnosticsOpen = false;
  const hasActualSelectedBuildingGeometry =
    Boolean(selectedBuildingGeometry) && (selectionMode === 'geometry' || selectionMode === 'building_footprint');
  const shouldShowDevDiagnostics = false;
  const appEnv = import.meta.env.DEV ? 'development' : import.meta.env.MODE || 'production';
  const hasBuildingDataHealthError = buildingDataHealth.buildingIndexStatus === 'error';
  const buildingDataHealthStatusText = `index ${formatHealthStatus(
    buildingDataHealth.buildingIndexStatus,
  )} / meta ${formatHealthStatus(buildingDataHealth.buildingMetaStatus)}`;
  const isClimateLiveBackendEnabled = import.meta.env.VITE_ENABLE_CLIMATE_LIVE_BACKEND === 'true';
  const isClimateBackendPvBypassEnabled = isExternalClimateBackendConfigured();
  const configuredClimateBackendBaseUrl = getConfiguredClimateBackendBaseUrl();
  const pvAnalysisResult = pvAnalysisResponse?.result ?? null;
  const buildingFootprintCoordinateSummary = useMemo(
    () => summarizeBuildingFootprintCoordinates(buildingFootprints),
    [buildingFootprints],
  );
  const nearbySelectableBuildingPolygons = useMemo(
    () => getNearbyBuildingPolygons(selectableBuildingPolygons, selectedCoordinate, selectedBuildingGeometry),
    [selectableBuildingPolygons, selectedBuildingGeometry, selectedCoordinate],
  );
  const roofHeightEstimate = useMemo(
    () => deriveRoofHeightMFromFeature(selectedBuildingFeature),
    [selectedBuildingFeature],
  );
  const selectedBuildingCentroid = useMemo(
    () => (selectedRoofPolygon ? getPolygonCentroid(selectedRoofPolygon) : selectedCoordinate),
    [selectedCoordinate, selectedRoofPolygon],
  );
  const selectedBuildingId = selectedBuildingFootprint?.buildingId ?? null;
  const selectedAnalysisSessionId = selectedBuildingFootprint?.analysisSessionId ?? null;
  const livePanelsBuildingId =
    liveClimateDiagnostics?.backendPanelsBuildingId ??
    liveClimateDiagnostics?.requestSelectedBuildingId ??
    (liveClimateBundle ? selectedBuildingId : null);
  const livePanelsSessionId =
    liveClimateDiagnostics?.backendPanelsSessionId ??
    liveClimateDiagnostics?.requestSessionId ??
    (liveClimateBundle ? selectedAnalysisSessionId : null);
  const backendPanelsBuildingId = livePanelsBuildingId;
  const backendPanelsSessionId = livePanelsSessionId;
  const currentSelectedBuildingId = selectedBuildingId;
  const currentSessionId = selectedAnalysisSessionId;
  const sameBuildingForLivePanels =
    livePanelsBuildingId && livePanelsSessionId
      ? livePanelsBuildingId === selectedBuildingId && livePanelsSessionId === selectedAnalysisSessionId
      : null;
  const sameBuildingForBackendPanels =
    typeof liveClimateDiagnostics?.sameBuildingForBackendPanels === 'boolean'
      ? liveClimateDiagnostics.sameBuildingForBackendPanels
      : sameBuildingForLivePanels;
  const staleResponseIgnored = Boolean(
    liveClimateDiagnostics?.staleBackendResponseIgnored ?? liveClimateDiagnostics?.ignoredStaleLiveResponse,
  );
  const sameViewerAsBuildingLayer =
    selectedBuildingLayerStatus.viewerDebugId && panelLayerStatus.viewerDebugId
      ? selectedBuildingLayerStatus.viewerDebugId === panelLayerStatus.viewerDebugId
      : null;
  const geoJsonDiagnosticSourceStatus = getGeoJsonDiagnosticSourceStatus(buildingFootprintLoadState);
  const buildingFootprintDiagnostics = buildingFootprintLoadState.diagnostics;
  const buildingPolygonSource = getConfiguredBuildingPolygonSource();
  const isAdmdongIndexReady =
    buildingFootprintDiagnostics.indexLoaded ||
    buildingFootprintLoadState.status === 'index_loaded' ||
    buildingFootprintLoadState.status === 'selected' ||
    buildingFootprintLoadState.status === 'not_found';
  const isBuildingPolygonDataReady =
    buildingPolygonSource === 'api' ||
    (buildingPolygonSource === 'geojson' && Boolean(buildingFootprints)) ||
    (buildingPolygonSource === 'admdong_index' && isAdmdongIndexReady);
  const hasSelectedBuilding = selectionMode === 'building_footprint' && Boolean(selectedBuildingFootprint);
  const hasSelectedBuildingPolygon = hasSelectedBuilding && Boolean(selectedRoofPolygon);
  const hasGeneratedPanelLayout = hasSelectedBuildingPolygon && solarPanelPolygons.length > 0;
  const staticClimatePanelFeatureCount = climatePocExtent?.featureCount ?? climatePanelGeojson?.features.length ?? 0;
  const climatePocCentroid = climatePocExtent?.centroid ?? null;
  const climatePocBbox = climatePocExtent?.bbox ?? null;
  const liveClimatePocExtent = useMemo(
    () => summarizeClimatePanelGeojson(liveClimatePanelGeojson),
    [liveClimatePanelGeojson],
  );
  const liveClimatePanelFeatureCount = liveClimatePocExtent?.featureCount ?? liveClimatePanelGeojson?.features.length ?? 0;
  const backendRoofMatchesSelected =
    typeof liveClimateDiagnostics?.backendRoofMatchesSelected === 'boolean'
      ? liveClimateDiagnostics.backendRoofMatchesSelected
      : null;
  const backendRoofDistanceToSelectedM =
    typeof liveClimateDiagnostics?.backendRoofDistanceToSelectedM === 'number'
      ? liveClimateDiagnostics.backendRoofDistanceToSelectedM
      : null;
  const hasBackendPolygonMismatch =
    backendRoofMatchesSelected === false &&
    (backendRoofDistanceToSelectedM ?? Number.POSITIVE_INFINITY) > BACKEND_ROOF_MATCH_DISTANCE_THRESHOLD_M;
  const panelCellCountAfterClip =
    typeof liveClimateDiagnostics?.panelCellCountAfterClip === 'number'
      ? liveClimateDiagnostics.panelCellCountAfterClip
      : typeof liveClimateDiagnostics?.backendPanelCellCountAfterClip === 'number'
        ? liveClimateDiagnostics.backendPanelCellCountAfterClip
        : null;
  const backendPanelCellsOutsideSelectedCount =
    typeof liveClimateDiagnostics?.backendPanelCellsOutsideSelectedCount === 'number'
      ? liveClimateDiagnostics.backendPanelCellsOutsideSelectedCount
      : null;
  const hasStaticClimatePanelLayout =
    isClimatePanelModeEnabled &&
    climatePanelLoadStatus === 'loaded' &&
    staticClimatePanelFeatureCount > 0 &&
    Boolean(climatePocCentroid);
  const hasLiveClimatePanelLayout =
    isClimateLiveBackendEnabled &&
    liveClimateStatus === 'success' &&
    liveClimatePanelFeatureCount > 0 &&
    Boolean(liveClimateBundle);
  const activeClimateBundle = hasLiveClimatePanelLayout ? liveClimateBundle : null;
  const activeBundleAiResult = isSimulationAiResult(activeClimateBundle?.ai_simulation_result)
    ? activeClimateBundle.ai_simulation_result
    : null;
  const activeAiSimulationResult = aiSimulationResult ?? activeBundleAiResult;
  const activeBuildingSuitability =
    activeAiSimulationResult?.buildingSuitability ?? activeAiSimulationResult?.suitability ?? null;
  const activeAiCluster = activeBuildingSuitability?.cluster ?? null;
  const activeAiModelType =
    activeBuildingSuitability?.modelType ?? activeAiSimulationResult?.generationPrediction.modelType ?? '-';
  const aiSuitabilityReasons = activeBuildingSuitability?.reasons.slice(0, 3) ?? [];
  const aiSuitabilityWarnings = activeBuildingSuitability?.warnings ?? [];
  const activeReportInputMetrics = activeAiSimulationResult?.agentPayload?.reportInputMetrics ?? null;
  const activeClimatePanelGeojson = hasLiveClimatePanelLayout
    ? liveClimatePanelGeojson
    : hasStaticClimatePanelLayout
      ? climatePanelGeojson
      : null;
  const activeBackendRoofPolygon4326 =
    liveBackendRoofPolygon4326 ?? (hasLiveClimatePanelLayout ? liveClimateBundle?.roof_polygon_4326 ?? null : null);
  const activeClimatePanelFeatureCount = hasLiveClimatePanelLayout
    ? liveClimatePanelFeatureCount
    : hasStaticClimatePanelLayout
      ? staticClimatePanelFeatureCount
      : 0;
  const shouldRenderClimatePanelLayer =
    isSolarPanelLayerVisible && (Boolean(activeClimatePanelGeojson) || Boolean(activeBackendRoofPolygon4326));
  const shouldRenderGeneratedPanelLayer =
    isSolarPanelLayerVisible &&
    hasActualSelectedBuildingGeometry &&
    !hasLiveClimatePanelLayout;
  const liveRoofSource = (liveClimateDiagnostics?.roofSource as ClimateLiveRoofSource | undefined) ?? null;
  const liveSelectBuldStatus = liveClimateDiagnostics?.selectBuldStatus ?? null;
  const liveHybridMode = Boolean(liveClimateDiagnostics?.liveHybridMode);
  const maxCellsApplied = Boolean(liveClimateDiagnostics?.maxCellsApplied);
  const panelPlacementSourceLabel = hasLiveClimatePanelLayout
    ? 'climate.gg 라이브 옥상·음영 분석'
    : isClimatePanelModeEnabled
      ? 'climate.gg 샘플 음영 분석'
      : '건물 footprint 기반 자체 배치';
  const resolvedPanelPlacementSourceLabel = hasLiveClimatePanelLayout
    ? '선택 건물 footprint + climate.gg 음영 분석'
    : panelPlacementSourceLabel;
  const demoPanelSourceLabel = hasLiveClimatePanelLayout
    ? '선택 건물 footprint + climate.gg 음영 분석'
    : DEFAULT_PANEL_PLACEMENT_SOURCE;
  const verifiedPanelPlacementSourceLabel = hasBackendPolygonMismatch
    ? '백엔드 polygon 불일치로 자체 배치 표시'
    : hasLiveClimatePanelLayout
      ? '선택 건물 footprint + climate.gg 음영 분석'
      : isClimatePanelModeEnabled
        ? 'climate.gg 샘플 음영 분석'
        : '건물 footprint 기반 자체 배치';
  const verifiedResolvedPanelPlacementSourceLabel = hasLiveClimatePanelLayout
    ? '선택 건물 footprint + climate.gg 음영 분석'
    : verifiedPanelPlacementSourceLabel;
  const hasAnyPanelLayout = hasGeneratedPanelLayout || hasStaticClimatePanelLayout || hasLiveClimatePanelLayout;
  const hasPvAnalysisCompleted =
    pvAnalysisStatus === 'success' ||
    pvAnalysisStatus === 'fallback' ||
    pvAnalysisStatus === 'backend-result' ||
    pvAnalysisStatus === 'local-fallback';
  const liveRoofAreaM2 = liveClimateDiagnostics?.roofAreaM2 ?? null;
  const liveCellCount = liveClimateDiagnostics?.cellCount ?? null;
  const liveShadingAverage = liveClimateDiagnostics?.shadingAverage ?? null;
  const livePanelCount = liveClimateDiagnostics?.panelCount ?? null;
  const liveOriginalCellCount = liveClimateDiagnostics?.originalCellCount ?? null;
  const liveUsedCellCount = liveClimateDiagnostics?.usedCellCount ?? null;
  const liveElapsedMs = liveClimateDiagnostics?.elapsedMs ?? null;
  const liveSelectSunListStatus = liveClimateDiagnostics?.selectSunListStatus ?? null;
  const liveSelectSunListTimeoutMs = liveClimateDiagnostics?.selectSunListTimeoutMs ?? null;
  const liveFrontendAbortMs = liveClimateDiagnostics?.frontendAbortMs ?? null;
  const liveFallbackReason = typeof liveClimateDiagnostics?.fallbackReason === 'string' ? liveClimateDiagnostics.fallbackReason : '-';
  const liveBackendBaseUrl =
    typeof liveClimateDiagnostics?.backendBaseUrl === 'string'
      ? liveClimateDiagnostics.backendBaseUrl
      : configuredClimateBackendBaseUrl || '-';
  const liveBackendHealthStatus = toFiniteNumber(liveClimateDiagnostics?.backendHealthStatus);
  const liveBackendPostStatus = toFiniteNumber(liveClimateDiagnostics?.backendPostStatus);
  const liveBackendFetchErrorName =
    typeof liveClimateDiagnostics?.backendFetchErrorName === 'string' ? liveClimateDiagnostics.backendFetchErrorName : '-';
  const liveBackendFetchErrorMessage =
    typeof liveClimateDiagnostics?.backendFetchErrorMessage === 'string' ? liveClimateDiagnostics.backendFetchErrorMessage : '-';
  const liveBackendResponseOk =
    typeof liveClimateDiagnostics?.backendResponseOk === 'boolean' ? liveClimateDiagnostics.backendResponseOk : null;
  const liveBackendResponseMessage =
    typeof liveClimateDiagnostics?.backendResponseMessage === 'string' ? liveClimateDiagnostics.backendResponseMessage : '-';
  const liveIncludePvAnalysis = liveClimateDiagnostics?.includePvAnalysis ?? false;
  const liveInstallCapacityKw = liveClimateDiagnostics?.installCapacityKw ?? null;
  const liveApiSource = liveClimateStatus === 'success' ? 'climate.gg-live-hybrid' : '-';
  const activeClimatePvOutput = activeClimateBundle?.pv_analysis_output ?? null;
  const pvAnalysisDiagnostics = pvAnalysisResponse?.diagnostics;
  const pvAnalysisSource =
    pvAnalysisDiagnostics?.pvAnalysisSource ??
    pvAnalysisResponse?.source ??
    (pvAnalysisStatus === 'backend-result'
      ? getClimatePvOutputSource(activeClimatePvOutput)
      : pvAnalysisStatus === 'local-fallback'
        ? 'frontend-local-formula'
        : pvAnalysisStatus === 'fallback'
          ? 'local-scenario-fallback'
          : pvAnalysisStatus === 'calculating'
            ? 'separate-request-pending'
            : '-');
  const usedVercelPvAnalysis =
    typeof pvAnalysisDiagnostics?.usedVercelPvAnalysis === 'boolean'
      ? pvAnalysisDiagnostics.usedVercelPvAnalysis
      : isClimateBackendPvBypassEnabled
        ? false
        : pvAnalysisStatus === 'success' || pvAnalysisStatus === 'fallback';
  const climateExpectedRevenue = activeClimatePvOutput?.expected_revenue;
  const isSeparatePvCalculating = hasLiveClimatePanelLayout && pvAnalysisStatus === 'calculating';
  const isBuildingDataApiLoading =
    buildingDataHealth.buildingIndexStatus === 'loading' ||
    buildingDataHealth.buildingMetaStatus === 'loading' ||
    buildingFootprintLoadState.status === 'index_loading' ||
    buildingFootprintLoadState.status === 'candidate_loading';
  const isMapApiLoading =
    mapStatus === 'ready' &&
    (addressSearchStatus === 'searching' ||
      selectionFeedbackStatus === 'loading' ||
      geometryQueryStatus === 'loading' ||
      isBuildingDataApiLoading ||
      climatePanelLoadStatus === 'loading' ||
      liveClimateStatus === 'loading' ||
      liveShadingStatus === 'trying' ||
      pvAnalysisStatus === 'calculating');
  const mapApiLoadingLabel =
    liveClimateStatus === 'loading' || liveShadingStatus === 'trying'
      ? 'climate.gg 분석 중'
      : pvAnalysisStatus === 'calculating'
        ? '발전량 분석 중'
        : addressSearchStatus === 'searching'
          ? '주소 검색 중'
          : selectionFeedbackStatus === 'loading' || geometryQueryStatus === 'loading'
            ? '건물 데이터 확인 중'
            : climatePanelLoadStatus === 'loading'
              ? '음영 데이터 불러오는 중'
              : '지도 데이터 불러오는 중';
  const simplePaybackSource: SimplePaybackSource = hasLiveClimatePanelLayout
    ? 'climate-live'
    : 'footprint-fallback';
  const climateBundlePaybackYears = calculateClimateBundlePaybackYears(activeClimateBundle);
  const pvResultPaybackYears = calculatePvResultPaybackYears(pvAnalysisResult);
  const footprintPaybackYears = normalizeSimplePaybackYears(selectedBuilding.estimatedPaybackYears);
  const simplePaybackYears =
    simplePaybackSource === 'climate-live'
      ? climateBundlePaybackYears
      : pvResultPaybackYears ?? footprintPaybackYears;
  const simplePaybackText = formatSimplePaybackYears(simplePaybackYears);
  const overviewRoofAreaM2 = liveRoofAreaM2 ?? activeClimateBundle?.roof_area_sqm_5186 ?? selectedBuilding.estimatedRoofAreaM2;
  const overviewShadingAverage = liveShadingAverage ?? activeClimateBundle?.shading.score_mean ?? null;
  const overviewPanelCount =
    livePanelCount ?? activeClimateBundle?.pv_analysis_input.solar_panel_info.panel_count ?? selectedBuilding.estimatedPanelCount;
  const overviewInstallCapacityKw =
    climateExpectedRevenue?.install_kw ??
    pvAnalysisResult?.installKw ??
    liveInstallCapacityKw ??
    (activeClimateBundle
      ? (activeClimateBundle.pv_analysis_input.solar_panel_info.panel_capacity *
          activeClimateBundle.pv_analysis_input.solar_panel_info.panel_count) /
        1000
      : selectedBuilding.estimatedCapacityKw);
  const overviewAnnualGenerationKwh =
    activeClimatePvOutput?.annual_generation ??
    pvAnalysisResult?.annualGenerationKwh ??
    selectedBuilding.estimatedAnnualGenerationKwh;
  const overviewAnnualSavingsKrw =
    climateExpectedRevenue?.first_year_save_cost ??
    pvAnalysisResult?.firstYearSelfConsumptionSavingKrw ??
    selectedBuilding.estimatedAnnualSavingsKrw;
  const overviewInvestmentKrw = climateExpectedRevenue?.expected_investment ?? pvAnalysisResult?.estimatedInvestmentKrw ?? null;
  const roofSourceFallbackNote =
    hasLiveClimatePanelLayout && liveRoofSource === 'vworld-building-footprint-fallback'
      ? liveSelectBuldStatus === 'mismatch_selected_building'
        ? 'climate.gg 옥상 polygon이 선택 건물과 달라 선택 건물 footprint 기반으로 음영 분석을 진행했습니다.'
        : 'climate.gg 옥상 polygon 조회가 지연되어 선택 건물 footprint 기반으로 음영 분석을 진행했습니다.'
      : null;
  const analysisOverviewCards = [
    ['분석 소스', verifiedPanelPlacementSourceLabel],
    ['옥상 추정 면적', formatEstimatedSquareMeters(overviewRoofAreaM2)],
    ['음영 평균 점수', formatEstimatedScore(overviewShadingAverage)],
    ['예상 패널 수', formatDiagnosticCount(overviewPanelCount)],
    ['예상 설치용량', formatEstimatedKw(overviewInstallCapacityKw)],
    ['예상 연간 발전량', isSeparatePvCalculating ? '계산 중...' : formatEstimatedKwh(overviewAnnualGenerationKwh)],
    ['예상 연간 절감액', isSeparatePvCalculating ? '발전량은 별도 계산 중' : formatEstimatedKrw(overviewAnnualSavingsKrw)],
    ['총 설치비 추정', overviewInvestmentKrw && overviewInvestmentKrw > 0 ? formatEstimatedKrw(overviewInvestmentKrw) : '계산 불가'],
    ['단순 회수기간 추정', simplePaybackText],
  ] as const;
  const climateBundleSummaryItems = activeClimateBundle
    ? [
        ['unq_id', formatOptionalText(activeClimateBundle.meta.unq_id)],
        ['building name', formatOptionalText(activeClimateBundle.meta.bldg_nm)],
        ['roof area', formatEstimatedSquareMeters(activeClimateBundle.roof_area_sqm_5186)],
        [
          'shading score mean/min/max',
          `${formatEstimatedScore(activeClimateBundle.shading.score_mean)} / ${formatEstimatedScore(
            activeClimateBundle.shading.score_min,
          )} / ${formatEstimatedScore(activeClimateBundle.shading.score_max)}`,
        ],
        [
          'panel/cell count',
          `추정 ${activeClimateBundle.pv_analysis_input.solar_panel_info.panel_count.toLocaleString('ko-KR')}개 / 셀 ${activeClimateBundle.shading.cells_total.toLocaleString(
            'ko-KR',
          )}개`,
        ],
        [
          'annual generation',
          activeClimatePvOutput ? formatEstimatedKwh(activeClimatePvOutput.annual_generation) : '발전량은 별도 계산 중',
        ],
        ['install kw', climateExpectedRevenue ? formatEstimatedKw(climateExpectedRevenue.install_kw) : '-'],
        ['first year revenue', climateExpectedRevenue ? formatEstimatedKrw(climateExpectedRevenue.first_year_revenue) : '-'],
        [
          'first year save cost',
          climateExpectedRevenue ? formatEstimatedKrw(climateExpectedRevenue.first_year_save_cost) : '-',
        ],
        [
          'expected investment',
          climateExpectedRevenue ? formatEstimatedKrw(climateExpectedRevenue.expected_investment) : '-',
        ],
        ['단순 회수기간 추정', simplePaybackText],
      ]
    : [];
  const hasCompletedClimateAnalysis =
    !isClimateLiveBackendEnabled || (hasLiveClimatePanelLayout && Boolean(activeAiSimulationResult));
  const shouldShowCompletedAnalysisActions = activeTab === 'solar' && hasPvAnalysisCompleted && hasCompletedClimateAnalysis;
  const panelSpacingText = `행 ${formatMeters(DEFAULT_SOLAR_PANEL_LAYOUT_OPTIONS.rowGapM)} · 열 ${formatMeters(
    DEFAULT_SOLAR_PANEL_LAYOUT_OPTIONS.colGapM,
  )}`;
  const roofMarginText = formatMeters(DEFAULT_SOLAR_PANEL_LAYOUT_OPTIONS.roofMarginM);
  const installationExclusionRateText = formatPercent(1 - DEFAULT_SOLAR_PANEL_LAYOUT_OPTIONS.usableAreaRatio);
  const riskProcessSteps: RiskProcessStep[] = [
    {
      title: '건물 선택',
      state: !isBuildingPolygonDataReady ? 'disabled' : hasSelectedBuilding ? 'complete' : 'active',
      message: hasBuildingDataHealthError
        ? BUILDING_DATA_HEALTH_ERROR_MESSAGE
        : !isBuildingPolygonDataReady
        ? '화성시 건물 polygon 데이터 연결 필요'
        : hasSelectedBuilding
          ? `${selectedBuildingFootprint?.buildingId ?? '선택 건물'} 선택 완료`
          : '지도에서 분석할 건물을 선택하세요.',
    },
    {
      title: '태양광 패널 배치',
      state: !hasSelectedBuilding && !hasAnyPanelLayout ? 'pending' : hasAnyPanelLayout ? 'complete' : 'active',
      message: hasLiveClimatePanelLayout
        ? `선택 건물 기준 climate.gg 라이브 분석으로 ${liveClimatePanelFeatureCount.toLocaleString('ko-KR')}개 음영 셀을 불러왔습니다.`
        : hasStaticClimatePanelLayout
          ? `climate.gg 샘플 사전계산본으로 ${staticClimatePanelFeatureCount.toLocaleString('ko-KR')}개 옥상·음영 셀을 불러왔습니다.`
        : hasGeneratedPanelLayout
          ? `건물 footprint 기반 옥상 추정으로 ${solarPanelPolygons.length.toLocaleString('ko-KR')}개 패널 후보를 배치했습니다.`
          : hasSelectedBuilding
            ? '건물 footprint 기반 옥상 추정으로 패널 배치를 계산합니다.'
            : '건물 선택 후 패널 배치를 확인할 수 있습니다.',
    },
    {
      title: '발전량 분석',
      state: hasPvAnalysisCompleted ? 'complete' : hasAnyPanelLayout ? 'active' : 'pending',
      message: hasPvAnalysisCompleted
        ? '발전량 분석이 완료되었습니다.'
        : hasAnyPanelLayout
          ? '패널 배치 결과로 발전량 분석을 실행하세요.'
          : '패널 배치 후 발전량 분석을 실행할 수 있습니다.',
    },
  ];

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    selectedBuildingIdRef.current = selectedBuildingId;
    selectedAnalysisSessionIdRef.current = selectedAnalysisSessionId;
  }, [selectedAnalysisSessionId, selectedBuildingId]);

  useEffect(() => {
    setLiveShadingStatus('idle');
    setLiveClimateStatus('idle');
    setLiveClimateStep('새 선택 건물 기준 라이브 분석 대기');
    setLiveClimateError('');
    setLiveClimateDiagnostics(null);
    setLiveClimateBundle(null);
    setLiveClimatePanelGeojson(null);
    setLiveBackendRoofPolygon4326(null);
    setAiSimulationResult(null);
    setPvAnalysisStatus('idle');
    setPvAnalysisMessage('');
    setPvAnalysisResponse(null);
  }, [selectedAnalysisSessionId, selectedBuildingId]);

  useEffect(() => {
    buildingFootprintUrlRef.current = buildingFootprintLoadState.url;
  }, [buildingFootprintLoadState.url]);

  useEffect(() => {
    buildingFootprintFeatureCountRef.current = buildingFootprints?.features.length ?? 0;
  }, [buildingFootprints?.features.length]);

  useEffect(() => {
    if (
      activeTab === 'solar' &&
      hasSelectedBuildingPolygon &&
      solarPanelPolygons.length > 0 &&
      !panelVisibilityUserOverrideRef.current
    ) {
      setIsSolarPanelLayerVisible(true);
    }
  }, [activeTab, hasSelectedBuildingPolygon, solarPanelPolygons.length]);

  const loadClimatePocAssets = useCallback(async () => {
    setClimatePanelLoadStatus('loading');
    setClimatePanelLoadMessage('climate.gg POC 정적 파일을 불러오는 중입니다.');
    setCameraMoveStatus('climate.gg POC 정적 파일 로드 중');

    try {
      const [loadedBundle, loadedPanels] = await Promise.all([
        loadClimateBundle(DEFAULT_CLIMATE_POC_ID),
        loadClimatePanelGeojson(DEFAULT_CLIMATE_POC_ID),
      ]);
      const nextExtent = summarizeClimatePanelGeojson(loadedPanels);

      if (!nextExtent) {
        setClimatePanelLoadStatus('error');
        setClimatePanelLoadMessage('climate.gg POC 정적 파일을 불러오지 못했습니다.');
        setClimateBundle(null);
        setClimatePanelGeojson(null);
        setClimatePocExtent(null);
        setCameraMoveStatus('panels_4326.geojson에서 bbox/centroid 계산 가능한 좌표를 찾지 못했습니다.');
        setClimatePanelLayerStatus((current) => ({
          ...current,
          state: 'error',
          message: 'climate.gg POC 정적 파일을 불러오지 못했습니다.',
          climatePanelFeatureCount: loadedPanels.features.length,
          climatePanelEntityCount: 0,
          firstPanelCoordinates: null,
          climatePanelRenderStatus: 'error',
          renderMethod: '-',
          viewerDebugId: null,
          viewerEntityCount: null,
        }));
        return;
      }

      setClimateBundle(loadedBundle);
      setClimatePanelGeojson(loadedPanels);
      setClimatePocExtent(nextExtent);
      setClimatePanelLoadStatus('loaded');
      setClimatePanelLoadMessage(
        `climate.gg POC 사전계산본 ${nextExtent.featureCount.toLocaleString('ko-KR')}개 패널 셀을 불러왔습니다.`,
      );
      setCameraMoveStatus(
        `climatePocCentroid/bbox 계산 완료 · ${nextExtent.featureCount.toLocaleString('ko-KR')}개 feature`,
      );
      setClimatePanelLayerStatus((current) => ({
        ...current,
        state: current.state === 'rendered' ? current.state : 'loaded',
        message: `climate.gg POC 정적 파일 로드 완료 · ${nextExtent.featureCount.toLocaleString('ko-KR')}개 패널 셀`,
        climatePanelFeatureCount: nextExtent.featureCount,
        climatePanelEntityCount: current.state === 'rendered' ? current.climatePanelEntityCount : 0,
        climatePanelRenderStatus: current.state === 'rendered' ? current.climatePanelRenderStatus : 'loaded',
      }));
    } catch {
      setClimatePanelLoadStatus('error');
      setClimatePanelLoadMessage('climate.gg POC 정적 파일을 불러오지 못했습니다.');
      setClimateBundle(null);
      setClimatePanelGeojson(null);
      setClimatePocExtent(null);
      setCameraMoveStatus('climate.gg POC 정적 파일을 불러오지 못했습니다.');
      setClimatePanelLayerStatus({
        state: 'error',
        message: 'climate.gg POC 정적 파일을 불러오지 못했습니다.',
        climatePanelFeatureCount: 0,
        climatePanelEntityCount: 0,
        firstPanelCoordinates: null,
        climatePanelRenderStatus: 'error',
        renderMethod: '-',
        viewerDebugId: null,
        viewerEntityCount: null,
      });
    }
  }, []);

  useEffect(() => {
    if (isClimatePanelModeEnabled && climatePanelLoadStatus === 'idle') {
      void loadClimatePocAssets();
    }
  }, [climatePanelLoadStatus, isClimatePanelModeEnabled, loadClimatePocAssets]);

  useEffect(() => {
    if (!isClimatePanelModeEnabled) {
      setCameraMoveStatus('climate.gg POC 패널 위치 계산 대기');
      return;
    }

    if (climatePanelLoadStatus === 'loading') {
      setCameraMoveStatus('climate.gg POC 정적 파일 로드 중');
      return;
    }

    if (climatePanelLoadStatus === 'error') {
      setCameraMoveStatus('climate.gg POC 정적 파일을 불러오지 못했습니다.');
      return;
    }

    if (!climatePocExtent) {
      setCameraMoveStatus('climate.gg POC 패널 bbox/centroid 계산 대기');
      return;
    }

    setCameraMoveStatus(
      `climatePocCentroid/bbox 계산 완료 · ${climatePocExtent.featureCount.toLocaleString('ko-KR')}개 feature`,
    );
  }, [climatePanelLoadStatus, climatePocExtent, isClimatePanelModeEnabled]);

  useEffect(() => {
    if (!isClimatePanelModeEnabled || !climateBundle || !vworldMap || !climatePocExtent) {
      return;
    }

    const pocId = climateBundle.meta.unq_id ?? DEFAULT_CLIMATE_POC_ID;

    if (climateFocusPocRef.current === pocId) {
      return;
    }

    const focusResult = focusVWorldMapOnCoordinate(vworldMap, {
      longitude: climatePocExtent.centroid[0],
      latitude: climatePocExtent.centroid[1],
      height: getClimatePocFocusHeightM(climatePocExtent),
      pitch: -84,
    });

    climateFocusPocRef.current = pocId;
    setCameraMoveStatus(
      focusResult.moved
        ? `자동 이동 완료 · ${focusResult.method || 'camera'} · climatePocCentroid 기준`
        : `자동 이동 미완료 · ${focusResult.message}`,
    );
    setMapFocusStatus({
      message: focusResult.message,
      method: focusResult.method,
      selectionSource: 'climate.gg POC',
      selectionMethod: verifiedResolvedPanelPlacementSourceLabel,
      moved: focusResult.moved,
      markerAdded: false,
    });
  }, [climateBundle, climatePocExtent, isClimatePanelModeEnabled, verifiedResolvedPanelPlacementSourceLabel, vworldMap]);

  const applyBuildingFootprintSelection = useCallback(
    (match: BuildingFootprintMatch, coordinate: Coordinate, selection?: VWorldSelection) => {
      const polygon = normalizeGeoJsonPolygon(match.feature);

      if (!polygon) {
        clearRiskMapSelectionEntities(vworldMapRef.current);
        setGeometryQueryStatus('not-found');
        setGeometryQueryMessage('선택 좌표에서 건물 polygon을 찾았지만 표시 가능한 Polygon/MultiPolygon 좌표가 없습니다.');
        setSelectionFeedbackStatus('not_found');
        setSelectionFeedbackMessage(SELECTION_NOT_FOUND_MESSAGE);
        setSelectedBuildingFootprint(null);
        setSelectedBuildingFeature(null);
        setSelectedBuildingGeometry(null);
        setSelectedRoofPolygon(null);
        setSelectableBuildingPolygons([]);
        setSolarPanelPolygons([]);
        return;
      }

      const roofPolygon = estimateRoofPolygonFromFootprint(polygon);
      const roofCentroid = getPolygonCentroid(roofPolygon);
      const focusHeightM = getRoofFocusHeightM(roofPolygon);
      const layoutResult = generateSolarPanelLayout(roofPolygon);
      const panelPolygons = layoutResult.panelPolygons;
      const solarEstimate = createSolarEstimateFromPanelLayout(layoutResult);
      const selectedAnalysisSessionId = createSelectedAnalysisSessionId(match.metadata.buildingId);
      const layoutWarningMessage = layoutResult.warnings.length > 0 ? ` ${layoutResult.warnings.join(' ')}` : '';
      const refinedFocusResult = focusVWorldMapOnCoordinate(vworldMapRef.current, {
        longitude: roofCentroid[0],
        latitude: roofCentroid[1],
        height: focusHeightM,
        pitch: -88,
      });
      const selectionModeText = getFootprintSelectionModeText(match.metadata.selectionMode);
      const distanceText =
        typeof match.metadata.distanceMeters === 'number' && match.metadata.distanceMeters > 0
          ? ` · 클릭 좌표와 약 ${Math.round(match.metadata.distanceMeters).toLocaleString('ko-KR')}m`
          : '';

      clearRiskMapSelectionEntities(vworldMapRef.current);
      setSelectedCoordinate(coordinate);
      setSelectedBuildingFootprint({
        ...match.metadata,
        analysisSessionId: selectedAnalysisSessionId,
      });
      setSelectedBuildingFeature(match.feature);
      setSelectedBuildingGeometry(polygon);
      setSelectedRoofPolygon(roofPolygon);
      setSolarPanelPolygons(panelPolygons);
      setLiveShadingStatus('idle');
      setLiveClimateStatus('idle');
      setLiveClimateStep('새 선택 건물 기준 라이브 분석 대기');
      setLiveClimateError('');
      setLiveClimateDiagnostics(null);
      setLiveClimateBundle(null);
      setLiveClimatePanelGeojson(null);
      setLiveBackendRoofPolygon4326(null);
      setAiSimulationResult(null);
      panelVisibilityUserOverrideRef.current = false;
      setIsSolarPanelLayerVisible(activeTabRef.current === 'solar' && panelPolygons.length > 0);
      setMapFocusStatus({
        message: refinedFocusResult.message,
        method: refinedFocusResult.method,
        selectionSource: selection?.source,
        selectionMethod: selection?.method,
        moved: refinedFocusResult.moved,
        markerAdded: false,
      });
      setSelectionMode('building_footprint');
      setGeometryQueryStatus('found');
      setSelectionFeedbackStatus('success');
      setSelectionFeedbackMessage('건물 선택 완료');
      setGeometryQueryMessage(
        `건물 선택 완료: ${selectionModeText}${distanceText}. 건물 footprint 기반 옥상 추정: ${
          match.metadata.geometryType
        } geometry에서 ${panelPolygons.length.toLocaleString(
          'ko-KR',
        )}개 패널 후보를 배치했습니다.${layoutWarningMessage}`,
      );
      setFeatureDataInfo({
        dataId: getBuildingSourceDataId(buildingPolygonSource),
        dataTypeLabel: getBuildingPolygonSourceLabel(buildingPolygonSource),
        isActualRoofPolygon: false,
        dataTypeNote:
          '건물 footprint 기반 옥상 추정입니다. 정밀 옥상·장애물 데이터가 아니므로 현장조사가 필요합니다.',
        sourceKind: 'building-or-roof',
      });
      setFeatureQueryDiagnostics({
        queryStatus: 'success',
        featureCount: buildingFootprintFeatureCountRef.current,
        requestedLon: coordinate[0],
        requestedLat: coordinate[1],
        dataId: getBuildingSourceDataId(buildingPolygonSource),
        buffer: 0,
        requestPath: buildingFootprintUrlRef.current,
      });
      setSelectedBuilding({
        ...demoBuilding,
        apartmentName: match.metadata.name,
        address: match.metadata.address,
        ...solarEstimate,
        selectionNote: `${selectionModeText} · building_id ${match.metadata.buildingId} / ${match.metadata.geometryType} 기반으로 선택했습니다.${distanceText}`,
        simulationConfidence: '건물 footprint 기반 옥상 추정',
        simulationNote: `건물 footprint 기반 옥상 추정입니다. ${layoutResult.reason ?? ''} 실제 설치 가능 여부는 옥상 장애물, 음영, 구조안전성, 관리주체 협의, 현장조사에 따라 달라질 수 있습니다.`,
      });
    },
    [buildingPolygonSource],
  );

  const handleAddressSearchChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setAddressSearchText(event.target.value);
  }, []);

  const runAddressSearch = useCallback(
    async (rawQuery: string) => {
      const query = rawQuery.trim();

      if (!query) {
        setAddressSearchStatus('error');
        setAddressSearchMessage('주소 또는 아파트명을 입력해 주세요.');
        return;
      }

      saveLandingAddressDraft(query, 'risk-map-search');
      setAddressSearchStatus('searching');
      setAddressSearchMessage('입력 주소를 건물 polygon 데이터에서 찾는 중입니다.');
      setSelectionFeedbackStatus('loading');
      setSelectionFeedbackMessage('주소 검색으로 건물을 찾는 중...');
      setGeometryQueryStatus('loading');
      setGeometryQueryMessage('입력 주소를 건물 polygon 데이터와 매칭하고 있습니다.');
      setSelectedBuilding((current) => ({
        ...current,
        address: query,
        selectionNote: '주소 입력값을 저장했습니다. 건물 polygon 검색 결과가 있으면 실제 건물 데이터로 갱신됩니다.',
      }));

      if (buildingPolygonSource === 'api' || buildingPolygonSource === 'none') {
        const message =
          buildingPolygonSource === 'api'
            ? '현재 API 모드는 지도 클릭 좌표 기반 조회만 지원합니다. 지도에서 해당 건물을 클릭해 주세요.'
            : '건물 polygon 데이터가 연결되어 있지 않습니다.';

        setAddressSearchStatus('error');
        setAddressSearchMessage(message);
        setSelectionFeedbackStatus('error');
        setSelectionFeedbackMessage(message);
        setGeometryQueryStatus('error');
        setGeometryQueryMessage(message);
        return;
      }

      if (!isBuildingPolygonDataReady) {
        const message = '건물 polygon 데이터가 아직 로드 중입니다. 잠시 뒤 다시 검색해주세요.';

        setAddressSearchStatus('error');
        setAddressSearchMessage(message);
        setSelectionFeedbackStatus('error');
        setSelectionFeedbackMessage(message);
        setGeometryQueryStatus('error');
        setGeometryQueryMessage(message);
        return;
      }

      const result = await searchBuildingFootprintsByText({
        query,
        collection: buildingFootprints,
        index: buildingFootprintLoadState.index,
      });

      setBuildingFootprintLoadState((current) => ({
        ...current,
        status: result.diagnostics.status,
        diagnostics: result.diagnostics,
        message: result.message,
      }));
      setSelectableBuildingPolygons(createSelectableBuildingPolygons(result.candidateFeatures));

      if (result.status !== 'found' || !result.match) {
        setAddressSearchStatus(result.status === 'error' ? 'error' : 'not_found');
        setAddressSearchMessage(result.message);
        setSelectionFeedbackStatus(result.status === 'error' ? 'error' : 'not_found');
        setSelectionFeedbackMessage(result.message);
        setGeometryQueryStatus(result.status === 'error' ? 'error' : 'not-found');
        setGeometryQueryMessage(result.message);
        setFeatureQueryDiagnostics({
          queryStatus: result.status === 'error' ? 'error' : 'not_found',
          featureCount: result.diagnostics.searchedFeatureCount,
          dataId: getBuildingSourceDataId(buildingPolygonSource),
          buffer: 0,
          requestPath: getBuildingSourceRequestPath(buildingPolygonSource, result.diagnostics),
          errorMessage: result.status === 'error' ? result.message : undefined,
        });
        return;
      }

      const polygon = normalizeGeoJsonPolygon(result.match.feature);

      if (!polygon) {
        const message = '검색된 건물에 표시 가능한 polygon 좌표가 없습니다.';

        setAddressSearchStatus('error');
        setAddressSearchMessage(message);
        setSelectionFeedbackStatus('error');
        setSelectionFeedbackMessage(message);
        setGeometryQueryStatus('error');
        setGeometryQueryMessage(message);
        return;
      }

      const coordinate = getPolygonCentroid(estimateRoofPolygonFromFootprint(polygon));

      applyBuildingFootprintSelection(result.match, coordinate, {
        longitude: coordinate[0],
        latitude: coordinate[1],
        source: 'address-search',
        method: 'text-search',
        clickPickStatus: 'success',
      });
      setAddressSearchStatus('found');
      setAddressSearchMessage(result.message);
      setFeatureQueryDiagnostics({
        queryStatus: 'success',
        featureCount: result.diagnostics.searchedFeatureCount,
        requestedLon: coordinate[0],
        requestedLat: coordinate[1],
        dataId: getBuildingSourceDataId(buildingPolygonSource),
        buffer: 0,
        requestPath: getBuildingSourceRequestPath(buildingPolygonSource, result.diagnostics),
      });
    },
    [
      applyBuildingFootprintSelection,
      buildingFootprintLoadState.index,
      buildingFootprints,
      buildingPolygonSource,
      isBuildingPolygonDataReady,
    ],
  );

  const handleAddressSearchSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void runAddressSearch(addressSearchText);
    },
    [addressSearchText, runAddressSearch],
  );

  useEffect(() => {
    if (hasAutoSearchedAddressRef.current || !addressSearchText.trim() || !isBuildingPolygonDataReady) {
      return;
    }

    hasAutoSearchedAddressRef.current = true;
    void runAddressSearch(addressSearchText);
  }, [addressSearchText, isBuildingPolygonDataReady, runAddressSearch]);

  const shouldSkipDuplicateSelection = useCallback((coordinate: Coordinate) => {
    const previousSelection = lastMapSelectionRef.current;

    if (!previousSelection || Date.now() - previousSelection.selectedAt > 450) {
      lastMapSelectionRef.current = {
        longitude: coordinate[0],
        latitude: coordinate[1],
        selectedAt: Date.now(),
      };
      return false;
    }

    const isSameArea =
      Math.abs(previousSelection.longitude - coordinate[0]) < 0.00006 &&
      Math.abs(previousSelection.latitude - coordinate[1]) < 0.00006;

    if (!isSameArea) {
      lastMapSelectionRef.current = {
        longitude: coordinate[0],
        latitude: coordinate[1],
        selectedAt: Date.now(),
      };
    }

    return isSameArea;
  }, []);

  const handleMapSelection = useCallback(async (selection?: VWorldSelection) => {
    const coordinate =
      typeof selection?.longitude === 'number' && typeof selection?.latitude === 'number'
        ? ([selection.longitude, selection.latitude] as Coordinate)
        : null;

    setAnalysisStatus('');
    setPvAnalysisStatus('idle');
    setPvAnalysisMessage('');
    setPvAnalysisResponse(null);
    setSelectionClickDiagnostics(createSelectionClickDiagnostics(selection, coordinate));

    if (!coordinate) {
      mapSelectionRequestIdRef.current += 1;
      setSelectionMode('screen-fallback');
      setGeometryQueryStatus('idle');
      setGeometryQueryMessage('지도 좌표가 없어 화면 기준 예시 배치를 표시합니다.');
      setSelectionFeedbackStatus('error');
      setSelectionFeedbackMessage('지도 좌표를 읽지 못했습니다. 지도를 확대하거나 다시 클릭해주세요.');
      setSelectedBuildingFootprint(null);
      setSelectedBuildingFeature(null);
      setSelectedBuildingGeometry(null);
      setSelectedRoofPolygon(null);
      setSelectableBuildingPolygons([]);
      setSolarPanelPolygons([]);
      setIsSolarPanelLayerVisible(false);
      panelVisibilityUserOverrideRef.current = false;
      setMapFocusStatus({
        message: '지도 좌표가 없어 시점 이동을 실행하지 못했습니다.',
        selectionSource: selection?.source,
        selectionMethod: selection?.method,
        moved: false,
        markerAdded: false,
      });
      setSelectedBuilding({
        ...demoBuilding,
        selectionNote: '선택 위치 기준 1차 추정입니다. 실제 건물 도형을 찾지 못해 화면 기준 예시 배치를 표시합니다.',
      });
      return;
    }

    if (shouldSkipDuplicateSelection(coordinate)) {
      return;
    }

    const selectionRequestId = mapSelectionRequestIdRef.current + 1;
    mapSelectionRequestIdRef.current = selectionRequestId;
    setSelectionFeedbackStatus('loading');
    setSelectionFeedbackMessage('건물 선택 중...');
    setLiveShadingStatus('idle');
    setLiveClimateStatus('idle');
    setLiveClimateStep('새 선택 건물 기준 라이브 분석 대기');
    setLiveClimateError('');
    setLiveClimateDiagnostics(null);
    setLiveClimateBundle(null);
    setLiveClimatePanelGeojson(null);
    setLiveBackendRoofPolygon4326(null);
    setAiSimulationResult(null);

    const dataId = getConfiguredVWorldBuildingDataId();
    const buffer = 10;
    const requestPath = buildVWorldFeatureProxyPath({
      longitude: coordinate[0],
      latitude: coordinate[1],
      dataId,
      bufferMeters: buffer,
    });

    setMapFocusStatus({
      message: '건물 polygon 매칭 후 선택 건물 중심으로 시점 이동합니다.',
      selectionSource: selection?.source,
      selectionMethod: selection?.method,
      moved: false,
      markerAdded: false,
    });
    if (!selectedBuildingFootprint) {
      setSelectionMode('coordinate-fallback');
    }
    setGeometryQueryStatus('loading');
    setGeometryQueryMessage(
      buildingPolygonSource === 'admdong_index'
        ? '행정동 index bbox로 후보 건물 파일을 찾고 있습니다.'
        : '브이월드 건물 도형을 조회하고 있습니다.',
    );
    setFeatureQueryDiagnostics({
      queryStatus: 'loading',
      featureCount: 0,
      dataId: buildingPolygonSource === 'admdong_index' ? getBuildingAdmdongIndexUrl() : dataId,
      requestedLon: coordinate[0],
      requestedLat: coordinate[1],
      buffer,
      requestPath: buildingPolygonSource === 'admdong_index' ? getBuildingAdmdongIndexUrl() : requestPath,
    });
    if (buildingPolygonSource === 'admdong_index') {
      setBuildingFootprintLoadState((current) => {
        const diagnostics = createBuildingFootprintDiagnostics({
          ...current.diagnostics,
          status: 'candidate_loading',
          candidateFileCount: 0,
          searchedFeatureCount: 0,
          matchedBuildingId: null,
          matchedAddress: null,
          selectedGeometryType: null,
          message: '행정동 index bbox 후보 파일을 확인하는 중입니다.',
        });

        return {
          ...current,
          status: 'candidate_loading',
          diagnostics,
          message: diagnostics.message,
        };
      });
    }
    if (!selectedBuildingFootprint) {
      clearRiskMapSelectionEntities(vworldMapRef.current);
      setSelectedBuildingFeature(null);
      setSelectedBuildingGeometry(null);
      setSelectedRoofPolygon(null);
      setSelectableBuildingPolygons([]);
      setSolarPanelPolygons([]);
      setIsSolarPanelLayerVisible(false);
      panelVisibilityUserOverrideRef.current = false;
    }

    const buildingPolygonResult = await requestSelectedBuildingPolygon({
      longitude: coordinate[0],
      latitude: coordinate[1],
      cameraHeightM: selection?.cameraHeightM,
    });

    if (mapSelectionRequestIdRef.current !== selectionRequestId) {
      return;
    }

    if (buildingPolygonResult.status === 'found') {
      const diagnostics = buildingPolygonResult.diagnostics;
      const candidateFeatures = buildingPolygonResult.candidateFeatures ?? [];
      setSelectableBuildingPolygons(createSelectableBuildingPolygons(candidateFeatures));

      applyBuildingFootprintSelection(
        {
          feature: {
            ...buildingPolygonResult.building.feature,
            properties: buildingPolygonResult.building.feature.properties ?? {},
          },
          metadata: {
            buildingId: buildingPolygonResult.building.id,
            address: buildingPolygonResult.building.address,
            name: buildingPolygonResult.building.name,
            geometryType: buildingPolygonResult.building.geometryType,
            selectionMode: diagnostics?.selectionMode ?? undefined,
            distanceMeters: diagnostics?.nearestDistanceM ?? null,
          },
        },
        coordinate,
        selection,
      );
      if (diagnostics) {
        setBuildingFootprintLoadState((current) => ({
          ...current,
          status: 'selected',
          url: diagnostics.indexUrl,
          diagnostics,
          message: diagnostics.message,
        }));
      }
      setFeatureDataInfo({
        dataId: getBuildingSourceDataId(buildingPolygonResult.building.source),
        dataTypeLabel: buildingPolygonResult.building.sourceLabel,
        isActualRoofPolygon: false,
        dataTypeNote:
          '건물 footprint 기반 옥상 추정입니다. 정밀 옥상·장애물 데이터가 아니므로 현장조사가 필요합니다.',
        sourceKind: 'building-or-roof',
      });
      setFeatureQueryDiagnostics({
        queryStatus: 'success',
        featureCount:
          buildingPolygonResult.building.source === 'admdong_index'
            ? diagnostics?.searchedFeatureCount ?? 0
            : buildingPolygonResult.building.source === 'geojson'
              ? buildingFootprintFeatureCountRef.current
              : 1,
        requestedLon: coordinate[0],
        requestedLat: coordinate[1],
        dataId: getBuildingSourceDataId(buildingPolygonResult.building.source),
        buffer: 0,
        requestPath: getBuildingSourceRequestPath(buildingPolygonResult.building.source, diagnostics),
      });
      return;
    }

    if (buildingPolygonResult.diagnostics) {
      setBuildingFootprintLoadState((current) => ({
        ...current,
        status: buildingPolygonResult.diagnostics?.status ?? 'error',
        url: buildingPolygonResult.diagnostics?.indexUrl ?? current.url,
        diagnostics: buildingPolygonResult.diagnostics ?? current.diagnostics,
        message: buildingPolygonResult.diagnostics?.message ?? buildingPolygonResult.message,
      }));
    }
    setSelectableBuildingPolygons(createSelectableBuildingPolygons(buildingPolygonResult.candidateFeatures ?? []));
    const fallbackMessage = selectedBuildingFootprint
      ? `${buildingPolygonResult.message} 기존 선택 건물은 유지했습니다.`
      : buildingPolygonResult.message;
    const userFacingFallbackMessage =
      buildingPolygonResult.status === 'not_found' ? SELECTION_NOT_FOUND_MESSAGE : fallbackMessage;
    setMapFocusStatus({
      message: selectedBuildingFootprint
        ? '건물 매칭 실패로 시점 이동을 건너뛰고 기존 선택을 유지했습니다.'
        : '건물 매칭 실패로 시점 이동을 실행하지 않았습니다.',
      selectionSource: selection?.source,
      selectionMethod: selection?.method,
      moved: false,
      markerAdded: false,
    });
    setGeometryQueryStatus(
      buildingPolygonResult.status === 'unconfigured'
        ? 'unconfigured'
        : buildingPolygonResult.status === 'not_found'
          ? 'not-found'
          : 'error',
    );
    setSelectionFeedbackStatus(buildingPolygonResult.status === 'not_found' ? 'not_found' : 'error');
    setSelectionFeedbackMessage(userFacingFallbackMessage);
    setGeometryQueryMessage(userFacingFallbackMessage);
    setFeatureDataInfo({
      dataId: getBuildingSourceDataId(buildingPolygonResult.source),
      dataTypeLabel: buildingPolygonResult.sourceLabel,
      isActualRoofPolygon: false,
      dataTypeNote:
        buildingPolygonResult.status === 'unconfigured'
          ? '화성시 건물 polygon 데이터가 아직 연결되지 않았습니다.'
          : '건물 footprint 기반 옥상 추정용 polygon을 선택하지 못했습니다.',
      sourceKind: 'building-or-roof',
    });
    setFeatureQueryDiagnostics({
      queryStatus: buildingPolygonResult.status === 'not_found' ? 'not_found' : 'error',
      featureCount:
        buildingPolygonResult.source === 'admdong_index'
          ? buildingPolygonResult.diagnostics?.searchedFeatureCount ?? 0
          : buildingPolygonResult.source === 'geojson'
            ? buildingFootprintFeatureCountRef.current
            : 0,
      requestedLon: coordinate[0],
      requestedLat: coordinate[1],
      dataId: getBuildingSourceDataId(buildingPolygonResult.source),
      buffer: 0,
      requestPath: getBuildingSourceRequestPath(buildingPolygonResult.source, buildingPolygonResult.diagnostics),
      errorMessage: buildingPolygonResult.status === 'error' ? buildingPolygonResult.message : undefined,
    });
    if (!selectedBuildingFootprint) {
      clearRiskMapSelectionEntities(vworldMapRef.current);
      setSelectedBuilding({
        ...demoBuilding,
        selectionNote: userFacingFallbackMessage,
        simulationConfidence: '건물 polygon 미선택',
        simulationNote: userFacingFallbackMessage,
      });
    }
    return;
  }, [applyBuildingFootprintSelection, buildingPolygonSource, selectedBuildingFootprint, shouldSkipDuplicateSelection]);

  const handleMapSelectionRef = useRef(handleMapSelection);

  useEffect(() => {
    handleMapSelectionRef.current = handleMapSelection;
  }, [handleMapSelection]);

  const handlePvAnalysisRequest = useCallback(async () => {
    if (!selectedCoordinate || selectionMode !== 'building_footprint') {
      setPvAnalysisStatus('error');
      setPvAnalysisMessage('화성시 건물 polygon을 선택한 뒤 발전량 분석을 실행해주세요.');
      setPvAnalysisResponse(null);
      return;
    }

    const panelCount =
      selectedBuilding.estimatedPanelCount > 0 ? selectedBuilding.estimatedPanelCount : PV_DEFAULT_PANEL_COUNT;
    // This API calculates generation/economic results, not building geometry.
    const input: PvAnalysisInput = {
      latitude: selectedCoordinate[1],
      longitude: selectedCoordinate[0],
      // shading_index_average currently comes from data team lookup / A4 output later.
      shading_index_average: PV_DEFAULT_SHADING_INDEX_AVERAGE,
      solar_panel_angle: PV_DEFAULT_PANEL_ANGLE,
      solar_panel_info: {
        panel_capacity: PV_DEFAULT_PANEL_CAPACITY_W,
        // panel_count should later come from real roof geometry and panel layout.
        panel_count: panelCount,
        panel_type: PV_DEFAULT_PANEL_TYPE,
      },
    };

    setPvAnalysisStatus('calculating');
    setPvAnalysisMessage('경기 기후 플랫폼 기준 발전량 분석을 요청하고 있습니다.');

    if (isClimateBackendPvBypassEnabled) {
      const selectedBuildingIdForPv = selectedBuildingId ?? selectedBuildingFootprint?.buildingId ?? 'demo-building';
      const selectedSessionIdForPv = selectedAnalysisSessionId ?? selectedBuildingFootprint?.analysisSessionId ?? 'manual-pv';
      const backendBaseUrl = configuredClimateBackendBaseUrl || '-';
      const backendBundle = liveClimateStatus === 'success' && liveClimateBundle ? liveClimateBundle : null;
      const backendPvResult = backendBundle
        ? createBackendPvAnalysisResponse({
            bundle: backendBundle,
            diagnostics: liveClimateDiagnostics,
            selectedBuildingId: selectedBuildingIdForPv,
            selectedAnalysisSessionId: selectedSessionIdForPv,
            roofSource: liveRoofSource ?? 'vworld-building-footprint-fallback',
            selectedFeatureBuildingId: null,
            backendBaseUrl,
            fallbackPanelCapacityW: PV_DEFAULT_PANEL_CAPACITY_W,
            fallbackPanelAngle: PV_DEFAULT_PANEL_ANGLE,
            fallbackPanelType: PV_DEFAULT_PANEL_TYPE,
          })
        : {
            status: 'local-fallback' as PvAnalysisStatus,
            response: {
              ok: false,
              fallback: true,
              source: 'frontend-local-formula',
              message: 'Render 백엔드 응답에 PV 출력이 없어 프론트엔드 시나리오 산식으로 발전량을 표시합니다.',
              selectedBuildingId: selectedBuildingIdForPv,
              selectedAnalysisSessionId: selectedSessionIdForPv,
              roofSource: liveRoofSource ?? 'vworld-building-footprint-fallback',
              selectedFeatureBuildingId: null,
              diagnostics: {
                requestSelectedBuildingId: selectedBuildingIdForPv,
                requestSessionId: selectedSessionIdForPv,
                ignoredStaleLiveResponse: false,
                pvAnalysisSource: 'frontend-local-formula',
                pvAnalysisStatus: 'local-fallback',
                usedVercelPvAnalysis: false,
                backendBaseUrl,
                panelCount: input.solar_panel_info.panel_count,
                installKw: roundDecimal((input.solar_panel_info.panel_capacity * input.solar_panel_info.panel_count) / 1000, 1),
                shadingAverage: input.shading_index_average,
                roofAreaM2: selectedBuilding.estimatedRoofAreaM2,
              },
              input: createSafePvInputSummary(input),
              result: createFrontendLocalPvFormulaResult(input),
            } satisfies PvAnalysisProxyResponse,
          };

      setPvAnalysisResponse(backendPvResult.response);
      setPvAnalysisStatus(backendPvResult.status);
      setPvAnalysisMessage(
        backendBundle?.pv_analysis_output
          ? '음영 분석은 Render 백엔드에서 완료되었습니다. 발전량은 백엔드 결과 또는 시나리오 산식으로 표시합니다.'
          : '발전량은 백엔드 결과 또는 시나리오 산식으로 표시합니다.',
      );
      return;
    }

    const rawResponse = await requestPvAnalysis(input);
    const response: PvAnalysisProxyResponse = rawResponse.ok
      ? {
          ...rawResponse,
          diagnostics: {
            ...(rawResponse.diagnostics ?? {}),
            pvAnalysisSource: rawResponse.source,
            pvAnalysisStatus: 'success',
            usedVercelPvAnalysis: true,
            backendBaseUrl: configuredClimateBackendBaseUrl,
          },
        }
      : {
          ...rawResponse,
          source: 'local-scenario-fallback',
          diagnostics: {
            ...(rawResponse.diagnostics ?? {}),
            pvAnalysisSource: 'local-scenario-fallback',
            pvAnalysisStatus: 'fallback',
            usedVercelPvAnalysis: true,
            backendBaseUrl: configuredClimateBackendBaseUrl,
          },
        };

    setPvAnalysisResponse(response);
    setPvAnalysisStatus(response.ok ? 'success' : 'fallback');
    setPvAnalysisMessage(
      response.ok
        ? '경기 기후 플랫폼 응답을 시나리오 기준 값으로 표시합니다.'
        : response.message,
    );
  }, [
    configuredClimateBackendBaseUrl,
    isClimateBackendPvBypassEnabled,
    liveClimateBundle,
    liveClimateDiagnostics,
    liveClimateStatus,
    liveRoofSource,
    selectedAnalysisSessionId,
    selectedBuilding.estimatedPanelCount,
    selectedBuildingFootprint,
    selectedBuildingId,
    selectedCoordinate,
    selectionMode,
  ]);

  const createCurrentStoredSimulationResult = useCallback(() => {
    const selectedAddress = selectedBuildingFootprint?.address ?? selectedBuilding.address;
    return buildStoredSimulationResult({
      building: {
        name: selectedBuildingFootprint?.name ?? selectedBuilding.apartmentName,
        roadAddress: selectedAddress,
        jibunAddress: selectedBuildingFootprint ? '지번 정보 확인 필요' : selectedBuilding.address,
        buildingId: selectedBuildingFootprint?.buildingId ?? 'demo-building',
      },
      liveClimateBundle:
        liveClimateStatus === 'success' && liveClimateBundle?.pv_analysis_output ? liveClimateBundle : null,
      aiSimulationResult: activeAiSimulationResult,
      pvAnalysisResult,
      selectedEstimate: {
        panelCount: selectedBuilding.estimatedPanelCount,
        installCapacityKw: selectedBuilding.estimatedCapacityKw,
        annualGenerationKwh: selectedBuilding.estimatedAnnualGenerationKwh,
        annualSavingKrw: selectedBuilding.estimatedAnnualSavingsKrw,
        paybackYears: selectedBuilding.estimatedPaybackYears,
        investmentKrw: overviewInvestmentKrw ?? undefined,
      },
    });
  }, [
    activeAiSimulationResult,
    liveClimateBundle,
    liveClimateStatus,
    overviewInvestmentKrw,
    pvAnalysisResult,
    selectedBuilding.address,
    selectedBuilding.apartmentName,
    selectedBuilding.estimatedAnnualGenerationKwh,
    selectedBuilding.estimatedAnnualSavingsKrw,
    selectedBuilding.estimatedCapacityKw,
    selectedBuilding.estimatedPanelCount,
    selectedBuilding.estimatedPaybackYears,
    selectedBuildingFootprint,
  ]);

  const handleResultDetailRequest = useCallback(() => {
    const result = createCurrentStoredSimulationResult();
    const didSave = saveSimulationResultToSession(result);

    setAnalysisStatus(
      didSave
        ? '현재 선택 건물과 최신 예상 분석 결과를 저장하고 결과 상세 화면으로 이동합니다.'
        : '브라우저 저장소를 사용할 수 없어 결과 화면에서 시나리오 기준 예시값을 표시합니다.',
    );
    window.location.assign('/simulation/result');
  }, [createCurrentStoredSimulationResult]);

  const handleAiSuitabilityReportRequest = useCallback(() => {
    const result = createCurrentStoredSimulationResult();
    const didSave = saveSimulationResultToSession(result);

    setAnalysisStatus(
      didSave
        ? 'AI 설치 적합도 화면으로 이동합니다.'
        : '브라우저 저장소를 사용할 수 없어 AI 설치 적합도 화면에서 예시값을 표시합니다.',
    );
    window.location.assign('/simulation/ai-suitability');
  }, [createCurrentStoredSimulationResult]);

  const handleProfitReportRequest = useCallback(async () => {
    if (!activeAiSimulationResult?.agentPayload?.reportInputMetrics) {
      setProfitReportStatus('error');
      setProfitReportMessage('AI 수익 리포트를 만들기 위한 분석 지표가 아직 없습니다. 먼저 발전량 분석을 실행해주세요.');
      return;
    }

    const result = createCurrentStoredSimulationResult();

    saveSimulationResultToSession(result);
    setProfitReportStatus('loading');
    setProfitReportMessage('AI 수익·보조금·금융 리포트를 생성하고 있습니다.');

    const response = await generateProfitReport({
      analysisResultId: result.analysisResultId,
      aiSimulationResult: result.aiSimulationResult ?? activeAiSimulationResult,
      agentPayload: result.agentPayload ?? activeAiSimulationResult.agentPayload,
    });

    if (response.ok) {
      saveProfitReportToSession({
        profitReportId: response.profitReportId,
        report: response.report,
        reportMarkdown: response.reportMarkdown,
        dbSaveStatus: response.dbSaveStatus,
      });
      setProfitReportStatus('success');
      setProfitReportMessage('AI 수익 리포트를 저장하고 리포트 화면으로 이동합니다.');
      window.location.assign('/simulation/profit-report');
      return;
    }

    setProfitReportStatus('error');
    setProfitReportMessage(response.message ?? 'AI 수익 리포트를 생성하지 못했습니다. 잠시 후 다시 시도해주세요.');
  }, [
    activeAiSimulationResult,
    createCurrentStoredSimulationResult,
  ]);

  const handleRiskAnalysisRequest = useCallback(async () => {
    setAnalysisStatus('선택 건물 기준 위험 분석과 발전량 분석을 함께 실행합니다.');
    setActiveTab('solar');
    await handlePvAnalysisRequest();
  }, [handlePvAnalysisRequest]);

  const handleClimatePanelModeChange = useCallback(
    (nextEnabled: boolean) => {
      setIsClimatePanelModeEnabled(nextEnabled);

      if (!nextEnabled) {
        setCameraMoveStatus(
          climatePocExtent
            ? 'climate.gg POC 패널 위치 계산 완료 · 토글이 꺼져 있습니다.'
            : 'climate.gg POC 패널 위치 계산 대기',
        );
        return;
      }

      setIsSolarPanelLayerVisible(true);
      panelVisibilityUserOverrideRef.current = false;
      climateFocusPocRef.current = null;
      void loadClimatePocAssets();
    },
    [climatePocExtent, loadClimatePocAssets],
  );

  const handleClimatePocCameraMove = useCallback(() => {
    if (!climatePocExtent) {
      setCameraMoveStatus('climatePocBbox 또는 climatePocCentroid가 아직 계산되지 않았습니다.');
      return;
    }

    const [longitude, latitude] = climatePocExtent.centroid;
    const focusResult = focusVWorldMapOnCoordinate(vworldMapRef.current, {
      longitude,
      latitude,
      height: getClimatePocFocusHeightM(climatePocExtent),
      pitch: -84,
    });
    const nextStatus = focusResult.moved
      ? `수동 이동 완료 · ${focusResult.method || 'camera'} · climatePocCentroid 기준`
      : `수동 이동 미완료 · ${focusResult.message}`;

    setCameraMoveStatus(nextStatus);
    setMapFocusStatus({
      message: focusResult.message,
      method: focusResult.method,
      selectionSource: 'climate.gg POC',
      selectionMethod: 'POC 위치로 이동',
      moved: focusResult.moved,
      markerAdded: false,
    });
  }, [climatePocExtent]);

  const handleLiveClimateAnalysisRequest = useCallback(async () => {
    if (!isClimateLiveBackendEnabled) {
      setLiveShadingStatus('fallback');
      setLiveClimateStatus('idle');
      setLiveClimateStep('별도 백엔드 서버 연동 대기');
      setLiveClimateError('climate.gg 라이브 분석은 별도 백엔드 서버 연동 예정입니다.');
      setIsSolarPanelLayerVisible(true);
      return;
    }

    if (!selectedCoordinate || !hasSelectedBuilding || !selectedBuildingFeature || !selectedBuildingId || !selectedAnalysisSessionId) {
      setLiveShadingStatus('fallback');
      setLiveClimateStatus('error');
      setLiveClimateStep('선택 건물 기준 좌표가 필요합니다.');
      setLiveClimateError('화성시 건물 polygon을 선택한 뒤 climate.gg 라이브 분석을 실행해주세요.');
      return;
    }

    const requestSelectedBuildingId = selectedBuildingId;
    const requestSessionId = createSelectedAnalysisSessionId(requestSelectedBuildingId);
    const requestSelectionId = mapSelectionRequestIdRef.current;
    const livePanelCapacityW = 640;
    const livePanelAngle = 35;
    const livePanelType = 1;
    const liveCellsPerPanel = 2;

    setSelectedBuildingFootprint((current) =>
      current && current.buildingId === requestSelectedBuildingId
        ? {
            ...current,
            analysisSessionId: requestSessionId,
          }
        : current,
    );
    selectedBuildingIdRef.current = requestSelectedBuildingId;
    selectedAnalysisSessionIdRef.current = requestSessionId;

    setLiveShadingStatus('trying');
    setLiveClimateStatus('loading');
    setLiveClimateStep('기본 분석 완료 · 음영 분석 시도 중');
    setLiveClimateError('');
    setLiveClimateDiagnostics(null);
    setLiveClimateBundle(null);
    setLiveClimatePanelGeojson(null);
    setLiveBackendRoofPolygon4326(null);
    setAiSimulationResult(null);
    setPvAnalysisStatus('idle');
    setPvAnalysisMessage('');
    setPvAnalysisResponse(null);

    setIsSolarPanelLayerVisible(true);

    const response = await runExternalClimateBackendAnalysis({
      longitude: selectedCoordinate[0],
      latitude: selectedCoordinate[1],
      selectedBuildingId: requestSelectedBuildingId,
      selectedAnalysisSessionId: requestSessionId,
      selectedBuildingFeature: selectedBuildingFeature as ClimateSelectedBuildingFeature,
      panelCapacityW: livePanelCapacityW,
      panelAngle: livePanelAngle,
      panelType: livePanelType,
      cellsPerPanel: liveCellsPerPanel,
      includePvAnalysis: false,
      mode: CLIMATE_LIVE_ANALYSIS_MODE,
    });
    const responseBuildingId = response.selectedBuildingId ?? response.diagnostics.requestSelectedBuildingId ?? requestSelectedBuildingId;
    const responseSessionId = response.selectedAnalysisSessionId ?? response.diagnostics.requestSessionId ?? requestSessionId;
    const currentBuildingId = selectedBuildingIdRef.current;
    const currentSessionId = selectedAnalysisSessionIdRef.current;
    const sameBuildingForBackendPanels = responseBuildingId === currentBuildingId;
    const backendIdentityDiagnostics: Partial<ClimateLiveAnalysisDiagnostics> = {
      staleBackendResponseIgnored: false,
      backendPanelsBuildingId: responseBuildingId,
      currentSelectedBuildingId: currentBuildingId,
      backendPanelsSessionId: responseSessionId,
      currentSessionId,
      sameBuildingForBackendPanels,
      requestSelectedBuildingId: responseBuildingId,
      requestSessionId: responseSessionId,
      ignoredStaleLiveResponse: false,
    };
    const isStaleResponse =
      mapSelectionRequestIdRef.current !== requestSelectionId ||
      responseBuildingId !== currentBuildingId ||
      (Boolean(responseSessionId) && responseSessionId !== currentSessionId);

    if (isStaleResponse) {
      setLiveClimateDiagnostics((current) => ({
        ...(current ?? {}),
        ...backendIdentityDiagnostics,
        ignoredStaleLiveResponse: true,
        staleBackendResponseIgnored: true,
        sameBuildingForBackendPanels: false,
      }));
      return;
    }

    if (!response.ok) {
      const fallbackReason = response.diagnostics.fallbackReason;
      const isNetworkFetchFailure =
        fallbackReason === 'climate-backend-fetch-error' ||
        fallbackReason === 'climate-backend-health-aborted' ||
        fallbackReason === 'climate-backend-post-aborted' ||
        fallbackReason === 'climate-backend-health-error' ||
        fallbackReason === 'climate-backend-unavailable';
      const fallbackMessage = response.disabled
        ? '백엔드 서버 연결은 성공했습니다. climate.gg 파이프라인은 다음 단계에서 연결됩니다.'
        : isNetworkFetchFailure
          ? 'climate.gg 백엔드에 연결할 수 없어 건물 footprint 기반 자체 배치와 프론트엔드 데모 산식으로 표시합니다.'
          : response.message || 'climate.gg 응답이 지연되어 기본 패널 배치를 표시합니다.';
      const fallbackPvInput: PvAnalysisInput = {
        latitude: selectedCoordinate[1],
        longitude: selectedCoordinate[0],
        shading_index_average: PV_DEFAULT_SHADING_INDEX_AVERAGE,
        solar_panel_angle: livePanelAngle,
        solar_panel_info: {
          panel_capacity: livePanelCapacityW,
          panel_count: selectedBuilding.estimatedPanelCount > 0 ? selectedBuilding.estimatedPanelCount : PV_DEFAULT_PANEL_COUNT,
          panel_type: livePanelType,
        },
      };
      const fallbackPvResponse: PvAnalysisProxyResponse = {
        ok: false,
        fallback: true,
        source: 'frontend-local-formula',
        message: '백엔드 응답 없이 프론트엔드 데모 산식으로 발전량을 표시합니다. 실제 공고와 현장조사 확인이 필요합니다.',
        selectedBuildingId: responseBuildingId,
        selectedAnalysisSessionId: responseSessionId,
        roofSource: response.roofSource ?? 'vworld-building-footprint-fallback',
        selectedFeatureBuildingId: response.selectedFeatureBuildingId ?? null,
        diagnostics: {
          ...response.diagnostics,
          ...backendIdentityDiagnostics,
          pvAnalysisSource: 'frontend-local-formula',
          pvAnalysisStatus: 'local-fallback',
          usedVercelPvAnalysis: false,
          backendBaseUrl: configuredClimateBackendBaseUrl || liveBackendBaseUrl,
          panelCount: fallbackPvInput.solar_panel_info.panel_count,
          installKw: roundDecimal(
            (fallbackPvInput.solar_panel_info.panel_capacity * fallbackPvInput.solar_panel_info.panel_count) / 1000,
            1,
          ),
          shadingAverage: fallbackPvInput.shading_index_average,
          roofAreaM2: response.roofAreaM2 ?? response.diagnostics.roofAreaM2 ?? selectedBuilding.estimatedRoofAreaM2,
        },
        input: createSafePvInputSummary(fallbackPvInput),
        result: createFrontendLocalPvFormulaResult(fallbackPvInput),
      };

      setLiveShadingStatus(
        response.analysisStage === 'shading-timeout' || response.diagnostics.timedOutStep ? 'timeout' : 'fallback',
      );
      setLiveClimateStatus('idle');
      setLiveClimateStep(
        response.disabled
          ? '백엔드 서버 연결 성공 · climate.gg 파이프라인 대기'
          : isNetworkFetchFailure
            ? '백엔드 연결 실패 · 자체 배치 표시'
            : '기본 배치 표시 중',
      );
      setLiveClimateError(fallbackMessage);
      setLiveClimateDiagnostics({
        ...response.diagnostics,
        ...backendIdentityDiagnostics,
      });
      setLiveBackendRoofPolygon4326(response.roofPolygon4326 ?? null);
      setPvAnalysisResponse(fallbackPvResponse);
      setPvAnalysisStatus('local-fallback');
      setPvAnalysisMessage(fallbackPvResponse.message);
      setAnalysisStatus(fallbackMessage);
      setIsSolarPanelLayerVisible(true);
      return;
    }

    const roofMatchDiagnostics = checkBackendRoofMatchesSelected({
      roofPolygon4326: response.roofPolygon4326 ?? response.bundle.roof_polygon_4326,
      selectedBuildingFeature,
    });
    const clippedPanelResult = filterBackendPanelsToSelectedFeature(response.panelsGeojson, selectedBuildingFeature);
    const backendAcceptanceDiagnostics: ClimateLiveAnalysisDiagnostics = {
      ...response.diagnostics,
      ...backendIdentityDiagnostics,
      roofSource: response.roofSource,
      roofAreaM2: response.roofAreaM2 ?? response.diagnostics.roofAreaM2,
      backendRoofCentroidInsideSelected: roofMatchDiagnostics.backendRoofCentroidInsideSelected,
      backendRoofDistanceToSelectedM: roofMatchDiagnostics.backendRoofDistanceToSelectedM,
      backendRoofMatchesSelected: roofMatchDiagnostics.backendRoofMatchesSelected,
      backendPanelCellCountBeforeClip: clippedPanelResult.backendPanelCellCountBeforeClip,
      backendPanelCellCountAfterClip: clippedPanelResult.backendPanelCellCountAfterClip,
      backendPanelCellsOutsideSelectedCount: clippedPanelResult.backendPanelCellsOutsideSelectedCount,
      panelCellCountAfterClip: clippedPanelResult.backendPanelCellCountAfterClip,
    };
    const backendPolygonMismatch =
      roofMatchDiagnostics.backendRoofMatchesSelected === false &&
      (roofMatchDiagnostics.backendRoofDistanceToSelectedM ?? Number.POSITIVE_INFINITY) >
        BACKEND_ROOF_MATCH_DISTANCE_THRESHOLD_M;
    const backendMismatchMessage = '백엔드 분석 polygon이 선택 건물과 다르게 감지되어 표시하지 않았습니다.';

    setLiveBackendRoofPolygon4326(response.roofPolygon4326 ?? response.bundle.roof_polygon_4326 ?? null);

    if (backendPolygonMismatch || clippedPanelResult.backendPanelCellCountAfterClip === 0) {
      const fallbackMessage =
        backendPolygonMismatch
          ? backendMismatchMessage
          : '백엔드 패널 셀이 선택 건물 footprint 내부에 없어 자체 배치를 표시합니다.';

      setLiveShadingStatus('fallback');
      setLiveClimateStatus('idle');
      setLiveClimateStep('백엔드 polygon 검증 실패 · 자체 배치 표시');
      setLiveClimateError(fallbackMessage);
      setLiveClimateDiagnostics(backendAcceptanceDiagnostics);
      setLiveClimateBundle(null);
      setLiveClimatePanelGeojson(null);
      setAiSimulationResult(null);
      setPvAnalysisStatus('idle');
      setPvAnalysisMessage(fallbackMessage);
      setAnalysisStatus(fallbackMessage);
      setIsSolarPanelLayerVisible(true);
      return;
    }

    {
    const backendCompletionMessage =
      '음영 분석은 Render 백엔드에서 완료되었습니다. 발전량은 백엔드 결과 또는 시나리오 산식으로 표시합니다.';
    const backendPvResult = createBackendPvAnalysisResponse({
      bundle: response.bundle,
      diagnostics: response.diagnostics,
      selectedBuildingId: responseBuildingId,
      selectedAnalysisSessionId: responseSessionId,
      roofSource: response.roofSource,
      selectedFeatureBuildingId: response.selectedFeatureBuildingId ?? null,
      backendBaseUrl: configuredClimateBackendBaseUrl || liveBackendBaseUrl,
      fallbackPanelCapacityW: livePanelCapacityW,
      fallbackPanelAngle: livePanelAngle,
      fallbackPanelType: livePanelType,
    });
    const nextPvResponse = backendPvResult.response;
    const nextAiSimulationResult: SimulationAiResult | null = isSimulationAiResult(response.aiSimulationResult)
      ? response.aiSimulationResult ?? null
      : isSimulationAiResult(response.bundle.ai_simulation_result)
        ? response.bundle.ai_simulation_result ?? null
        : null;

    setLiveShadingStatus('success');
    setLiveClimateStatus('success');
    setLiveClimateStep('음영 분석은 Render 백엔드에서 완료되었습니다.');
    setLiveClimateError(
      clippedPanelResult.backendPanelCellsOutsideSelectedCount > 0
        ? `선택 건물 밖으로 감지된 백엔드 셀 ${clippedPanelResult.backendPanelCellsOutsideSelectedCount.toLocaleString(
            'ko-KR',
          )}개를 제외하고 표시합니다.`
        : '',
    );
    setLiveClimateDiagnostics({
      ...backendAcceptanceDiagnostics,
      pvAnalysisSource: nextPvResponse.diagnostics?.pvAnalysisSource,
      pvAnalysisStatus: backendPvResult.status,
      usedVercelPvAnalysis: false,
      backendBaseUrl: configuredClimateBackendBaseUrl || liveBackendBaseUrl,
    });
    setLiveClimateBundle(response.bundle);
    setLiveClimatePanelGeojson(clippedPanelResult.panelsGeojson);
    setAiSimulationResult(nextAiSimulationResult);
    setIsSolarPanelLayerVisible(true);
    setPvAnalysisResponse(nextPvResponse);
    setPvAnalysisStatus(backendPvResult.status);
    setPvAnalysisMessage(backendCompletionMessage);

    const storedResult = buildStoredSimulationResult({
      building: {
        name: selectedBuildingFootprint?.name ?? selectedBuilding.apartmentName,
        roadAddress: selectedBuildingFootprint?.address ?? selectedBuilding.address,
        jibunAddress: selectedBuildingFootprint ? '지번 정보 확인 필요' : selectedBuilding.address,
        buildingId: selectedBuildingFootprint?.buildingId ?? 'demo-building',
      },
      liveClimateBundle: response.bundle.pv_analysis_output ? response.bundle : null,
      aiSimulationResult: nextAiSimulationResult,
      analysisResultId: response.analysisResultId ?? response.bundle.analysisResultId ?? response.bundle.analysis_result_id ?? null,
      dbSaveStatus: response.dbSaveStatus ?? response.bundle.dbSaveStatus ?? null,
      pvAnalysisResult: nextPvResponse.result,
      selectedEstimate: {
        panelCount: selectedBuilding.estimatedPanelCount,
        installCapacityKw: selectedBuilding.estimatedCapacityKw,
        annualGenerationKwh: selectedBuilding.estimatedAnnualGenerationKwh,
        annualSavingKrw: selectedBuilding.estimatedAnnualSavingsKrw,
        paybackYears: selectedBuilding.estimatedPaybackYears,
      },
    });

    saveSimulationResultToSession(storedResult);
    setAnalysisStatus(backendCompletionMessage);
    return;
    }

    const legacyLiveResponse = response as {
      bundle: ClimateBundle;
      panelsGeojson: ClimatePanelsGeoJson;
    };
    const legacyAiSimulationResult: SimulationAiResult | null = isSimulationAiResult(response.aiSimulationResult)
      ? response.aiSimulationResult ?? null
      : isSimulationAiResult(legacyLiveResponse.bundle.ai_simulation_result)
        ? legacyLiveResponse.bundle.ai_simulation_result ?? null
        : null;

    const liveCompletionMessage = 'AI 음영 분석 완료';
    const pvInput: PvAnalysisInput = {
      latitude: legacyLiveResponse.bundle.pv_analysis_input.latitude,
      longitude: legacyLiveResponse.bundle.pv_analysis_input.longitude,
      shading_index_average: legacyLiveResponse.bundle.pv_analysis_input.shading_index_average,
      solar_panel_angle: Number(legacyLiveResponse.bundle.pv_analysis_input.solar_panel_angle) || livePanelAngle,
      solar_panel_info: {
        panel_capacity: legacyLiveResponse.bundle.pv_analysis_input.solar_panel_info.panel_capacity,
        panel_count: legacyLiveResponse.bundle.pv_analysis_input.solar_panel_info.panel_count,
        panel_type: legacyLiveResponse.bundle.pv_analysis_input.solar_panel_info.panel_type,
      },
    };
    const interimScenarioResponse: PvAnalysisProxyResponse = {
      ok: false,
      fallback: true,
      message: '발전량은 별도 계산 중입니다. 결과 상세보기에는 시나리오 산식 값을 우선 사용합니다.',
      selectedBuildingId: responseBuildingId,
      selectedAnalysisSessionId: responseSessionId,
      roofSource: response.roofSource,
      selectedFeatureBuildingId: response.selectedFeatureBuildingId ?? null,
      diagnostics: {
        requestSelectedBuildingId: responseBuildingId,
        requestSessionId: responseSessionId,
        ignoredStaleLiveResponse: false,
      },
      input: createSafePvInputSummary(pvInput),
      result: createLivePvScenarioFallbackResult(pvInput),
    };

    setLiveShadingStatus('success');
    setLiveClimateStatus('success');
    setLiveClimateStep(liveCompletionMessage);
    setLiveClimateError('');
    setLiveClimateDiagnostics(response.diagnostics);
    setLiveClimateBundle(legacyLiveResponse.bundle);
    setLiveClimatePanelGeojson(legacyLiveResponse.panelsGeojson);
    setAiSimulationResult(legacyAiSimulationResult);
    setIsSolarPanelLayerVisible(true);
    setPvAnalysisStatus('calculating');
    setPvAnalysisMessage('발전량 계산 중...');
    setPvAnalysisResponse(interimScenarioResponse);
    setAnalysisStatus(`${liveCompletionMessage} · 발전량은 별도 계산 중`);

    const pvResponse = interimScenarioResponse;
    const isPvStaleResponse =
      mapSelectionRequestIdRef.current !== requestSelectionId ||
      responseBuildingId !== selectedBuildingIdRef.current ||
      responseSessionId !== selectedAnalysisSessionIdRef.current;

    if (isPvStaleResponse) {
      return;
    }

    const nextPvResponse: PvAnalysisProxyResponse = pvResponse.ok
      ? {
          ...pvResponse,
          selectedBuildingId: responseBuildingId,
          selectedAnalysisSessionId: responseSessionId,
          roofSource: response.roofSource,
          selectedFeatureBuildingId: response.selectedFeatureBuildingId ?? null,
          diagnostics: {
            ...(pvResponse.diagnostics ?? {}),
            requestSelectedBuildingId: responseBuildingId,
            requestSessionId: responseSessionId,
            ignoredStaleLiveResponse: false,
          },
        }
      : {
          ok: false,
          fallback: true,
          message: '발전량 API 응답 지연으로 시나리오 산식을 사용했습니다.',
          selectedBuildingId: responseBuildingId,
          selectedAnalysisSessionId: responseSessionId,
          roofSource: response.roofSource,
          selectedFeatureBuildingId: response.selectedFeatureBuildingId ?? null,
          diagnostics: {
            ...(pvResponse.diagnostics ?? {}),
            requestSelectedBuildingId: responseBuildingId,
            requestSessionId: responseSessionId,
            ignoredStaleLiveResponse: false,
          },
          input: createSafePvInputSummary(pvInput),
          result: createLivePvScenarioFallbackResult(pvInput),
        };

    setPvAnalysisResponse(nextPvResponse);
    setPvAnalysisStatus(nextPvResponse.ok ? 'success' : 'fallback');
    setPvAnalysisMessage(
      nextPvResponse.ok
        ? '발전량 계산 완료 · 경기 기후 플랫폼 응답을 예상/추정 값으로 표시합니다.'
        : ((nextPvResponse as { message?: string }).message ?? ''),
    );

    const storedResult = buildStoredSimulationResult({
      building: {
        name: selectedBuildingFootprint?.name ?? selectedBuilding.apartmentName,
        roadAddress: selectedBuildingFootprint?.address ?? selectedBuilding.address,
        jibunAddress: selectedBuildingFootprint ? '지번 정보 확인 필요' : selectedBuilding.address,
        buildingId: selectedBuildingFootprint?.buildingId ?? 'demo-building',
      },
      liveClimateBundle: legacyLiveResponse.bundle.pv_analysis_output ? legacyLiveResponse.bundle : null,
      aiSimulationResult: legacyAiSimulationResult,
      pvAnalysisResult: nextPvResponse.result,
      selectedEstimate: {
        panelCount: selectedBuilding.estimatedPanelCount,
        installCapacityKw: selectedBuilding.estimatedCapacityKw,
        annualGenerationKwh: selectedBuilding.estimatedAnnualGenerationKwh,
        annualSavingKrw: selectedBuilding.estimatedAnnualSavingsKrw,
        paybackYears: selectedBuilding.estimatedPaybackYears,
      },
    });

    saveSimulationResultToSession(storedResult);
    setAnalysisStatus(
      nextPvResponse.ok
        ? '음영 분석과 발전량 계산이 완료되었습니다. 결과는 예상/추정 값입니다.'
        : '음영 분석은 완료되었고, 발전량은 API 응답 지연으로 시나리오 산식을 사용했습니다.',
    );
  }, [
    configuredClimateBackendBaseUrl,
    hasSelectedBuilding,
    isClimateLiveBackendEnabled,
    liveBackendBaseUrl,
    selectedAnalysisSessionId,
    selectedBuilding.address,
    selectedBuilding.apartmentName,
    selectedBuilding.estimatedAnnualGenerationKwh,
    selectedBuilding.estimatedAnnualSavingsKrw,
    selectedBuilding.estimatedCapacityKw,
    selectedBuilding.estimatedPanelCount,
    selectedBuilding.estimatedPaybackYears,
    selectedBuilding.estimatedRoofAreaM2,
    selectedBuildingFeature,
    selectedBuildingId,
    selectedBuildingFootprint,
    selectedCoordinate,
  ]);

  const updateSelectionInputDiagnostics = useCallback(
    (
      diagnostics: Partial<
        Pick<SelectionClickDiagnostics, 'lastPointerMovePx' | 'lastSelectionIgnoredBecauseDrag'>
      >,
    ) => {
      const currentInputDiagnostics = readMapInputDiagnostics();
      const nextInputDiagnostics = {
        ...currentInputDiagnostics,
        ...diagnostics,
        cameraControlMode: MAP_CAMERA_CONTROL_MODE,
      };

      window.__solarMateMapDiagnostics = {
        ...(window.__solarMateMapDiagnostics ?? {}),
        selectionInputControls: nextInputDiagnostics,
      };

      setSelectionClickDiagnostics((current) => ({
        ...current,
        ...nextInputDiagnostics,
      }));
    },
    [],
  );

  const suppressMapLeftDragClick = useCallback(
    (movePx: number) => {
      if (!MAP_LEFT_CLICK_SELECT_ONLY) {
        return;
      }

      const roundedMovePx = Math.round(movePx * 10) / 10;

      mapTouchGestureRef.current.suppressClickUntil = Date.now() + TOUCH_GESTURE_SUPPRESS_CLICK_MS;
      mapTouchGestureRef.current.lastPointerMovePx = roundedMovePx;
      mapTouchGestureRef.current.lastSelectionIgnoredBecauseDrag = true;
      updateSelectionInputDiagnostics({
        lastPointerMovePx: roundedMovePx,
        lastSelectionIgnoredBecauseDrag: true,
      });
    },
    [updateSelectionInputDiagnostics],
  );

  const isMapShellClickSuppressed = useCallback(() => {
    const gesture = mapTouchGestureRef.current;
    const isSuppressed = Date.now() < gesture.suppressClickUntil;

    if (isSuppressed && gesture.lastSelectionIgnoredBecauseDrag) {
      updateSelectionInputDiagnostics({
        lastPointerMovePx: gesture.lastPointerMovePx,
        lastSelectionIgnoredBecauseDrag: true,
      });
    }

    return isSuppressed;
  }, [updateSelectionInputDiagnostics]);

  const handleMapShellClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (isMapShellClickSuppressed()) {
        return;
      }

      if (MAP_LEFT_CLICK_SELECT_ONLY && event.button !== 0) {
        return;
      }

      const targetElement = event.target instanceof Element ? event.target : null;

      if (
        targetElement?.closest('.mapControlOverlay') ||
        targetElement?.closest('.riskLegend')
      ) {
        return;
      }

      const startedAt = Date.now();
      const nativeEvent = event.nativeEvent;

      window.setTimeout(() => {
        if (lastMapSelectionRef.current && lastMapSelectionRef.current.selectedAt >= startedAt) {
          return;
        }

        const selection = createVWorldSelectionFromMouseEvent(
          vworldMapRef.current,
          nativeEvent,
          'react.mapShell.clickCapture',
        );

        if (typeof selection.longitude !== 'number' || typeof selection.latitude !== 'number') {
          return;
        }

        void handleMapSelection(selection);
      }, 120);
    },
    [handleMapSelection, isMapShellClickSuppressed],
  );

  const suppressMapTouchClick = useCallback(() => {
    mapTouchGestureRef.current.suppressClickUntil = Date.now() + TOUCH_GESTURE_SUPPRESS_CLICK_MS;
  }, []);

  const handleMapPointerDownCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (MAP_LEFT_CLICK_SELECT_ONLY && event.pointerType === 'mouse' && event.button === 0) {
      mapTouchGestureRef.current.activeLeftPointer = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startedAt: Date.now(),
        maxMovePx: 0,
      };
      mapTouchGestureRef.current.lastPointerMovePx = 0;
      mapTouchGestureRef.current.lastSelectionIgnoredBecauseDrag = false;
      updateSelectionInputDiagnostics({
        lastPointerMovePx: 0,
        lastSelectionIgnoredBecauseDrag: false,
      });
      return;
    }

    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') {
      return;
    }

    const gesture = mapTouchGestureRef.current;
    gesture.activePointers.set(event.pointerId, {
      startX: event.clientX,
      startY: event.clientY,
      maxMovePx: 0,
    });
    gesture.wasMultiTouchGesture = gesture.wasMultiTouchGesture || gesture.activePointers.size > 1;
  }, [updateSelectionInputDiagnostics]);

  const handleMapPointerMoveCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const gesture = mapTouchGestureRef.current;
      const leftPointer = gesture.activeLeftPointer;

      if (leftPointer?.pointerId === event.pointerId) {
        const movePx = Math.hypot(event.clientX - leftPointer.startX, event.clientY - leftPointer.startY);
        leftPointer.maxMovePx = Math.max(leftPointer.maxMovePx, movePx);
        gesture.lastPointerMovePx = Math.round(leftPointer.maxMovePx * 10) / 10;

        if (leftPointer.maxMovePx > LEFT_CLICK_SELECT_MAX_MOVE_PX) {
          suppressMapLeftDragClick(leftPointer.maxMovePx);
        }

        return;
      }

      const pointer = gesture.activePointers.get(event.pointerId);

      if (!pointer) {
        return;
      }

      const movePx = Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY);
      pointer.maxMovePx = Math.max(pointer.maxMovePx, movePx);

      if (pointer.maxMovePx > TOUCH_TAP_MAX_MOVE_PX || gesture.activePointers.size > 1) {
        suppressMapTouchClick();
      }
    },
    [suppressMapLeftDragClick, suppressMapTouchClick],
  );

  const handleMapPointerUpCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const gesture = mapTouchGestureRef.current;
      const leftPointer = gesture.activeLeftPointer;

      if (leftPointer?.pointerId === event.pointerId) {
        const movePx = Math.hypot(event.clientX - leftPointer.startX, event.clientY - leftPointer.startY);
        leftPointer.maxMovePx = Math.max(leftPointer.maxMovePx, movePx);
        gesture.lastPointerMovePx = Math.round(leftPointer.maxMovePx * 10) / 10;

        if (leftPointer.maxMovePx > LEFT_CLICK_SELECT_MAX_MOVE_PX) {
          suppressMapLeftDragClick(leftPointer.maxMovePx);
        } else {
          gesture.lastSelectionIgnoredBecauseDrag = false;
          updateSelectionInputDiagnostics({
            lastPointerMovePx: gesture.lastPointerMovePx,
            lastSelectionIgnoredBecauseDrag: false,
          });
        }

        gesture.activeLeftPointer = null;
        return;
      }

      const pointer = gesture.activePointers.get(event.pointerId);

      if (pointer && (pointer.maxMovePx > TOUCH_TAP_MAX_MOVE_PX || gesture.wasMultiTouchGesture)) {
        suppressMapTouchClick();
      }

      gesture.activePointers.delete(event.pointerId);

      if (gesture.activePointers.size === 0) {
        gesture.wasMultiTouchGesture = false;
      }
    },
    [suppressMapLeftDragClick, suppressMapTouchClick, updateSelectionInputDiagnostics],
  );

  useEffect(() => {
    let isMounted = true;
    const indexUrl = getBuildingAdmdongIndexUrl();
    const metaUrl = getBuildingMetaUrl();
    const buildingDataBaseUrl = getBuildingDataBaseUrl(indexUrl);

    setBuildingDataHealth({
      buildingIndexStatus: 'loading',
      buildingMetaStatus: 'loading',
      buildingIndexEntryCount: 0,
      buildingDataBaseUrl,
      indexUrl,
      metaUrl,
      message: '건물 polygon 데이터 경로를 확인하는 중입니다.',
    });

    const loadIndexHealth = fetch(indexUrl)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`index fetch failed: ${response.status}`);
        }

        return readBuildingIndexEntryCount(await response.json());
      })
      .then((entryCount) => ({ status: 'ok' as const, entryCount, message: '' }))
      .catch((error: unknown) => ({
        status: 'error' as const,
        entryCount: 0,
        message: error instanceof Error ? error.message : 'index fetch failed',
      }));

    const loadMetaHealth = fetch(metaUrl)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`meta fetch failed: ${response.status}`);
        }

        await response.json().catch(() => null);
        return { status: 'ok' as const, message: '' };
      })
      .catch((error: unknown) => ({
        status: 'error' as const,
        message: error instanceof Error ? error.message : 'meta fetch failed',
      }));

    Promise.all([loadIndexHealth, loadMetaHealth]).then(([indexHealth, metaHealth]) => {
      if (!isMounted) {
        return;
      }

      const hasIndexError = indexHealth.status === 'error';
      const message = hasIndexError
        ? BUILDING_DATA_HEALTH_ERROR_MESSAGE
        : `건물 polygon 데이터 확인 완료: index ${indexHealth.entryCount.toLocaleString('ko-KR')}개 항목`;

      setBuildingDataHealth({
        buildingIndexStatus: indexHealth.status,
        buildingMetaStatus: metaHealth.status,
        buildingIndexEntryCount: indexHealth.entryCount,
        buildingDataBaseUrl,
        indexUrl,
        metaUrl,
        message,
      });

      if (hasIndexError) {
        setSelectionFeedbackStatus('error');
        setSelectionFeedbackMessage(BUILDING_DATA_HEALTH_ERROR_MESSAGE);
        setGeometryQueryStatus('error');
        setGeometryQueryMessage(BUILDING_DATA_HEALTH_ERROR_MESSAGE);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (isBuildingAdmdongIndexEnabled()) {
      let isMounted = true;
      const url = getBuildingAdmdongIndexUrl();
      const message = '행정동 분할 건물 index.json을 불러오는 중입니다.';
      const loadingDiagnostics = createBuildingFootprintDiagnostics({
        status: 'index_loading',
        indexUrl: url,
        metaUrl: getBuildingMetaUrl(),
        message,
      });

      setBuildingFootprints(null);
      setBuildingFootprintLoadState({
        status: 'index_loading',
        url,
        collection: null,
        index: null,
        diagnostics: loadingDiagnostics,
        message,
      });
      setFeatureDataInfo({
        dataId: url,
        dataTypeLabel: getBuildingPolygonSourceLabel('admdong_index'),
        isActualRoofPolygon: false,
        dataTypeNote:
          '건물 footprint 기반 옥상 추정입니다. 정밀 옥상·장애물 데이터가 아니므로 현장조사가 필요합니다.',
        sourceKind: 'building-or-roof',
      });

      loadBuildingFootprintIndex(url)
        .then((index) => {
          if (!isMounted) {
            return;
          }

          const loadedMessage = `행정동 분할 건물 index 로드 완료: ${index.entries.length.toLocaleString('ko-KR')}개 항목`;
          const diagnostics = createBuildingFootprintDiagnostics({
            status: 'index_loaded',
            indexLoaded: true,
            indexEntryCount: index.entries.length,
            indexUrl: url,
            metaUrl: getBuildingMetaUrl(),
            message: loadedMessage,
          });

          setBuildingFootprintLoadState({
            status: 'index_loaded',
            url,
            collection: null,
            index,
            diagnostics,
            message: loadedMessage,
          });
        })
        .catch((error: unknown) => {
          if (!isMounted) {
            return;
          }

          const errorMessage =
            error instanceof Error ? error.message : '행정동 분할 건물 index.json을 불러오거나 검증하지 못했습니다.';
          const diagnostics = createBuildingFootprintDiagnostics({
            status: 'error',
            indexUrl: url,
            metaUrl: getBuildingMetaUrl(),
            message: errorMessage,
          });

          setBuildingFootprintLoadState({
            status: 'error',
            url,
            collection: null,
            index: null,
            diagnostics,
            message: errorMessage,
          });
        });

      return () => {
        isMounted = false;
      };
    }

    if (getConfiguredBuildingPolygonSource() !== 'geojson') {
      return undefined;
    }

    let isMounted = true;
    const url = getBuildingFootprintGeoJsonUrl();
    const message = '건물 footprint GeoJSON을 불러오는 중입니다.';
    const loadingDiagnostics = createBuildingFootprintDiagnostics({
      sourceMode: 'geojson',
      status: 'candidate_loading',
      message,
    });

    setBuildingFootprintLoadState({
      status: 'candidate_loading',
      url,
      collection: null,
      index: null,
      diagnostics: loadingDiagnostics,
      message,
    });

    loadBuildingFootprints(url)
      .then((collection) => {
        if (!isMounted) {
          return;
        }

        setBuildingFootprints(collection);
        const loadedMessage = `건물 footprint GeoJSON 로드 완료: ${collection.features.length.toLocaleString('ko-KR')}개 feature`;
        const diagnostics = createBuildingFootprintDiagnostics({
          sourceMode: 'geojson',
          status: 'index_loaded',
          indexLoaded: true,
          indexEntryCount: 1,
          searchedFeatureCount: collection.features.length,
          message: loadedMessage,
        });

        setBuildingFootprintLoadState({
          status: 'index_loaded',
          url,
          collection,
          index: null,
          diagnostics,
          message: loadedMessage,
        });
      })
      .catch((error: unknown) => {
        if (!isMounted) {
          return;
        }

        setBuildingFootprints(null);
        const errorMessage =
          error instanceof Error
            ? error.message
            : '건물 footprint GeoJSON을 불러오거나 검증하지 못했습니다.';
        const diagnostics = createBuildingFootprintDiagnostics({
          sourceMode: 'geojson',
          status: 'error',
          message: errorMessage,
        });

        setBuildingFootprintLoadState({
          status: 'error',
          url,
          collection: null,
          index: null,
          diagnostics,
          message: errorMessage,
        });
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    let controller: VWorldMapController | null = null;

    setMapStatus('loading');
    setMapErrorMessage('브이월드 3D 지도 로드에 실패했습니다. API 키, SDK URL, 허용 도메인을 확인해주세요.');

    loadVWorldScript()
      .then(() => {
        if (!isMounted) {
          return;
        }

        controller = initVWorld3DMap({
          mapId: MAP_CONTAINER_ID,
          onSelect: (selection) => {
            void handleMapSelectionRef.current(selection);
          },
        });
        vworldMapRef.current = controller.map;
        setVworldMap(controller.map);
        setMapStatus('ready');
      })
      .catch((error: unknown) => {
        if (isMounted) {
          setMapErrorMessage(
            error instanceof Error
              ? error.message
              : '브이월드 3D 지도 로드에 실패했습니다. API 키, SDK URL, 허용 도메인을 확인해주세요.',
          );
          setMapStatus('error');
        }
      });

    return () => {
      isMounted = false;
      vworldMapRef.current = null;
      setVworldMap(null);
      controller?.dispose();
    };
  }, []);

  return (
    <main className="riskMapPage">
      <SolarMateHeader />

      <section className="riskMapWorkspace" aria-label="전기세 위험 지도 작업 영역">
        <div className="riskMapCanvasColumn">
          <div
            className={`vworldMapShell ${isSolarPanelLayerVisible ? 'isSolarMode' : ''}`}
            onPointerDownCapture={handleMapPointerDownCapture}
            onPointerMoveCapture={handleMapPointerMoveCapture}
            onPointerUpCapture={handleMapPointerUpCapture}
            onPointerCancelCapture={handleMapPointerUpCapture}
            onClickCapture={handleMapShellClickCapture}
            onClick={(event) => {
              if (isMapShellClickSuppressed()) {
                event.preventDefault();
                event.stopPropagation();
                return;
              }

              if (event.target === event.currentTarget) {
                void handleMapSelection();
              }
            }}
            onContextMenu={(event) => {
              if (MAP_LEFT_CLICK_SELECT_ONLY) {
                event.preventDefault();
              }
            }}
            role="presentation"
          >
            <div
              className="mapControlOverlay"
              aria-label="지도 검색 및 필터"
              onClick={(event) => event.stopPropagation()}
            >
              <form className="mapSearchForm" onSubmit={handleAddressSearchSubmit}>
                <label>
                  <span>주소 또는 아파트명 검색</span>
                  <input
                    type="search"
                    value={addressSearchText}
                    placeholder="예: 화성시 동탄구 반송동 88-12"
                    onChange={handleAddressSearchChange}
                  />
                </label>
                <button type="submit" disabled={addressSearchStatus === 'searching'}>
                  {addressSearchStatus === 'searching' ? '검색 중' : '검색'}
                </button>
                {addressSearchMessage && (
                  <p className={`mapSearchMessage is-${addressSearchStatus}`} role={addressSearchStatus === 'error' ? 'alert' : 'status'}>
                    {addressSearchMessage}
                  </p>
                )}
              </form>

              <label>
                <span>지역 선택</span>
                <select defaultValue="hwaseong">
                  <option value="hwaseong">화성시</option>
                  <option value="dongtan">화성시 동탄권</option>
                  <option value="bongdam">화성시 봉담권</option>
                  <option value="namyang">화성시 남양권</option>
                </select>
              </label>

              <label>
                <span>위험 등급 필터</span>
                <select defaultValue="all">
                  <option value="all">전체</option>
                  <option value="low">낮음</option>
                  <option value="medium">보통</option>
                  <option value="high">높음</option>
                  <option value="critical">위험 높음</option>
                </select>
              </label>

              {MAP_LEFT_CLICK_SELECT_ONLY && (
                <div className="mapMouseHint" role="note">
                  왼쪽 클릭: 건물 선택 · 오른쪽 드래그: 지도 이동 · 휠: 확대/축소
                </div>
              )}
            </div>

            <div id={MAP_CONTAINER_ID} className="vworldMapCanvas" aria-label="브이월드 3D 지도" />

            <VWorldSelectableBuildingLayer
              map={vworldMap}
              isActive={buildingPolygonSource === 'admdong_index'}
              polygons={nearbySelectableBuildingPolygons}
              onStatusChange={setSelectableLayerStatus}
            />

            <VWorldSelectedBuildingLayer
              map={vworldMap}
              isActive={hasActualSelectedBuildingGeometry}
              polygon={selectedBuildingGeometry}
              roofHeightM={roofHeightEstimate.roofHeightM}
              onStatusChange={setSelectedBuildingLayerStatus}
            />

            <VWorldSolarPanelLayer
              map={vworldMap}
              visible={shouldRenderGeneratedPanelLayer}
              selectedBuildingFeature={selectedBuildingFeature}
              selectedBuildingId={selectedBuildingId}
              selectedAnalysisSessionId={selectedAnalysisSessionId}
              panelSource="self"
              selectedBuildingCentroid={selectedBuildingCentroid}
              panelPolygons={solarPanelPolygons}
              roofHeightM={roofHeightEstimate.roofHeightM}
              onStatusChange={setPanelLayerStatus}
            />

            <ClimatePanelLayer
              map={vworldMap}
              visible={shouldRenderClimatePanelLayer}
              panelsGeojson={activeClimatePanelGeojson}
              roofPolygon4326={activeBackendRoofPolygon4326}
              pocId={activeClimateBundle?.meta.unq_id ?? DEFAULT_CLIMATE_POC_ID}
              panelSource={
                hasLiveClimatePanelLayout || (!hasStaticClimatePanelLayout && activeBackendRoofPolygon4326)
                  ? 'climate-live'
                  : 'static-poc'
              }
              selectedBuildingId={selectedBuildingId}
              selectedAnalysisSessionId={selectedAnalysisSessionId}
              roofHeightM={activeClimateBundle?.meta.bldg_hgt ?? roofHeightEstimate.roofHeightM}
              onStatusChange={setClimatePanelLayerStatus}
            />

            {isMapApiLoading && (
              <div className="mapApiLoadingOverlay" role="status" aria-live="polite" aria-label={mapApiLoadingLabel}>
                <span className="mapApiLoadingSpinner" aria-hidden="true" />
                <span>로딩 중</span>
              </div>
            )}

            {mapStatus === 'loading' && (
              <div className="mapStateOverlay" role="status">
                브이월드 3D 지도를 불러오는 중입니다...
              </div>
            )}

            {mapStatus === 'error' && (
              <div className="mapStateOverlay mapStateOverlayError" role="alert">
                {mapErrorMessage}
              </div>
            )}

            {hasBuildingDataHealthError && (
              <div className="mapDataHealthAlert" role="alert">
                {BUILDING_DATA_HEALTH_ERROR_MESSAGE}
              </div>
            )}

            {selectionFeedbackStatus !== 'idle' && !hasBuildingDataHealthError && (
              <div className={`selectionStatusOverlay is-${selectionFeedbackStatus}`} role="status">
                {selectionFeedbackMessage}
              </div>
            )}

            {shouldShowDevDiagnostics && (
              <div className="selectionDebugPanel" aria-label="건물 선택 디버그 패널">
                <strong>selection debug</strong>
                <dl>
                  <div>
                    <dt>appEnv</dt>
                    <dd>{appEnv}</dd>
                  </div>
                  <div>
                    <dt>data health</dt>
                    <dd>{buildingDataHealthStatusText}</dd>
                  </div>
                  <div>
                    <dt>clickPickMethod</dt>
                    <dd>{selectionClickDiagnostics.clickPickMethod}</dd>
                  </div>
                  <div>
                    <dt>clickPickStatus</dt>
                    <dd>{selectionClickDiagnostics.clickPickStatus}</dd>
                  </div>
                  <div>
                    <dt>cameraControlMode</dt>
                    <dd>{selectionClickDiagnostics.cameraControlMode}</dd>
                  </div>
                  <div>
                    <dt>leftDragDisabled</dt>
                    <dd>{selectionClickDiagnostics.leftDragNavigationDisabled ? 'true' : 'false'}</dd>
                  </div>
                  <div>
                    <dt>rightDragEnabled</dt>
                    <dd>{selectionClickDiagnostics.rightDragNavigationEnabled ? 'true' : 'false'}</dd>
                  </div>
                  <div>
                    <dt>lastPointerMovePx</dt>
                    <dd>{selectionClickDiagnostics.lastPointerMovePx.toFixed(1)}</dd>
                  </div>
                  <div>
                    <dt>ignoredByDrag</dt>
                    <dd>{selectionClickDiagnostics.lastSelectionIgnoredBecauseDrag ? 'true' : 'false'}</dd>
                  </div>
                  <div>
                    <dt>selectedLat/Lon</dt>
                    <dd>
                      {selectionClickDiagnostics.selectedLat?.toFixed(6) ?? '-'} /{' '}
                      {selectionClickDiagnostics.selectedLon?.toFixed(6) ?? '-'}
                    </dd>
                  </div>
                  <div>
                    <dt>candidateFileCount</dt>
                    <dd>{buildingFootprintDiagnostics.candidateFileCount.toLocaleString('ko-KR')}</dd>
                  </div>
                  <div>
                    <dt>searchedFeatureCount</dt>
                    <dd>{buildingFootprintDiagnostics.searchedFeatureCount.toLocaleString('ko-KR')}</dd>
                  </div>
                  <div>
                    <dt>matchedBuildingId</dt>
                    <dd>{buildingFootprintDiagnostics.matchedBuildingId ?? '-'}</dd>
                  </div>
                  <div>
                    <dt>selectedBuildingId</dt>
                    <dd>{selectedBuildingId ?? '-'}</dd>
                  </div>
                  <div>
                    <dt>backendPanelsBuildingId</dt>
                    <dd>{backendPanelsBuildingId ?? '-'}</dd>
                  </div>
                  <div>
                    <dt>sameBuildingForBackendPanels</dt>
                    <dd>{formatDiagnosticBoolean(sameBuildingForBackendPanels)}</dd>
                  </div>
                  <div>
                    <dt>backendRoofMatchesSelected</dt>
                    <dd>{formatDiagnosticBoolean(backendRoofMatchesSelected)}</dd>
                  </div>
                  <div>
                    <dt>backendRoofDistanceToSelectedM</dt>
                    <dd>{formatDiagnosticMeters(backendRoofDistanceToSelectedM)}</dd>
                  </div>
                  <div>
                    <dt>panelCellCountAfterClip</dt>
                    <dd>{formatDiagnosticCount(panelCellCountAfterClip)}</dd>
                  </div>
                  <div>
                    <dt>staleBackendResponseIgnored</dt>
                    <dd>{formatDiagnosticBoolean(staleResponseIgnored)}</dd>
                  </div>
                  <div>
                    <dt>nearestDistanceM</dt>
                    <dd>{formatDiagnosticMeters(buildingFootprintDiagnostics.nearestDistanceM)}</dd>
                  </div>
                </dl>
              </div>
            )}

            <div className="riskLegend" aria-label="위험 등급 범례">
              {riskLegendItems.map((item) => (
                <span key={item.label}>
                  <i className={`legendDot legendDot-${item.tone}`} aria-hidden="true" />
                  {item.label}
                </span>
              ))}
              <span>
                <i className="legendDot legendDot-selectedFootprint" aria-hidden="true" />
                빨강: 선택 건물 footprint
              </span>
              <span>
                <i className="legendDot legendDot-backendRoof" aria-hidden="true" />
                보라 점선: 백엔드 분석 polygon
              </span>
              <span>
                <i className="legendDot legendDot-climateCells" aria-hidden="true" />
                초록/노랑/빨강 셀: climate.gg 음영 점수
              </span>
            </div>

          </div>
        </div>

        <aside className="riskInfoPanel" id="analysis-panel" aria-label="선택 건물 위험 정보">
          <div className="riskInfoHeader">
            <div>
              <span>시나리오 기준 · 현장조사 필요</span>
              <h2>선택 건물 정보</h2>
            </div>
            <strong>{selectedBuilding.riskLevel}</strong>
          </div>

          <section className="riskProcessPanel" aria-label="전기세 위험 지도 진행 단계">
            <ol>
              {riskProcessSteps.map((step, index) => (
                <li key={step.title} className={`riskProcessStep is-${step.state}`}>
                  <span className="riskProcessNumber">{index + 1}</span>
                  <div>
                    <div className="riskProcessStepHeader">
                      <strong>{step.title}</strong>
                      <em>{getRiskProcessStateText(step.state)}</em>
                    </div>
                    <p>{step.message}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <div className="riskPanelTabs" role="tablist" aria-label="선택 건물 분석 탭">
            {panelTabs.map((tab) => (
              <button
                key={tab.id}
                className={activeTab === tab.id ? 'isActive' : ''}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'risk' && (
            <>
              <dl className="buildingInfoList">
                {buildingFields.map(([label, key]) => (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>{selectedBuilding[key]}</dd>
                  </div>
                ))}
              </dl>

              {hasSelectedBuilding && <p className="selectionNote selectionFeedbackText is-success">건물 선택 완료</p>}

              <button
                className="riskAnalysisButton"
                type="button"
                onClick={handleRiskAnalysisRequest}
                disabled={pvAnalysisStatus === 'calculating'}
              >
                {pvAnalysisStatus === 'calculating' ? '발전량 분석 중...' : '이 건물로 위험 분석 시작'}
              </button>
            </>
          )}

          {shouldShowCompletedAnalysisActions && (
            <section className="completedAnalysisActions" aria-label="분석 결과 이동">
              <button
                className="riskAnalysisButton resultDetailButton"
                type="button"
                onClick={handleResultDetailRequest}
              >
                결과 상세보기
              </button>
              <button
                className="riskAnalysisButton aiProfitReportButton"
                type="button"
                onClick={handleProfitReportRequest}
                disabled={profitReportStatus === 'loading'}
              >
                {profitReportStatus === 'loading' ? 'AI 수익 리포트 생성 중...' : 'AI 수익 리포트 보기'}
              </button>
              <button
                className="riskAnalysisButton aiSuitabilityDetailButton"
                type="button"
                onClick={handleAiSuitabilityReportRequest}
              >
                AI 설치 적합도 보기
              </button>
              {profitReportMessage && (
                <p className={`aiProfitReportStatus is-${profitReportStatus}`}>{profitReportMessage}</p>
              )}
            </section>
          )}

          {activeTab === 'solar' && !shouldShowCompletedAnalysisActions && (
            <>
              <div className="simulationSummary">
                <span>{selectedBuilding.simulationConfidence}</span>
                <strong>AI/공공데이터 기반 패널 배치 예시</strong>
                <p>{selectedBuilding.simulationNote}</p>
              </div>

              <div className="panelSourceSummary">
                <span>패널 배치 데이터 소스</span>
                <strong>{verifiedPanelPlacementSourceLabel}</strong>
                <p>
                  표시되는 패널과 발전량은 예상·추정 예시이며, 실제 설치 가능 여부는 현장조사와 구조안전성,
                  관리주체 협의, 실제 공고 확인이 필요합니다.
                </p>
                {isClimateLiveBackendEnabled && (
                  <button
                    className="riskAnalysisButton climateLiveButton"
                    type="button"
                    onClick={handleLiveClimateAnalysisRequest}
                    disabled={
                      !hasSelectedBuilding ||
                      !selectedCoordinate ||
                      !selectedBuildingFeature ||
                      liveShadingStatus === 'trying'
                    }
                  >
                    {liveShadingStatus === 'trying'
                      ? '백엔드 분석 요청 중...'
                      : '선택 건물 climate.gg 백엔드 분석 실행'}
                  </button>
                )}
                {isClimateLiveBackendEnabled && liveClimateError && (
                  <p
                    className={`climateLiveStatusText is-${liveClimateStatus === 'error' ? 'error' : liveShadingStatus}`}
                    role={liveClimateStatus === 'error' ? 'alert' : 'status'}
                  >
                    {liveClimateError}
                  </p>
                )}
                <p>
                  climate.gg 샘플 음영 분석은 현재 선택 건물과 별개의 1개 사전계산 샘플입니다.
                </p>
                <label className="panelToggleRow panelToggleRowInline">
                  <span>climate.gg 샘플 음영 분석 보기</span>
                  <input
                    type="checkbox"
                    checked={isClimatePanelModeEnabled}
                    onChange={(event) => {
                      handleClimatePanelModeChange(event.target.checked);
                    }}
                  />
                </label>
                {isClimatePanelModeEnabled && climatePanelLoadStatus === 'error' && (
                  <p role="alert">climate.gg POC 정적 파일을 불러오지 못했습니다. 건물 footprint 기반 자체 배치를 fallback으로 표시합니다.</p>
                )}
                <button
                  className="pocFocusButton"
                  type="button"
                  onClick={handleClimatePocCameraMove}
                  disabled={!climatePocCentroid}
                >
                  샘플 POC 건물 위치로 이동
                </button>
              </div>

              <div className="geometryStatusBox">
                <div className="analysisOverviewGrid">
                  {analysisOverviewCards.map(([label, value]) => (
                    <div className="analysisOverviewCard" key={label}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
                {roofSourceFallbackNote && <p className="analysisSourceNote">{roofSourceFallbackNote}</p>}
                <p className="analysisSourceWarning">
                  본 분석은 비공식 API와 건물 footprint 기반 추정을 포함한 MVP입니다. 실제 설치 가능 여부는 현장조사와 구조 검토가 필요합니다.
                </p>
                {isDeveloperDiagnosticsOpen && (
                  <div className="developerDiagnosticsContent">
                <div>
                  <span>선택 모드</span>
                  <strong>{getSelectionModeText(selectionMode)}</strong>
                </div>
                <div>
                  <span>선택 좌표</span>
                  <strong>{formatCoordinate(selectedCoordinate)}</strong>
                </div>
                <div>
                  <span>지도 시점 이동</span>
                  <strong>
                    {mapFocusStatus.moved ? '이동 시도됨' : '이동 미완료'}
                    {mapFocusStatus.method ? ` · ${mapFocusStatus.method}` : ''}
                    {mapFocusStatus.markerAdded ? ' · 마커 표시' : ''}
                    {mapFocusStatus.selectionSource || mapFocusStatus.selectionMethod
                      ? ` · 클릭 ${mapFocusStatus.selectionSource ?? '-'} / ${mapFocusStatus.selectionMethod ?? '-'}`
                      : ''}
                  </strong>
                </div>
                <div>
                  <span>데이터 소스</span>
                  <strong>{featureDataInfo.dataTypeLabel}</strong>
                </div>
                <div>
                  <span>패널 배치 소스</span>
                  <strong>{verifiedPanelPlacementSourceLabel}</strong>
                </div>
                <div>
                  <span>liveClimateStatus</span>
                  <strong>{liveClimateStatus}</strong>
                </div>
                <div>
                  <span>liveShadingStatus</span>
                  <strong>{liveShadingStatus}</strong>
                </div>
                <div>
                  <span>pvAnalysisStatus</span>
                  <strong>{pvAnalysisStatus}</strong>
                </div>
                <div>
                  <span>includePvAnalysis</span>
                  <strong>{liveIncludePvAnalysis ? 'true' : 'false'}</strong>
                </div>
                <div>
                  <span>liveClimateStep</span>
                  <strong>{liveClimateStep}</strong>
                </div>
                <div>
                  <span>liveClimateError</span>
                  <strong>{liveClimateError || '-'}</strong>
                </div>
                <div>
                  <span>liveRoofAreaM2</span>
                  <strong>{formatEstimatedSquareMeters(liveRoofAreaM2)}</strong>
                </div>
                <div>
                  <span>liveCellCount</span>
                  <strong>{formatDiagnosticCount(liveCellCount)}</strong>
                </div>
                <div>
                  <span>originalCellCount</span>
                  <strong>{formatDiagnosticCount(liveOriginalCellCount)}</strong>
                </div>
                <div>
                  <span>usedCellCount</span>
                  <strong>{formatDiagnosticCount(liveUsedCellCount)}</strong>
                </div>
                <div>
                  <span>liveShadingAverage</span>
                  <strong>{formatEstimatedScore(liveShadingAverage)}</strong>
                </div>
                <div>
                  <span>livePanelCount</span>
                  <strong>{formatDiagnosticCount(livePanelCount)}</strong>
                </div>
                <div>
                  <span>liveApiSource</span>
                  <strong>{liveApiSource}</strong>
                </div>
                <div>
                  <span>roofSource</span>
                  <strong>{liveRoofSource ?? '-'}</strong>
                </div>
                <div>
                  <span>selectBuldStatus</span>
                  <strong>{liveSelectBuldStatus ?? '-'}</strong>
                </div>
                <div>
                  <span>selectSunListStatus</span>
                  <strong>{liveSelectSunListStatus ?? '-'}</strong>
                </div>
                <div>
                  <span>selectSunListTimeoutMs</span>
                  <strong>
                    {liveSelectSunListTimeoutMs === null
                      ? '-'
                      : `${liveSelectSunListTimeoutMs.toLocaleString('ko-KR')}ms`}
                  </strong>
                </div>
                <div>
                  <span>frontendAbortMs</span>
                  <strong>{liveFrontendAbortMs === null ? '-' : `${liveFrontendAbortMs.toLocaleString('ko-KR')}ms`}</strong>
                </div>
                <div>
                  <span>elapsedMs</span>
                  <strong>{liveElapsedMs === null ? '-' : `${liveElapsedMs.toLocaleString('ko-KR')}ms`}</strong>
                </div>
                <div>
                  <span>fallbackReason</span>
                  <strong>{liveFallbackReason}</strong>
                </div>
                <div>
                  <span>backendBaseUrl</span>
                  <strong>{liveBackendBaseUrl}</strong>
                </div>
                <div>
                  <span>backendHealthStatus</span>
                  <strong>{formatDiagnosticCount(liveBackendHealthStatus)}</strong>
                </div>
                <div>
                  <span>backendPostStatus</span>
                  <strong>{formatDiagnosticCount(liveBackendPostStatus)}</strong>
                </div>
                <div>
                  <span>backendFetchErrorName</span>
                  <strong>{liveBackendFetchErrorName}</strong>
                </div>
                <div>
                  <span>backendFetchErrorMessage</span>
                  <strong>{liveBackendFetchErrorMessage}</strong>
                </div>
                <div>
                  <span>backendResponseOk</span>
                  <strong>{formatDiagnosticBoolean(liveBackendResponseOk)}</strong>
                </div>
                <div>
                  <span>backendResponseMessage</span>
                  <strong>{liveBackendResponseMessage}</strong>
                </div>
                <div>
                  <span>pvAnalysisSource</span>
                  <strong>{pvAnalysisSource}</strong>
                </div>
                <div>
                  <span>usedVercelPvAnalysis</span>
                  <strong>{usedVercelPvAnalysis ? 'true' : 'false'}</strong>
                </div>
                <div>
                  <span>liveHybridMode</span>
                  <strong>{liveHybridMode ? 'true' : 'false'}</strong>
                </div>
                <div>
                  <span>maxCellsApplied</span>
                  <strong>{maxCellsApplied ? 'true' : 'false'}</strong>
                </div>
                <div>
                  <span>climatePocEnabled</span>
                  <strong>{isClimatePanelModeEnabled ? 'true' : 'false'}</strong>
                </div>
                <div>
                  <span>climatePocLoadStatus</span>
                  <strong>{climatePanelLoadStatus}</strong>
                </div>
                <div>
                  <span>climate.gg POC 로드</span>
                  <strong>
                    {climatePanelLoadStatus}
                    {climatePanelLoadMessage ? ` · ${climatePanelLoadMessage}` : ''}
                  </strong>
                </div>
                <div>
                  <span>climatePocCentroid</span>
                  <strong>{formatCoordinate(climatePocCentroid)}</strong>
                </div>
                <div>
                  <span>climatePocBbox</span>
                  <strong>{formatClimatePocBbox(climatePocBbox)}</strong>
                </div>
                <div>
                  <span>cameraMoveStatus</span>
                  <strong>{cameraMoveStatus}</strong>
                </div>
                <div>
                  <span>현재 사용 데이터ID</span>
                  <strong>{featureDataInfo.dataId}</strong>
                </div>
                <div>
                  <span>데이터 유형</span>
                  <strong>{getDataTypeDisplayText(featureDataInfo)}</strong>
                </div>
                <div>
                  <span>GeoJSON 로드</span>
                  <strong>{buildingFootprintLoadState.message}</strong>
                </div>
                <div>
                  <span>건물 ID</span>
                  <strong>{selectedBuildingFootprint?.buildingId ?? '-'}</strong>
                </div>
                <div>
                  <span>selectedBuildingId</span>
                  <strong>{selectedBuildingId ?? '-'}</strong>
                </div>
                <div>
                  <span>backendPanelsBuildingId</span>
                  <strong>{backendPanelsBuildingId ?? '-'}</strong>
                </div>
                <div>
                  <span>currentSelectedBuildingId</span>
                  <strong>{currentSelectedBuildingId ?? '-'}</strong>
                </div>
                <div>
                  <span>backendPanelsSessionId</span>
                  <strong>{backendPanelsSessionId ?? '-'}</strong>
                </div>
                <div>
                  <span>currentSessionId</span>
                  <strong>{currentSessionId ?? '-'}</strong>
                </div>
                <div>
                  <span>sameBuildingForBackendPanels</span>
                  <strong>{formatDiagnosticBoolean(sameBuildingForBackendPanels)}</strong>
                </div>
                <div>
                  <span>backendRoofMatchesSelected</span>
                  <strong>{formatDiagnosticBoolean(backendRoofMatchesSelected)}</strong>
                </div>
                <div>
                  <span>backendRoofDistanceToSelectedM</span>
                  <strong>{formatDiagnosticMeters(backendRoofDistanceToSelectedM)}</strong>
                </div>
                <div>
                  <span>panelCellCountAfterClip</span>
                  <strong>{formatDiagnosticCount(panelCellCountAfterClip)}</strong>
                </div>
                <div>
                  <span>backendPanelCellsOutsideSelectedCount</span>
                  <strong>{formatDiagnosticCount(backendPanelCellsOutsideSelectedCount)}</strong>
                </div>
                <div>
                  <span>staleBackendResponseIgnored</span>
                  <strong>{formatDiagnosticBoolean(staleResponseIgnored)}</strong>
                </div>
                <div>
                  <span>livePanelsBuildingId</span>
                  <strong>{livePanelsBuildingId ?? '-'}</strong>
                </div>
                <div>
                  <span>livePanelsSessionId</span>
                  <strong>{livePanelsSessionId ?? '-'}</strong>
                </div>
                <div>
                  <span>currentSessionId</span>
                  <strong>{selectedAnalysisSessionId ?? '-'}</strong>
                </div>
                <div>
                  <span>sameBuildingForLivePanels</span>
                  <strong>{formatDiagnosticBoolean(sameBuildingForLivePanels)}</strong>
                </div>
                <div>
                  <span>selectBuldRoofMatchesSelectedBuilding</span>
                  <strong>{formatDiagnosticBoolean(liveClimateDiagnostics?.selectBuldRoofMatchesSelectedBuilding ?? null)}</strong>
                </div>
                <div>
                  <span>staleResponseIgnored</span>
                  <strong>{formatDiagnosticBoolean(staleResponseIgnored)}</strong>
                </div>
                <div>
                  <span>건물명</span>
                  <strong>{selectedBuildingFootprint?.name ?? '-'}</strong>
                </div>
                <div>
                  <span>주소</span>
                  <strong>{selectedBuildingFootprint?.address ?? '-'}</strong>
                </div>
                <div>
                  <span>geometry type</span>
                  <strong>{selectedBuildingFootprint?.geometryType ?? '-'}</strong>
                </div>
                <div>
                  <span>건물 polygon 매칭</span>
                  <strong>{hasSelectedBuildingPolygon ? '건물 polygon 매칭 완료' : '건물 polygon 매칭 대기'}</strong>
                </div>
                <div>
                  <span>선택 건물 지도 표시</span>
                  <strong>
                    {selectedBuildingLayerStatus.selectedBuildingEntityStatus}
                    {selectedBuildingLayerStatus.renderMethod !== '-'
                      ? ` · ${selectedBuildingLayerStatus.renderMethod}`
                      : ''}
                  </strong>
                </div>
                <div>
                  <span>정밀 옥상 데이터 여부</span>
                  <strong>{featureDataInfo.isActualRoofPolygon ? '예' : '아님'}</strong>
                </div>
                <div>
                  <span>공간정보 도형 조회 상태</span>
                  <strong>{getGeometryStatusText(geometryQueryStatus)}</strong>
                </div>
                <div>
                  <span>프록시 조회 상태</span>
                  <strong>
                    {featureQueryDiagnostics.queryStatus}
                    {featureQueryDiagnostics.rawStatus ? ` · ${featureQueryDiagnostics.rawStatus}` : ''}
                  </strong>
                </div>
                <div>
                  <span>조회 feature 수</span>
                  <strong>{featureQueryDiagnostics.featureCount.toLocaleString('ko-KR')}개</strong>
                </div>
                <div>
                  <span>선택 가능 건물 테두리</span>
                  <strong>{selectableLayerStatus.message}</strong>
                </div>
                <div>
                  <span>candidateEntityCount</span>
                  <strong>
                    {selectableLayerStatus.candidateEntityCount.toLocaleString('ko-KR')}개
                    {selectableLayerStatus.renderMethod !== '-' ? ` · ${selectableLayerStatus.renderMethod}` : ''}
                  </strong>
                </div>
                <div>
                  <span>옥상 추정 상태</span>
                  <strong>{getRoofPolygonStatusText(selectionMode, selectedRoofPolygon)}</strong>
                </div>
                <div>
                  <span>패널 간격</span>
                  <strong>{panelSpacingText}</strong>
                </div>
                <div>
                  <span>옥상 여백</span>
                  <strong>{roofMarginText}</strong>
                </div>
                <div>
                  <span>설치 제외율</span>
                  <strong>{installationExclusionRateText}</strong>
                </div>
                <div>
                  <span>패널 수</span>
                  <strong>{selectedBuilding.estimatedPanelCount.toLocaleString('ko-KR')}개</strong>
                </div>
                <div>
                  <span>패널 polygon 수</span>
                  <strong>{panelLayerStatus.panelPolygonCount.toLocaleString('ko-KR')}개</strong>
                </div>
                <div>
                  <span>첫 패널 좌표</span>
                  <strong>{formatPanelCoordinates(panelLayerStatus.firstPanelCoordinates)}</strong>
                </div>
                <div>
                  <span>패널 레이어 상태</span>
                  <strong>
                    {panelLayerStatus.state === 'rendered'
                      ? `패널 표시 완료 · 좌표 고정 지도 객체 ${panelLayerStatus.panelEntityCount.toLocaleString('ko-KR')}개 표시`
                      : panelLayerStatus.message}
                  </strong>
                </div>
                <div>
                  <span>panelEntityCount</span>
                  <strong>{panelLayerStatus.panelEntityCount.toLocaleString('ko-KR')}개</strong>
                </div>
                <div>
                  <span>climatePanelFeatureCount</span>
                  <strong>{activeClimatePanelFeatureCount.toLocaleString('ko-KR')}개</strong>
                </div>
                <div>
                  <span>climatePanelEntityCount</span>
                  <strong>{climatePanelLayerStatus.climatePanelEntityCount.toLocaleString('ko-KR')}개</strong>
                </div>
                <div>
                  <span>firstPanelCoordinates</span>
                  <strong>{formatPanelCoordinates(climatePanelLayerStatus.firstPanelCoordinates)}</strong>
                </div>
                <div>
                  <span>climatePanelRenderStatus</span>
                  <strong>
                    {climatePanelLayerStatus.climatePanelRenderStatus}
                    {climatePanelLayerStatus.renderMethod !== '-' ? ` · ${climatePanelLayerStatus.renderMethod}` : ''}
                  </strong>
                </div>
                <div>
                  <span>지도 객체 렌더링 방식</span>
                  <strong>{panelLayerStatus.renderMode}</strong>
                </div>
                <div>
                  <span>roofHeightM</span>
                  <strong>
                    {panelLayerStatus.roofHeightM.toLocaleString('ko-KR')}m
                    {panelLayerStatus.heightMessage ? ` · ${panelLayerStatus.heightMessage}` : ''}
                  </strong>
                </div>
                <div>
                  <span>terrainHeightM</span>
                  <strong>{formatDiagnosticMeters(panelLayerStatus.terrainHeightM)}</strong>
                </div>
                <div>
                  <span>finalPanelHeightM</span>
                  <strong>{formatDiagnosticMeters(panelLayerStatus.finalPanelHeightM)}</strong>
                </div>
                <div>
                  <span>entityCountBefore</span>
                  <strong>{formatDiagnosticCount(panelLayerStatus.entityCountBefore)}</strong>
                </div>
                <div>
                  <span>entityCountAfter</span>
                  <strong>{formatDiagnosticCount(panelLayerStatus.entityCountAfter)}</strong>
                </div>
                <div>
                  <span>viewerEntityCount</span>
                  <strong>{formatDiagnosticCount(panelLayerStatus.viewerEntityCount)}</strong>
                </div>
                <div>
                  <span>selectedBuildingEntityStatus</span>
                  <strong>{selectedBuildingLayerStatus.selectedBuildingEntityStatus}</strong>
                </div>
                <div>
                  <span>sameViewerAsBuildingLayer</span>
                  <strong>{formatDiagnosticMatch(sameViewerAsBuildingLayer)}</strong>
                </div>
                <div>
                  <span>viewerCanvasSize</span>
                  <strong>{formatViewerCanvasSize(panelLayerStatus.viewerCanvasSize)}</strong>
                </div>
                <div>
                  <span>depthTestAgainstTerrain</span>
                  <strong>{formatDiagnosticBoolean(panelLayerStatus.depthTestAgainstTerrain)}</strong>
                </div>
                <div>
                  <span>debug test entity</span>
                  <strong>
                    {panelLayerStatus.debugEntityAdded
                      ? '추가됨'
                      : '비활성 또는 미추가 · VITE_SHOW_PANEL_DEBUG_ENTITY=true 필요'}
                  </strong>
                </div>
                <div>
                  <span>panel debug lift</span>
                  <strong>
                    {panelLayerStatus.debugLiftApplied
                      ? '적용 중 · VITE_LIFT_SOLAR_PANELS_DEBUG=true'
                      : '비활성 · VITE_LIFT_SOLAR_PANELS_DEBUG=true로 +20m'}
                  </strong>
                </div>
                <p>지형 높이 미확인 시 디버그 높이로 패널을 표시합니다.</p>
                <p>{geometryQueryMessage}</p>
                <p>{featureDataInfo.dataTypeNote}</p>
                {hasSelectedBuildingPolygon && solarPanelPolygons.length === 0 && (
                  <p role="status">선택 건물에서 배치 가능한 패널을 계산하지 못했습니다.</p>
                )}
                  </div>
                )}
              </div>

              <section className="climatePanelLegendPanel" aria-label="climate.gg 패널 음영 범례">
                <div className="climatePanelLegendHeader">
                  <span>climate.gg 패널 음영 범례</span>
                  <strong>높은 shading_score가 더 양호한 셀입니다.</strong>
                </div>
                <ul>
                  {CLIMATE_PANEL_LEGEND_ITEMS.map((item) => (
                    <li key={item.label}>
                      <i style={{ background: item.color }} aria-hidden="true" />
                      <span>{item.label}</span>
                      <strong>{item.scoreText}</strong>
                    </li>
                  ))}
                </ul>
              </section>

              {activeClimateBundle && isDeveloperDiagnosticsOpen && (
                <section className="climateBundleSummary" aria-label="climate.gg 분석 bundle 요약">
                  <div className="climateBundleSummaryHeader">
                    <span>{hasLiveClimatePanelLayout ? 'climate.gg live bundle' : 'climate.gg sample bundle'}</span>
                    <strong>옥상·음영·발전량 추정 요약</strong>
                  </div>
                  <dl>
                    {climateBundleSummaryItems.map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}

              {shouldShowDevDiagnostics && isDeveloperDiagnosticsOpen && (
                <div className="devDiagnosticsPanel" aria-label="개발용 건물 polygon 매칭 진단">
                  <strong>개발용 건물 polygon 매칭 진단</strong>
                  <dl>
                    <div>
                      <dt>appEnv</dt>
                      <dd>{appEnv}</dd>
                    </div>
                    <div>
                      <dt>data health</dt>
                      <dd>{buildingDataHealthStatusText}</dd>
                    </div>
                    <div>
                      <dt>building data base URL</dt>
                      <dd>{buildingDataHealth.buildingDataBaseUrl}</dd>
                    </div>
                    <div>
                      <dt>meta URL</dt>
                      <dd>{buildingDataHealth.metaUrl}</dd>
                    </div>
                    <div>
                      <dt>health index entry count</dt>
                      <dd>{buildingDataHealth.buildingIndexEntryCount.toLocaleString('ko-KR')}</dd>
                    </div>
                    <div>
                      <dt>source mode</dt>
                      <dd>{buildingFootprintDiagnostics.sourceMode}</dd>
                    </div>
                    <div>
                      <dt>lookup status</dt>
                      <dd>{buildingFootprintDiagnostics.status}</dd>
                    </div>
                    <div>
                      <dt>index URL</dt>
                      <dd>{buildingFootprintLoadState.url || '-'}</dd>
                    </div>
                    <div>
                      <dt>source status</dt>
                      <dd>{geoJsonDiagnosticSourceStatus}</dd>
                    </div>
                    <div>
                      <dt>index loaded</dt>
                      <dd>{buildingFootprintDiagnostics.indexLoaded ? 'true' : 'false'}</dd>
                    </div>
                    <div>
                      <dt>index entry count</dt>
                      <dd>{buildingFootprintDiagnostics.indexEntryCount.toLocaleString('ko-KR')}</dd>
                    </div>
                    <div>
                      <dt>candidate file count</dt>
                      <dd>{buildingFootprintDiagnostics.candidateFileCount.toLocaleString('ko-KR')}</dd>
                    </div>
                    <div>
                      <dt>selection mode</dt>
                      <dd>{getFootprintSelectionModeText(buildingFootprintDiagnostics.selectionMode)}</dd>
                    </div>
                    <div>
                      <dt>selection tolerance</dt>
                      <dd>{formatDiagnosticMeters(buildingFootprintDiagnostics.selectionToleranceM)}</dd>
                    </div>
                    <div>
                      <dt>loaded file names</dt>
                      <dd>{buildingFootprintDiagnostics.loadedFileNames.join(', ') || '-'}</dd>
                    </div>
                    <div>
                      <dt>selectable outline count</dt>
                      <dd>{selectableBuildingPolygons.length.toLocaleString('ko-KR')}</dd>
                    </div>
                    <div>
                      <dt>searched feature count</dt>
                      <dd>{buildingFootprintDiagnostics.searchedFeatureCount.toLocaleString('ko-KR')}</dd>
                    </div>
                    <div>
                      <dt>GeoJSON feature count</dt>
                      <dd>{(buildingFootprints?.features.length ?? 0).toLocaleString('ko-KR')}</dd>
                    </div>
                    <div>
                      <dt>selected lat</dt>
                      <dd>{selectionClickDiagnostics.selectedLat?.toFixed(6) ?? featureQueryDiagnostics.requestedLat?.toFixed(6) ?? '-'}</dd>
                    </div>
                    <div>
                      <dt>selected lon</dt>
                      <dd>{selectionClickDiagnostics.selectedLon?.toFixed(6) ?? featureQueryDiagnostics.requestedLon?.toFixed(6) ?? '-'}</dd>
                    </div>
                    <div>
                      <dt>click pick method</dt>
                      <dd>{selectionClickDiagnostics.clickPickMethod}</dd>
                    </div>
                    <div>
                      <dt>click pick status</dt>
                      <dd>{selectionClickDiagnostics.clickPickStatus}</dd>
                    </div>
                    <div>
                      <dt>cameraControlMode</dt>
                      <dd>{selectionClickDiagnostics.cameraControlMode}</dd>
                    </div>
                    <div>
                      <dt>leftDragNavigationDisabled</dt>
                      <dd>{selectionClickDiagnostics.leftDragNavigationDisabled ? 'true' : 'false'}</dd>
                    </div>
                    <div>
                      <dt>rightDragNavigationEnabled</dt>
                      <dd>{selectionClickDiagnostics.rightDragNavigationEnabled ? 'true' : 'false'}</dd>
                    </div>
                    <div>
                      <dt>lastPointerMovePx</dt>
                      <dd>{selectionClickDiagnostics.lastPointerMovePx.toFixed(1)}</dd>
                    </div>
                    <div>
                      <dt>lastSelectionIgnoredBecauseDrag</dt>
                      <dd>{selectionClickDiagnostics.lastSelectionIgnoredBecauseDrag ? 'true' : 'false'}</dd>
                    </div>
                    <div>
                      <dt>pickPositionSupported</dt>
                      <dd>{selectionClickDiagnostics.pickPositionSupported ? 'true' : 'false'}</dd>
                    </div>
                    <div>
                      <dt>camera height</dt>
                      <dd>{formatDiagnosticMeters(selectionClickDiagnostics.cameraHeightM)}</dd>
                    </div>
                    <div>
                      <dt>selected geometry type</dt>
                      <dd>{buildingFootprintDiagnostics.selectedGeometryType ?? selectedBuildingFootprint?.geometryType ?? '-'}</dd>
                    </div>
                    <div>
                      <dt>matched building id</dt>
                      <dd>{buildingFootprintDiagnostics.matchedBuildingId ?? selectedBuildingFootprint?.buildingId ?? '-'}</dd>
                    </div>
                    <div>
                      <dt>matched building address</dt>
                      <dd>{buildingFootprintDiagnostics.matchedAddress ?? selectedBuildingFootprint?.address ?? '-'}</dd>
                    </div>
                    <div>
                      <dt>nearest distance</dt>
                      <dd>{formatDiagnosticMeters(buildingFootprintDiagnostics.nearestDistanceM)}</dd>
                    </div>
                    <div>
                      <dt>nearest building id</dt>
                      <dd>{buildingFootprintDiagnostics.nearestBuildingId ?? '-'}</dd>
                    </div>
                    <div>
                      <dt>nearest building address</dt>
                      <dd>{buildingFootprintDiagnostics.nearestBuildingAddress ?? '-'}</dd>
                    </div>
                    {selectedCoordinate && !selectedBuildingFootprint && (
                      <div>
                        <dt>match result</dt>
                        <dd>클릭 좌표를 포함하는 건물 polygon이 없습니다.</dd>
                      </div>
                    )}
                    <div>
                      <dt>minLon</dt>
                      <dd>{formatDiagnosticNumber(buildingFootprintCoordinateSummary.minLon)}</dd>
                    </div>
                    <div>
                      <dt>maxLon</dt>
                      <dd>{formatDiagnosticNumber(buildingFootprintCoordinateSummary.maxLon)}</dd>
                    </div>
                    <div>
                      <dt>minLat</dt>
                      <dd>{formatDiagnosticNumber(buildingFootprintCoordinateSummary.minLat)}</dd>
                    </div>
                    <div>
                      <dt>maxLat</dt>
                      <dd>{formatDiagnosticNumber(buildingFootprintCoordinateSummary.maxLat)}</dd>
                    </div>
                    {buildingFootprintCoordinateSummary.hasProjectedCoordinateWarning && (
                      <div>
                        <dt>coordinate system warning</dt>
                        <dd>좌표가 EPSG:4326 경도/위도 형식이 아닐 수 있습니다.</dd>
                      </div>
                    )}
                    <div>
                      <dt>API request path</dt>
                      <dd>{featureQueryDiagnostics.requestPath}</dd>
                    </div>
                    <div>
                      <dt>dataId</dt>
                      <dd>{featureQueryDiagnostics.dataId}</dd>
                    </div>
                    <div>
                      <dt>queryStatus</dt>
                      <dd>{featureQueryDiagnostics.queryStatus}</dd>
                    </div>
                    <div>
                      <dt>featureCount</dt>
                      <dd>{featureQueryDiagnostics.featureCount}</dd>
                    </div>
                    <div>
                      <dt>rawStatus</dt>
                      <dd>{featureQueryDiagnostics.rawStatus ?? '-'}</dd>
                    </div>
                    {featureQueryDiagnostics.errorMessage && (
                      <div>
                        <dt>errorMessage</dt>
                        <dd>{featureQueryDiagnostics.errorMessage}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}

              {activeAiSimulationResult && activeBuildingSuitability && (
                <section className="aiSuitabilityCard" aria-label="AI 설치 적합도">
                  <div className="aiSuitabilityHeader">
                    <div>
                      <span>설명형 AI 점수화</span>
                      <strong>AI 설치 적합도</strong>
                    </div>
                    <div className="aiSuitabilityScore">
                      <strong>{activeBuildingSuitability.score}</strong>
                      <span>{activeBuildingSuitability.grade}</span>
                    </div>
                  </div>

                  <p className="aiSuitabilityLabel">{activeBuildingSuitability.label}</p>

                  {activeReportInputMetrics && (
                    <>
                      <dl className="aiCounselingMetricGrid" aria-label="상담 에이전트 4대 입력 지표">
                        <div>
                          <dt>예상 발전량</dt>
                          <dd>{formatEstimatedKwh(activeReportInputMetrics.annualGenerationKwh)}</dd>
                        </div>
                        <div>
                          <dt>예상 자부담</dt>
                          <dd>{formatEstimatedKrw(activeReportInputMetrics.selfPaymentEstimateKrw)}</dd>
                        </div>
                        <div>
                          <dt>예상 회수기간</dt>
                          <dd>{formatSimplePaybackYears(activeReportInputMetrics.paybackYears)}</dd>
                        </div>
                        <div>
                          <dt>AI 적합도 등급</dt>
                          <dd>
                            {activeReportInputMetrics.installationSuitabilityGrade} ·{' '}
                            {activeReportInputMetrics.installationSuitabilityScore}점
                          </dd>
                        </div>
                      </dl>

                      <p className="aiSuitabilityNote">
                        보조금은 {activeReportInputMetrics.subsidyProgramName} 기준으로 표시합니다. 실제 지원 여부는 공고와
                        예산 잔여 여부에 따라 달라질 수 있습니다.
                      </p>
                    </>
                  )}

                  <dl className="aiSuitabilityMeta">
                    <div>
                      <dt>군집 유형</dt>
                      <dd>{activeAiCluster?.clusterName ?? '군집 확인 필요'}</dd>
                    </div>
                    <div>
                      <dt>모델</dt>
                      <dd>{activeAiModelType}</dd>
                    </div>
                  </dl>

                  {aiSuitabilityReasons.length > 0 && (
                    <div className="aiSuitabilityList">
                      <span>주요 근거</span>
                      <ul>
                        {aiSuitabilityReasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="aiSuitabilityList">
                    <span>주의 항목</span>
                    {aiSuitabilityWarnings.length > 0 ? (
                      <ul>
                        {aiSuitabilityWarnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>현재 자동 경고는 없지만 실제 설치 전 현장 검토가 필요합니다.</p>
                    )}
                  </div>

                  <p className="aiSuitabilityNote">
                    현재 모델은 시뮬레이션 기반 대리 회귀 모델이며, 실측 데이터 누적 시 고도화됩니다.
                  </p>
                </section>
              )}

              {activeReportInputMetrics && (
                <section className="aiProfitReportCard" aria-label="AI 수익 리포트 요약">
                  <div className="aiProfitReportHeader">
                    <div>
                      <span>AI 수익·보조금·금융 리포트</span>
                      <strong>도입 판단용 핵심 요약</strong>
                    </div>
                  </div>

                  <dl className="aiProfitReportGrid">
                    <div>
                      <dt>예상 발전량</dt>
                      <dd>{formatEstimatedKwh(activeReportInputMetrics.annualGenerationKwh)}</dd>
                    </div>
                    <div>
                      <dt>예상 자부담</dt>
                      <dd>{formatEstimatedKrw(activeReportInputMetrics.selfPaymentEstimateKrw)}</dd>
                    </div>
                    <div>
                      <dt>예상 회수기간</dt>
                      <dd>{formatSimplePaybackYears(activeReportInputMetrics.paybackYears)}</dd>
                    </div>
                    <div>
                      <dt>보조금 정책</dt>
                      <dd>{activeReportInputMetrics.subsidyProgramName}</dd>
                    </div>
                  </dl>

                  <p>
                    보조금과 대출은 예상·검토 시나리오입니다. 실제 지원 여부는 공고, 예산 잔여 여부,
                    금융기관 심사 확인이 필요합니다.
                  </p>

                  <button
                    className="riskAnalysisButton aiProfitReportButton"
                    type="button"
                    onClick={handleProfitReportRequest}
                    disabled={profitReportStatus === 'loading'}
                  >
                    {profitReportStatus === 'loading' ? 'AI 수익 리포트 생성 중...' : 'AI 수익 리포트 보기'}
                  </button>

                  {profitReportMessage && (
                    <p className={`aiProfitReportStatus is-${profitReportStatus}`}>{profitReportMessage}</p>
                  )}
                </section>
              )}

              <dl className="buildingInfoList solarInfoList">
                {solarFields.map(([label, key, unit]) => (
                  <div key={key}>
                    <dt>{key === 'estimatedPaybackYears' ? '단순 회수기간 추정' : label}</dt>
                    <dd>
                      {key === 'estimatedPaybackYears'
                        ? formatSimplePaybackYears(normalizeSimplePaybackYears(selectedBuilding[key]))
                        : formatSolarValue(selectedBuilding[key], unit)}
                    </dd>
                  </div>
                ))}
              </dl>

            </>
          )}

          {analysisStatus && activeTab === 'risk' && !shouldShowCompletedAnalysisActions && (
            <p className="analysisStatus">{analysisStatus}</p>
          )}

          {activeTab === 'risk' && !shouldShowCompletedAnalysisActions && (
            <p className="riskDisclaimer">
              본 태양광 가상 설치는 브이월드 공간정보와 입력값 기반의 1차 추정입니다. 실제 설치 가능 여부,
              발전량, 절감액은 현장조사, 옥상 장애물, 음영, 구조안전성, 설비 사양, 관리주체 협의, 정책 공고
              기준에 따라 달라질 수 있습니다. 실제 설치 가능 여부는 옥상 장애물, 음영, 구조안전성, 관리주체 협의,
              현장조사에 따라 달라질 수 있습니다.
            </p>
          )}
        </aside>
      </section>
    </main>
  );
}

export default RiskMapPage;
