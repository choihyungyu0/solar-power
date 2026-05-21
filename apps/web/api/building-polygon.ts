import { createBuildingPolygonRecord, selectBuildingByPoint } from '../src/lib/spatialSelect';
import type { BuildingPolygonFeature, BuildingPolygonProxyResponse } from '../src/types/buildingPolygon';

const BUILDING_POLYGON_TIMEOUT_MS = 8000;
const BUILDING_POLYGON_UNCONFIGURED_MESSAGE = '화성시 건물 polygon 데이터가 아직 연결되지 않았습니다.';

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function jsonResponse(body: BuildingPolygonProxyResponse | { error: string }, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

function readRequiredNumber(payload: Record<string, unknown>, key: string) {
  const value = payload[key];

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError(`${key} is required and must be a number.`);
  }

  return value;
}

function validateLongitude(longitude: number) {
  if (longitude < -180 || longitude > 180) {
    throw new ValidationError('longitude must be between -180 and 180.');
  }
}

function validateLatitude(latitude: number) {
  if (latitude < -90 || latitude > 90) {
    throw new ValidationError('latitude must be between -90 and 90.');
  }
}

function isCoordinate(value: unknown) {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

function isPolygonCoordinates(value: unknown) {
  return (
    Array.isArray(value) &&
    value.some(
      (ring) =>
        Array.isArray(ring) &&
        ring.length >= 4 &&
        ring.every(isCoordinate),
    )
  );
}

function isMultiPolygonCoordinates(value: unknown) {
  return Array.isArray(value) && value.some(isPolygonCoordinates);
}

function isBuildingPolygonFeature(value: unknown): value is BuildingPolygonFeature {
  if (!isRecord(value) || value.type !== 'Feature' || !isRecord(value.geometry)) {
    return false;
  }

  if (value.geometry.type === 'Polygon') {
    return isPolygonCoordinates(value.geometry.coordinates);
  }

  if (value.geometry.type === 'MultiPolygon') {
    return isMultiPolygonCoordinates(value.geometry.coordinates);
  }

  return false;
}

function readNestedValue(value: unknown, path: string[]) {
  let current = value;

  for (const key of path) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[key];
  }

  return current;
}

function readFeatureCandidates(payload: unknown) {
  const directCandidates = [
    payload,
    readNestedValue(payload, ['building']),
    readNestedValue(payload, ['feature']),
    readNestedValue(payload, ['data']),
    readNestedValue(payload, ['data', 'building']),
    readNestedValue(payload, ['data', 'feature']),
    readNestedValue(payload, ['result']),
    readNestedValue(payload, ['result', 'building']),
    readNestedValue(payload, ['result', 'feature']),
  ];
  const collectionCandidates = [
    readNestedValue(payload, ['features']),
    readNestedValue(payload, ['data', 'features']),
    readNestedValue(payload, ['result', 'features']),
  ];
  const features = directCandidates.filter(isBuildingPolygonFeature);

  for (const candidate of collectionCandidates) {
    if (Array.isArray(candidate)) {
      features.push(...candidate.filter(isBuildingPolygonFeature));
    }
  }

  return features;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export default async function handler(request: Request) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  const apiUrl = process.env.BUILDING_POLYGON_API_URL?.trim();

  if (!apiUrl) {
    return jsonResponse({ ok: false, message: BUILDING_POLYGON_UNCONFIGURED_MESSAGE });
  }

  let longitude: number;
  let latitude: number;

  try {
    const body = (await request.json().catch(() => null)) as unknown;

    if (!isRecord(body)) {
      throw new ValidationError('Request body must be a JSON object.');
    }

    longitude = readRequiredNumber(body, 'longitude');
    latitude = readRequiredNumber(body, 'latitude');
    validateLongitude(longitude);
    validateLatitude(latitude);
  } catch (error) {
    return jsonResponse(
      { ok: false, message: error instanceof Error ? error.message : 'Building polygon request validation failed.' },
      400,
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BUILDING_POLYGON_TIMEOUT_MS);
  const apiKey = process.env.BUILDING_POLYGON_API_KEY?.trim();

  try {
    const headers: Record<string, string> = {
      Accept: 'application/json, application/geo+json',
      'Content-Type': 'application/json; charset=UTF-8',
      'User-Agent': 'solarmate-backend/0.1',
    };

    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
      headers['X-API-Key'] = apiKey;
    }

    const externalResponse = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ longitude, latitude }),
      signal: controller.signal,
    });
    const payload = await readJsonResponse(externalResponse);
    const features = readFeatureCandidates(payload);

    if (!externalResponse.ok) {
      return jsonResponse({ ok: false, message: '건물 polygon API 응답이 정상 상태가 아닙니다.' }, 502);
    }

    if (features.length === 0) {
      return jsonResponse({ ok: false, message: '건물 polygon API 응답에서 polygon geometry를 찾지 못했습니다.' }, 404);
    }

    const selectedBuilding =
      features.length === 1
        ? createBuildingPolygonRecord({
            feature: features[0],
            source: 'api',
            sourceLabel: '화성시 건물 polygon API',
          })
        : selectBuildingByPoint({
            features,
            longitude,
            latitude,
            source: 'api',
            sourceLabel: '화성시 건물 polygon API',
          });

    if (!selectedBuilding) {
      return jsonResponse({ ok: false, message: '선택 좌표와 일치하는 건물 polygon을 찾지 못했습니다.' }, 404);
    }

    return jsonResponse({
      ok: true,
      source: 'api',
      building: {
        id: selectedBuilding.id,
        address: selectedBuilding.address,
        name: selectedBuilding.name,
        geometryType: selectedBuilding.geometryType,
        source: 'api',
        sourceLabel: selectedBuilding.sourceLabel,
        feature: selectedBuilding.feature,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return jsonResponse({ ok: false, message: '건물 polygon API 요청 시간이 초과되었습니다.' }, 504);
    }

    return jsonResponse({ ok: false, message: '건물 polygon API 요청에 실패했습니다.' }, 502);
  } finally {
    clearTimeout(timeoutId);
  }
}

