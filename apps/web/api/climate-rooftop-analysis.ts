import proj4 from 'proj4';
import type {
  ClimateBundle,
  ClimateBundlePvOutputRaw,
  ClimateLiveAnalysisResponse,
  ClimateLiveRoofSource,
  ClimatePanelsGeoJson,
} from '../src/types/climateBundle';

const BASE = 'https://climate.gg.go.kr';
const SELECT_BULD_URL = `${BASE}/gcs/book/cmm/selectBuld.do`;
const OVERALL_TIMEOUT_MS = 25_000;
const SELECT_BULD_TIMEOUT_MS = 5_000;
const WFS_METADATA_TIMEOUT_MS = 5_000;
const SELECT_SUN_LIST_TIMEOUT_MS = 12_000;
const SELECT_BULD_INFO_TIMEOUT_MS = 4_000;
const SELECT_RULE_LIST_TIMEOUT_MS = 4_000;
const PV_ANALYSIS_TIMEOUT_MS = 8_000;
const SELECT_BULD_MAX_ATTEMPTS = 1;
const CELL_W_M = 1;
const CELL_H_M = 3.5;
const MAX_CELLS = 2500;
const MAX_CELL_SCAN_COUNT = 100_000;
const DEFAULT_PANEL_CAPACITY_W = 640;
const DEFAULT_PANEL_ANGLE = 35;
const DEFAULT_PANEL_TYPE = 1;
const DEFAULT_CELLS_PER_PANEL = 2;
const SELECT_BULD_MATCH_DISTANCE_THRESHOLD_M = 15;
const ANNUAL_GENERATION_KWH_PER_KW = 1265;
const ELECTRICITY_VALUE_KRW_PER_KWH = 150;
const FALLBACK_PAYBACK_YEARS = 6.8;
const CARBON_REDUCTION_KG_PER_KWH = 0.4594;
const PINE_TREE_KG_CO2_PER_YEAR = 6.6;
const MONTHLY_GENERATION_WEIGHTS = [0.072, 0.079, 0.092, 0.101, 0.107, 0.104, 0.097, 0.096, 0.087, 0.073, 0.049, 0.043];

export const maxDuration = 60;

const COMMON_HEADERS = {
  Accept: 'application/json, text/javascript, */*; q=0.01',
  'X-Requested-With': 'XMLHttpRequest',
  Origin: BASE,
  Referer: `${BASE}/`,
  'User-Agent': 'solarmate-poc/0.1',
};

const FORM_HEADERS = {
  ...COMMON_HEADERS,
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
};

const JSON_HEADERS = {
  ...COMMON_HEADERS,
  'Content-Type': 'application/json; charset=UTF-8',
};

proj4.defs(
  'EPSG:5186',
  '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs',
);

type Coordinate5186 = [number, number];
type Coordinate4326 = [number, number];
type Ring5186 = Coordinate5186[];
type Ring4326 = Coordinate4326[];
type SelectBuldStatus = 'success' | 'timeout' | 'not_found' | 'skipped' | 'mismatch_selected_building';
type ExternalStepStatus = 'success' | 'timeout' | 'failed' | 'skipped' | 'fallback';

type Cell = {
  id: number;
  bbox5186: [number, number, number, number];
  centroid5186: { x: number; y: number };
};

type SelectBuldDiagnostics = {
  selectBuldUrl: string;
  selectBuldRequestBody: string;
  selectBuldHttpStatus?: number;
  selectBuldContentType?: string | null;
  selectBuldRawTextPreview?: string;
  selectBuldRawKeys?: string[];
  selectBuldHasBuld?: boolean;
  selectBuldBuldKeys?: string[];
  selectBuldFeatureParseStatus?: string;
  selectBuldAttemptCount?: number;
  selectBuldTimeoutMs?: number;
  selectBuldAttemptTimingsMs?: number[];
  selectBuldLastError?: string;
};

type LiveDiagnostics = {
  inputWgs84: { longitude: number; latitude: number };
  input5186: { x: number; y: number };
  requestSelectedBuildingId?: string | null;
  requestSessionId?: string | null;
  selectedFeatureBuildingId?: string | null;
  ignoredStaleLiveResponse?: boolean;
  roofAreaM2: number;
  cellCount: number;
  shadingCellCount: number;
  shadingAverage: number;
  panelCount: number;
  roofSource: ClimateLiveRoofSource;
  overallTimeoutMs: number;
  elapsedMs: number;
  timedOutStep?: string | null;
  selectBuldStatus: SelectBuldStatus;
  selectSunListStatus?: ExternalStepStatus;
  pvAnalysisStatus?: ExternalStepStatus;
  fallbackReason?: string;
  selectBuldRoofMatchesSelectedBuilding?: boolean | null;
  selectBuldCentroidInsideSelectedBuilding?: boolean;
  selectBuldCentroidDistanceToSelectedBuildingM?: number | null;
  selectBuldCentroidWgs84?: { longitude: number; latitude: number } | null;
  liveHybridMode: boolean;
  maxCellsApplied: boolean;
  apiTimingsMs: Record<string, number>;
  warnings?: string[];
  unqId?: string | null;
} & Partial<SelectBuldDiagnostics>;

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

class ExternalStepError extends Error {
  step: string;
  diagnostics?: Record<string, unknown>;

  constructor(step: string, message: string, diagnostics?: Record<string, unknown>) {
    super(message);
    this.name = 'ExternalStepError';
    this.step = step;
    this.diagnostics = diagnostics;
  }
}

function jsonResponse(body: ClimateLiveAnalysisResponse | { error: string }, status = 200) {
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

function readNumber(value: unknown, fallback: number | null = null) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function roundDecimal(value: number, digits = 1) {
  const multiplier = 10 ** digits;

  return Math.round(value * multiplier) / multiplier;
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readFeatureBuildingId(feature: unknown) {
  if (!isRecord(feature)) {
    return null;
  }

  if (typeof feature.id === 'string' || typeof feature.id === 'number') {
    return String(feature.id);
  }

  const properties = isRecord(feature.properties) ? feature.properties : null;
  const candidateKeys = ['id', 'building_id', 'buildingId', 'bldg_id', 'BD_MGT_SN', 'pnu', 'PNU'];

  for (const key of candidateKeys) {
    const value = properties?.[key];

    if (typeof value === 'string' || typeof value === 'number') {
      return String(value);
    }
  }

  return null;
}

function readPositiveInteger(value: unknown, fallback: number) {
  const parsed = readNumber(value, fallback);

  return parsed && parsed > 0 ? Math.round(parsed) : fallback;
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

function validateCommonRequestBody(payload: unknown) {
  if (!isRecord(payload)) {
    throw new ValidationError('Request body must be a JSON object.');
  }

  const longitude = readNumber(payload.longitude);
  const latitude = readNumber(payload.latitude);

  if (typeof longitude !== 'number' || typeof latitude !== 'number') {
    throw new ValidationError('longitude and latitude are required.');
  }

  validateLongitude(longitude);
  validateLatitude(latitude);

  const panelCapacityW = readPositiveInteger(payload.panelCapacityW, DEFAULT_PANEL_CAPACITY_W);
  const panelAngle = readPositiveInteger(payload.panelAngle, DEFAULT_PANEL_ANGLE);
  const panelType = readPositiveInteger(payload.panelType, DEFAULT_PANEL_TYPE);
  const cellsPerPanel = readPositiveInteger(payload.cellsPerPanel, DEFAULT_CELLS_PER_PANEL);

  if (![500, 640].includes(panelCapacityW)) {
    throw new ValidationError('panelCapacityW must be 500 or 640.');
  }

  if (![30, 35].includes(panelAngle)) {
    throw new ValidationError('panelAngle must be 30 or 35.');
  }

  return {
    longitude,
    latitude,
    panelCapacityW,
    panelAngle,
    panelType,
    cellsPerPanel,
  };
}

function isCoordinate4326(value: unknown): value is Coordinate4326 {
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    typeof value[0] !== 'number' ||
    typeof value[1] !== 'number' ||
    !Number.isFinite(value[0]) ||
    !Number.isFinite(value[1])
  ) {
    return false;
  }

  return value[0] >= -180 && value[0] <= 180 && value[1] >= -90 && value[1] <= 90;
}

function closeRing4326(ring: Ring4326): Ring4326 {
  if (ring.length === 0) {
    return ring;
  }

  const first = ring[0];
  const last = ring[ring.length - 1];

  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
}

function readSelectedBuildingOuterRing4326(feature: unknown): Ring4326 | null {
  if (!isRecord(feature) || feature.type !== 'Feature' || !isRecord(feature.geometry)) {
    return null;
  }

  const { geometry } = feature;

  if (geometry.type === 'Polygon') {
    const ring = Array.isArray(geometry.coordinates) ? geometry.coordinates[0] : null;

    return Array.isArray(ring) && ring.every(isCoordinate4326) ? closeRing4326(ring) : null;
  }

  if (geometry.type === 'MultiPolygon') {
    const ring = Array.isArray(geometry.coordinates) ? geometry.coordinates[0]?.[0] : null;

    return Array.isArray(ring) && ring.every(isCoordinate4326) ? closeRing4326(ring) : null;
  }

  return null;
}

function convertRing4326To5186(ring: Ring4326): Ring5186 {
  return ring.map(([longitude, latitude]) => to5186(longitude, latitude));
}

function validateLiveHybridRequestBody(payload: unknown) {
  const input = validateCommonRequestBody(payload);

  if (!isRecord(payload)) {
    throw new ValidationError('Request body must be a JSON object.');
  }

  const selectedBuildingRing4326 = readSelectedBuildingOuterRing4326(payload.selectedBuildingFeature);

  if (!selectedBuildingRing4326 || selectedBuildingRing4326.length < 4) {
    throw new ValidationError('selectedBuildingFeature must be a GeoJSON Polygon or MultiPolygon Feature in EPSG:4326.');
  }

  return {
    ...input,
    selectedBuildingId: readString(payload.selectedBuildingId) ?? 'selected-building',
    selectedAnalysisSessionId: readString(payload.selectedAnalysisSessionId),
    selectedFeatureBuildingId: readFeatureBuildingId(payload.selectedBuildingFeature),
    selectedBuildingFeature: payload.selectedBuildingFeature,
    selectedBuildingRing4326,
    selectedBuildingRing5186: convertRing4326To5186(selectedBuildingRing4326),
  };
}

function createFailureResponse(
  message: string,
  diagnostics: Partial<LiveDiagnostics> & Record<string, unknown> = {},
  status = 200,
  identity: {
    selectedBuildingId?: string | null;
    selectedAnalysisSessionId?: string | null;
    selectedFeatureBuildingId?: string | null;
  } = {},
) {
  const responseDiagnostics = {
    overallTimeoutMs: OVERALL_TIMEOUT_MS,
    timedOutStep: null,
    selectBuldStatus: 'skipped',
    selectSunListStatus: 'skipped',
    pvAnalysisStatus: 'skipped',
    ...diagnostics,
    requestSelectedBuildingId:
      identity.selectedBuildingId ?? (diagnostics.requestSelectedBuildingId as string | null | undefined) ?? null,
    requestSessionId:
      identity.selectedAnalysisSessionId ?? (diagnostics.requestSessionId as string | null | undefined) ?? null,
    selectedFeatureBuildingId:
      identity.selectedFeatureBuildingId ?? (diagnostics.selectedFeatureBuildingId as string | null | undefined) ?? null,
    ignoredStaleLiveResponse: false,
  };

  return jsonResponse(
    {
      ok: false,
      source: 'climate.gg-live-hybrid',
      ...(diagnostics.roofSource ? { roofSource: diagnostics.roofSource as ClimateLiveRoofSource } : {}),
      selectedBuildingId: responseDiagnostics.requestSelectedBuildingId,
      selectedAnalysisSessionId: responseDiagnostics.requestSessionId,
      selectedFeatureBuildingId: responseDiagnostics.selectedFeatureBuildingId,
      message,
      fallbackRecommended: true,
      diagnostics: responseDiagnostics,
    },
    status,
  );
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  options: { step: string; overallSignal?: AbortSignal } = { step: 'fetch' },
) {
  const controller = new AbortController();
  let didOverallAbort = false;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromOverall = () => {
    didOverallAbort = true;
    controller.abort();
  };

  if (options.overallSignal?.aborted) {
    throw new ExternalStepError(options.step, '전체 분석 시간이 초과되었습니다.', {
      timedOutStep: options.step,
      overallTimeoutMs: OVERALL_TIMEOUT_MS,
    });
  }

  options.overallSignal?.addEventListener('abort', abortFromOverall, { once: true });

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (didOverallAbort) {
      throw new ExternalStepError(options.step, '전체 분석 시간이 초과되었습니다.', {
        timedOutStep: options.step,
        overallTimeoutMs: OVERALL_TIMEOUT_MS,
      });
    }

    throw error;
  } finally {
    options.overallSignal?.removeEventListener('abort', abortFromOverall);
    clearTimeout(timeoutId);
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function timedJson<T>(
  timings: Record<string, number>,
  step: string,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  overallSignal?: AbortSignal,
): Promise<T> {
  const startedAt = Date.now();

  try {
    const response = await fetchWithTimeout(url, init, timeoutMs, { step, overallSignal });
    timings[step] = Date.now() - startedAt;

    if (!response.ok) {
      throw new ExternalStepError(step, `${step} 응답 상태가 정상 범위가 아닙니다.`);
    }

    return (await readJson(response)) as T;
  } catch (error) {
    timings[step] = Date.now() - startedAt;

    if (error instanceof ExternalStepError) {
      throw error;
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new ExternalStepError(step, `${step} 요청 시간이 초과되었습니다.`);
    }

    throw new ExternalStepError(step, `${step} 호출에 실패했습니다.`);
  }
}

function to5186(longitude: number, latitude: number) {
  const [x, y] = proj4('EPSG:4326', 'EPSG:5186', [longitude, latitude]);

  return [x, y] as Coordinate5186;
}

function to4326(x: number, y: number) {
  const [longitude, latitude] = proj4('EPSG:5186', 'EPSG:4326', [x, y]);

  return [longitude, latitude] as [number, number];
}

function isCoordinate5186(value: unknown): value is Coordinate5186 {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

function getOuterRingFromGeometry(geometry: unknown): Ring5186 | null {
  if (!isRecord(geometry) || !Array.isArray(geometry.coordinates)) {
    return null;
  }

  if (geometry.type === 'Polygon') {
    const ring = geometry.coordinates[0];

    return Array.isArray(ring) && ring.every(isCoordinate5186) ? ring : null;
  }

  if (geometry.type === 'MultiPolygon') {
    const ring = geometry.coordinates[0]?.[0];

    return Array.isArray(ring) && ring.every(isCoordinate5186) ? ring : null;
  }

  return null;
}

function createSelectBuldBody(x: number, y: number) {
  const body = new URLSearchParams({
    x: String(x),
    y: String(y),
    type: 'PANEL',
  });

  return body.toString();
}

function previewText(value: string, maxLength = 500) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function parseJsonOrNull(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function extractSelectBuldRing(payload: unknown, diagnostics: SelectBuldDiagnostics): Ring5186 | null {
  diagnostics.selectBuldRawKeys = isRecord(payload) ? Object.keys(payload) : undefined;
  diagnostics.selectBuldHasBuld = isRecord(payload) && Boolean(payload.buld);

  if (!isRecord(payload) || !isRecord(payload.buld)) {
    diagnostics.selectBuldFeatureParseStatus = 'missing-buld';
    return null;
  }

  diagnostics.selectBuldBuldKeys = Object.keys(payload.buld);
  const featureText = payload.buld.feature;

  if (typeof featureText !== 'string') {
    diagnostics.selectBuldFeatureParseStatus = 'missing-feature-string';
    return null;
  }

  try {
    const feature = JSON.parse(featureText) as unknown;
    const geometry = isRecord(feature) ? feature.geometry : null;
    const ring = getOuterRingFromGeometry(geometry);

    diagnostics.selectBuldFeatureParseStatus = ring ? 'parsed' : 'parsed-feature-no-supported-ring';

    return ring;
  } catch (error) {
    diagnostics.selectBuldFeatureParseStatus = `feature-json-parse-failed: ${
      error instanceof Error ? error.message : 'unknown'
    }`;

    return null;
  }
}

async function runSelectBuldRequest(x: number, y: number, timings?: Record<string, number>, overallSignal?: AbortSignal) {
  const requestBody = createSelectBuldBody(x, y);
  const diagnostics: SelectBuldDiagnostics = {
    selectBuldUrl: SELECT_BULD_URL,
    selectBuldRequestBody: requestBody,
    selectBuldAttemptCount: 0,
    selectBuldTimeoutMs: SELECT_BULD_TIMEOUT_MS,
    selectBuldAttemptTimingsMs: [],
  };
  const startedAt = Date.now();

  for (let attempt = 1; attempt <= SELECT_BULD_MAX_ATTEMPTS; attempt += 1) {
    const attemptStartedAt = Date.now();
    diagnostics.selectBuldAttemptCount = attempt;

    try {
      const response = await fetchWithTimeout(
        SELECT_BULD_URL,
        {
          method: 'POST',
          headers: FORM_HEADERS,
          body: requestBody,
        },
        SELECT_BULD_TIMEOUT_MS,
        { step: 'selectBuld', overallSignal },
      );
      const rawText = await response.text();
      const payload = parseJsonOrNull(rawText);

      diagnostics.selectBuldAttemptTimingsMs?.push(Date.now() - attemptStartedAt);
      if (timings) {
        timings.selectBuld = Date.now() - startedAt;
      }

      diagnostics.selectBuldHttpStatus = response.status;
      diagnostics.selectBuldContentType = response.headers.get('content-type');
      diagnostics.selectBuldRawTextPreview = previewText(rawText);

      if (!response.ok) {
        diagnostics.selectBuldLastError = `attempt ${attempt}: HTTP ${response.status}`;
        throw new ExternalStepError('selectBuld', 'selectBuld 응답 상태가 정상 범위가 아닙니다.', diagnostics);
      }

      if (!payload) {
        diagnostics.selectBuldFeatureParseStatus = 'response-json-parse-failed';
        diagnostics.selectBuldLastError = `attempt ${attempt}: response-json-parse-failed`;

        return { ring: null, diagnostics };
      }

      const ring = extractSelectBuldRing(payload, diagnostics);

      return { ring, diagnostics };
    } catch (error) {
      diagnostics.selectBuldAttemptTimingsMs?.push(Date.now() - attemptStartedAt);
      if (timings) {
        timings.selectBuld = Date.now() - startedAt;
      }

      if (error instanceof ExternalStepError) {
        throw error;
      }

      const isTimeout = error instanceof Error && error.name === 'AbortError';
      diagnostics.selectBuldFeatureParseStatus = isTimeout ? 'request-timeout' : 'request-failed';
      diagnostics.selectBuldLastError = `attempt ${attempt}: ${
        isTimeout ? 'request-timeout' : error instanceof Error ? error.message : 'unknown'
      }`;

      if (isTimeout && attempt < SELECT_BULD_MAX_ATTEMPTS) {
        continue;
      }

      throw new ExternalStepError(
        'selectBuld',
        isTimeout && attempt === SELECT_BULD_MAX_ATTEMPTS
          ? 'climate.gg selectBuld 요청이 2회 모두 시간 초과되었습니다.'
          : 'selectBuld 호출에 실패했습니다.',
        diagnostics,
      );
    }
  }

  throw new ExternalStepError('selectBuld', 'selectBuld 호출에 실패했습니다.', diagnostics);
}

async function selectBuld(x: number, y: number, timings: Record<string, number>, overallSignal?: AbortSignal) {
  const result = await runSelectBuldRequest(x, y, timings, overallSignal);

  if (!result.ring) {
    throw new ExternalStepError(
      'selectBuld',
      '선택 좌표에서 climate.gg 옥상 polygon을 찾지 못했습니다.',
      result.diagnostics,
    );
  }

  return { ring: result.ring, diagnostics: result.diagnostics };
}

async function runSelectBuldCandidateRequest(
  x: number,
  y: number,
  timings?: Record<string, number>,
  overallSignal?: AbortSignal,
) {
  const requestBody = createSelectBuldBody(x, y);
  const diagnostics: SelectBuldDiagnostics = {
    selectBuldUrl: SELECT_BULD_URL,
    selectBuldRequestBody: requestBody,
    selectBuldAttemptCount: 1,
    selectBuldTimeoutMs: SELECT_BULD_TIMEOUT_MS,
    selectBuldAttemptTimingsMs: [],
  };
  const startedAt = Date.now();

  try {
    const response = await fetchWithTimeout(
      SELECT_BULD_URL,
      {
        method: 'POST',
        headers: FORM_HEADERS,
        body: requestBody,
      },
      SELECT_BULD_TIMEOUT_MS,
      { step: 'selectBuld', overallSignal },
    );
    const rawText = await response.text();
    const payload = parseJsonOrNull(rawText);

    diagnostics.selectBuldAttemptTimingsMs?.push(Date.now() - startedAt);
    if (timings) {
      timings.selectBuld = Date.now() - startedAt;
    }

    diagnostics.selectBuldHttpStatus = response.status;
    diagnostics.selectBuldContentType = response.headers.get('content-type');
    diagnostics.selectBuldRawTextPreview = previewText(rawText);

    if (!response.ok) {
      diagnostics.selectBuldFeatureParseStatus = 'http-error';
      diagnostics.selectBuldLastError = `HTTP ${response.status}`;
      throw new ExternalStepError('selectBuld', 'selectBuld 응답 상태가 정상 범위가 아닙니다.', diagnostics);
    }

    if (!payload) {
      diagnostics.selectBuldFeatureParseStatus = 'response-json-parse-failed';
      diagnostics.selectBuldLastError = 'response-json-parse-failed';

      return { ring: null, status: 'not_found' as SelectBuldStatus, diagnostics };
    }

    const ring = extractSelectBuldRing(payload, diagnostics);

    return {
      ring,
      status: ring ? ('success' as SelectBuldStatus) : ('not_found' as SelectBuldStatus),
      diagnostics,
    };
  } catch (error) {
    diagnostics.selectBuldAttemptTimingsMs?.push(Date.now() - startedAt);
    if (timings) {
      timings.selectBuld = Date.now() - startedAt;
    }

    if (error instanceof ExternalStepError) {
      throw error;
    }

    const isTimeout = error instanceof Error && error.name === 'AbortError';

    diagnostics.selectBuldFeatureParseStatus = isTimeout ? 'request-timeout' : 'request-failed';
    diagnostics.selectBuldLastError = isTimeout ? 'request-timeout' : error instanceof Error ? error.message : 'unknown';

    throw new ExternalStepError(
      'selectBuld',
      isTimeout ? 'climate.gg selectBuld 요청 시간이 초과되었습니다.' : 'selectBuld 호출에 실패했습니다.',
      diagnostics,
    );
  }
}

async function loadWfsMetadata(x: number, y: number, timings: Record<string, number>, overallSignal?: AbortSignal) {
  const cqlFilter = encodeURIComponent(`INTERSECTS(shape, Point(${x} ${y}))`);
  const url =
    `${BASE}/geoserver/spggcee/ows?service=WFS&version=1.0.0&request=GetFeature` +
    `&typeName=spggcee:TM_BLDG_INFO&outputFormat=application/json&SRS=EPSG:5186&CQL_FILTER=${cqlFilter}`;

  const payload = await timedJson<unknown>(
    timings,
    'wfsBuildingMetadata',
    url,
    {
      method: 'GET',
      headers: COMMON_HEADERS,
    },
    WFS_METADATA_TIMEOUT_MS,
    overallSignal,
  );

  const features = isRecord(payload) && Array.isArray(payload.features) ? payload.features : [];
  const firstFeature = features.find(isRecord);
  const properties = firstFeature && isRecord(firstFeature.properties) ? firstFeature.properties : {};

  return properties;
}

function polygonBbox(ring: Ring5186) {
  return ring.reduce(
    (bbox, [x, y]) => ({
      minX: Math.min(bbox.minX, x),
      minY: Math.min(bbox.minY, y),
      maxX: Math.max(bbox.maxX, x),
      maxY: Math.max(bbox.maxY, y),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );
}

function polygonAreaM2(ring: Ring5186) {
  let sum = 0;

  for (let index = 0; index < ring.length; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[(index + 1) % ring.length];

    sum += x1 * y2 - x2 * y1;
  }

  return Math.abs(sum) / 2;
}

function polygonCentroid(ring: Ring5186): Coordinate5186 {
  let twiceArea = 0;
  let centroidX = 0;
  let centroidY = 0;

  for (let index = 0; index < ring.length; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[(index + 1) % ring.length];
    const cross = x1 * y2 - x2 * y1;

    twiceArea += cross;
    centroidX += (x1 + x2) * cross;
    centroidY += (y1 + y2) * cross;
  }

  if (Math.abs(twiceArea) < 1e-9) {
    const sum = ring.reduce<Coordinate5186>(([xSum, ySum], [x, y]) => [xSum + x, ySum + y], [0, 0]);

    return [sum[0] / Math.max(1, ring.length), sum[1] / Math.max(1, ring.length)];
  }

  return [centroidX / (3 * twiceArea), centroidY / (3 * twiceArea)];
}

function pointToSegmentDistanceM(point: Coordinate5186, segmentStart: Coordinate5186, segmentEnd: Coordinate5186) {
  const [px, py] = point;
  const [x1, y1] = segmentStart;
  const [x2, y2] = segmentEnd;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
  }

  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
  const closestX = x1 + t * dx;
  const closestY = y1 + t * dy;

  return Math.sqrt((px - closestX) ** 2 + (py - closestY) ** 2);
}

function pointDistanceToPolygonM(point: Coordinate5186, ring: Ring5186) {
  if (ring.length < 2) {
    return null;
  }

  let minimumDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < ring.length; index += 1) {
    minimumDistance = Math.min(
      minimumDistance,
      pointToSegmentDistanceM(point, ring[index], ring[(index + 1) % ring.length]),
    );
  }

  return Number.isFinite(minimumDistance) ? minimumDistance : null;
}

function getSelectBuldMatchStatus(selectBuldRing: Ring5186, selectedBuildingRing: Ring5186) {
  const centroid = polygonCentroid(selectBuldRing);
  const centroidInsideSelectedBuilding = isPointInPolygon(centroid, selectedBuildingRing);
  const centroidDistanceToSelectedBuildingM = centroidInsideSelectedBuilding
    ? 0
    : pointDistanceToPolygonM(centroid, selectedBuildingRing);
  const [longitude, latitude] = to4326(centroid[0], centroid[1]);

  return {
    matchesSelectedBuilding:
      centroidInsideSelectedBuilding ||
      (typeof centroidDistanceToSelectedBuildingM === 'number' &&
        centroidDistanceToSelectedBuildingM <= SELECT_BULD_MATCH_DISTANCE_THRESHOLD_M),
    centroidInsideSelectedBuilding,
    centroidDistanceToSelectedBuildingM,
    centroidWgs84: { longitude, latitude },
  };
}

function isPointInPolygon(point: Coordinate5186, ring: Ring5186) {
  const [x, y] = point;
  let isInside = false;

  for (let index = 0, previousIndex = ring.length - 1; index < ring.length; previousIndex = index, index += 1) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[previousIndex];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi;

    if (intersects) {
      isInside = !isInside;
    }
  }

  return isInside;
}

function generateCells(ring: Ring5186) {
  const bbox = polygonBbox(ring);
  const cells: Cell[] = [];
  let id = 0;
  let scannedCellCount = 0;

  for (let y = bbox.minY; y + CELL_H_M <= bbox.maxY; y += CELL_H_M) {
    for (let x = bbox.minX; x + CELL_W_M <= bbox.maxX; x += CELL_W_M) {
      scannedCellCount += 1;

      if (scannedCellCount > MAX_CELL_SCAN_COUNT) {
        return { cells, maxCellsApplied: cells.length > MAX_CELLS, scanLimitApplied: true };
      }

      const centroid: Coordinate5186 = [x + CELL_W_M / 2, y + CELL_H_M / 2];

      if (isPointInPolygon(centroid, ring)) {
        cells.push({
          id,
          bbox5186: [x, y, x + CELL_W_M, y + CELL_H_M],
          centroid5186: { x: centroid[0], y: centroid[1] },
        });

        if (cells.length > MAX_CELLS) {
          return { cells, maxCellsApplied: true, scanLimitApplied: false };
        }
      }

      id += 1;
    }
  }

  return { cells, maxCellsApplied: false, scanLimitApplied: false };
}

async function selectSunList(cells: Cell[], timings: Record<string, number>, overallSignal?: AbortSignal) {
  const body = new URLSearchParams();

  cells.forEach((cell) => {
    const [x1, y1, x2, y2] = cell.bbox5186;
    body.append('panel', `${cell.id}-${x1},${y1},${x2},${y2}`);
  });
  body.append('type', 'build');

  const payload = await timedJson<unknown>(
    timings,
    'selectSunList',
    `${BASE}/gcs/panel/selectSunList.do`,
    {
      method: 'POST',
      headers: FORM_HEADERS,
      body,
    },
    SELECT_SUN_LIST_TIMEOUT_MS,
    overallSignal,
  );

  if (!Array.isArray(payload)) {
    throw new ExternalStepError('selectSunList', 'climate.gg 셀별 음영 분석 응답 형식이 올바르지 않습니다.');
  }

  return payload.reduce<Record<number, number>>((scores, item) => {
    if (typeof item !== 'string') {
      return scores;
    }

    const [idText, scoreText] = item.split('|');
    const id = Number(idText);
    const score = Number(scoreText);

    if (Number.isFinite(id) && Number.isFinite(score)) {
      scores[id] = score;
    }

    return scores;
  }, {});
}

async function selectBuldInfo(unqId: string | null, timings: Record<string, number>, overallSignal?: AbortSignal) {
  if (!unqId) {
    return { labels: [], electricity_kwh: [], gas_m3: [] };
  }

  const body = new URLSearchParams({ unq_id: unqId });
  const payload = await timedJson<unknown>(
    timings,
    'selectBuldInfo',
    `${BASE}/gcs/panel/selectBuldInfo.do`,
    {
      method: 'POST',
      headers: FORM_HEADERS,
      body,
    },
    SELECT_BULD_INFO_TIMEOUT_MS,
    overallSignal,
  );

  const firstRow =
    isRecord(payload) && Array.isArray(payload.list) ? payload.list.find((item: unknown) => isRecord(item)) : null;

  if (!isRecord(firstRow)) {
    return { labels: [], electricity_kwh: [], gas_m3: [] };
  }

  const labels = readString(firstRow.use_ym)?.replace(/\n/g, '-').split(',') ?? [];
  const electricityKwh =
    readString(firstRow.elpwr_usqty)
      ?.split(',')
      .map((value) => Number(value))
      .filter(Number.isFinite) ?? [];
  const gasM3 =
    readString(firstRow.gas_usqty)
      ?.split(',')
      .map((value) => Number(value))
      .filter(Number.isFinite) ?? [];

  return { labels, electricity_kwh: electricityKwh, gas_m3: gasM3 };
}

function createRoofWkt(ring: Ring5186) {
  const coordinates = ring.map(([x, y]) => `${x} ${y}`).join(', ');

  return `MULTIPOLYGON(((${coordinates})))`;
}

async function selectRuleList(ring: Ring5186, timings: Record<string, number>, overallSignal?: AbortSignal) {
  const body = new URLSearchParams({ text: createRoofWkt(ring) });
  const payload = await timedJson<unknown>(
    timings,
    'selectRuleList',
    `${BASE}/gcs/panel/selectRuleList.do`,
    {
      method: 'POST',
      headers: FORM_HEADERS,
      body,
    },
    SELECT_RULE_LIST_TIMEOUT_MS,
    overallSignal,
  );

  const items = isRecord(payload) && Array.isArray(payload.list) ? payload.list : [];

  return items.flatMap((item): Array<[string, number]> => {
    if (!isRecord(item)) {
      return [];
    }

    const layer = readString(item.layer);
    const count = readNumber(item.cnt, 0) ?? 0;

    return layer && count > 0 ? [[layer, count]] : [];
  });
}

async function callPvAnalysis({
  longitude,
  latitude,
  shadingAverage,
  panelCount,
  panelCapacityW,
  panelAngle,
  panelType,
  timings,
  overallSignal,
}: {
  longitude: number;
  latitude: number;
  shadingAverage: number;
  panelCount: number;
  panelCapacityW: number;
  panelAngle: number;
  panelType: number;
  timings: Record<string, number>;
  overallSignal?: AbortSignal;
}) {
  const pvInput = {
    latitude,
    longitude,
    shading_index_average: shadingAverage,
    solar_panel_angle: panelAngle,
    solar_panel_info: {
      panel_capacity: panelCapacityW,
      panel_count: panelCount,
      panel_type: panelType,
    },
  };
  const payload = await timedJson<unknown>(
    timings,
    'pvAnalysis',
    `${BASE}/spsvc/pv/analysis`,
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(pvInput),
    },
    PV_ANALYSIS_TIMEOUT_MS,
    overallSignal,
  );
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;

  if (!data) {
    throw new ExternalStepError('pvAnalysis', 'climate.gg 발전량 분석 응답을 해석하지 못했습니다.');
  }

  return { pvInput, pvOutput: data as unknown as ClimateBundlePvOutputRaw };
}

function createFallbackPvOutput(panelCapacityW: number, panelCount: number): ClimateBundlePvOutputRaw {
  const installKw = roundDecimal((panelCapacityW * panelCount) / 1000, 1);
  const annualGeneration = Math.round(installKw * ANNUAL_GENERATION_KWH_PER_KW);
  const firstYearSaveCost = Math.round(annualGeneration * ELECTRICITY_VALUE_KRW_PER_KWH);
  const expectedInvestment = Math.round(firstYearSaveCost * FALLBACK_PAYBACK_YEARS);
  const carbonReduction = roundDecimal(annualGeneration * CARBON_REDUCTION_KG_PER_KWH, 1);

  return {
    annual_generation: annualGeneration,
    expected_revenue: {
      install_kw: installKw,
      first_year_revenue: firstYearSaveCost,
      first_year_save_cost: firstYearSaveCost,
      expected_investment: expectedInvestment,
    },
    environmental_contribution: {
      pine_tree_effect: roundDecimal(carbonReduction / PINE_TREE_KG_CO2_PER_YEAR, 1),
      carbon_reduction: carbonReduction,
    },
    annual_revenue: [],
    annual_saveCost: [],
    monthly_generation: MONTHLY_GENERATION_WEIGHTS.map((weight, index) => ({
      month: index + 1,
      generation: roundDecimal(annualGeneration * weight, 1),
    })),
  };
}

function createCellRing4326([x1, y1, x2, y2]: [number, number, number, number]) {
  return [to4326(x1, y1), to4326(x2, y1), to4326(x2, y2), to4326(x1, y2), to4326(x1, y1)];
}

function createPanelsGeojson(cells: Cell[], shadingByCellId: Record<number, number>): ClimatePanelsGeoJson {
  return {
    type: 'FeatureCollection',
    features: cells.flatMap((cell) => {
      const shadingScore = shadingByCellId[cell.id];

      if (typeof shadingScore !== 'number' || !Number.isFinite(shadingScore)) {
        return [];
      }

      return [
        {
          type: 'Feature' as const,
          geometry: {
            type: 'Polygon' as const,
            coordinates: [createCellRing4326(cell.bbox5186)],
          },
          properties: {
            cell_id: cell.id,
            shading_score: shadingScore,
            cell_5186_bbox: cell.bbox5186,
          },
        },
      ];
    }),
  };
}

function createBundle({
  longitude,
  latitude,
  roofRing,
  roofAreaM2,
  metadata,
  cells,
  shadingValues,
  usageMonthly,
  regulationHits,
  pvInput,
  pvOutput,
}: {
  longitude: number;
  latitude: number;
  roofRing: Ring5186;
  roofAreaM2: number;
  metadata: Record<string, unknown>;
  cells: Cell[];
  shadingValues: number[];
  usageMonthly: ClimateBundle['usage_monthly'];
  regulationHits: Array<[string, number]>;
  pvInput: ClimateBundle['pv_analysis_input'];
  pvOutput: ClimateBundlePvOutputRaw;
}): ClimateBundle {
  const scoreMean =
    shadingValues.length > 0 ? shadingValues.reduce((sum, value) => sum + value, 0) / shadingValues.length : 0;

  return {
    meta: {
      unq_id: readString(metadata.unq_id),
      bldg_nm: readString(metadata.bldg_nm),
      bldg_hgt: readNumber(metadata.bldg_hgt),
      bdar: readNumber(metadata.bdar),
      bldg_nofl: readNumber(metadata.bldg_nofl),
      use_aprv_ymd: readString(metadata.use_aprv_ymd),
      bldg_usg_cd: readString(metadata.bldg_usg_cd),
      sigun_cd: readString(metadata.sigun_cd),
      click_wgs84: { longitude, latitude },
    },
    roof_polygon_4326: {
      type: 'Polygon',
      coordinates: [roofRing.map(([x, y]) => to4326(x, y))],
    },
    roof_area_sqm_5186: Math.round(roofAreaM2 * 100) / 100,
    shading: {
      cell_w_m: CELL_W_M,
      cell_h_m: CELL_H_M,
      cells_total: cells.length,
      cells_with_score: shadingValues.length,
      score_min: shadingValues.length > 0 ? Math.min(...shadingValues) : 0,
      score_mean: scoreMean,
      score_max: shadingValues.length > 0 ? Math.max(...shadingValues) : 0,
    },
    usage_monthly: usageMonthly,
    regulation_hits: regulationHits,
    pv_analysis_input: pvInput,
    pv_analysis_output: pvOutput,
  };
}

export async function runDebugSelectBuld(payload: unknown) {
  const input = validateCommonRequestBody(payload);
  const [x5186, y5186] = to5186(input.longitude, input.latitude);
  const inputWgs84 = { longitude: input.longitude, latitude: input.latitude };
  const input5186 = { x: x5186, y: y5186 };
  const apiTimingsMs: Record<string, number> = {};

  try {
    const result = await runSelectBuldCandidateRequest(x5186, y5186, apiTimingsMs);
    const roofAreaM2 = result.ring ? polygonAreaM2(result.ring) : 0;

    return {
      ok: Boolean(result.ring),
      source: 'climate.gg-live',
      message: result.ring
        ? 'selectBuld에서 climate.gg 옥상 polygon을 찾았습니다.'
        : '선택 좌표에서 climate.gg 옥상 polygon을 찾지 못했습니다.',
      diagnostics: {
        inputWgs84,
        input5186,
        roofAreaM2,
        cellCount: 0,
        shadingCellCount: 0,
        shadingAverage: 0,
        panelCount: 0,
        apiTimingsMs,
        ...result.diagnostics,
      },
    };
  } catch (error) {
    return {
      ok: false,
      source: 'climate.gg-live',
      message: error instanceof Error ? error.message : 'selectBuld 디버그 호출에 실패했습니다.',
      diagnostics: {
        inputWgs84,
        input5186,
        roofAreaM2: 0,
        cellCount: 0,
        shadingCellCount: 0,
        shadingAverage: 0,
        panelCount: 0,
        apiTimingsMs,
        ...(error instanceof ExternalStepError && error.diagnostics ? error.diagnostics : {}),
      },
    };
  }
}

export default async function handler(request: Request) {
  const overallStartedAt = Date.now();
  const overallController = new AbortController();
  let timedOutStep: string | null = null;
  const overallTimeoutId = setTimeout(() => {
    timedOutStep = timedOutStep ?? 'overall';
    overallController.abort();
  }, OVERALL_TIMEOUT_MS);
  const getElapsedMs = () => Date.now() - overallStartedAt;

  if (request.method !== 'POST') {
    clearTimeout(overallTimeoutId);
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  const apiTimingsMs: Record<string, number> = {};
  const warnings: string[] = [];
  let inputWgs84: { longitude: number; latitude: number } | undefined;
  let input5186: { x: number; y: number } | undefined;
  let selectBuldDiagnostics: SelectBuldDiagnostics | undefined;
  let selectBuldStatus: SelectBuldStatus = 'skipped';
  let roofSource: ClimateLiveRoofSource = 'vworld-building-footprint-fallback';
  let maxCellsApplied = false;
  let requestIdentity: {
    selectedBuildingId?: string | null;
    selectedAnalysisSessionId?: string | null;
    selectedFeatureBuildingId?: string | null;
  } = {};
  let selectBuldRoofMatchesSelectedBuilding: boolean | null = null;
  let selectBuldCentroidInsideSelectedBuilding = false;
  let selectBuldCentroidDistanceToSelectedBuildingM: number | null = null;
  let selectBuldCentroidWgs84: { longitude: number; latitude: number } | null = null;
  let selectSunListStatus: ExternalStepStatus = 'skipped';
  let pvAnalysisStatus: ExternalStepStatus = 'skipped';
  let fallbackReason: string | undefined;
  const getCommonDiagnostics = () => ({
    overallTimeoutMs: OVERALL_TIMEOUT_MS,
    elapsedMs: getElapsedMs(),
    timedOutStep,
    selectSunListStatus,
    pvAnalysisStatus,
    fallbackReason,
  });
  const markTimedOutStep = (error: unknown, step: string) => {
    if (error instanceof ExternalStepError) {
      const diagnosticStep =
        error.diagnostics && typeof error.diagnostics.timedOutStep === 'string' ? error.diagnostics.timedOutStep : null;

      if (diagnosticStep || error.message.includes('초과')) {
        timedOutStep = diagnosticStep ?? step;
      }
    } else if (error instanceof Error && error.name === 'AbortError') {
      timedOutStep = step;
    }
  };

  try {
    const requestBody = await request.json().catch(() => null);
    if (isRecord(requestBody)) {
      requestIdentity = {
        selectedBuildingId: readString(requestBody.selectedBuildingId),
        selectedAnalysisSessionId: readString(requestBody.selectedAnalysisSessionId),
        selectedFeatureBuildingId: readFeatureBuildingId(requestBody.selectedBuildingFeature),
      };
    }
    const input = validateLiveHybridRequestBody(requestBody);
    const [x5186, y5186] = to5186(input.longitude, input.latitude);

    requestIdentity = {
      selectedBuildingId: input.selectedBuildingId,
      selectedAnalysisSessionId: input.selectedAnalysisSessionId,
      selectedFeatureBuildingId: input.selectedFeatureBuildingId,
    };
    inputWgs84 = { longitude: input.longitude, latitude: input.latitude };
    input5186 = { x: x5186, y: y5186 };

    const metadataPromise = loadWfsMetadata(x5186, y5186, apiTimingsMs, overallController.signal).catch((error) => {
      warnings.push(error instanceof Error ? error.message : 'WFS 건물 메타데이터 조회에 실패했습니다.');

      return {};
    });
    let roofRing = input.selectedBuildingRing5186;
    const selectBuldResult = await runSelectBuldCandidateRequest(
      x5186,
      y5186,
      apiTimingsMs,
      overallController.signal,
    ).catch((error) => {
      if (error instanceof ExternalStepError && error.step === 'selectBuld') {
        markTimedOutStep(error, 'selectBuld');

        if (error.diagnostics) {
          selectBuldDiagnostics = error.diagnostics as SelectBuldDiagnostics;
        }

        selectBuldStatus =
          selectBuldDiagnostics?.selectBuldFeatureParseStatus === 'request-timeout' || error.message.includes('초과')
            ? 'timeout'
            : 'not_found';
        warnings.push(
          selectBuldStatus === 'timeout'
            ? 'climate.gg 옥상 polygon 조회가 시간 초과되어 선택 건물 footprint 기반 옥상 추정으로 진행했습니다.'
            : 'climate.gg 옥상 polygon 조회에 실패하여 선택 건물 footprint 기반 옥상 추정으로 진행했습니다.',
        );

        return null;
      }

      throw error;
    });

    if (selectBuldResult?.ring) {
      selectBuldDiagnostics = selectBuldResult.diagnostics;
      const matchStatus = getSelectBuldMatchStatus(selectBuldResult.ring, input.selectedBuildingRing5186);

      selectBuldRoofMatchesSelectedBuilding = matchStatus.matchesSelectedBuilding;
      selectBuldCentroidInsideSelectedBuilding = matchStatus.centroidInsideSelectedBuilding;
      selectBuldCentroidDistanceToSelectedBuildingM = matchStatus.centroidDistanceToSelectedBuildingM;
      selectBuldCentroidWgs84 = matchStatus.centroidWgs84;

      if (matchStatus.matchesSelectedBuilding) {
        selectBuldStatus = 'success';
        roofSource = 'climate.gg-selectBuld';
        roofRing = selectBuldResult.ring;
      } else {
        selectBuldStatus = 'mismatch_selected_building';
        roofSource = 'vworld-building-footprint-fallback';
        roofRing = input.selectedBuildingRing5186;
        warnings.push(
          'climate.gg 옥상 polygon이 선택 건물과 달라 선택 건물 footprint 기반으로 음영 분석을 진행했습니다.',
        );
      }
    } else if (selectBuldResult) {
      selectBuldDiagnostics = selectBuldResult.diagnostics;
      selectBuldStatus = selectBuldResult.status;
      selectBuldRoofMatchesSelectedBuilding = null;
      warnings.push('climate.gg 옥상 polygon을 찾지 못해 선택 건물 footprint 기반 옥상 추정으로 진행했습니다.');
    }

    const roofAreaM2 = polygonAreaM2(roofRing);
    const generatedCells = generateCells(roofRing);
    maxCellsApplied = generatedCells.maxCellsApplied;
    const cells = maxCellsApplied ? generatedCells.cells.slice(0, MAX_CELLS) : generatedCells.cells;

    if (generatedCells.maxCellsApplied) {
      warnings.push(`셀 수가 ${generatedCells.cells.length.toLocaleString('ko-KR')}개를 넘어 ${MAX_CELLS}개만 분석했습니다.`);
    }

    if (generatedCells.scanLimitApplied) {
      warnings.push('건물 footprint 범위가 커서 셀 탐색 상한을 적용했습니다.');
    }

    if (cells.length === 0) {
      return createFailureResponse('climate.gg 옥상 polygon에서 분석 가능한 1m x 3.5m 셀을 만들지 못했습니다.', {
        inputWgs84,
        input5186,
        roofAreaM2,
        cellCount: 0,
        shadingCellCount: 0,
        shadingAverage: 0,
        panelCount: 0,
        roofSource,
        selectBuldStatus,
        requestSelectedBuildingId: requestIdentity.selectedBuildingId ?? null,
        requestSessionId: requestIdentity.selectedAnalysisSessionId ?? null,
        selectedFeatureBuildingId: requestIdentity.selectedFeatureBuildingId ?? null,
        selectBuldRoofMatchesSelectedBuilding,
        selectBuldCentroidInsideSelectedBuilding,
        selectBuldCentroidDistanceToSelectedBuildingM,
        selectBuldCentroidWgs84,
        liveHybridMode: true,
        maxCellsApplied,
        apiTimingsMs,
        ...getCommonDiagnostics(),
        ...(selectBuldDiagnostics ?? {}),
        warnings,
      }, 200, requestIdentity);
    }

    let shadingByCellId: Record<number, number>;

    try {
      shadingByCellId = await selectSunList(cells, apiTimingsMs, overallController.signal);
      selectSunListStatus = 'success';
    } catch (error) {
      markTimedOutStep(error, 'selectSunList');
      selectSunListStatus = timedOutStep === 'selectSunList' ? 'timeout' : 'failed';
      fallbackReason = selectSunListStatus === 'timeout' ? 'selectSunList-timeout' : 'selectSunList-failed';

      return createFailureResponse('climate.gg 음영 분석 응답 지연으로 건물 footprint 기반 자체 배치를 유지합니다.', {
        inputWgs84,
        input5186,
        roofAreaM2,
        cellCount: cells.length,
        shadingCellCount: 0,
        shadingAverage: 0,
        panelCount: 0,
        roofSource,
        selectBuldStatus,
        requestSelectedBuildingId: requestIdentity.selectedBuildingId ?? null,
        requestSessionId: requestIdentity.selectedAnalysisSessionId ?? null,
        selectedFeatureBuildingId: requestIdentity.selectedFeatureBuildingId ?? null,
        selectBuldRoofMatchesSelectedBuilding,
        selectBuldCentroidInsideSelectedBuilding,
        selectBuldCentroidDistanceToSelectedBuildingM,
        selectBuldCentroidWgs84,
        liveHybridMode: true,
        maxCellsApplied,
        apiTimingsMs,
        ...getCommonDiagnostics(),
        ...(selectBuldDiagnostics ?? {}),
        selectSunListLastError: error instanceof Error ? error.message : 'unknown',
        warnings,
      }, 200, requestIdentity);
    }
    const shadingValues = Object.values(shadingByCellId).filter((value) => Number.isFinite(value));
    const shadingAverage =
      shadingValues.length > 0 ? shadingValues.reduce((sum, value) => sum + value, 0) / shadingValues.length : 0;
    const panelCount = Math.max(1, Math.floor(shadingValues.length / input.cellsPerPanel));

    if (shadingValues.length === 0) {
      selectSunListStatus = 'failed';
      fallbackReason = 'selectSunList-empty';

      return createFailureResponse('climate.gg 셀별 음영 분석 결과가 비어 있습니다.', {
        inputWgs84,
        input5186,
        roofAreaM2,
        cellCount: cells.length,
        shadingCellCount: 0,
        shadingAverage: 0,
        panelCount: 0,
        roofSource,
        selectBuldStatus,
        requestSelectedBuildingId: requestIdentity.selectedBuildingId ?? null,
        requestSessionId: requestIdentity.selectedAnalysisSessionId ?? null,
        selectedFeatureBuildingId: requestIdentity.selectedFeatureBuildingId ?? null,
        selectBuldRoofMatchesSelectedBuilding,
        selectBuldCentroidInsideSelectedBuilding,
        selectBuldCentroidDistanceToSelectedBuildingM,
        selectBuldCentroidWgs84,
        liveHybridMode: true,
        maxCellsApplied,
        apiTimingsMs,
        ...getCommonDiagnostics(),
        ...(selectBuldDiagnostics ?? {}),
        warnings,
      }, 200, requestIdentity);
    }

    const metadata: Record<string, unknown> = await metadataPromise;
    const unqId = readString(metadata.unq_id);
    const usageMonthlyPromise = selectBuldInfo(unqId, apiTimingsMs, overallController.signal).catch((error) => {
      warnings.push(error instanceof Error ? error.message : 'selectBuldInfo 사용량 조회에 실패했습니다.');

      return { labels: [], electricity_kwh: [], gas_m3: [] };
    });
    const regulationHitsPromise = selectRuleList(roofRing, apiTimingsMs, overallController.signal).catch((error) => {
      warnings.push(error instanceof Error ? error.message : 'selectRuleList 규제 조회에 실패했습니다.');

      return [];
    });
    const fallbackPvInput = {
      latitude: input.latitude,
      longitude: input.longitude,
      shading_index_average: shadingAverage,
      solar_panel_angle: input.panelAngle,
      solar_panel_info: {
        panel_capacity: input.panelCapacityW,
        panel_count: panelCount,
        panel_type: input.panelType,
      },
    };
    const pvAnalysisPromise = callPvAnalysis({
      longitude: input.longitude,
      latitude: input.latitude,
      shadingAverage,
      panelCount,
      panelCapacityW: input.panelCapacityW,
      panelAngle: input.panelAngle,
      panelType: input.panelType,
      timings: apiTimingsMs,
      overallSignal: overallController.signal,
    })
      .then((result) => {
        pvAnalysisStatus = 'success';

        return result;
      })
      .catch((error) => {
        markTimedOutStep(error, 'pvAnalysis');
        pvAnalysisStatus = timedOutStep === 'pvAnalysis' ? 'timeout' : 'fallback';
        fallbackReason = pvAnalysisStatus === 'timeout' ? 'pvAnalysis-timeout' : 'pvAnalysis-failed';
        warnings.push(
          error instanceof Error
            ? `pv/analysis 실패로 데모 경제성 산식을 사용했습니다: ${error.message}`
            : 'pv/analysis 실패로 데모 경제성 산식을 사용했습니다.',
        );

        return {
          pvInput: fallbackPvInput,
          pvOutput: createFallbackPvOutput(input.panelCapacityW, panelCount),
        };
      });
    const [usageMonthly, regulationHits, { pvInput, pvOutput }] = await Promise.all([
      usageMonthlyPromise,
      regulationHitsPromise,
      pvAnalysisPromise,
    ]);
    const panelsGeojson = createPanelsGeojson(cells, shadingByCellId);
    const bundle = createBundle({
      longitude: input.longitude,
      latitude: input.latitude,
      roofRing,
      roofAreaM2,
      metadata,
      cells,
      shadingValues,
      usageMonthly,
      regulationHits,
      pvInput,
      pvOutput,
    });
    const diagnostics: LiveDiagnostics = {
      inputWgs84,
      input5186,
      requestSelectedBuildingId: input.selectedBuildingId,
      requestSessionId: input.selectedAnalysisSessionId,
      selectedFeatureBuildingId: input.selectedFeatureBuildingId,
      roofAreaM2,
      cellCount: cells.length,
      shadingCellCount: shadingValues.length,
      shadingAverage,
      panelCount,
      roofSource,
      selectBuldStatus,
      selectBuldRoofMatchesSelectedBuilding,
      selectBuldCentroidInsideSelectedBuilding,
      selectBuldCentroidDistanceToSelectedBuildingM,
      selectBuldCentroidWgs84,
      liveHybridMode: true,
      maxCellsApplied,
      apiTimingsMs,
      ...getCommonDiagnostics(),
      ...(selectBuldDiagnostics ?? {}),
      warnings,
      unqId,
      ignoredStaleLiveResponse: false,
    };

    return jsonResponse({
      ok: true,
      source: 'climate.gg-live-hybrid',
      selectedBuildingId: input.selectedBuildingId,
      selectedAnalysisSessionId: input.selectedAnalysisSessionId,
      selectedFeatureBuildingId: input.selectedFeatureBuildingId,
      roofSource,
      bundle,
      panelsGeojson,
      diagnostics,
    });
  } catch (error) {
    markTimedOutStep(error, error instanceof ExternalStepError ? error.step : 'handler');
    fallbackReason = fallbackReason ?? (timedOutStep ? `${timedOutStep}-timeout` : 'handler-error');

    const message =
      error instanceof ExternalStepError || error instanceof ValidationError
        ? error.message
        : 'climate.gg 라이브 옥상 분석 처리 중 오류가 발생했습니다.';

    const errorDiagnostics =
      error instanceof ExternalStepError && error.diagnostics ? error.diagnostics : selectBuldDiagnostics ?? {};

    return createFailureResponse(
      message,
      {
        ...(inputWgs84 ? { inputWgs84 } : {}),
        ...(input5186 ? { input5186 } : {}),
        roofAreaM2: 0,
        cellCount: 0,
        shadingCellCount: 0,
        shadingAverage: 0,
        panelCount: 0,
        roofSource,
        selectBuldStatus,
        requestSelectedBuildingId: requestIdentity.selectedBuildingId ?? null,
        requestSessionId: requestIdentity.selectedAnalysisSessionId ?? null,
        selectedFeatureBuildingId: requestIdentity.selectedFeatureBuildingId ?? null,
        selectBuldRoofMatchesSelectedBuilding,
        selectBuldCentroidInsideSelectedBuilding,
        selectBuldCentroidDistanceToSelectedBuildingM,
        selectBuldCentroidWgs84,
        liveHybridMode: true,
        maxCellsApplied,
        apiTimingsMs,
        ...getCommonDiagnostics(),
        ...errorDiagnostics,
        warnings,
      },
      error instanceof ValidationError ? 400 : 200,
      requestIdentity,
    );
  } finally {
    clearTimeout(overallTimeoutId);
  }
}
