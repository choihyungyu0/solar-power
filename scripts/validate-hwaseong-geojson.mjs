import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGET_RELATIVE_PATH = 'apps/web/public/data/buildings/hwaseong-buildings.geojson';
const LONGITUDE_RANGE = { min: 124, max: 132 };
const LATITUDE_RANGE = { min: 33, max: 39 };
const PROJECTED_COORDINATE_MIN = 100_000;
const PROJECTED_COORDINATE_MAX = 1_000_000;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const targetPath = path.resolve(repoRoot, TARGET_RELATIVE_PATH);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function createCoordinateRange() {
  return {
    lonMin: Infinity,
    lonMax: -Infinity,
    latMin: Infinity,
    latMax: -Infinity,
  };
}

function updateCoordinateRange(range, lon, lat) {
  range.lonMin = Math.min(range.lonMin, lon);
  range.lonMax = Math.max(range.lonMax, lon);
  range.latMin = Math.min(range.latMin, lat);
  range.latMax = Math.max(range.latMax, lat);
}

function isProjectedLikeValue(value) {
  const absolute = Math.abs(value);
  return absolute >= PROJECTED_COORDINATE_MIN && absolute <= PROJECTED_COORDINATE_MAX;
}

function visitPosition(position, visitor) {
  if (!Array.isArray(position) || position.length < 2) {
    return false;
  }

  const [lon, lat] = position;

  if (!isFiniteNumber(lon) || !isFiniteNumber(lat)) {
    return false;
  }

  visitor(lon, lat);
  return true;
}

function visitPolygonCoordinates(coordinates, visitor) {
  if (!Array.isArray(coordinates)) {
    return 0;
  }

  let count = 0;

  for (const ring of coordinates) {
    if (!Array.isArray(ring)) {
      continue;
    }

    for (const position of ring) {
      if (visitPosition(position, visitor)) {
        count += 1;
      }
    }
  }

  return count;
}

function visitGeometryCoordinates(geometry, visitor) {
  if (geometry.type === 'Polygon') {
    return visitPolygonCoordinates(geometry.coordinates, visitor);
  }

  if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.reduce((count, polygonCoordinates) => {
      return count + visitPolygonCoordinates(polygonCoordinates, visitor);
    }, 0);
  }

  return 0;
}

function formatRangeValue(value) {
  return Number.isFinite(value) ? value.toFixed(7) : 'n/a';
}

function printList(title, items) {
  if (items.length === 0) {
    return;
  }

  console.log(`\n${title}`);
  for (const item of items) {
    console.log(`- ${item}`);
  }
}

async function readJsonFile() {
  let raw;

  try {
    raw = await readFile(targetPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`File does not exist: ${TARGET_RELATIVE_PATH}`);
    }

    throw error;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`JSON parse failed: ${error.message}`);
  }
}

async function main() {
  const errors = [];
  const warnings = [];
  const geometryTypeCounts = {
    Polygon: 0,
    MultiPolygon: 0,
  };
  const coordinateRange = createCoordinateRange();
  const missingIdExamples = [];
  let totalCoordinateCount = 0;
  let projectedLikeCoordinateCount = 0;
  let outOfRangeCoordinateCount = 0;

  const geojson = await readJsonFile();

  if (!isPlainObject(geojson)) {
    errors.push('Top-level JSON value must be an object.');
  }

  if (geojson.type !== 'FeatureCollection') {
    errors.push(`Top-level type must be FeatureCollection. Received: ${String(geojson.type)}`);
  }

  if (!Array.isArray(geojson.features)) {
    errors.push('features must be an array.');
  }

  if (errors.length > 0) {
    printList('Errors', errors);
    process.exitCode = 1;
    return;
  }

  const features = geojson.features;

  if (features.length === 0) {
    errors.push('Feature count must be greater than 0.');
  }

  features.forEach((feature, index) => {
    if (!isPlainObject(feature)) {
      errors.push(`Feature ${index} must be an object.`);
      return;
    }

    const geometry = feature.geometry;

    if (!isPlainObject(geometry)) {
      errors.push(`Feature ${index} is missing geometry.`);
      return;
    }

    if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') {
      errors.push(`Feature ${index} geometry type must be Polygon or MultiPolygon. Received: ${String(geometry.type)}`);
      return;
    }

    geometryTypeCounts[geometry.type] += 1;

    const coordinateCount = visitGeometryCoordinates(geometry, (lon, lat) => {
      updateCoordinateRange(coordinateRange, lon, lat);

      if (isProjectedLikeValue(lon) || isProjectedLikeValue(lat)) {
        projectedLikeCoordinateCount += 1;
      }

      if (
        lon < LONGITUDE_RANGE.min ||
        lon > LONGITUDE_RANGE.max ||
        lat < LATITUDE_RANGE.min ||
        lat > LATITUDE_RANGE.max
      ) {
        outOfRangeCoordinateCount += 1;
      }
    });

    totalCoordinateCount += coordinateCount;

    if (coordinateCount === 0) {
      errors.push(`Feature ${index} has no valid numeric coordinate positions.`);
    }

    const properties = isPlainObject(feature.properties) ? feature.properties : {};
    const hasBuildingId = properties.building_id !== undefined || properties.id !== undefined || feature.id !== undefined;

    if (!hasBuildingId && missingIdExamples.length < 10) {
      missingIdExamples.push(index);
    }
  });

  if (totalCoordinateCount === 0) {
    errors.push('No valid coordinates found.');
  }

  if (outOfRangeCoordinateCount > 0) {
    errors.push(
      `${outOfRangeCoordinateCount.toLocaleString('en-US')} coordinate positions are outside rough EPSG:4326 Korea bounds ` +
        `(lon ${LONGITUDE_RANGE.min}-${LONGITUDE_RANGE.max}, lat ${LATITUDE_RANGE.min}-${LATITUDE_RANGE.max}).`,
    );
  }

  if (projectedLikeCoordinateCount > 0) {
    warnings.push(
      `${projectedLikeCoordinateCount.toLocaleString('en-US')} coordinate positions look like projected EPSG:5179/5186 values ` +
        `(${PROJECTED_COORDINATE_MIN}-${PROJECTED_COORDINATE_MAX}). Convert to EPSG:4326 lon/lat before serving to the map.`,
    );
  }

  if (missingIdExamples.length > 0) {
    warnings.push(
      `Some features are missing building_id/id. First examples: ${missingIdExamples.map((index) => `#${index}`).join(', ')}`,
    );
  }

  const firstFeatureProperties = isPlainObject(features[0]?.properties) ? features[0].properties : {};
  const firstFeaturePropertyKeys = Object.keys(firstFeatureProperties);

  console.log('Hwaseong building GeoJSON validation summary');
  console.log(`Target: ${TARGET_RELATIVE_PATH}`);
  console.log(`Feature count: ${features.length.toLocaleString('en-US')}`);
  console.log(`Geometry type counts: Polygon=${geometryTypeCounts.Polygon}, MultiPolygon=${geometryTypeCounts.MultiPolygon}`);
  console.log(
    `Coordinate range: lon ${formatRangeValue(coordinateRange.lonMin)} to ${formatRangeValue(
      coordinateRange.lonMax,
    )}, lat ${formatRangeValue(coordinateRange.latMin)} to ${formatRangeValue(coordinateRange.latMax)}`,
  );
  console.log(
    `First feature property keys: ${firstFeaturePropertyKeys.length > 0 ? firstFeaturePropertyKeys.join(', ') : '(none)'}`,
  );

  printList('Warnings', warnings);
  printList('Errors', errors);

  if (errors.length > 0) {
    process.exitCode = 1;
    return;
  }

  console.log('\nValidation passed.');
}

main().catch((error) => {
  console.error('Validation failed before summary.');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
