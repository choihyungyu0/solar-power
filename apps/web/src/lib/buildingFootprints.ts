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

export type BuildingFootprintLoadState =
  | { status: 'idle'; url: string; collection: null; message: string }
  | { status: 'loading'; url: string; collection: null; message: string }
  | { status: 'loaded'; url: string; collection: BuildingFootprintCollection; message: string }
  | { status: 'error'; url: string; collection: null; message: string };

export type BuildingFootprintMatch = {
  feature: BuildingFootprintFeature;
  metadata: {
    buildingId: string;
    address: string;
    name: string;
    geometryType: 'Polygon' | 'MultiPolygon';
  };
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
const BUILDING_POLYGON_UNCONFIGURED_MESSAGE = '화성시 건물 polygon 데이터가 아직 연결되지 않았습니다.';
const PROJECTED_COORDINATE_MIN = 100_000;
const PROJECTED_COORDINATE_MAX = 1_000_000;

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

export function getBuildingFootprintGeoJsonUrl() {
  return import.meta.env.VITE_BUILDING_FOOTPRINT_GEOJSON_URL?.trim() || DEFAULT_GEOJSON_URL;
}

export function getConfiguredBuildingPolygonSource(): BuildingPolygonSourceMode {
  const source = import.meta.env.VITE_BUILDING_POLYGON_SOURCE?.trim().toLowerCase();

  if (source === 'api' || source === 'geojson') {
    return source;
  }

  return 'none';
}

export function getBuildingPolygonSourceLabel(source: BuildingPolygonSourceMode) {
  if (source === 'api') {
    return '화성시 건물 polygon API';
  }

  if (source === 'geojson') {
    return '화성시 건물 GeoJSON';
  }

  return '건물 polygon 데이터 미연결';
}

export function getBuildingPolygonUnconfiguredMessage() {
  return BUILDING_POLYGON_UNCONFIGURED_MESSAGE;
}

export function isBuildingFootprintGeoJsonEnabled() {
  return getConfiguredBuildingPolygonSource() === 'geojson';
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

  if (features.length === 0) {
    throw new Error('건물 footprint GeoJSON에 Polygon 또는 MultiPolygon feature가 없습니다.');
  }

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
    throw new Error(response.status === 404 ? `건물 footprint GeoJSON 파일을 찾지 못했습니다: ${url}` : BUILDING_POLYGON_UNCONFIGURED_MESSAGE);
  }

  return validateBuildingFootprintCollection(await response.json());
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
  const clickedPoint = point(coordinate);
  const feature = collection.features.find((candidate) => booleanPointInPolygon(clickedPoint, candidate as never));

  if (!feature) {
    return null;
  }

  const properties = feature.properties;

  return {
    feature,
    metadata: {
      buildingId: getStringProperty(properties, ['building_id', 'buildingId', 'bldg_id', 'BD_MGT_SN', 'id'], String(feature.id ?? '-')),
      address: getStringProperty(properties, ['address', 'addr', 'road_address', 'jibun_address', 'A3', 'A4'], '주소 정보 없음'),
      name: getStringProperty(properties, ['name', 'building_name', 'bldg_name', 'apartment_name', 'A1'], '건물명 정보 없음'),
      geometryType: feature.geometry.type,
    },
  };
}
