import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
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
  estimateCapacityKw,
  estimateInstallableArea,
} from '../lib/solarSimulation';
import {
  DEFAULT_SOLAR_PANEL_LAYOUT_OPTIONS,
  generateSolarPanelLayout,
  type SolarPanelLayoutResult,
} from '../lib/solarPanelLayout';
import { requestPvAnalysis } from '../lib/pvAnalysisClient';
import { requestSelectedBuildingPolygon } from '../lib/buildingPolygonClient';
import {
  DEFAULT_CLIMATE_POC_ID,
  loadClimateBundle,
  loadClimatePanelGeojson,
  summarizeClimatePanelGeojson,
  type ClimatePocBbox,
  type ClimatePocPanelExtent,
} from '../lib/climateBundleClient';
import { runExternalClimateBackendAnalysis } from '../lib/climateBackendClient';
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
  summarizeBuildingFootprintCoordinates,
  type BuildingFootprintCollection,
  type BuildingFootprintDiagnostics,
  type BuildingFootprintLoadState,
  type BuildingFootprintMatch,
  type BuildingFootprintSelectionMode,
} from '../lib/buildingFootprints';
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
  saveSimulationResultToSession,
} from '../lib/simulationResultStorage';
import type {
  ClimateBundle,
  ClimateLiveAnalysisDiagnostics,
  ClimateLiveRoofSource,
  ClimatePanelsGeoJson,
  ClimateSelectedBuildingFeature,
} from '../types/climateBundle';
import type { PvAnalysisInput, PvAnalysisProxyResponse, PvAnalysisResult } from '../types/pvAnalysis';
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
const ROOF_FOCUS_MIN_HEIGHT_M = 520;
const ROOF_FOCUS_MAX_HEIGHT_M = 1800;
const ROOF_FOCUS_SPAN_MULTIPLIER = 3.2;
const ROOF_FOCUS_HEIGHT_PADDING_M = 220;
const CLIMATE_POC_FOCUS_MIN_HEIGHT_M = 550;
const CLIMATE_POC_FOCUS_MAX_HEIGHT_M = 1800;
const CLIMATE_POC_FOCUS_SPAN_MULTIPLIER = 4;
const CLIMATE_POC_FOCUS_HEIGHT_PADDING_M = 320;
const SIMPLE_PAYBACK_MAX_REASONABLE_YEARS = 100;
const FOOTPRINT_FALLBACK_SIMPLE_PAYBACK_YEARS = 6.8;
const DEFAULT_PANEL_PLACEMENT_SOURCE = '건물 footprint 기반 자체 배치';
const BUILDING_DATA_HEALTH_ERROR_MESSAGE =
  '건물 polygon 데이터를 불러오지 못했습니다. 배포 데이터 경로를 확인해주세요.';
const SELECTION_NOT_FOUND_MESSAGE =
  '선택 좌표 주변에서 건물 polygon을 찾지 못했습니다. 지도를 확대하거나 건물 중심을 다시 클릭해주세요.';
const RISK_MAP_SELECTION_ENTITY_PREFIXES = [
  'solarmate-selected-building-',
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
type RiskPanelTab = 'risk' | 'solar' | 'policy';
type SelectionMode = 'screen-fallback' | 'coordinate-fallback' | 'parcel-fallback' | 'geometry' | 'building_footprint';
type SelectionFeedbackStatus = 'idle' | 'loading' | 'success' | 'not_found' | 'error';
type BuildingDataHealthStatus = 'idle' | 'loading' | 'ok' | 'error';
type PvAnalysisStatus = 'idle' | 'calculating' | 'success' | 'fallback' | 'error';
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

const mvpAssumptionPreview = {
  installableAreaM2: estimateInstallableArea(mvpSolarEstimate.estimatedRoofAreaM2),
  capacityKw: estimateCapacityKw(mvpSolarEstimate.estimatedInstallableAreaM2),
  annualGenerationKwh: estimateAnnualGenerationKwh(mvpSolarEstimate.estimatedCapacityKw),
  annualSavingsKrw: estimateAnnualSavingsKrw(mvpSolarEstimate.estimatedAnnualGenerationKwh),
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
  ['5년 누적 추가 부담 예상', 'fiveYearExtraCost'],
  ['태양광 도입 시 예상 절감 가능성', 'solarPotential'],
  ['보조금 검토 가능성', 'subsidyReview'],
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

const pvAnalysisResultCards = [
  { label: '연간 발전량 예상', render: (result: PvAnalysisResult) => formatEstimatedKwh(result.annualGenerationKwh) },
  { label: '설치용량 추정', render: (result: PvAnalysisResult) => formatScenarioKw(result.installKw) },
  {
    label: '1년차 총 경제효과 예상',
    render: (result: PvAnalysisResult) => formatEstimatedKrw(result.firstYearTotalEconomicEffectKrw),
  },
  {
    label: '자가소비 절감액 예상',
    render: (result: PvAnalysisResult) => formatEstimatedKrw(result.firstYearSelfConsumptionSavingKrw),
  },
  {
    label: '잉여전력 매전 추정',
    render: (result: PvAnalysisResult) => formatEstimatedKrw(result.estimatedSurplusSalesKrw),
  },
  { label: '총 설치비 추정', render: (result: PvAnalysisResult) => formatEstimatedKrw(result.estimatedInvestmentKrw) },
  { label: '탄소 저감량 추정', render: (result: PvAnalysisResult) => formatEstimatedKg(result.carbonReductionKg) },
] as const;

const panelTabs = [
  { id: 'risk', label: '위험 진단' },
  { id: 'solar', label: '태양광 설치' },
  { id: 'policy', label: '보조금' },
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

function formatScenarioKw(value: number) {
  return `시나리오 기준 ${value.toLocaleString('ko-KR')}kW`;
}

function formatEstimatedKw(value: number) {
  return `추정 ${value.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}kW`;
}

function formatEstimatedKrw(value: number) {
  return `추정 ${Math.round(value).toLocaleString('ko-KR')}원`;
}

function formatEstimatedKg(value: number) {
  return `추정 ${Math.round(value).toLocaleString('ko-KR')}kg`;
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

function formatSimplePaybackYears(years: number | null) {
  return years === null
    ? '계산 불가'
    : `${years.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}년`;
}

function getSimplePaybackSourceText(source: SimplePaybackSource) {
  if (source === 'climate-live') {
    return 'climate.gg live 결과 기준';
  }

  if (source === 'static-poc') {
    return 'climate.gg 샘플 POC 기준';
  }

  return '건물 footprint fallback 기준';
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

function getNearbyBuildingPolygons(polygons: PolygonCoordinates[], coordinate: Coordinate | null) {
  if (!coordinate) {
    return [];
  }

  return polygons
    .map((polygon) => ({
      polygon,
      distanceMeters: getDistanceMeters(coordinate, getPolygonCentroid(polygon)),
    }))
    .filter((item) => item.distanceMeters <= NEARBY_BUILDING_OUTLINE_RADIUS_M)
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
  const [selectedBuilding, setSelectedBuilding] = useState<SelectedBuilding>(demoBuilding);
  const [analysisStatus, setAnalysisStatus] = useState('');
  const [activeTab, setActiveTab] = useState<RiskPanelTab>('risk');
  const activeTabRef = useRef<RiskPanelTab>('risk');
  const [pvAnalysisStatus, setPvAnalysisStatus] = useState<PvAnalysisStatus>('idle');
  const [pvAnalysisMessage, setPvAnalysisMessage] = useState('');
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
  const [liveClimateDiagnostics, setLiveClimateDiagnostics] = useState<ClimateLiveAnalysisDiagnostics | null>(null);
  const [cameraMoveStatus, setCameraMoveStatus] = useState('climate.gg POC 패널 위치 계산 대기');
  const panelVisibilityUserOverrideRef = useRef(false);
  const climateFocusPocRef = useRef<string | null>(null);
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
  const [isDeveloperDiagnosticsOpen, setIsDeveloperDiagnosticsOpen] = useState(false);
  const hasMapAnchoredGeometry =
    selectionMode === 'geometry' || selectionMode === 'parcel-fallback' || selectionMode === 'building_footprint';
  const shouldShowDevDiagnostics = import.meta.env.DEV || import.meta.env.VITE_SHOW_SELECTION_DEBUG === 'true';
  const appEnv = import.meta.env.DEV ? 'development' : import.meta.env.MODE || 'production';
  const hasBuildingDataHealthError = buildingDataHealth.buildingIndexStatus === 'error';
  const buildingDataHealthStatusText = `index ${formatHealthStatus(
    buildingDataHealth.buildingIndexStatus,
  )} / meta ${formatHealthStatus(buildingDataHealth.buildingMetaStatus)}`;
  const isClimateLiveBackendEnabled = import.meta.env.VITE_ENABLE_CLIMATE_LIVE_BACKEND === 'true';
  const pvAnalysisResult = pvAnalysisResponse?.result ?? null;
  const monthlyGenerationMaxKwh = Math.max(
    1,
    ...(pvAnalysisResult?.monthlyGenerationSeries.map((item) => item.generationKwh) ?? [0]),
  );
  const buildingFootprintCoordinateSummary = useMemo(
    () => summarizeBuildingFootprintCoordinates(buildingFootprints),
    [buildingFootprints],
  );
  const nearbySelectableBuildingPolygons = useMemo(
    () => getNearbyBuildingPolygons(selectableBuildingPolygons, selectedCoordinate),
    [selectableBuildingPolygons, selectedCoordinate],
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
  const livePanelsBuildingId = liveClimateBundle ? liveClimateDiagnostics?.requestSelectedBuildingId ?? selectedBuildingId : null;
  const livePanelsSessionId = liveClimateBundle ? liveClimateDiagnostics?.requestSessionId ?? selectedAnalysisSessionId : null;
  const sameBuildingForLivePanels =
    livePanelsBuildingId && livePanelsSessionId
      ? livePanelsBuildingId === selectedBuildingId && livePanelsSessionId === selectedAnalysisSessionId
      : null;
  const staleResponseIgnored = Boolean(liveClimateDiagnostics?.ignoredStaleLiveResponse);
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
  const activeClimatePanelGeojson = hasLiveClimatePanelLayout
    ? liveClimatePanelGeojson
    : hasStaticClimatePanelLayout
      ? climatePanelGeojson
      : null;
  const activeClimatePanelFeatureCount = hasLiveClimatePanelLayout
    ? liveClimatePanelFeatureCount
    : hasStaticClimatePanelLayout
      ? staticClimatePanelFeatureCount
      : 0;
  const shouldRenderClimatePanelLayer = isSolarPanelLayerVisible && Boolean(activeClimatePanelGeojson);
  const shouldRenderGeneratedPanelLayer =
    isSolarPanelLayerVisible &&
    hasMapAnchoredGeometry &&
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
  const hasAnyPanelLayout = hasGeneratedPanelLayout || hasStaticClimatePanelLayout || hasLiveClimatePanelLayout;
  const hasPvAnalysisCompleted = pvAnalysisStatus === 'success' || pvAnalysisStatus === 'fallback';
  const hasResultDetailReady = hasPvAnalysisCompleted || hasLiveClimatePanelLayout;
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
  const liveBackendBaseUrl = typeof liveClimateDiagnostics?.backendBaseUrl === 'string' ? liveClimateDiagnostics.backendBaseUrl : '-';
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
  const climateExpectedRevenue = activeClimatePvOutput?.expected_revenue;
  const isSeparatePvCalculating = hasLiveClimatePanelLayout && pvAnalysisStatus === 'calculating';
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
  const simplePaybackSourceText = getSimplePaybackSourceText(simplePaybackSource);
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
    ['분석 소스', demoPanelSourceLabel],
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
    {
      title: '리포트 확인',
      state: hasResultDetailReady ? 'active' : 'pending',
      message: hasResultDetailReady
        ? '예상/추정 리포트를 확인하세요.'
        : '음영 분석 또는 발전량 분석 후 리포트가 활성화됩니다.',
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
      selectionMethod: resolvedPanelPlacementSourceLabel,
      moved: focusResult.moved,
      markerAdded: false,
    });
  }, [climateBundle, climatePocExtent, isClimatePanelModeEnabled, resolvedPanelPlacementSourceLabel, vworldMap]);

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

    const response = await requestPvAnalysis(input);

    setPvAnalysisResponse(response);
    setPvAnalysisStatus(response.ok ? 'success' : 'fallback');
    setPvAnalysisMessage(
      response.ok
        ? '경기 기후 플랫폼 응답을 시나리오 기준 값으로 표시합니다.'
        : response.message,
    );
  }, [selectedBuilding.estimatedPanelCount, selectedCoordinate, selectionMode]);

  const handleResultDetailRequest = useCallback(() => {
    const selectedAddress = selectedBuildingFootprint?.address ?? selectedBuilding.address;
    const result = buildStoredSimulationResult({
      building: {
        name: selectedBuildingFootprint?.name ?? selectedBuilding.apartmentName,
        roadAddress: selectedAddress,
        jibunAddress: selectedBuildingFootprint ? '지번 정보 확인 필요' : selectedBuilding.address,
        buildingId: selectedBuildingFootprint?.buildingId ?? 'demo-building',
      },
      liveClimateBundle:
        liveClimateStatus === 'success' && liveClimateBundle?.pv_analysis_output ? liveClimateBundle : null,
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
    const didSave = saveSimulationResultToSession(result);

    setAnalysisStatus(
      didSave
        ? '현재 선택 건물과 최신 예상 분석 결과를 저장하고 상세 리포트로 이동합니다.'
        : '브라우저 저장소를 사용할 수 없어 상세 리포트에서 시나리오 기준 예시값을 표시합니다.',
    );
    window.location.assign('/simulation/result');
  }, [
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
    const requestSessionId = selectedAnalysisSessionId;
    const requestSelectionId = mapSelectionRequestIdRef.current;
    const livePanelCapacityW = 640;
    const livePanelAngle = 35;
    const livePanelType = 1;
    const liveCellsPerPanel = 2;

    setLiveShadingStatus('trying');
    setLiveClimateStatus('loading');
    setLiveClimateStep('기본 분석 완료 · 음영 분석 시도 중');
    setLiveClimateError('');
    setLiveClimateDiagnostics(null);
    setLiveClimateBundle(null);
    setLiveClimatePanelGeojson(null);
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
      mode: 'fast',
    });
    const responseBuildingId = response.selectedBuildingId ?? response.diagnostics.requestSelectedBuildingId ?? requestSelectedBuildingId;
    const responseSessionId = response.selectedAnalysisSessionId ?? response.diagnostics.requestSessionId ?? requestSessionId;
    const currentBuildingId = selectedBuildingIdRef.current;
    const currentSessionId = selectedAnalysisSessionIdRef.current;
    const isStaleResponse =
      mapSelectionRequestIdRef.current !== requestSelectionId ||
      responseBuildingId !== currentBuildingId ||
      responseSessionId !== currentSessionId;

    if (isStaleResponse) {
      setLiveClimateDiagnostics((current) => ({
        ...(current ?? {}),
        requestSelectedBuildingId: responseBuildingId,
        requestSessionId: responseSessionId,
        ignoredStaleLiveResponse: true,
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
        : response.message || 'climate.gg 응답이 지연되어 기본 패널 배치를 표시합니다.';

      setLiveShadingStatus(
        response.analysisStage === 'shading-timeout' || response.diagnostics.timedOutStep ? 'timeout' : 'fallback',
      );
      setLiveClimateStatus(isNetworkFetchFailure ? 'error' : 'idle');
      setLiveClimateStep(
        response.disabled
          ? '백엔드 서버 연결 성공 · climate.gg 파이프라인 대기'
          : isNetworkFetchFailure
            ? '백엔드 서버 요청 실패'
            : '기본 배치 표시 중',
      );
      setLiveClimateError(fallbackMessage);
      setLiveClimateDiagnostics(response.diagnostics);
      setPvAnalysisStatus('idle');
      setPvAnalysisMessage(fallbackMessage);
      setAnalysisStatus(fallbackMessage);
      setIsSolarPanelLayerVisible(true);
      return;
    }

    const liveCompletionMessage = 'AI 음영 분석 완료';
    const pvInput: PvAnalysisInput = {
      latitude: response.bundle.pv_analysis_input.latitude,
      longitude: response.bundle.pv_analysis_input.longitude,
      shading_index_average: response.bundle.pv_analysis_input.shading_index_average,
      solar_panel_angle: Number(response.bundle.pv_analysis_input.solar_panel_angle) || livePanelAngle,
      solar_panel_info: {
        panel_capacity: response.bundle.pv_analysis_input.solar_panel_info.panel_capacity,
        panel_count: response.bundle.pv_analysis_input.solar_panel_info.panel_count,
        panel_type: response.bundle.pv_analysis_input.solar_panel_info.panel_type,
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
    setLiveClimateBundle(response.bundle);
    setLiveClimatePanelGeojson(response.panelsGeojson);
    setIsSolarPanelLayerVisible(true);
    setPvAnalysisStatus('calculating');
    setPvAnalysisMessage('발전량 계산 중...');
    setPvAnalysisResponse(interimScenarioResponse);
    setAnalysisStatus(`${liveCompletionMessage} · 발전량은 별도 계산 중`);

    const pvResponse = await requestPvAnalysis(pvInput);
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
        : nextPvResponse.message,
    );

    const storedResult = buildStoredSimulationResult({
      building: {
        name: selectedBuildingFootprint?.name ?? selectedBuilding.apartmentName,
        roadAddress: selectedBuildingFootprint?.address ?? selectedBuilding.address,
        jibunAddress: selectedBuildingFootprint ? '지번 정보 확인 필요' : selectedBuilding.address,
        buildingId: selectedBuildingFootprint?.buildingId ?? 'demo-building',
      },
      liveClimateBundle: response.bundle.pv_analysis_output ? response.bundle : null,
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
    hasSelectedBuilding,
    isClimateLiveBackendEnabled,
    selectedAnalysisSessionId,
    selectedBuilding.address,
    selectedBuilding.apartmentName,
    selectedBuilding.estimatedAnnualGenerationKwh,
    selectedBuilding.estimatedAnnualSavingsKrw,
    selectedBuilding.estimatedCapacityKw,
    selectedBuilding.estimatedPanelCount,
    selectedBuilding.estimatedPaybackYears,
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
        targetElement?.closest('.riskLegend') ||
        targetElement?.closest('.scenarioComparisonStrip')
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
      <header className="landingHeader riskMapHeader">
        <a className="logo" href="/" aria-label="솔라메이트 홈">
          <span className="sunMark" aria-hidden="true" />
          <span>
            <strong>솔라메이트</strong>
            <small>SolarMate</small>
          </span>
        </a>

        <nav className="desktopNav" aria-label="주요 메뉴">
          <a href="/#service-intro">서비스 소개</a>
          <a href="/risk-map">전기세 위험 진단</a>
          <a href="/#service-intro-status">절감 시나리오</a>
          <a href="/#solar-feed">정책 지원</a>
          <a href="/member/as">고객센터</a>
        </nav>

        <div className="headerActions">
          <button className="loginButton" type="button" onClick={() => window.location.assign('/member/dashboard')}>
            로그인
          </button>
          <a className="primaryButton headerCta" href="/risk-map">
            무료 진단 시작
          </a>
        </div>
      </header>

      <section className="riskMapIntro" aria-labelledby="risk-map-title">
        <span className="riskMapEyebrow">전기세 위험 지도</span>
        <div>
          <h1 id="risk-map-title">지도에서 우리 아파트의 전기세 위험을 확인하세요</h1>
          <p>
            3D 지도에서 건물을 선택하면 전기세 상승 위험 등급과 태양광 대응 가능성을 확인할 수 있습니다.
          </p>
        </div>
      </section>

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
              <label>
                <span>주소 또는 아파트명 검색</span>
                <input type="search" placeholder="예: 화성시 동탄역 인근 아파트" />
              </label>

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
              isActive={hasMapAnchoredGeometry}
              polygon={selectedBuildingGeometry ?? selectedRoofPolygon}
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
              pocId={activeClimateBundle?.meta.unq_id ?? DEFAULT_CLIMATE_POC_ID}
              panelSource={hasLiveClimatePanelLayout ? 'climate-live' : 'static-poc'}
              selectedBuildingId={selectedBuildingId}
              selectedAnalysisSessionId={selectedAnalysisSessionId}
              roofHeightM={activeClimateBundle?.meta.bldg_hgt ?? roofHeightEstimate.roofHeightM}
              onStatusChange={setClimatePanelLayerStatus}
            />

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
            </div>

            <div className="scenarioComparisonStrip" aria-label="전기세 위험과 태양광 대응 비교">
              <div>
                <span>미도입 시 5년 추가 부담 예상</span>
                <strong>{selectedBuilding.fiveYearExtraCost}</strong>
              </div>
              <div>
                <span>태양광 도입 시 예상 절감</span>
                <strong>예상 {selectedBuilding.estimatedAnnualSavingsKrw.toLocaleString('ko-KR')}원/년</strong>
              </div>
              <div>
                <span>보조금 적용 시 검토 가능성</span>
                <strong>{selectedBuilding.subsidyReview}</strong>
              </div>
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

              <p className="selectionNote">{selectedBuilding.selectionNote}</p>
              <p className={`selectionNote selectionFeedbackText is-${selectionFeedbackStatus}`}>
                {selectionFeedbackMessage}
              </p>
              <p className="selectionNote">
                지도 이동: {mapFocusStatus.message}
                {mapFocusStatus.method ? ` (${mapFocusStatus.method})` : ''}
                {mapFocusStatus.markerAdded ? ' · 선택 마커 표시' : ''}
                {mapFocusStatus.selectionSource || mapFocusStatus.selectionMethod
                  ? ` · 클릭 ${mapFocusStatus.selectionSource ?? '-'} / ${mapFocusStatus.selectionMethod ?? '-'}`
                  : ''}
              </p>

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

          {activeTab === 'solar' && (
            <>
              <div className="simulationSummary">
                <span>{selectedBuilding.simulationConfidence}</span>
                <strong>AI/공공데이터 기반 패널 배치 예시</strong>
                <p>{selectedBuilding.simulationNote}</p>
              </div>

              <div className="panelSourceSummary">
                <span>패널 배치 데이터 소스</span>
                <strong>{demoPanelSourceLabel}</strong>
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
                <button
                  className="developerDiagnosticsToggle"
                  type="button"
                  aria-expanded={isDeveloperDiagnosticsOpen}
                  onClick={() => setIsDeveloperDiagnosticsOpen((current) => !current)}
                >
                  개발자 진단 보기
                </button>
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
                  <strong>{demoPanelSourceLabel}</strong>
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
                  <strong>
                    {pvAnalysisResponse?.ok
                      ? pvAnalysisResponse.source
                      : pvAnalysisStatus === 'fallback'
                        ? 'local-scenario-fallback'
                        : pvAnalysisStatus === 'calculating'
                          ? 'separate-request-pending'
                          : '-'}
                  </strong>
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

              <button
                className="riskAnalysisButton pvAnalysisButton"
                type="button"
                onClick={handlePvAnalysisRequest}
                disabled={pvAnalysisStatus === 'calculating'}
              >
                {pvAnalysisStatus === 'calculating' ? '발전량 분석 중...' : '발전량 분석 실행'}
              </button>

              {pvAnalysisMessage && (
                <p
                  className={`pvAnalysisStatusText is-${pvAnalysisStatus}`}
                  role={pvAnalysisStatus === 'error' ? 'alert' : 'status'}
                >
                  {pvAnalysisMessage}
                </p>
              )}

              {pvAnalysisResult && (
                <section
                  className={`pvAnalysisPanel ${pvAnalysisResponse?.ok ? '' : 'isFallback'}`}
                  aria-label="발전량 분석 결과"
                >
                  <div className="pvAnalysisPanelHeader">
                    <span>
                      {pvAnalysisResponse?.ok
                        ? '경기 기후 플랫폼 응답 · 시나리오 기준'
                        : '대체 데모 산식 · 시나리오 기준'}
                    </span>
                    <strong>발전량 분석 결과</strong>
                    <p>
                      발전량과 경제효과는 예상·추정 값입니다. 실제 절감액은 전기요금, 자가소비율, 설비 조건,
                      정책 공고 확인 결과에 따라 달라질 수 있습니다.
                    </p>
                  </div>

                  <div className="pvResultGrid">
                    {pvAnalysisResultCards.map((card) => (
                      <div key={card.label}>
                        <span>{card.label}</span>
                        <strong>{card.render(pvAnalysisResult)}</strong>
                      </div>
                    ))}
                    <div>
                      <span>단순 회수기간 추정</span>
                      <strong>{simplePaybackText}</strong>
                      <small>{simplePaybackSourceText}</small>
                    </div>
                  </div>

                  {pvAnalysisResult.monthlyGenerationSeries.length > 0 && (
                    <div className="pvMonthlyChart" aria-label="월별 발전량 예상 차트">
                      <div className="pvMonthlyChartHeader">
                        <strong>월별 발전량 예상</strong>
                        <span>시나리오 기준</span>
                      </div>
                      <ol>
                        {pvAnalysisResult.monthlyGenerationSeries.map((item) => (
                          <li key={item.month}>
                            <span>{item.month}월</span>
                            <div aria-hidden="true">
                              <i style={{ inlineSize: `${Math.max(3, (item.generationKwh / monthlyGenerationMaxKwh) * 100)}%` }} />
                            </div>
                            <strong>{Math.round(item.generationKwh).toLocaleString('ko-KR')}kWh</strong>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </section>
              )}

              <label className="panelToggleRow">
                <span>지도에 태양광 패널 표시</span>
                <input
                  type="checkbox"
                  checked={isSolarPanelLayerVisible}
                  onChange={(event) => {
                    panelVisibilityUserOverrideRef.current = true;
                    setIsSolarPanelLayerVisible(event.target.checked);
                  }}
                />
              </label>

              <button
                className="riskAnalysisButton resultDetailButton"
                type="button"
                onClick={handleResultDetailRequest}
              >
                결과 상세보기
              </button>

              <p className="assumptionNote">
                MVP 산식 기준: 설치가능면적 {Math.round(mvpAssumptionPreview.installableAreaM2).toLocaleString('ko-KR')}
                ㎡, 용량 {Math.round(mvpAssumptionPreview.capacityKw).toLocaleString('ko-KR')}kW, 연 발전량{' '}
                {Math.round(mvpAssumptionPreview.annualGenerationKwh).toLocaleString('ko-KR')}kWh, 연 절감액{' '}
                {Math.round(mvpAssumptionPreview.annualSavingsKrw).toLocaleString('ko-KR')}원 예시입니다.
              </p>
            </>
          )}

          {activeTab === 'policy' && (
            <div className="policyReviewPanel">
              <h3>보조금 검토 가능성</h3>
              <strong>{selectedBuilding.subsidyReview}</strong>
              <p>
                보조금은 공고 기준 확인 필요 상태입니다. 접수 가능 여부와 지원 규모는 지자체 예산, 건물 조건,
                신청 시점에 따라 달라질 수 있습니다.
              </p>
              <ul>
                <li>경기도/지자체 공고 기준 확인 필요</li>
                <li>공동주택 관리주체 동의 및 구조 검토 필요</li>
                <li>정책자금 접근성 향상을 위한 신청 지원 검토 가능</li>
              </ul>
            </div>
          )}

          {analysisStatus && <p className="analysisStatus">{analysisStatus}</p>}

          <p className="riskDisclaimer">
            본 태양광 가상 설치는 브이월드 공간정보와 입력값 기반의 1차 추정입니다. 실제 설치 가능 여부,
            발전량, 절감액은 현장조사, 옥상 장애물, 음영, 구조안전성, 설비 사양, 관리주체 협의, 정책 공고
            기준에 따라 달라질 수 있습니다. 실제 설치 가능 여부는 옥상 장애물, 음영, 구조안전성, 관리주체 협의,
            현장조사에 따라 달라질 수 있습니다.
          </p>
        </aside>
      </section>
    </main>
  );
}

export default RiskMapPage;
