import {
  createDefaultPvAnalysisInput,
  createFallbackPvAnalysisResult,
  createSafePvAnalysisInputSummary,
  normalizePvAnalysisResponse,
  type PvAnalysisInput,
  type PvAnalysisProxyResponse,
} from './_shared/normalizePvAnalysis';

const PV_ANALYSIS_API_URL = 'https://climate.gg.go.kr/spsvc/pv/analysis';
const PV_ANALYSIS_TIMEOUT_MS = 8000;

export const maxDuration = 60;

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function jsonResponse(body: PvAnalysisProxyResponse | { error: string }, status = 200) {
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

function readRequiredNumber(payload: Record<string, unknown>, key: string, label: string) {
  const value = payload[key];

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError(`${label} is required and must be a number.`);
  }

  return value;
}

function validateLatitude(latitude: number) {
  if (latitude < -90 || latitude > 90) {
    throw new ValidationError('latitude must be between -90 and 90.');
  }
}

function validateLongitude(longitude: number) {
  if (longitude < -180 || longitude > 180) {
    throw new ValidationError('longitude must be between -180 and 180.');
  }
}

function validatePositiveNumber(value: number, label: string) {
  if (value <= 0) {
    throw new ValidationError(`${label} must be greater than 0.`);
  }
}

function validatePvAnalysisInput(payload: unknown): PvAnalysisInput {
  if (!isRecord(payload)) {
    throw new ValidationError('Request body must be a JSON object.');
  }

  const latitude = readRequiredNumber(payload, 'latitude', 'latitude');
  const longitude = readRequiredNumber(payload, 'longitude', 'longitude');
  const shadingIndexAverage = readRequiredNumber(payload, 'shading_index_average', 'shading_index_average');
  const solarPanelAngle = readRequiredNumber(payload, 'solar_panel_angle', 'solar_panel_angle');

  validateLatitude(latitude);
  validateLongitude(longitude);
  validatePositiveNumber(shadingIndexAverage, 'shading_index_average');
  validatePositiveNumber(solarPanelAngle, 'solar_panel_angle');

  if (!isRecord(payload.solar_panel_info)) {
    throw new ValidationError('solar_panel_info is required.');
  }

  const panelCapacity = readRequiredNumber(payload.solar_panel_info, 'panel_capacity', 'panel_capacity');
  const panelCount = readRequiredNumber(payload.solar_panel_info, 'panel_count', 'panel_count');
  const panelType = readRequiredNumber(payload.solar_panel_info, 'panel_type', 'panel_type');

  validatePositiveNumber(panelCapacity, 'panel_capacity');
  validatePositiveNumber(panelCount, 'panel_count');
  validatePositiveNumber(panelType, 'panel_type');

  return {
    latitude,
    longitude,
    shading_index_average: shadingIndexAverage,
    solar_panel_angle: solarPanelAngle,
    solar_panel_info: {
      panel_capacity: panelCapacity,
      panel_count: panelCount,
      panel_type: panelType,
    },
  };
}

function createFallbackResponse(message: string, input?: Partial<PvAnalysisInput>, status = 200) {
  const fallbackInput = input ? createDefaultPvAnalysisInput(input) : undefined;
  const response: PvAnalysisProxyResponse = {
    ok: false,
    fallback: true,
    message,
    input: fallbackInput ? createSafePvAnalysisInputSummary(fallbackInput) : undefined,
    result: createFallbackPvAnalysisResult(fallbackInput),
  };

  return jsonResponse(response, status);
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

  let input: PvAnalysisInput;

  try {
    input = validatePvAnalysisInput(await request.json().catch(() => null));
  } catch (error) {
    return createFallbackResponse(
      error instanceof Error ? error.message : 'PV analysis request validation failed.',
      undefined,
      400,
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PV_ANALYSIS_TIMEOUT_MS);

  try {
    // shading_index_average currently comes from data team lookup / A4 output later.
    // panel_count should later come from real roof geometry and panel layout.
    // This API calculates generation/economic results, not building geometry.
    const externalResponse = await fetch(PV_ANALYSIS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        Accept: 'application/json',
        'User-Agent': 'solarmate-backend/0.1',
      },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    const payload = await readJsonResponse(externalResponse);
    const result = normalizePvAnalysisResponse(payload);

    if (!externalResponse.ok) {
      return createFallbackResponse('경기 기후 플랫폼 발전량 분석 API 응답이 정상 상태가 아닙니다.', input);
    }

    if (!result) {
      return createFallbackResponse('경기 기후 플랫폼 발전량 분석 응답을 안전하게 해석하지 못했습니다.', input);
    }

    return jsonResponse({
      ok: true,
      source: 'gyeonggi-climate-platform',
      input: createSafePvAnalysisInputSummary(input),
      result,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return createFallbackResponse('경기 기후 플랫폼 발전량 분석 요청 시간이 초과되어 데모 산식으로 표시합니다.', input);
    }

    return createFallbackResponse('경기 기후 플랫폼 발전량 분석 요청에 실패해 데모 산식으로 표시합니다.', input);
  } finally {
    clearTimeout(timeoutId);
  }
}
