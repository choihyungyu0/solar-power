export type VWorldPointQueryParams = {
  longitude: number;
  latitude: number;
  bufferMeters?: number;
};

export type VWorldFeature = {
  type: 'Feature';
  id?: string | number;
  properties?: Record<string, unknown>;
  geometry?: {
    type: string;
    coordinates: unknown;
  };
};

export type VWorldFeatureQueryStatus = 'idle' | 'loading' | 'success' | 'not_found' | 'error';

export type VWorldFeatureQueryResult = {
  features: VWorldFeature[];
  dataId: string;
  dataTypeLabel: string;
  isActualRoofPolygon: boolean;
  dataTypeNote: string;
  sourceKind: 'building-or-roof' | 'parcel-fallback';
  requestMode: 'server-proxy';
  queryStatus: VWorldFeatureQueryStatus;
  featureCount: number;
  rawStatus?: string;
  errorMessage?: string;
  requestedLon: number;
  requestedLat: number;
  buffer: number;
  requestPath: string;
};

export class MissingVWorldBuildingDataIdError extends Error {
  constructor() {
    super('건물 도형 데이터ID가 설정되지 않아 실제 옥상 polygon 조회를 할 수 없습니다.');
    this.name = 'MissingVWorldBuildingDataIdError';
  }
}

const DEFAULT_BUILDING_DATA_ID = 'LP_PA_CBND_BUBUN';
const PROXY_ERROR_MESSAGE = '브이월드 데이터 API 조회에 실패했습니다. 서버 프록시, 인증키, 도메인 설정을 확인해주세요.';

function getBuildingDataId() {
  return import.meta.env.VITE_VWORLD_BUILDING_DATA_ID?.trim() || DEFAULT_BUILDING_DATA_ID;
}

export function isCadastralParcelDataId(dataId: string) {
  return dataId.trim().toUpperCase() === 'LP_PA_CBND_BUBUN';
}

export function getVWorldFeatureDataTypeInfo(dataId: string) {
  if (isCadastralParcelDataId(dataId)) {
    return {
      dataTypeLabel: '연속지적도 기반 필지 polygon',
      isActualRoofPolygon: false,
      dataTypeNote: '연속지적도 기반 필지 polygon을 사용한 1차 추정입니다. 실제 건물 옥상 도형은 아닙니다.',
      sourceKind: 'parcel-fallback' as const,
    };
  }

  return {
    dataTypeLabel: '건물/옥상 후보 polygon',
    isActualRoofPolygon: false,
    dataTypeNote:
      '브이월드 건물 또는 옥상 관련 데이터ID 기준의 1차 추정입니다. 실제 roof geometry 여부는 데이터셋 정의 확인이 필요합니다.',
    sourceKind: 'building-or-roof' as const,
  };
}

export function getConfiguredVWorldBuildingDataId() {
  return getBuildingDataId();
}

export function buildVWorldFeatureProxyPath({
  longitude,
  latitude,
  dataId,
  bufferMeters = 10,
}: {
  longitude: number;
  latitude: number;
  dataId: string;
  bufferMeters?: number;
}) {
  const params = new URLSearchParams();

  params.set('lon', String(longitude));
  params.set('lat', String(latitude));
  params.set('dataId', dataId);
  params.set('buffer', String(bufferMeters));

  return `/api/vworld-feature?${params.toString()}`;
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
    readNestedValue(payload, ['features']),
    readNestedValue(payload, ['result', 'featureCollection', 'features']),
    readNestedValue(payload, ['response', 'result', 'featureCollection', 'features']),
    readNestedValue(payload, ['response', 'features']),
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
    readNestedValue(payload, ['rawStatus']) ??
    readNestedValue(payload, ['status']) ??
    readNestedValue(payload, ['response', 'status']) ??
    readNestedValue(payload, ['result', 'status']) ??
    readNestedValue(payload, ['response', 'result', 'status']);

  return typeof rawStatus === 'string' ? rawStatus : undefined;
}

function readProxyStatus(payload: unknown): VWorldFeatureQueryStatus | undefined {
  const status = readNestedValue(payload, ['status']);

  if (status === 'success' || status === 'not_found' || status === 'error') {
    return status;
  }

  return undefined;
}

function readMessage(payload: unknown) {
  const message = readNestedValue(payload, ['message']);

  return typeof message === 'string' ? message : undefined;
}

function createQueryResult({
  payload,
  dataId,
  longitude,
  latitude,
  bufferMeters,
  requestPath,
  queryStatus,
  errorMessage,
}: {
  payload: unknown;
  dataId: string;
  longitude: number;
  latitude: number;
  bufferMeters: number;
  requestPath: string;
  queryStatus?: VWorldFeatureQueryStatus;
  errorMessage?: string;
}): VWorldFeatureQueryResult {
  const dataTypeInfo = getVWorldFeatureDataTypeInfo(dataId);
  const features = readFeatures(payload);
  const rawStatus = readRawStatus(payload);
  const proxyStatus = readProxyStatus(payload);
  const nextQueryStatus =
    queryStatus ?? proxyStatus ?? (features.length > 0 ? 'success' : 'not_found');

  return {
    features,
    dataId,
    ...dataTypeInfo,
    requestMode: 'server-proxy',
    queryStatus: nextQueryStatus,
    featureCount: features.length,
    rawStatus,
    errorMessage,
    requestedLon: longitude,
    requestedLat: latitude,
    buffer: bufferMeters,
    requestPath,
  };
}

export async function queryVWorldFeaturesByPoint({
  longitude,
  latitude,
  bufferMeters = 10,
}: VWorldPointQueryParams): Promise<VWorldFeatureQueryResult> {
  const dataId = getBuildingDataId();
  const requestPath = buildVWorldFeatureProxyPath({
    longitude,
    latitude,
    dataId,
    bufferMeters,
  });
  const url = new URL(requestPath, window.location.origin);

  // The data ID must be a VWorld building, roof, or building-facility related dataset.
  // If roof geometry is not available, a building footprint can be used as a first approximation.
  // LP_PA_CBND_BUBUN is cadastral parcel data and must not be treated as an exact roof polygon.
  try {
    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
      },
    });
    const payload = (await response.json().catch(() => null)) as unknown;

    if (!response.ok) {
      return createQueryResult({
        payload,
        dataId,
        longitude,
        latitude,
        bufferMeters,
        requestPath,
        queryStatus: 'error',
        errorMessage: PROXY_ERROR_MESSAGE,
      });
    }

    const proxyStatus = readProxyStatus(payload);
    const message = readMessage(payload);

    if (proxyStatus === 'error') {
      return createQueryResult({
        payload,
        dataId,
        longitude,
        latitude,
        bufferMeters,
        requestPath,
        queryStatus: 'error',
        errorMessage: message || PROXY_ERROR_MESSAGE,
      });
    }

    return createQueryResult({
      payload,
      dataId,
      longitude,
      latitude,
      bufferMeters,
      requestPath,
      queryStatus: proxyStatus,
    });
  } catch {
    return createQueryResult({
      payload: null,
      dataId,
      longitude,
      latitude,
      bufferMeters,
      requestPath,
      queryStatus: 'error',
      errorMessage: PROXY_ERROR_MESSAGE,
    });
  }
}
