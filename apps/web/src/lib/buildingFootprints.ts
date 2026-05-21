import { booleanPointInPolygon, point } from '@turf/turf';
import type { BuildingPolygonFeatureCollection, BuildingPolygonSourceMode } from '../types/buildingPolygon';
import type { VWorldFeature } from './vworldFeatureQuery';

export type BuildingFootprintFeature = VWorldFeature & {
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: unknown;
  };
  properties: Record<string, unknown>;
};

export type BuildingFootprintCollection = {
  type: 'FeatureCollection';
  features: BuildingFootprintFeature[];
};

export type BuildingFootprintLookupStatus =
  | 'idle'
  | 'index_loading'
  | 'index_loaded'
  | 'candidate_loading'
  | 'selected'
  | 'not_found'
  | 'error';

export type BuildingAdmdongIndexEntry = {
  admdongName: string;
  filename: string;
  featureCount: number;
  bbox: [minLon: number, minLat: number, maxLon: number, maxLat: number];
  sizeBytes?: number;
};

export type BuildingAdmdongIndex = {
  sigungu?: string;
  sigunguCode?: string;
  url: string;
  entries: BuildingAdmdongIndexEntry[];
};

export type BuildingFootprintDiagnostics = {
  sourceMode: BuildingPolygonSourceMode;
  status: BuildingFootprintLookupStatus;
  indexLoaded: boolean;
  indexEntryCount: number;
  candidateFileCount: number;
  loadedFileNames: string[];
  searchedFeatureCount: number;
  matchedBuildingId: string | null;
  matchedAddress: string | null;
  selectedGeometryType: 'Polygon' | 'MultiPolygon' | null;
  indexUrl: string;
  metaUrl: string;
  message: string;
};

export type BuildingFootprintLoadState = {
  status: BuildingFootprintLookupStatus;
  url: string;
  collection: BuildingFootprintCollection | null;
  index: BuildingAdmdongIndex | null;
  diagnostics: BuildingFootprintDiagnostics;
  message: string;
};

export type BuildingFootprintMatch = {
  feature: BuildingFootprintFeature;
  metadata: {
    buildingId: string;
    address: string;
    name: string;
    geometryType: 'Polygon' | 'MultiPolygon';
  };
};

export type BuildingFootprintSelectionResult =
  | {
      status: 'selected';
      match: BuildingFootprintMatch;
      diagnostics: BuildingFootprintDiagnostics;
      candidateFeatures: BuildingFootprintFeature[];
      message: string;
    }
  | {
      status: 'not_found' | 'error';
      match: null;
      diagnostics: BuildingFootprintDiagnostics;
      candidateFeatures: BuildingFootprintFeature[];
      message: string;
    };

export type BuildingFootprintCoordinateSummary = {
  minLon: number | null;
  maxLon: number | null;
  minLat: number | null;
  maxLat: number | null;
  coordinateCount: number;
  projectedLikeCoordinateCount: number;
  hasProjectedCoordinateWarning: boolean;
};

const DEFAULT_GEOJSON_URL = '/data/buildings/hwaseong-buildings.geojson';
const DEFAULT_ADMDONG_INDEX_URL = '/data/buildings/hwaseong_buildings_v1_by_admdong/index.json';
const DEFAULT_BUILDING_META_URL = '/data/buildings/hwaseong_buildings_v1_meta.json';
const BUILDING_POLYGON_UNCONFIGURED_MESSAGE = '화성시 건물 polygon 데이터가 아직 연결되지 않았습니다.';
const ADMDONG_SOURCE_LABEL = 'VWorld GIS건물통합정보 AL_D010, 화성시 필터, 행정동 분할';
const PROJECTED_COORDINATE_MIN = 100_000;
const PROJECTED_COORDINATE_MAX = 1_000_000;

type TurfPolygonInput = Parameters<typeof booleanPointInPolygon>[1];

let cachedIndexUrl = '';
let cachedIndex: BuildingAdmdongIndex | null = null;
let indexLoadPromise: Promise<BuildingAdmdongIndex> | null = null;
const loadedAdmdongCollections = new Map<string, BuildingFootprintCollection>();
const loadedAdmdongFileNames = new Map<string, string>();
const loadingAdmdongCollections = new Map<string, Promise<BuildingFootprintCollection>>();

function getStringProperty(properties: Record<string, unknown>, keys: string[], fallback: string) {
  for (const key of keys) {
    const value = properties[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }

  return fallback;
}

function getAddressProperty(properties: Record<string, unknown>) {
  const directAddress = getStringProperty(
    properties,
    ['address', 'addr', 'road_address', 'jibun_address', 'rn_addr', 'bd_addr', 'A3', 'A4'],
    '',
  );

  if (directAddress) {
    return directAddress;
  }

  const admdongName = getStringProperty(properties, ['admdong_name'], '');
  const jibun = getStringProperty(properties, ['jibun'], '');

  if (admdongName && jibun) {
    return `${admdongName} ${jibun}`;
  }

  return '주소 속성 미제공';
}

function isBuildingFootprintFeature(value: unknown): value is BuildingFootprintFeature {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const feature = value as VWorldFeature;

  return (
    feature.type === 'Feature' &&
    Boolean(feature.geometry) &&
    (feature.geometry?.type === 'Polygon' || feature.geometry?.type === 'MultiPolygon')
  );
}

function isProjectedLikeValue(value: number) {
  const absolute = Math.abs(value);
  return absolute >= PROJECTED_COORDINATE_MIN && absolute <= PROJECTED_COORDINATE_MAX;
}

function visitPosition(position: unknown, visitor: (longitude: number, latitude: number) => void) {
  if (!Array.isArray(position) || position.length < 2) {
    return false;
  }

  const [longitude, latitude] = position;

  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return false;
  }

  visitor(longitude, latitude);
  return true;
}

function visitPolygonCoordinates(coordinates: unknown, visitor: (longitude: number, latitude: number) => void) {
  if (!Array.isArray(coordinates)) {
    return;
  }

  coordinates.forEach((ring) => {
    if (!Array.isArray(ring)) {
      return;
    }

    ring.forEach((position) => visitPosition(position, visitor));
  });
}

function visitFeatureCoordinates(feature: BuildingFootprintFeature, visitor: (longitude: number, latitude: number) => void) {
  if (feature.geometry.type === 'Polygon') {
    visitPolygonCoordinates(feature.geometry.coordinates, visitor);
    return;
  }

  if (Array.isArray(feature.geometry.coordinates)) {
    feature.geometry.coordinates.forEach((polygonCoordinates) => visitPolygonCoordinates(polygonCoordinates, visitor));
  }
}

function isNumberBbox(value: unknown): value is [number, number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
  );
}

function readIndexEntries(value: unknown): BuildingAdmdongIndexEntry[] {
  if (!value || typeof value !== 'object') {
    return [];
  }

  const files = (value as { files?: unknown }).files;

  if (!Array.isArray(files)) {
    return [];
  }

  return files.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [];
    }

    const record = item as Record<string, unknown>;
    const filename = typeof record.file === 'string' ? record.file : typeof record.filename === 'string' ? record.filename : '';
    const featureCount = typeof record.feature_count === 'number' ? record.feature_count : Number(record.featureCount ?? 0);

    if (!filename || !isNumberBbox(record.bbox)) {
      return [];
    }

    return [
      {
        admdongName: typeof record.admdong_name === 'string' ? record.admdong_name : '',
        filename,
        featureCount: Number.isFinite(featureCount) ? featureCount : 0,
        bbox: record.bbox,
        sizeBytes: typeof record.size_bytes === 'number' ? record.size_bytes : undefined,
      },
    ];
  });
}

function createMatch(feature: BuildingFootprintFeature): BuildingFootprintMatch {
  const properties = feature.properties;

  return {
    feature,
    metadata: {
      buildingId: getStringProperty(
        properties,
        ['bld_id', 'building_id', 'buildingId', 'bldg_id', 'bdmgt_sn', 'BD_MGT_SN', 'id', 'pnu', 'PNU'],
        String(feature.id ?? 'ID 속성 미제공'),
      ),
      address: getAddressProperty(properties),
      name: getStringProperty(
        properties,
        ['name', 'building_name', 'bldg_name', 'apartment_name', 'dong_name', 'A1', 'usage_name'],
        '건물명 정보 없음',
      ),
      geometryType: feature.geometry.type,
    },
  };
}

function isPointInsideFeature(feature: BuildingFootprintFeature, coordinate: [longitude: number, latitude: number]) {
  try {
    return booleanPointInPolygon(
      point(coordinate),
      {
        type: 'Feature',
        properties: feature.properties ?? {},
        geometry: feature.geometry,
      } as TurfPolygonInput,
      { ignoreBoundary: false },
    );
  } catch {
    return false;
  }
}

function containsCoordinate(entry: BuildingAdmdongIndexEntry, coordinate: [longitude: number, latitude: number]) {
  const [longitude, latitude] = coordinate;
  const [minLon, minLat, maxLon, maxLat] = entry.bbox;

  return longitude >= minLon && longitude <= maxLon && latitude >= minLat && latitude <= maxLat;
}

function getAdmdongFileUrl(indexUrl: string, filename: string) {
  const baseUrl = indexUrl.slice(0, indexUrl.lastIndexOf('/') + 1);

  return `${baseUrl}${encodeURIComponent(filename)}`;
}

function getLoadedAdmdongFileNames() {
  return Array.from(loadedAdmdongFileNames.values()).sort((a, b) => a.localeCompare(b, 'ko-KR'));
}

export function getBuildingFootprintGeoJsonUrl() {
  return import.meta.env.VITE_BUILDING_FOOTPRINT_GEOJSON_URL?.trim() || DEFAULT_GEOJSON_URL;
}

export function getBuildingAdmdongIndexUrl() {
  return import.meta.env.VITE_BUILDING_ADMDONG_INDEX_URL?.trim() || DEFAULT_ADMDONG_INDEX_URL;
}

export function getBuildingMetaUrl() {
  return import.meta.env.VITE_BUILDING_META_URL?.trim() || DEFAULT_BUILDING_META_URL;
}

export function getConfiguredBuildingPolygonSource(): BuildingPolygonSourceMode {
  const source = import.meta.env.VITE_BUILDING_POLYGON_SOURCE?.trim().toLowerCase();

  if (source === 'api' || source === 'geojson' || source === 'admdong_index' || source === 'none') {
    return source;
  }

  return 'admdong_index';
}

export function getBuildingPolygonSourceLabel(source: BuildingPolygonSourceMode) {
  if (source === 'api') {
    return '화성시 건물 polygon API';
  }

  if (source === 'geojson') {
    return '화성시 건물 GeoJSON';
  }

  if (source === 'admdong_index') {
    return ADMDONG_SOURCE_LABEL;
  }

  return '건물 polygon 데이터 미연결';
}

export function getBuildingPolygonUnconfiguredMessage() {
  return BUILDING_POLYGON_UNCONFIGURED_MESSAGE;
}

export function isBuildingFootprintGeoJsonEnabled() {
  return getConfiguredBuildingPolygonSource() === 'geojson';
}

export function isBuildingAdmdongIndexEnabled() {
  return getConfiguredBuildingPolygonSource() === 'admdong_index';
}

export function createBuildingFootprintDiagnostics(
  overrides: Partial<BuildingFootprintDiagnostics> = {},
): BuildingFootprintDiagnostics {
  const sourceMode = getConfiguredBuildingPolygonSource();

  return {
    sourceMode,
    status: 'idle',
    indexLoaded: false,
    indexEntryCount: 0,
    candidateFileCount: 0,
    loadedFileNames: getLoadedAdmdongFileNames(),
    searchedFeatureCount: 0,
    matchedBuildingId: null,
    matchedAddress: null,
    selectedGeometryType: null,
    indexUrl: getBuildingAdmdongIndexUrl(),
    metaUrl: getBuildingMetaUrl(),
    message: '건물 footprint 데이터 로드 대기 중',
    ...overrides,
  };
}

export function validateBuildingFootprintCollection(value: unknown): BuildingFootprintCollection {
  if (!value || typeof value !== 'object') {
    throw new Error('건물 footprint GeoJSON 응답이 객체가 아닙니다.');
  }

  const collection = value as { type?: unknown; features?: unknown };

  if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    throw new Error('건물 footprint 파일이 GeoJSON FeatureCollection 형식이 아닙니다.');
  }

  const features = collection.features.filter(isBuildingFootprintFeature).map((feature) => ({
    ...feature,
    properties: feature.properties ?? {},
  }));

  return {
    type: 'FeatureCollection',
    features,
  };
}

export async function loadBuildingFootprints(url = getBuildingFootprintGeoJsonUrl()) {
  if (!url) {
    throw new Error(BUILDING_POLYGON_UNCONFIGURED_MESSAGE);
  }

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      response.status === 404 ? `건물 footprint GeoJSON 파일을 찾지 못했습니다: ${url}` : BUILDING_POLYGON_UNCONFIGURED_MESSAGE,
    );
  }

  return validateBuildingFootprintCollection(await response.json());
}

export async function loadBuildingFootprintIndex(indexUrl = getBuildingAdmdongIndexUrl()) {
  if (!indexUrl) {
    throw new Error(BUILDING_POLYGON_UNCONFIGURED_MESSAGE);
  }

  if (cachedIndex && cachedIndexUrl === indexUrl) {
    return cachedIndex;
  }

  if (indexLoadPromise && cachedIndexUrl === indexUrl) {
    return indexLoadPromise;
  }

  cachedIndexUrl = indexUrl;
  indexLoadPromise = fetch(indexUrl)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(
          response.status === 404 ? `행정동 건물 index.json 파일을 찾지 못했습니다: ${indexUrl}` : BUILDING_POLYGON_UNCONFIGURED_MESSAGE,
        );
      }

      const payload = (await response.json()) as unknown;
      const entries = readIndexEntries(payload);

      if (entries.length === 0) {
        throw new Error('행정동 건물 index.json에서 사용할 수 있는 bbox 항목을 찾지 못했습니다.');
      }

      cachedIndex = {
        sigungu: typeof (payload as { sigungu?: unknown }).sigungu === 'string' ? (payload as { sigungu: string }).sigungu : undefined,
        sigunguCode:
          typeof (payload as { sigungu_code?: unknown }).sigungu_code === 'string'
            ? (payload as { sigungu_code: string }).sigungu_code
            : undefined,
        url: indexUrl,
        entries,
      };

      return cachedIndex;
    })
    .finally(() => {
      indexLoadPromise = null;
    });

  return indexLoadPromise;
}

async function loadAdmdongBuildingFile(entry: BuildingAdmdongIndexEntry, indexUrl: string) {
  const fileUrl = getAdmdongFileUrl(indexUrl, entry.filename);
  const cachedCollection = loadedAdmdongCollections.get(fileUrl);

  if (cachedCollection) {
    return cachedCollection;
  }

  const cachedPromise = loadingAdmdongCollections.get(fileUrl);

  if (cachedPromise) {
    return cachedPromise;
  }

  const loadPromise = fetch(fileUrl)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`행정동 건물 GeoJSON 파일을 찾지 못했습니다: ${entry.filename}`);
      }

      const collection = validateBuildingFootprintCollection(await response.json());

      loadedAdmdongCollections.set(fileUrl, collection);
      loadedAdmdongFileNames.set(fileUrl, entry.filename);
      return collection;
    })
    .finally(() => {
      loadingAdmdongCollections.delete(fileUrl);
    });

  loadingAdmdongCollections.set(fileUrl, loadPromise);
  return loadPromise;
}

export function getCandidateAdmdongEntries(
  index: BuildingAdmdongIndex,
  coordinate: [longitude: number, latitude: number],
) {
  return index.entries.filter((entry) => containsCoordinate(entry, coordinate));
}

export async function findBuildingFootprintInAdmdongIndex(
  coordinate: [longitude: number, latitude: number],
): Promise<BuildingFootprintSelectionResult> {
  const indexUrl = getBuildingAdmdongIndexUrl();
  const metaUrl = getBuildingMetaUrl();
  let index: BuildingAdmdongIndex;

  try {
    index = await loadBuildingFootprintIndex(indexUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : BUILDING_POLYGON_UNCONFIGURED_MESSAGE;

    return {
      status: 'error',
      match: null,
      message,
      candidateFeatures: [],
      diagnostics: createBuildingFootprintDiagnostics({
        status: 'error',
        indexUrl,
        metaUrl,
        message,
      }),
    };
  }

  const candidates = getCandidateAdmdongEntries(index, coordinate);

  if (candidates.length === 0) {
    const message = '선택 좌표를 포함하는 행정동 bbox 후보가 없습니다.';

    return {
      status: 'not_found',
      match: null,
      message,
      candidateFeatures: [],
      diagnostics: createBuildingFootprintDiagnostics({
        status: 'not_found',
        indexLoaded: true,
        indexEntryCount: index.entries.length,
        candidateFileCount: 0,
        loadedFileNames: getLoadedAdmdongFileNames(),
        indexUrl,
        metaUrl,
        message,
      }),
    };
  }

  const candidateCollections = await Promise.all(
    candidates.map(async (entry) => {
      try {
        return {
          entry,
          collection: await loadAdmdongBuildingFile(entry, index.url),
          errorMessage: null,
        };
      } catch (error) {
        return {
          entry,
          collection: null,
          errorMessage: error instanceof Error ? error.message : `행정동 건물 GeoJSON 로드 실패: ${entry.filename}`,
        };
      }
    }),
  );
  const loadedCollectionsForSearch = candidateCollections.filter(
    (item): item is { entry: BuildingAdmdongIndexEntry; collection: BuildingFootprintCollection; errorMessage: null } =>
      Boolean(item.collection),
  );
  const candidateFeatures = loadedCollectionsForSearch.flatMap(({ collection }) => collection.features);
  const fileErrors = candidateCollections.flatMap((item) => (item.errorMessage ? [item.errorMessage] : []));
  let searchedFeatureCount = 0;

  for (const { collection } of loadedCollectionsForSearch) {
    for (const feature of collection.features) {
      searchedFeatureCount += 1;

      if (isPointInsideFeature(feature, coordinate)) {
        const match = createMatch(feature);
        const message = `행정동 bbox 후보 ${candidates.length.toLocaleString('ko-KR')}개 파일에서 건물 footprint를 선택했습니다.`;

        return {
          status: 'selected',
          match,
          message,
          candidateFeatures,
          diagnostics: createBuildingFootprintDiagnostics({
            status: 'selected',
            indexLoaded: true,
            indexEntryCount: index.entries.length,
            candidateFileCount: candidates.length,
            loadedFileNames: getLoadedAdmdongFileNames(),
            searchedFeatureCount,
            matchedBuildingId: match.metadata.buildingId,
            matchedAddress: match.metadata.address,
            selectedGeometryType: match.metadata.geometryType,
            indexUrl,
            metaUrl,
            message,
          }),
        };
      }
    }
  }

  if (loadedCollectionsForSearch.length === 0 && fileErrors.length > 0) {
    const message = fileErrors.join(' ');

    return {
      status: 'error',
      match: null,
      message,
      candidateFeatures,
      diagnostics: createBuildingFootprintDiagnostics({
        status: 'error',
        indexLoaded: true,
        indexEntryCount: index.entries.length,
        candidateFileCount: candidates.length,
        loadedFileNames: getLoadedAdmdongFileNames(),
        searchedFeatureCount,
        indexUrl,
        metaUrl,
        message,
      }),
    };
  }

  const message =
    fileErrors.length > 0
      ? `후보 파일 일부를 읽지 못했고, 로드된 후보에서 클릭 좌표를 포함하는 건물 polygon을 찾지 못했습니다. ${fileErrors.join(' ')}`
      : '행정동 후보 파일에서 클릭 좌표를 포함하는 건물 polygon을 찾지 못했습니다.';

  return {
    status: 'not_found',
    match: null,
    message,
    candidateFeatures,
    diagnostics: createBuildingFootprintDiagnostics({
      status: 'not_found',
      indexLoaded: true,
      indexEntryCount: index.entries.length,
      candidateFileCount: candidates.length,
      loadedFileNames: getLoadedAdmdongFileNames(),
      searchedFeatureCount,
      indexUrl,
      metaUrl,
      message,
    }),
  };
}

export function normalizeBuildingFeatureCollection(value: unknown): BuildingPolygonFeatureCollection | null {
  try {
    return validateBuildingFootprintCollection(value) as BuildingPolygonFeatureCollection;
  } catch {
    return null;
  }
}

export function summarizeBuildingFootprintCoordinates(
  collection: BuildingFootprintCollection | null,
): BuildingFootprintCoordinateSummary {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let coordinateCount = 0;
  let projectedLikeCoordinateCount = 0;

  collection?.features.forEach((feature) => {
    visitFeatureCoordinates(feature, (longitude, latitude) => {
      minLon = Math.min(minLon, longitude);
      maxLon = Math.max(maxLon, longitude);
      minLat = Math.min(minLat, latitude);
      maxLat = Math.max(maxLat, latitude);
      coordinateCount += 1;

      if (isProjectedLikeValue(longitude) || isProjectedLikeValue(latitude)) {
        projectedLikeCoordinateCount += 1;
      }
    });
  });

  return {
    minLon: Number.isFinite(minLon) ? minLon : null,
    maxLon: Number.isFinite(maxLon) ? maxLon : null,
    minLat: Number.isFinite(minLat) ? minLat : null,
    maxLat: Number.isFinite(maxLat) ? maxLat : null,
    coordinateCount,
    projectedLikeCoordinateCount,
    hasProjectedCoordinateWarning: projectedLikeCoordinateCount > 0,
  };
}

export function findBuildingFootprintAtCoordinate(
  collection: BuildingFootprintCollection,
  coordinate: [longitude: number, latitude: number],
): BuildingFootprintMatch | null {
  for (const candidate of collection.features) {
    if (isPointInsideFeature(candidate, coordinate)) {
      return createMatch(candidate);
    }
  }

  return null;
}
