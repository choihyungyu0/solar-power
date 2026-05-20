import type { VWorldFeature } from './vworldFeatureQuery';

export type Coordinate = [longitude: number, latitude: number];
export type PolygonCoordinates = Coordinate[];

function isCoordinate(value: unknown): value is Coordinate {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  );
}

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

function readPolygonRings(coordinates: unknown): PolygonCoordinates[] {
  if (!Array.isArray(coordinates)) {
    return [];
  }

  return coordinates
    .map((ring) => (Array.isArray(ring) ? ring.filter(isCoordinate).map(([lon, lat]) => [lon, lat] as Coordinate) : []))
    .filter((ring) => ring.length >= 4);
}

function readMultiPolygonRings(coordinates: unknown): PolygonCoordinates[] {
  if (!Array.isArray(coordinates)) {
    return [];
  }

  return coordinates.flatMap((polygon) => readPolygonRings(polygon));
}

export function calculatePolygonAreaM2(polygon: PolygonCoordinates): number {
  const closed = closePolygon(polygon);

  if (closed.length < 4) {
    return 0;
  }

  const centroid = getPolygonCentroid(closed);
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon = metersPerDegreeLat * Math.cos((centroid[1] * Math.PI) / 180);

  // MVP approximation: project WGS84 lon/lat to a local meter plane around the centroid,
  // then use the shoelace formula. Replace with a geodesic area calculation for production reports.
  let area = 0;

  for (let index = 0; index < closed.length - 1; index += 1) {
    const current = closed[index];
    const next = closed[index + 1];
    const x1 = (current[0] - centroid[0]) * metersPerDegreeLon;
    const y1 = (current[1] - centroid[1]) * metersPerDegreeLat;
    const x2 = (next[0] - centroid[0]) * metersPerDegreeLon;
    const y2 = (next[1] - centroid[1]) * metersPerDegreeLat;
    area += x1 * y2 - x2 * y1;
  }

  return Math.abs(area) / 2;
}

export function normalizeGeoJsonPolygon(feature: VWorldFeature): PolygonCoordinates | null {
  const geometry = feature.geometry;

  if (!geometry) {
    return null;
  }

  const candidates =
    geometry.type === 'Polygon'
      ? readPolygonRings(geometry.coordinates)
      : geometry.type === 'MultiPolygon'
        ? readMultiPolygonRings(geometry.coordinates)
        : [];

  if (candidates.length === 0) {
    return null;
  }

  return closePolygon(
    candidates.reduce((largest, polygon) =>
      calculatePolygonAreaM2(polygon) > calculatePolygonAreaM2(largest) ? polygon : largest,
    ),
  );
}

export function getPolygonCentroid(polygon: PolygonCoordinates): Coordinate {
  const closed = closePolygon(polygon);

  if (closed.length < 4) {
    return polygon[0] ?? [0, 0];
  }

  let twiceArea = 0;
  let centroidX = 0;
  let centroidY = 0;

  for (let index = 0; index < closed.length - 1; index += 1) {
    const current = closed[index];
    const next = closed[index + 1];
    const cross = current[0] * next[1] - next[0] * current[1];
    twiceArea += cross;
    centroidX += (current[0] + next[0]) * cross;
    centroidY += (current[1] + next[1]) * cross;
  }

  if (Math.abs(twiceArea) < 1e-12) {
    const sum = polygon.reduce<Coordinate>(
      ([lonSum, latSum], [lon, lat]) => [lonSum + lon, latSum + lat],
      [0, 0],
    );
    return [sum[0] / polygon.length, sum[1] / polygon.length];
  }

  return [centroidX / (3 * twiceArea), centroidY / (3 * twiceArea)];
}

export function estimateRoofPolygonFromFootprint(
  polygon: PolygonCoordinates,
  options: { insetRatio?: number } = {},
): PolygonCoordinates {
  const insetRatio = options.insetRatio ?? 0.82;
  const centroid = getPolygonCentroid(polygon);
  const roofPolygon = polygon.map<Coordinate>((coordinate) => [
    centroid[0] + (coordinate[0] - centroid[0]) * insetRatio,
    centroid[1] + (coordinate[1] - centroid[1]) * insetRatio,
  ]);

  return closePolygon(roofPolygon);
}
