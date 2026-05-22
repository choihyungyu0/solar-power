import type { ClimateBundle, ClimatePanelsGeoJson } from '../types/climateBundle';
import type { Coordinate } from './roofGeometry';

export const DEFAULT_CLIMATE_POC_ID = 'L1_41110_065203';

export type ClimatePocBbox = {
  minLongitude: number;
  minLatitude: number;
  maxLongitude: number;
  maxLatitude: number;
};

export type ClimatePocPanelExtent = {
  bbox: ClimatePocBbox;
  centroid: Coordinate;
  coordinateCount: number;
  featureCount: number;
};

function getClimatePocBasePath(pocId: string) {
  const basePath = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;

  return `${basePath}data/climate-poc/${encodeURIComponent(pocId)}`;
}

function isClimateCoordinate(value: unknown): value is Coordinate {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

function extractClimateCoordinates(value: unknown): Coordinate[] {
  if (isClimateCoordinate(value)) {
    return [[value[0], value[1]]];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => extractClimateCoordinates(item));
}

export function summarizeClimatePanelGeojson(
  panelsGeojson: ClimatePanelsGeoJson | null,
): ClimatePocPanelExtent | null {
  const coordinates =
    panelsGeojson?.features.flatMap((feature) => extractClimateCoordinates(feature.geometry.coordinates)) ?? [];

  if (coordinates.length === 0) {
    return null;
  }

  const bbox = coordinates.reduce<ClimatePocBbox>(
    (current, [longitude, latitude]) => ({
      minLongitude: Math.min(current.minLongitude, longitude),
      minLatitude: Math.min(current.minLatitude, latitude),
      maxLongitude: Math.max(current.maxLongitude, longitude),
      maxLatitude: Math.max(current.maxLatitude, latitude),
    }),
    {
      minLongitude: Number.POSITIVE_INFINITY,
      minLatitude: Number.POSITIVE_INFINITY,
      maxLongitude: Number.NEGATIVE_INFINITY,
      maxLatitude: Number.NEGATIVE_INFINITY,
    },
  );

  return {
    bbox,
    centroid: [(bbox.minLongitude + bbox.maxLongitude) / 2, (bbox.minLatitude + bbox.maxLatitude) / 2],
    coordinateCount: coordinates.length,
    featureCount: panelsGeojson?.features.length ?? 0,
  };
}

async function fetchClimateJson<T>(url: string, label: string): Promise<T> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`${label} 로드 실패: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

export async function loadClimateBundle(pocId = DEFAULT_CLIMATE_POC_ID) {
  return fetchClimateJson<ClimateBundle>(`${getClimatePocBasePath(pocId)}/bundle.json`, 'climate.gg POC bundle');
}

export async function loadClimatePanelGeojson(pocId = DEFAULT_CLIMATE_POC_ID) {
  return fetchClimateJson<ClimatePanelsGeoJson>(
    `${getClimatePocBasePath(pocId)}/panels_4326.geojson`,
    'climate.gg POC panel GeoJSON',
  );
}
