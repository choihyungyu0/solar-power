import { booleanPointInPolygon, point } from '@turf/turf';
import { calculatePolygonAreaM2, type Coordinate, type PolygonCoordinates } from './roofGeometry';
import type { BuildingPolygonFeature, BuildingPolygonRecord, BuildingPolygonSource } from '../types/buildingPolygon';

type TurfPolygonInput = Parameters<typeof booleanPointInPolygon>[1];

function closePolygon(polygon: PolygonCoordinates): PolygonCoordinates {
  if (polygon.length === 0) {
    return polygon;
  }

  const first = polygon[0];
  const last = polygon[polygon.length - 1];

  if (first[0] === last[0] && first[1] === last[1]) {
    return polygon;
  }

  return [...polygon, first];
}

function readStringProperty(properties: Record<string, unknown> | null | undefined, keys: string[], fallback: string) {
  for (const key of keys) {
    const value = properties?.[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }

  return fallback;
}

function isCoordinate(value: unknown): value is Coordinate {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

function readPolygonRings(coordinates: unknown): PolygonCoordinates[] {
  if (!Array.isArray(coordinates)) {
    return [];
  }

  return coordinates
    .map((ring) => (Array.isArray(ring) ? ring.filter(isCoordinate).map(([lon, lat]) => [lon, lat] as Coordinate) : []))
    .filter((ring) => ring.length >= 4)
    .map(closePolygon);
}

function readMultiPolygonRings(coordinates: unknown): PolygonCoordinates[] {
  if (!Array.isArray(coordinates)) {
    return [];
  }

  return coordinates.flatMap((polygon) => readPolygonRings(polygon));
}

export function getLargestFootprintRing(feature: BuildingPolygonFeature): PolygonCoordinates | null {
  const rings =
    feature.geometry.type === 'Polygon'
      ? readPolygonRings(feature.geometry.coordinates)
      : readMultiPolygonRings(feature.geometry.coordinates);

  if (rings.length === 0) {
    return null;
  }

  return rings.reduce((largest, ring) =>
    calculatePolygonAreaM2(ring) > calculatePolygonAreaM2(largest) ? ring : largest,
  );
}

export function isPointInBuildingPolygon(longitude: number, latitude: number, feature: BuildingPolygonFeature) {
  try {
    return booleanPointInPolygon(
      point([longitude, latitude]),
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

export function createBuildingPolygonRecord({
  feature,
  source,
  sourceLabel,
}: {
  feature: BuildingPolygonFeature;
  source: BuildingPolygonSource;
  sourceLabel: string;
}): BuildingPolygonRecord | null {
  const footprintPolygon = getLargestFootprintRing(feature);
  const properties = feature.properties ?? {};
  const id =
    feature.id ??
    properties.id ??
    properties.building_id ??
    properties.buildingId ??
    properties.bldg_id ??
    properties.BD_MGT_SN ??
    properties.pnu ??
    properties.PNU;

  if (!footprintPolygon) {
    return null;
  }

  return {
    id: typeof id === 'string' || typeof id === 'number' ? String(id) : 'ID 속성 미제공',
    address: readStringProperty(properties, ['address', 'addr', 'road_address', 'jibun_address', 'rn_addr', 'bd_addr', 'A3', 'A4'], '주소 속성 미제공'),
    name: readStringProperty(properties, ['name', 'building_name', 'bldg_name', 'apartment_name', 'A1'], '건물명 정보 없음'),
    geometryType: feature.geometry.type,
    source,
    sourceLabel,
    feature,
    footprintPolygon,
  };
}

export function selectBuildingByPoint({
  features,
  longitude,
  latitude,
  source,
  sourceLabel,
}: {
  features: BuildingPolygonFeature[];
  longitude: number;
  latitude: number;
  source: BuildingPolygonSource;
  sourceLabel: string;
}): BuildingPolygonRecord | null {
  const selectedFeature = features.find((feature) => isPointInBuildingPolygon(longitude, latitude, feature));

  if (!selectedFeature) {
    return null;
  }

  return createBuildingPolygonRecord({
    feature: selectedFeature,
    source,
    sourceLabel,
  });
}

