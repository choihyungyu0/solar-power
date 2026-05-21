import { booleanPointInPolygon, point } from '@turf/turf';
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

const DEFAULT_GEOJSON_URL = '/data/buildings/hwaseong-buildings.geojson';

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

export function getBuildingFootprintGeoJsonUrl() {
  return import.meta.env.VITE_BUILDING_FOOTPRINT_GEOJSON_URL?.trim() || DEFAULT_GEOJSON_URL;
}

export function isBuildingFootprintGeoJsonEnabled() {
  return import.meta.env.VITE_BUILDING_POLYGON_SOURCE?.trim().toLowerCase() === 'geojson';
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
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`건물 footprint GeoJSON을 불러오지 못했습니다. HTTP ${response.status}`);
  }

  return validateBuildingFootprintCollection(await response.json());
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
