const DEFAULT_DATA_ID = 'LP_PA_CBND_BUBUN';
const DEFAULT_BUFFER_METERS = 10;

type VWorldFeature = {
  type: 'Feature';
  id?: string | number;
  properties?: Record<string, unknown>;
  geometry?: {
    type: string;
    coordinates: unknown;
  };
};

type ErrorResponse = {
  error: string;
  details?: unknown;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function validateCoordinate(value: string | null, label: 'lon' | 'lat') {
  const coordinate = Number(value);
  const min = label === 'lon' ? -180 : -90;
  const max = label === 'lon' ? 180 : 90;

  if (!Number.isFinite(coordinate) || coordinate < min || coordinate > max) {
    throw new Error(`${label} query parameter is invalid.`);
  }

  return coordinate;
}

function normalizeBuffer(value: string | null) {
  const buffer = Number(value ?? DEFAULT_BUFFER_METERS);

  if (!Number.isFinite(buffer) || buffer <= 0) {
    return DEFAULT_BUFFER_METERS;
  }

  return Math.min(Math.round(buffer), 100);
}

function normalizeDataId(value: string | null) {
  const dataId = value?.trim() || DEFAULT_DATA_ID;

  if (!/^[A-Za-z0-9_-]+$/.test(dataId)) {
    throw new Error('dataId query parameter is invalid.');
  }

  return dataId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
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

function isVWorldFeatureLike(value: unknown): value is VWorldFeature {
  return isRecord(value) && (value.type === 'Feature' || isRecord(value.geometry));
}

function readFeatures(payload: unknown): VWorldFeature[] {
  const candidates = [
    readNestedValue(payload, ['response', 'result', 'featureCollection', 'features']),
    readNestedValue(payload, ['result', 'featureCollection', 'features']),
    readNestedValue(payload, ['features']),
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter(isVWorldFeatureLike);
    }
  }

  return [];
}

function readRawStatus(payload: unknown) {
  const rawStatus =
    readNestedValue(payload, ['response', 'status']) ??
    readNestedValue(payload, ['status']) ??
    readNestedValue(payload, ['response', 'result', 'status']) ??
    readNestedValue(payload, ['result', 'status']);

  return typeof rawStatus === 'string' ? rawStatus : undefined;
}

function createProxyPayload({
  ok,
  status,
  features,
  message,
  rawStatus,
  dataId,
  longitude,
  latitude,
  buffer,
  details,
}: {
  ok: boolean;
  status: 'success' | 'not_found' | 'error';
  features: VWorldFeature[];
  message: string;
  rawStatus?: string;
  dataId: string;
  longitude: number;
  latitude: number;
  buffer: number;
  details?: unknown;
}) {
  return {
    ok,
    status,
    features,
    featureCount: features.length,
    message,
    rawStatus,
    dataId,
    requestedLon: longitude,
    requestedLat: latitude,
    buffer,
    details,
  };
}

async function readVWorldJson(response: Response): Promise<unknown> {
  const text = await response.text();

  try {
    return JSON.parse(text) as unknown;
  } catch {
    const errorBody: ErrorResponse = {
      error: 'VWorld API returned a non-JSON response.',
      details: {
        status: response.status,
      },
    };

    throw new Error(JSON.stringify(errorBody));
  }
}

function getVWorldError(payload: unknown) {
  const status = readRawStatus(payload)?.toUpperCase();
  const responseError = readNestedValue(payload, ['response', 'error']);

  if (status === 'ERROR') {
    return {
      status: readRawStatus(payload),
      code: isRecord(responseError) && typeof responseError.code === 'string' ? responseError.code : undefined,
      message:
        isRecord(responseError) && typeof responseError.text === 'string'
          ? responseError.text
          : isRecord(responseError) && typeof responseError.message === 'string'
            ? responseError.message
            : 'VWorld API returned an error.',
    };
  }

  const topLevelError = readNestedValue(payload, ['error']);

  if (typeof topLevelError === 'string') {
    return {
      status: 'ERROR',
      message: topLevelError,
    };
  }

  return null;
}

export default async function handler(request: Request) {
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  const apiKey = process.env.VWORLD_API_KEY?.trim();

  if (!apiKey) {
    return jsonResponse(
      {
        ok: false,
        status: 'error',
        features: [],
        featureCount: 0,
        message: 'VWORLD_API_KEY server environment variable is missing.',
      },
      500,
    );
  }

  try {
    const requestUrl = new URL(request.url);
    const longitude = validateCoordinate(requestUrl.searchParams.get('lon'), 'lon');
    const latitude = validateCoordinate(requestUrl.searchParams.get('lat'), 'lat');
    const dataId = normalizeDataId(requestUrl.searchParams.get('dataId'));
    const buffer = normalizeBuffer(requestUrl.searchParams.get('buffer'));
    const domain =
      process.env.VWORLD_DOMAIN?.trim() ||
      requestUrl.searchParams.get('domain')?.trim() ||
      request.headers.get('origin') ||
      requestUrl.origin;

    const vworldUrl = new URL('https://api.vworld.kr/req/data');

    vworldUrl.searchParams.set('service', 'data');
    vworldUrl.searchParams.set('version', '2.0');
    vworldUrl.searchParams.set('request', 'GetFeature');
    vworldUrl.searchParams.set('format', 'json');
    vworldUrl.searchParams.set('data', dataId);
    vworldUrl.searchParams.set('key', apiKey);
    vworldUrl.searchParams.set('domain', domain);
    vworldUrl.searchParams.set('geomFilter', `POINT(${longitude} ${latitude})`);
    vworldUrl.searchParams.set('buffer', String(buffer));
    vworldUrl.searchParams.set('geometry', 'true');
    vworldUrl.searchParams.set('attribute', 'true');
    vworldUrl.searchParams.set('crs', 'EPSG:4326');
    vworldUrl.searchParams.set('size', '10');

    const vworldResponse = await fetch(vworldUrl.toString(), {
      headers: {
        Accept: 'application/json',
      },
    });
    const payload = await readVWorldJson(vworldResponse);
    const rawStatus = readRawStatus(payload);
    const normalizedRawStatus = rawStatus?.toUpperCase();
    const features = readFeatures(payload);
    const vworldError = getVWorldError(payload);

    if (!vworldResponse.ok) {
      return jsonResponse(
        createProxyPayload({
          ok: false,
          status: 'error',
          features: [],
          message: 'VWorld API request failed.',
          rawStatus,
          dataId,
          longitude,
          latitude,
          buffer,
          details: { status: vworldResponse.status },
        }),
        502,
      );
    }

    if (vworldError) {
      return jsonResponse(
        createProxyPayload({
          ok: false,
          status: 'error',
          features: [],
          message: vworldError.message,
          rawStatus,
          dataId,
          longitude,
          latitude,
          buffer,
          details: vworldError,
        }),
        502,
      );
    }

    if (normalizedRawStatus === 'NOT_FOUND' || features.length === 0) {
      return jsonResponse(
        createProxyPayload({
          ok: false,
          status: 'not_found',
          features: [],
          message: '선택 위치 주변에서 공간정보 도형을 찾지 못했습니다.',
          rawStatus,
          dataId,
          longitude,
          latitude,
          buffer,
        }),
      );
    }

    return jsonResponse(
      createProxyPayload({
        ok: true,
        status: 'success',
        features,
        message: '선택 위치 주변의 공간정보 도형을 조회했습니다.',
        rawStatus,
        dataId,
        longitude,
        latitude,
        buffer,
      }),
    );
  } catch (error) {
    if (error instanceof Error) {
      try {
        const parsedError = JSON.parse(error.message) as ErrorResponse;

        return jsonResponse(
          {
            ok: false,
            status: 'error',
            features: [],
            featureCount: 0,
            message: parsedError.error,
            details: parsedError.details,
          },
          502,
        );
      } catch {
        return jsonResponse(
          {
            ok: false,
            status: 'error',
            features: [],
            featureCount: 0,
            message: error.message,
          },
          400,
        );
      }
    }

    return jsonResponse(
      {
        ok: false,
        status: 'error',
        features: [],
        featureCount: 0,
        message: 'Unknown VWorld feature proxy error.',
      },
      500,
    );
  }
}
