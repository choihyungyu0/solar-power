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

export type BuildingFootprintSelectionMode = 'polygon' | 'nearest';

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
  selectionMode: BuildingFootprintSelectionMode | null;
  nearestDistanceM: number | null;
  nearestBuildingId: string | null;
  nearestBuildingAddress: string | null;
  selectionToleranceM: number | null;
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
    selectionMode?: BuildingFootprintSelectionMode;
    distanceMeters?: number | null;
  };
};

export type BuildingFootprintSelectionOptions = {
  cameraHeightM?: number | null;
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

export type BuildingFootprintTextSearchResult =
  | {
      status: 'found';
      match: BuildingFootprintMatch;
      candidateFeatures: BuildingFootprintFeature[];
      diagnostics: BuildingFootprintDiagnostics;
      message: string;
    }
  | {
      status: 'not_found' | 'error';
      match: null;
      candidateFeatures: BuildingFootprintFeature[];
      diagnostics: BuildingFootprintDiagnostics;
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
const LOCAL_BUILDING_EDGE_SELECTION_TOLERANCE_M = 55;
const PRODUCTION_BUILDING_EDGE_SELECTION_TOLERANCE_M = 80;
const HIGH_CAMERA_BUILDING_EDGE_SELECTION_TOLERANCE_M = 120;
const DYNAMIC_TOLERANCE_MIN_CAMERA_HEIGHT_M = 800;
const DYNAMIC_TOLERANCE_MAX_CAMERA_HEIGHT_M = 3000;
const ADMDONG_BBOX_CLICK_TOLERANCE_M = 180;
const NEAREST_BBOX_CANDIDATE_LIMIT = 4;
const NEAREST_BBOX_MAX_DISTANCE_M = 3000;
const TEXT_SEARCH_FILE_LIMIT = 12;
const TEXT_SEARCH_STOPWORDS = new Set([
  '경기도',
  '화성시',
  '동탄구',
  '만세구',
  '효행구',
  '아파트',
  '공동주택',
  '근처',
  '인근',
  '주변',
  '주소',
]);

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

function createMatch(
  feature: BuildingFootprintFeature,
  selectionMode: BuildingFootprintSelectionMode = 'polygon',
  distanceMeters: number | null = null,
): BuildingFootprintMatch {
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
      selectionMode,
      distanceMeters,
    },
  };
}

function normalizeSearchText(value: string) {
  return value
    .toLocaleLowerCase('ko-KR')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '')
    .trim();
}

function getSearchTokens(value: string) {
  return value
    .toLocaleLowerCase('ko-KR')
    .split(/[^\p{Letter}\p{Number}]+/u)
    .map((token) => normalizeSearchText(token))
    .filter((token) => token.length >= 2 && !TEXT_SEARCH_STOPWORDS.has(token));
}

function getFeatureText(feature: BuildingFootprintFeature) {
  const match = createMatch(feature);
  const properties = feature.properties ?? {};
  const propertyValues = [
    properties.address,
    properties.admdong_name,
    properties.jibun,
    properties.name,
    properties.building_name,
    properties.bldg_name,
    properties.apartment_name,
    properties.dong_name,
    properties.usage_name,
    properties.bld_id,
    properties.pnu,
  ]
    .filter((value) => typeof value === 'string' || typeof value === 'number')
    .join(' ');

  return normalizeSearchText(
    `${match.metadata.address} ${match.metadata.name} ${match.metadata.buildingId} ${propertyValues}`,
  );
}

function scoreFeatureTextMatch(feature: BuildingFootprintFeature, normalizedQuery: string, tokens: string[]) {
  const featureText = getFeatureText(feature);

  if (normalizedQuery && featureText.includes(normalizedQuery)) {
    return 1000 + normalizedQuery.length;
  }

  if (tokens.length === 0) {
    return 0;
  }

  const matchedTokenCount = tokens.filter((token) => featureText.includes(token)).length;

  if (matchedTokenCount === tokens.length) {
    return 500 + matchedTokenCount * 20;
  }

  if (tokens.length >= 2 && matchedTokenCount >= tokens.length - 1) {
    return 200 + matchedTokenCount * 10;
  }

  return matchedTokenCount >= 1 && tokens.some((token) => token.length >= 4 && featureText.includes(token))
    ? 100 + matchedTokenCount * 10
    : 0;
}

function findBestTextMatch(features: BuildingFootprintFeature[], query: string) {
  const normalizedQuery = normalizeSearchText(query);
  const tokens = getSearchTokens(query);
  let bestFeature: BuildingFootprintFeature | null = null;
  let bestScore = 0;

  for (const feature of features) {
    const score = scoreFeatureTextMatch(feature, normalizedQuery, tokens);

    if (score > bestScore) {
      bestFeature = feature;
      bestScore = score;
    }
  }

  return bestFeature ? createMatch(bestFeature, 'polygon', 0) : null;
}

function getTextSearchCandidateEntries(index: BuildingAdmdongIndex, query: string) {
  const normalizedQuery = normalizeSearchText(query);
  const tokens = getSearchTokens(query);

  return index.entries
    .map((entry) => {
      const entryText = normalizeSearchText(`${entry.admdongName} ${entry.filename}`);
      const directScore =
        normalizedQuery.includes(normalizeSearchText(entry.admdongName)) || entryText.includes(normalizedQuery)
          ? 1000
          : 0;
      const tokenScore = tokens.filter((token) => entryText.includes(token)).length * 100;

      return {
        entry,
        score: directScore + tokenScore,
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.entry.featureCount - right.entry.featureCount)
    .slice(0, TEXT_SEARCH_FILE_LIMIT)
    .map((item) => item.entry);
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

function getDistanceMeters(from: [longitude: number, latitude: number], to: [longitude: number, latitude: number]) {
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon = metersPerDegreeLat * Math.cos((from[1] * Math.PI) / 180);
  const deltaX = (to[0] - from[0]) * metersPerDegreeLon;
  const deltaY = (to[1] - from[1]) * metersPerDegreeLat;

  return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
}

function getPointToSegmentDistanceMeters(
  coordinate: [longitude: number, latitude: number],
  start: [longitude: number, latitude: number],
  end: [longitude: number, latitude: number],
) {
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon = metersPerDegreeLat * Math.cos((coordinate[1] * Math.PI) / 180);
  const startX = (start[0] - coordinate[0]) * metersPerDegreeLon;
  const startY = (start[1] - coordinate[1]) * metersPerDegreeLat;
  const endX = (end[0] - coordinate[0]) * metersPerDegreeLon;
  const endY = (end[1] - coordinate[1]) * metersPerDegreeLat;
  const segmentX = endX - startX;
  const segmentY = endY - startY;
  const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;

  if (segmentLengthSquared === 0) {
    return getDistanceMeters(coordinate, start);
  }

  const projection = Math.max(0, Math.min(1, -(startX * segmentX + startY * segmentY) / segmentLengthSquared));
  const closestX = startX + projection * segmentX;
  const closestY = startY + projection * segmentY;

  return Math.sqrt(closestX * closestX + closestY * closestY);
}

type LonLat = [longitude: number, latitude: number];

function getRingDistanceMeters(coordinate: LonLat, ring: LonLat[]) {
  if (ring.length === 0) {
    return Infinity;
  }

  let minimumDistance = Infinity;

  for (let index = 0; index < ring.length; index += 1) {
    const start = ring[index];
    const end = ring[(index + 1) % ring.length];
    minimumDistance = Math.min(minimumDistance, getPointToSegmentDistanceMeters(coordinate, start, end));
  }

  return minimumDistance;
}

function readCoordinateRing(ring: unknown): LonLat[] {
  const coordinates: LonLat[] = [];

  if (!Array.isArray(ring)) {
    return coordinates;
  }

  ring.forEach((position) => {
    visitPosition(position, (longitude, latitude) => coordinates.push([longitude, latitude]));
  });

  return coordinates.length >= 2 ? coordinates : [];
}

function readPolygonCoordinateRings(coordinates: unknown): LonLat[][] {
  if (!Array.isArray(coordinates)) {
    return [];
  }

  return coordinates.flatMap((ring) => {
    const coordinateRing = readCoordinateRing(ring);

    return coordinateRing.length > 0 ? [coordinateRing] : [];
  });
}

function readFeatureRings(feature: BuildingFootprintFeature): LonLat[][] {
  if (feature.geometry.type === 'Polygon') {
    return readPolygonCoordinateRings(feature.geometry.coordinates);
  }

  if (!Array.isArray(feature.geometry.coordinates)) {
    return [];
  }

  return feature.geometry.coordinates.flatMap((polygonCoordinates) => readPolygonCoordinateRings(polygonCoordinates));
}

function getDistanceToFeatureMeters(
  feature: BuildingFootprintFeature,
  coordinate: [longitude: number, latitude: number],
) {
  if (isPointInsideFeature(feature, coordinate)) {
    return 0;
  }

  return readFeatureRings(feature).reduce(
    (minimumDistance, ring) => Math.min(minimumDistance, getRingDistanceMeters(coordinate, ring)),
    Infinity,
  );
}

function findNearbyBuildingFootprint(
  features: BuildingFootprintFeature[],
  coordinate: [longitude: number, latitude: number],
) {
  let nearestFeature: BuildingFootprintFeature | null = null;
  let nearestDistanceMeters = Infinity;

  for (const feature of features) {
    const distanceMeters = getDistanceToFeatureMeters(feature, coordinate);

    if (!Number.isFinite(distanceMeters)) {
      continue;
    }

    if (distanceMeters < nearestDistanceMeters) {
      nearestFeature = feature;
      nearestDistanceMeters = distanceMeters;
    }
  }

  if (!nearestFeature) {
    return null;
  }

  return {
    feature: nearestFeature,
    distanceMeters: nearestDistanceMeters,
  };
}

export function getDynamicBuildingSelectionToleranceM(cameraHeightM?: number | null) {
  const baseToleranceM = import.meta.env.PROD
    ? PRODUCTION_BUILDING_EDGE_SELECTION_TOLERANCE_M
    : LOCAL_BUILDING_EDGE_SELECTION_TOLERANCE_M;

  if (!cameraHeightM || !Number.isFinite(cameraHeightM) || cameraHeightM <= DYNAMIC_TOLERANCE_MIN_CAMERA_HEIGHT_M) {
    return baseToleranceM;
  }

  if (cameraHeightM >= DYNAMIC_TOLERANCE_MAX_CAMERA_HEIGHT_M) {
    return HIGH_CAMERA_BUILDING_EDGE_SELECTION_TOLERANCE_M;
  }

  const cameraProgress =
    (cameraHeightM - DYNAMIC_TOLERANCE_MIN_CAMERA_HEIGHT_M) /
    (DYNAMIC_TOLERANCE_MAX_CAMERA_HEIGHT_M - DYNAMIC_TOLERANCE_MIN_CAMERA_HEIGHT_M);

  return Math.round(
    baseToleranceM + cameraProgress * (HIGH_CAMERA_BUILDING_EDGE_SELECTION_TOLERANCE_M - baseToleranceM),
  );
}

function getLongitudeToleranceDegrees(latitude: number, meters: number) {
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon = metersPerDegreeLat * Math.cos((latitude * Math.PI) / 180);

  return meters / Math.max(metersPerDegreeLon, 1);
}

function containsCoordinate(
  entry: BuildingAdmdongIndexEntry,
  coordinate: [longitude: number, latitude: number],
  toleranceMeters = 0,
) {
  const [longitude, latitude] = coordinate;
  const [minLon, minLat, maxLon, maxLat] = entry.bbox;
  const latTolerance = toleranceMeters / 111_320;
  const lonTolerance = getLongitudeToleranceDegrees(latitude, toleranceMeters);

  return (
    longitude >= minLon - lonTolerance &&
    longitude <= maxLon + lonTolerance &&
    latitude >= minLat - latTolerance &&
    latitude <= maxLat + latTolerance
  );
}

function getDistanceToBboxMeters(entry: BuildingAdmdongIndexEntry, coordinate: [longitude: number, latitude: number]) {
  if (containsCoordinate(entry, coordinate)) {
    return 0;
  }

  const [longitude, latitude] = coordinate;
  const [minLon, minLat, maxLon, maxLat] = entry.bbox;
  const clampedLon = Math.max(minLon, Math.min(maxLon, longitude));
  const clampedLat = Math.max(minLat, Math.min(maxLat, latitude));

  return getDistanceMeters(coordinate, [clampedLon, clampedLat]);
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
    selectionMode: null,
    nearestDistanceM: null,
    nearestBuildingId: null,
    nearestBuildingAddress: null,
    selectionToleranceM: null,
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

export async function searchBuildingFootprintsByText({
  query,
  collection,
  index,
}: {
  query: string;
  collection?: BuildingFootprintCollection | null;
  index?: BuildingAdmdongIndex | null;
}): Promise<BuildingFootprintTextSearchResult> {
  const trimmedQuery = query.trim();
  const indexUrl = getBuildingAdmdongIndexUrl();
  const metaUrl = getBuildingMetaUrl();

  if (!trimmedQuery) {
    const message = '검색할 주소 또는 아파트명을 입력해주세요.';

    return {
      status: 'not_found',
      match: null,
      candidateFeatures: [],
      diagnostics: createBuildingFootprintDiagnostics({
        status: 'not_found',
        indexUrl,
        metaUrl,
        message,
      }),
      message,
    };
  }

  if (collection) {
    const match = findBestTextMatch(collection.features, trimmedQuery);
    const message = match
      ? '입력 주소와 일치하는 건물 footprint를 선택했습니다.'
      : '입력 주소와 일치하는 건물 footprint를 찾지 못했습니다.';

    return {
      status: match ? 'found' : 'not_found',
      match,
      candidateFeatures: collection.features,
      diagnostics: createBuildingFootprintDiagnostics({
        sourceMode: 'geojson',
        status: match ? 'selected' : 'not_found',
        indexLoaded: true,
        indexEntryCount: 1,
        searchedFeatureCount: collection.features.length,
        matchedBuildingId: match?.metadata.buildingId ?? null,
        matchedAddress: match?.metadata.address ?? null,
        selectionMode: match ? 'polygon' : null,
        nearestDistanceM: match ? 0 : null,
        nearestBuildingId: match?.metadata.buildingId ?? null,
        nearestBuildingAddress: match?.metadata.address ?? null,
        selectedGeometryType: match?.metadata.geometryType ?? null,
        message,
      }),
      message,
    } as BuildingFootprintTextSearchResult;
  }

  if (!index) {
    const message = '건물 polygon index를 아직 불러오지 못했습니다. 잠시 뒤 다시 검색해주세요.';

    return {
      status: 'error',
      match: null,
      candidateFeatures: [],
      diagnostics: createBuildingFootprintDiagnostics({
        status: 'error',
        indexUrl,
        metaUrl,
        message,
      }),
      message,
    };
  }

  const candidateEntries = getTextSearchCandidateEntries(index, trimmedQuery);

  if (candidateEntries.length === 0) {
    const message = '주소에서 행정동 후보를 찾지 못했습니다. 예: "동탄구 반송동 88-12"처럼 동 이름을 포함해 주세요.';

    return {
      status: 'not_found',
      match: null,
      candidateFeatures: [],
      diagnostics: createBuildingFootprintDiagnostics({
        status: 'not_found',
        indexLoaded: true,
        indexEntryCount: index.entries.length,
        loadedFileNames: getLoadedAdmdongFileNames(),
        indexUrl,
        metaUrl,
        message,
      }),
      message,
    };
  }

  const loadedCollections = await Promise.all(
    candidateEntries.map(async (entry) => {
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
  const loadedItems = loadedCollections.filter(
    (item): item is { entry: BuildingAdmdongIndexEntry; collection: BuildingFootprintCollection; errorMessage: null } =>
      Boolean(item.collection),
  );
  const candidateFeatures = loadedItems.flatMap((item) => item.collection.features);
  const match = findBestTextMatch(candidateFeatures, trimmedQuery);
  const fileErrors = loadedCollections.flatMap((item) => (item.errorMessage ? [item.errorMessage] : []));
  const message = match
    ? `입력 주소와 가장 가까운 건물 footprint를 선택했습니다. 후보 파일 ${candidateEntries.length.toLocaleString(
        'ko-KR',
      )}개를 확인했습니다.`
    : fileErrors.length > 0 && loadedItems.length === 0
      ? fileErrors.join(' ')
      : '입력 주소와 일치하는 건물 footprint를 찾지 못했습니다. 지번 또는 건물명을 더 구체적으로 입력해 주세요.';

  return {
    status: match ? 'found' : fileErrors.length > 0 && loadedItems.length === 0 ? 'error' : 'not_found',
    match,
    candidateFeatures,
    diagnostics: createBuildingFootprintDiagnostics({
      status: match ? 'selected' : fileErrors.length > 0 && loadedItems.length === 0 ? 'error' : 'not_found',
      indexLoaded: true,
      indexEntryCount: index.entries.length,
      candidateFileCount: candidateEntries.length,
      loadedFileNames: getLoadedAdmdongFileNames(),
      searchedFeatureCount: candidateFeatures.length,
      matchedBuildingId: match?.metadata.buildingId ?? null,
      matchedAddress: match?.metadata.address ?? null,
      selectionMode: match ? 'polygon' : null,
      nearestDistanceM: match ? 0 : null,
      nearestBuildingId: match?.metadata.buildingId ?? null,
      nearestBuildingAddress: match?.metadata.address ?? null,
      selectedGeometryType: match?.metadata.geometryType ?? null,
      indexUrl,
      metaUrl,
      message,
    }),
    message,
  } as BuildingFootprintTextSearchResult;
}

export function getCandidateAdmdongEntries(
  index: BuildingAdmdongIndex,
  coordinate: [longitude: number, latitude: number],
) {
  return index.entries.filter((entry) => containsCoordinate(entry, coordinate, ADMDONG_BBOX_CLICK_TOLERANCE_M));
}

function getNearestAdmdongEntries(index: BuildingAdmdongIndex, coordinate: [longitude: number, latitude: number]) {
  return index.entries
    .map((entry) => ({
      entry,
      distanceMeters: getDistanceToBboxMeters(entry, coordinate),
    }))
    .filter((item) => item.distanceMeters <= NEAREST_BBOX_MAX_DISTANCE_M)
    .sort((left, right) => left.distanceMeters - right.distanceMeters)
    .slice(0, NEAREST_BBOX_CANDIDATE_LIMIT)
    .map((item) => item.entry);
}

export async function findBuildingFootprintInAdmdongIndex(
  coordinate: [longitude: number, latitude: number],
  options: BuildingFootprintSelectionOptions = {},
): Promise<BuildingFootprintSelectionResult> {
  const indexUrl = getBuildingAdmdongIndexUrl();
  const metaUrl = getBuildingMetaUrl();
  const selectionToleranceM = getDynamicBuildingSelectionToleranceM(options.cameraHeightM);
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

  const bboxCandidates = getCandidateAdmdongEntries(index, coordinate);
  const candidates = bboxCandidates.length > 0 ? bboxCandidates : getNearestAdmdongEntries(index, coordinate);

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
        selectionToleranceM,
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
        const match = createMatch(feature, 'polygon', 0);
        const message = `건물 선택 완료: polygon 내부 선택. 행정동 bbox 후보 ${candidates.length.toLocaleString(
          'ko-KR',
        )}개 파일에서 건물 footprint를 선택했습니다.`;

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
            selectionMode: 'polygon',
            nearestDistanceM: 0,
            nearestBuildingId: match.metadata.buildingId,
            nearestBuildingAddress: match.metadata.address,
            selectionToleranceM,
            selectedGeometryType: match.metadata.geometryType,
            indexUrl,
            metaUrl,
            message,
          }),
        };
      }
    }
  }

  const nearbyMatch = findNearbyBuildingFootprint(candidateFeatures, coordinate);
  const nearestMatch = nearbyMatch ? createMatch(nearbyMatch.feature, 'nearest', nearbyMatch.distanceMeters) : null;

  if (nearbyMatch && nearbyMatch.distanceMeters <= selectionToleranceM) {
    const match = nearestMatch ?? createMatch(nearbyMatch.feature, 'nearest', nearbyMatch.distanceMeters);
    const message = `클릭 좌표가 건물 외곽선에서 약 ${Math.round(nearbyMatch.distanceMeters).toLocaleString(
      'ko-KR',
    )}m 이내여서 근접 건물 선택으로 해당 건물 footprint를 선택했습니다.`;

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
          searchedFeatureCount: Math.max(searchedFeatureCount, candidateFeatures.length),
          matchedBuildingId: match.metadata.buildingId,
          matchedAddress: match.metadata.address,
          selectionMode: 'nearest',
          nearestDistanceM: nearbyMatch.distanceMeters,
          nearestBuildingId: match.metadata.buildingId,
          nearestBuildingAddress: match.metadata.address,
          selectionToleranceM,
          selectedGeometryType: match.metadata.geometryType,
          indexUrl,
          metaUrl,
        message,
      }),
    };
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
        nearestDistanceM: nearbyMatch?.distanceMeters ?? null,
        nearestBuildingId: nearestMatch?.metadata.buildingId ?? null,
        nearestBuildingAddress: nearestMatch?.metadata.address ?? null,
        selectionToleranceM,
        indexUrl,
        metaUrl,
        message,
      }),
    };
  }

  const message =
    fileErrors.length > 0
      ? `후보 파일 일부를 읽지 못했고, 로드된 후보에서 클릭 좌표를 포함하는 건물 polygon을 찾지 못했습니다. ${fileErrors.join(' ')}`
      : '선택 좌표 주변에서 건물 polygon을 찾지 못했습니다. 지도를 확대하거나 건물 중심을 다시 클릭해주세요.';

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
        searchedFeatureCount: Math.max(searchedFeatureCount, candidateFeatures.length),
        nearestDistanceM: nearbyMatch?.distanceMeters ?? null,
        nearestBuildingId: nearestMatch?.metadata.buildingId ?? null,
        nearestBuildingAddress: nearestMatch?.metadata.address ?? null,
        selectionToleranceM,
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
