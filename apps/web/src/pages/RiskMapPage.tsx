import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import VWorldSelectableBuildingLayer, {
  type VWorldSelectableBuildingLayerStatus,
} from '../components/VWorldSelectableBuildingLayer';
import VWorldSelectedBuildingLayer from '../components/VWorldSelectedBuildingLayer';
import VWorldSolarPanelLayer, {
  deriveRoofHeightMFromFeature,
  type VWorldSolarPanelLayerStatus,
} from '../components/VWorldSolarPanelLayer';
import {
  focusVWorldMapOnCoordinate,
  initVWorld3DMap,
  loadVWorldScript,
  markVWorldMapSelection,
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
import { generateSolarPanelLayout, type SolarPanelLayoutResult } from '../lib/solarPanelLayout';
import { requestPvAnalysis } from '../lib/pvAnalysisClient';
import { requestSelectedBuildingPolygon } from '../lib/buildingPolygonClient';
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
} from '../lib/buildingFootprints';
import {
  buildVWorldFeatureProxyPath,
  getConfiguredVWorldBuildingDataId,
  getVWorldFeatureDataTypeInfo,
  queryVWorldFeaturesByPoint,
  type VWorldFeature,
  type VWorldFeatureQueryStatus,
} from '../lib/vworldFeatureQuery';
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

type MapLoadStatus = 'loading' | 'ready' | 'error';
type RiskPanelTab = 'risk' | 'solar' | 'policy';
type SelectionMode = 'screen-fallback' | 'coordinate-fallback' | 'parcel-fallback' | 'geometry' | 'building_footprint';
type PvAnalysisStatus = 'idle' | 'loading' | 'success' | 'fallback' | 'error';
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
  address: string;
  name: string;
  geometryType: 'Polygon' | 'MultiPolygon';
} | null;

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
  ['예상 회수기간', 'estimatedPaybackYears', 'years'],
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

function formatEstimatedKrw(value: number) {
  return `추정 ${Math.round(value).toLocaleString('ko-KR')}원`;
}

function formatEstimatedKg(value: number) {
  return `추정 ${Math.round(value).toLocaleString('ko-KR')}kg`;
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

function formatPanelCoordinates(polygon: PolygonCoordinates | null) {
  if (!polygon || polygon.length === 0) {
    return '-';
  }

  return polygon
    .slice(0, 4)
    .map(([longitude, latitude]) => `[${longitude.toFixed(7)}, ${latitude.toFixed(7)}]`)
    .join(' ');
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
    estimatedPaybackYears: capacity > 0 ? Number(Math.max(4.2, 680000 / Math.max(capacity, 1)).toFixed(1)) : 0,
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
  const [pvAnalysisStatus, setPvAnalysisStatus] = useState<PvAnalysisStatus>('idle');
  const [pvAnalysisMessage, setPvAnalysisMessage] = useState('');
  const [pvAnalysisResponse, setPvAnalysisResponse] = useState<PvAnalysisProxyResponse | null>(null);
  const [isSolarPanelLayerVisible, setIsSolarPanelLayerVisible] = useState(false);
  const panelVisibilityUserOverrideRef = useRef(false);
  const [vworldMap, setVworldMap] = useState<VWorldMapInstance | null>(null);
  const vworldMapRef = useRef<VWorldMapInstance | null>(null);
  const [selectedCoordinate, setSelectedCoordinate] = useState<Coordinate | null>(null);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('screen-fallback');
  const [geometryQueryStatus, setGeometryQueryStatus] = useState<GeometryQueryStatus>('idle');
  const [geometryQueryMessage, setGeometryQueryMessage] = useState('건물을 클릭하면 브이월드 공간정보 조회를 시도합니다.');
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
  const [buildingFootprintLoadState, setBuildingFootprintLoadState] = useState<BuildingFootprintLoadState>(
    createInitialBuildingFootprintLoadState,
  );
  const [selectedBuildingFootprint, setSelectedBuildingFootprint] = useState<SelectedBuildingFootprint>(null);
  const [selectedBuildingFeature, setSelectedBuildingFeature] = useState<SelectableBuildingFeature | null>(null);
  const [selectedBuildingGeometry, setSelectedBuildingGeometry] = useState<PolygonCoordinates | null>(null);
  const [selectedRoofPolygon, setSelectedRoofPolygon] = useState<PolygonCoordinates | null>(null);
  const [selectableBuildingPolygons, setSelectableBuildingPolygons] = useState<PolygonCoordinates[]>([]);
  const [solarPanelPolygons, setSolarPanelPolygons] = useState<PolygonCoordinates[]>([]);
  const [selectableLayerStatus, setSelectableLayerStatus] = useState<VWorldSelectableBuildingLayerStatus>({
    state: 'idle',
    message: '선택 가능한 건물 테두리는 후보 파일 로드 후 표시됩니다.',
  });
  const [panelLayerStatus, setPanelLayerStatus] = useState<VWorldSolarPanelLayerStatus>({
    state: 'idle',
    message: '태양광 패널 지도 레이어가 꺼져 있습니다.',
    panelPolygonCount: 0,
    firstPanelCoordinates: null,
    roofHeightM: 20,
    renderMethod: '-',
  });
  const hasMapAnchoredGeometry =
    selectionMode === 'geometry' || selectionMode === 'parcel-fallback' || selectionMode === 'building_footprint';
  const shouldShowDevDiagnostics = import.meta.env.DEV;
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
  const selectedBuildingId = selectedBuildingFootprint?.buildingId ?? null;
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
  const hasPvAnalysisCompleted = pvAnalysisStatus === 'success' || pvAnalysisStatus === 'fallback';
  const riskProcessSteps: RiskProcessStep[] = [
    {
      title: '건물 선택',
      state: !isBuildingPolygonDataReady ? 'disabled' : hasSelectedBuilding ? 'complete' : 'active',
      message: !isBuildingPolygonDataReady
        ? '화성시 건물 polygon 데이터 연결 필요'
        : hasSelectedBuilding
          ? `${selectedBuildingFootprint?.buildingId ?? '선택 건물'} 선택 완료`
          : '지도에서 분석할 건물을 선택하세요.',
    },
    {
      title: '태양광 패널 배치',
      state: !hasSelectedBuilding ? 'pending' : hasGeneratedPanelLayout ? 'complete' : 'active',
      message: hasGeneratedPanelLayout
        ? `건물 footprint 기반 옥상 추정으로 ${solarPanelPolygons.length.toLocaleString('ko-KR')}개 패널 후보를 배치했습니다.`
        : hasSelectedBuilding
          ? '건물 footprint 기반 옥상 추정으로 패널 배치를 계산합니다.'
          : '건물 선택 후 패널 배치를 확인할 수 있습니다.',
    },
    {
      title: '발전량 분석',
      state: hasPvAnalysisCompleted ? 'complete' : hasGeneratedPanelLayout ? 'active' : 'pending',
      message: hasPvAnalysisCompleted
        ? '발전량 분석이 완료되었습니다.'
        : hasGeneratedPanelLayout
          ? '패널 배치 결과로 발전량 분석을 실행하세요.'
          : '패널 배치 후 발전량 분석을 실행할 수 있습니다.',
    },
    {
      title: '리포트 확인',
      state: hasPvAnalysisCompleted ? 'active' : 'pending',
      message: hasPvAnalysisCompleted
        ? '예상 발전량과 경제성 리포트를 확인하세요.'
        : '발전량 분석 완료 후 리포트가 활성화됩니다.',
    },
  ];

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

  const applyBuildingFootprintSelection = useCallback(
    (match: BuildingFootprintMatch, coordinate: Coordinate) => {
      const polygon = normalizeGeoJsonPolygon(match.feature);

      if (!polygon) {
        setGeometryQueryStatus('not-found');
        setGeometryQueryMessage('선택 좌표에서 건물 polygon을 찾았지만 표시 가능한 Polygon/MultiPolygon 좌표가 없습니다.');
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
      const layoutResult = generateSolarPanelLayout(roofPolygon);
      const panelPolygons = layoutResult.panelPolygons;
      const solarEstimate = createSolarEstimateFromPanelLayout(layoutResult);
      const layoutWarningMessage = layoutResult.warnings.length > 0 ? ` ${layoutResult.warnings.join(' ')}` : '';
      const refinedFocusResult = focusVWorldMapOnCoordinate(vworldMapRef.current, {
        longitude: roofCentroid[0],
        latitude: roofCentroid[1],
        height: 160,
        pitch: -82,
      });
      const refinedMarkerAdded = markVWorldMapSelection(vworldMapRef.current, {
        longitude: coordinate[0],
        latitude: coordinate[1],
        label: '선택 건물',
      });

      setSelectedBuildingFootprint(match.metadata);
      setSelectedBuildingFeature(match.feature);
      setSelectedBuildingGeometry(polygon);
      setSelectedRoofPolygon(roofPolygon);
      setSolarPanelPolygons(panelPolygons);
      panelVisibilityUserOverrideRef.current = false;
      setIsSolarPanelLayerVisible(activeTab === 'solar' && panelPolygons.length > 0);
      setMapFocusStatus({
        message: refinedFocusResult.message,
        method: refinedFocusResult.method,
        moved: refinedFocusResult.moved,
        markerAdded: refinedMarkerAdded,
      });
      setSelectionMode('building_footprint');
      setGeometryQueryStatus('found');
      setGeometryQueryMessage(
        `건물 footprint 기반 옥상 추정: ${match.metadata.geometryType} geometry에서 ${panelPolygons.length.toLocaleString(
          'ko-KR',
        )}개 패널 후보를 배치했습니다.${layoutWarningMessage}`,
      );
      setFeatureDataInfo({
        dataId: getBuildingSourceDataId(buildingPolygonSource),
        dataTypeLabel: getBuildingPolygonSourceLabel(buildingPolygonSource),
        isActualRoofPolygon: false,
        dataTypeNote:
          '건물 footprint 기반 옥상 추정입니다. 정확한 옥상 polygon 또는 장애물 데이터가 아니므로 현장조사가 필요합니다.',
        sourceKind: 'building-or-roof',
      });
      setFeatureQueryDiagnostics({
        queryStatus: 'success',
        featureCount: buildingFootprints?.features.length ?? 0,
        requestedLon: coordinate[0],
        requestedLat: coordinate[1],
        dataId: getBuildingSourceDataId(buildingPolygonSource),
        buffer: 0,
        requestPath: buildingFootprintLoadState.url,
      });
      setSelectedBuilding({
        ...demoBuilding,
        apartmentName: match.metadata.name,
        address: match.metadata.address,
        ...solarEstimate,
        selectionNote: `building_id ${match.metadata.buildingId} / ${match.metadata.geometryType} 기반으로 선택했습니다.`,
        simulationConfidence: '건물 footprint 기반 옥상 추정',
        simulationNote: `건물 footprint 기반 옥상 추정입니다. ${layoutResult.reason ?? ''} 실제 설치 가능 여부는 옥상 장애물, 음영, 구조안전성, 관리주체 협의, 현장조사에 따라 달라질 수 있습니다.`,
      });
    },
    [activeTab, buildingFootprintLoadState.url, buildingFootprints?.features.length, buildingPolygonSource],
  );

  const handleMapSelection = useCallback(async (selection?: VWorldSelection) => {
    const coordinate =
      typeof selection?.longitude === 'number' && typeof selection.latitude === 'number'
        ? ([selection.longitude, selection.latitude] as Coordinate)
        : null;

    setAnalysisStatus('');
    setPvAnalysisStatus('idle');
    setPvAnalysisMessage('');
    setPvAnalysisResponse(null);

    if (!coordinate) {
      setSelectionMode('screen-fallback');
      setGeometryQueryStatus('idle');
      setGeometryQueryMessage('지도 좌표가 없어 화면 기준 예시 배치를 표시합니다.');
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
        moved: false,
        markerAdded: false,
      });
      setSelectedBuilding({
        ...demoBuilding,
        selectionNote: '선택 위치 기준 1차 추정입니다. 실제 건물 도형을 찾지 못해 화면 기준 예시 배치를 표시합니다.',
      });
      return;
    }

    setSelectedCoordinate(coordinate);
    setSelectedBuildingFootprint(null);
    setSelectedBuildingFeature(null);
    const dataId = getConfiguredVWorldBuildingDataId();
    const buffer = 10;
    const requestPath = buildVWorldFeatureProxyPath({
      longitude: coordinate[0],
      latitude: coordinate[1],
      dataId,
      bufferMeters: buffer,
    });
    const initialFocusResult = focusVWorldMapOnCoordinate(vworldMapRef.current, {
      longitude: coordinate[0],
      latitude: coordinate[1],
      height: 180,
      pitch: -82,
    });
    const markerAdded = markVWorldMapSelection(vworldMapRef.current, {
      longitude: coordinate[0],
      latitude: coordinate[1],
    });

    setMapFocusStatus({
      message: initialFocusResult.message,
      method: initialFocusResult.method,
      moved: initialFocusResult.moved,
      markerAdded,
    });
    setSelectionMode('coordinate-fallback');
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
    setSelectedBuildingGeometry(null);
    setSelectedRoofPolygon(null);
    setSelectableBuildingPolygons([]);
    setSolarPanelPolygons([]);
    setIsSolarPanelLayerVisible(false);
    panelVisibilityUserOverrideRef.current = false;

    const buildingPolygonResult = await requestSelectedBuildingPolygon({
      longitude: coordinate[0],
      latitude: coordinate[1],
    });

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
          },
        },
        coordinate,
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
          '건물 footprint 기반 옥상 추정입니다. 정확한 옥상 polygon 또는 장애물 데이터가 아니므로 현장조사가 필요합니다.',
        sourceKind: 'building-or-roof',
      });
      setFeatureQueryDiagnostics({
        queryStatus: 'success',
        featureCount:
          buildingPolygonResult.building.source === 'admdong_index'
            ? diagnostics?.searchedFeatureCount ?? 0
            : buildingPolygonResult.building.source === 'geojson'
              ? buildingFootprints?.features.length ?? 0
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
    setGeometryQueryStatus(
      buildingPolygonResult.status === 'unconfigured'
        ? 'unconfigured'
        : buildingPolygonResult.status === 'not_found'
          ? 'not-found'
          : 'error',
    );
    setGeometryQueryMessage(buildingPolygonResult.message);
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
            ? buildingFootprints?.features.length ?? 0
            : 0,
      requestedLon: coordinate[0],
      requestedLat: coordinate[1],
      dataId: getBuildingSourceDataId(buildingPolygonResult.source),
      buffer: 0,
      requestPath: getBuildingSourceRequestPath(buildingPolygonResult.source, buildingPolygonResult.diagnostics),
      errorMessage: buildingPolygonResult.status === 'error' ? buildingPolygonResult.message : undefined,
    });
    setSelectedBuilding({
      ...demoBuilding,
      selectionNote: buildingPolygonResult.message,
      simulationConfidence: '건물 polygon 미선택',
      simulationNote: buildingPolygonResult.message,
    });
    return;

  }, [applyBuildingFootprintSelection, buildingPolygonSource, buildingFootprints]);

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

    setPvAnalysisStatus('loading');
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

  const handleRiskAnalysisRequest = useCallback(async () => {
    setAnalysisStatus('선택 건물 기준 위험 분석과 발전량 분석을 함께 실행합니다.');
    setActiveTab('solar');
    await handlePvAnalysisRequest();
  }, [handlePvAnalysisRequest]);

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
          '건물 footprint 기반 옥상 추정입니다. 정확한 옥상 polygon 또는 장애물 데이터가 아니므로 현장조사가 필요합니다.',
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
          onSelect: handleMapSelection,
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
  }, [handleMapSelection]);

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
          <a href="/#contact">고객센터</a>
        </nav>

        <div className="headerActions">
          <button className="loginButton" type="button">
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
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                void handleMapSelection();
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
            />

            <VWorldSolarPanelLayer
              map={vworldMap}
              visible={isSolarPanelLayerVisible && hasMapAnchoredGeometry}
              selectedBuildingFeature={selectedBuildingFeature}
              selectedBuildingId={selectedBuildingId}
              panelPolygons={solarPanelPolygons}
              roofHeightM={roofHeightEstimate.roofHeightM}
              onStatusChange={setPanelLayerStatus}
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
              <p className="selectionNote">
                지도 이동: {mapFocusStatus.message}
                {mapFocusStatus.method ? ` (${mapFocusStatus.method})` : ''}
                {mapFocusStatus.markerAdded ? ' · 선택 마커 표시' : ''}
              </p>

              <button
                className="riskAnalysisButton"
                type="button"
                onClick={handleRiskAnalysisRequest}
                disabled={pvAnalysisStatus === 'loading'}
              >
                {pvAnalysisStatus === 'loading' ? '발전량 분석 중...' : '이 건물로 위험 분석 시작'}
              </button>
            </>
          )}

          {activeTab === 'solar' && (
            <>
              <div className="simulationSummary">
                <span>{selectedBuilding.simulationConfidence}</span>
                <strong>태양광 가상 설치 시뮬레이션</strong>
                <p>{selectedBuilding.simulationNote}</p>
              </div>

              <div className="geometryStatusBox">
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
                  </strong>
                </div>
                <div>
                  <span>데이터 소스</span>
                  <strong>{featureDataInfo.dataTypeLabel}</strong>
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
                  <span>실제 옥상 polygon 여부</span>
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
                  <span>옥상 polygon 상태</span>
                  <strong>{getRoofPolygonStatusText(selectionMode, selectedRoofPolygon)}</strong>
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
                      ? `좌표 고정 지도 객체 ${panelLayerStatus.panelPolygonCount.toLocaleString('ko-KR')}개 표시`
                      : panelLayerStatus.message}
                  </strong>
                </div>
                <div>
                  <span>지도 객체 렌더링 방식</span>
                  <strong>{panelLayerStatus.renderMethod}</strong>
                </div>
                <div>
                  <span>roofHeightM</span>
                  <strong>
                    {panelLayerStatus.roofHeightM.toLocaleString('ko-KR')}m
                    {panelLayerStatus.heightMessage ? ` · ${panelLayerStatus.heightMessage}` : ''}
                  </strong>
                </div>
                <p>{geometryQueryMessage}</p>
                <p>{featureDataInfo.dataTypeNote}</p>
                {hasSelectedBuildingPolygon && solarPanelPolygons.length === 0 && (
                  <p role="status">선택 건물에서 배치 가능한 패널을 계산하지 못했습니다.</p>
                )}
              </div>

              {shouldShowDevDiagnostics && (
                <div className="devDiagnosticsPanel" aria-label="개발용 건물 polygon 매칭 진단">
                  <strong>개발용 건물 polygon 매칭 진단</strong>
                  <dl>
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
                      <dd>{featureQueryDiagnostics.requestedLat?.toFixed(6) ?? '-'}</dd>
                    </div>
                    <div>
                      <dt>selected lon</dt>
                      <dd>{featureQueryDiagnostics.requestedLon?.toFixed(6) ?? '-'}</dd>
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
                    <dt>{label}</dt>
                    <dd>{formatSolarValue(selectedBuilding[key], unit)}</dd>
                  </div>
                ))}
              </dl>

              <button
                className="riskAnalysisButton pvAnalysisButton"
                type="button"
                onClick={handlePvAnalysisRequest}
                disabled={pvAnalysisStatus === 'loading'}
              >
                {pvAnalysisStatus === 'loading' ? '발전량 분석 중...' : '발전량 분석 실행'}
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
                className="riskAnalysisButton"
                type="button"
                onClick={() => setAnalysisStatus('태양광 도입 기준 절감 시나리오 초안이 준비되었습니다.')}
              >
                절감 시나리오 보기
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
