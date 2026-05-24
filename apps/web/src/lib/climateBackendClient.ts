import type {
  ClimateLiveAnalysisFailureResponse,
  ClimateLiveAnalysisDiagnostics,
  ClimateLiveAnalysisRequest,
  ClimateLiveAnalysisResponse,
} from '../types/climateBundle';

const CLIMATE_BACKEND_HEALTH_TIMEOUT_MS = 3000;
const CLIMATE_BACKEND_ANALYSIS_TIMEOUT_MS = 30000;
const CLIMATE_BACKEND_DISABLED_MESSAGE =
  '백엔드 서버 연결은 성공했습니다. climate.gg 파이프라인은 다음 단계에서 연결됩니다.';
const CLIMATE_BACKEND_UNAVAILABLE_MESSAGE =
  '백엔드 서버에 연결할 수 없습니다. http://localhost:8001/health를 확인해주세요.';

function getClimateBackendBaseUrl() {
  return (import.meta.env.VITE_CLIMATE_BACKEND_BASE_URL ?? '').trim().replace(/\/+$/, '');
}

export function getConfiguredClimateBackendBaseUrl() {
  return getClimateBackendBaseUrl();
}

export function isExternalClimateBackendConfigured() {
  return import.meta.env.VITE_ENABLE_CLIMATE_LIVE_BACKEND === 'true' && getClimateBackendBaseUrl().length > 0;
}

function createFailureResponse(
  input: ClimateLiveAnalysisRequest,
  message: string,
  fallbackReason: string,
  disabled = false,
  diagnostics: Partial<ClimateLiveAnalysisDiagnostics> = {},
): ClimateLiveAnalysisFailureResponse {
  return {
    ok: false,
    source: 'climate.gg-live-hybrid',
    selectedBuildingId: input.selectedBuildingId ?? null,
    selectedAnalysisSessionId: input.selectedAnalysisSessionId ?? null,
    disabled,
    message,
    fallbackRecommended: true,
    diagnostics: {
      ...diagnostics,
      requestSelectedBuildingId: input.selectedBuildingId ?? null,
      requestSessionId: input.selectedAnalysisSessionId ?? null,
      ignoredStaleLiveResponse: false,
      fallbackReason,
    },
  };
}

function createDisabledResponse(input: ClimateLiveAnalysisRequest): ClimateLiveAnalysisFailureResponse {
  return createFailureResponse(
    input,
    'climate.gg 라이브 분석은 별도 백엔드 서버 연동 예정입니다.',
    'climate-live-backend-disabled',
    true,
  );
}

function createBackendUnavailableResponse(
  input: ClimateLiveAnalysisRequest,
  diagnostics: Partial<ClimateLiveAnalysisDiagnostics> = {},
): ClimateLiveAnalysisFailureResponse {
  return createFailureResponse(
    input,
    CLIMATE_BACKEND_UNAVAILABLE_MESSAGE,
    'climate-backend-unavailable',
    false,
    diagnostics,
  );
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeBackendResponse(
  payload: Record<string, unknown>,
  input: ClimateLiveAnalysisRequest,
  diagnosticsFromFetch: Partial<ClimateLiveAnalysisDiagnostics>,
): ClimateLiveAnalysisResponse | null {
  if (payload.ok !== true && payload.ok !== false) {
    return null;
  }

  const diagnostics = isObjectRecord(payload.diagnostics) ? payload.diagnostics : {};
  const selectedBuildingId =
    typeof payload.selectedBuildingId === 'string' ? payload.selectedBuildingId : input.selectedBuildingId ?? null;
  const selectedAnalysisSessionId =
    typeof payload.selectedAnalysisSessionId === 'string'
      ? payload.selectedAnalysisSessionId
      : input.selectedAnalysisSessionId ?? null;
  const normalizedDiagnostics: ClimateLiveAnalysisDiagnostics = {
    ...diagnosticsFromFetch,
    ...diagnostics,
    requestSelectedBuildingId:
      typeof diagnostics.requestSelectedBuildingId === 'string'
        ? diagnostics.requestSelectedBuildingId
        : selectedBuildingId,
    requestSessionId:
      typeof diagnostics.requestSessionId === 'string'
        ? diagnostics.requestSessionId
        : selectedAnalysisSessionId,
    ignoredStaleLiveResponse:
      typeof diagnostics.ignoredStaleLiveResponse === 'boolean'
        ? diagnostics.ignoredStaleLiveResponse
        : false,
  };

  if (payload.ok === false) {
    return {
      ...(payload as Partial<ClimateLiveAnalysisFailureResponse>),
      ok: false,
      source: 'climate.gg-live-hybrid',
      selectedBuildingId,
      selectedAnalysisSessionId,
      disabled: payload.disabled === true,
      message: payload.disabled === true ? CLIMATE_BACKEND_DISABLED_MESSAGE : String(payload.message ?? ''),
      fallbackRecommended: true,
      diagnostics: {
        ...normalizedDiagnostics,
        fallbackReason:
          typeof normalizedDiagnostics.fallbackReason === 'string'
            ? normalizedDiagnostics.fallbackReason
            : payload.disabled === true
              ? 'climate-live-backend-disabled'
              : 'climate-backend-fallback',
      },
    };
  }

  if (!isObjectRecord(payload.bundle) || !isObjectRecord(payload.panelsGeojson)) {
    return createFailureResponse(
      input,
      '백엔드 응답 형식을 확인할 수 없습니다. bundle 또는 panelsGeojson이 없습니다.',
      'climate-backend-invalid-response',
      false,
      diagnosticsFromFetch,
    );
  }

  return {
    ...(payload as Partial<ClimateLiveAnalysisResponse>),
    ok: true,
    source: 'climate.gg-live-hybrid',
    selectedBuildingId,
    selectedAnalysisSessionId,
    diagnostics: normalizedDiagnostics,
  } as ClimateLiveAnalysisResponse;
}

function createBackendRequestBody(input: ClimateLiveAnalysisRequest) {
  return {
    selectedBuildingId: input.selectedBuildingId,
    selectedBuildingFeature: input.selectedBuildingFeature,
    longitude: input.longitude,
    latitude: input.latitude,
    panelCapacityW: input.panelCapacityW,
    panelAngle: input.panelAngle,
    panelType: input.panelType,
    cellsPerPanel: input.cellsPerPanel,
    mode: input.mode,
  };
}

function getErrorName(error: unknown) {
  return error instanceof Error ? error.name : typeof error;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function fetchJsonWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as unknown;

    return {
      ok: response.ok,
      payload,
      status: response.status,
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

// Future integration point: climate.gg live calls should run on a dedicated backend
// server with timeout/retry/cache controls, not in a Vercel Function.
export async function runExternalClimateBackendAnalysis(
  input: ClimateLiveAnalysisRequest,
): Promise<ClimateLiveAnalysisResponse> {
  if (import.meta.env.VITE_ENABLE_CLIMATE_LIVE_BACKEND !== 'true') {
    return createDisabledResponse(input);
  }

  const baseUrl = getClimateBackendBaseUrl();

  if (!baseUrl) {
    return createBackendUnavailableResponse(input, {
      backendBaseUrl: baseUrl,
      backendResponseMessage: 'VITE_CLIMATE_BACKEND_BASE_URL이 비어 있습니다.',
    });
  }

  const healthUrl = `${baseUrl}/health`;
  const requestUrl = `${baseUrl}/api/climate-rooftop-analysis`;
  const baseDiagnostics: Partial<ClimateLiveAnalysisDiagnostics> = {
    backendBaseUrl: baseUrl,
    requestUrl,
    backendResponseOk: false,
    usedVercelPvAnalysis: false,
  };
  let backendHealthStatus: number | null = null;

  try {
    const healthResponse = await fetchJsonWithTimeout(
      healthUrl,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      },
      CLIMATE_BACKEND_HEALTH_TIMEOUT_MS,
    );
    backendHealthStatus = healthResponse.status;

    if (!healthResponse.ok) {
      return createFailureResponse(
        input,
        `백엔드 health 확인 실패: HTTP ${healthResponse.status}`,
        'climate-backend-health-error',
        false,
        {
          ...baseDiagnostics,
          backendHealthStatus,
        },
      );
    }
  } catch (error) {
    const errorName = getErrorName(error);
    const errorMessage = getErrorMessage(error);

    return createFailureResponse(
      input,
      `백엔드 서버 요청 실패: ${errorMessage}`,
      errorName === 'AbortError' ? 'climate-backend-health-aborted' : 'climate-backend-fetch-error',
      false,
      {
        ...baseDiagnostics,
        backendFetchErrorName: errorName,
        backendFetchErrorMessage: errorMessage,
        backendHealthStatus,
      },
    );
  }

  try {
    const postResponse = await fetchJsonWithTimeout(
      requestUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          Accept: 'application/json',
        },
        body: JSON.stringify(createBackendRequestBody(input)),
      },
      CLIMATE_BACKEND_ANALYSIS_TIMEOUT_MS,
    );
    const diagnosticsFromFetch: Partial<ClimateLiveAnalysisDiagnostics> = {
      ...baseDiagnostics,
      backendHealthStatus,
      backendPostStatus: postResponse.status,
      backendResponseOk: isObjectRecord(postResponse.payload) && postResponse.payload.ok === true,
      backendResponseMessage:
        isObjectRecord(postResponse.payload) && typeof postResponse.payload.message === 'string'
          ? postResponse.payload.message
          : null,
    };

    if (isObjectRecord(postResponse.payload)) {
      const normalizedPayload = normalizeBackendResponse(postResponse.payload, input, diagnosticsFromFetch);

      if (normalizedPayload) {
        return normalizedPayload;
      }
    }

    return createFailureResponse(
      input,
      postResponse.ok
        ? '백엔드 응답 JSON에 ok 필드가 없습니다.'
        : `백엔드 POST 실패: HTTP ${postResponse.status}`,
      'climate-backend-invalid-response',
      false,
      diagnosticsFromFetch,
    );
  } catch (error) {
    const errorName = getErrorName(error);
    const errorMessage = getErrorMessage(error);

    return createFailureResponse(
      input,
      `백엔드 서버 요청 실패: ${errorMessage}`,
      errorName === 'AbortError' ? 'climate-backend-post-aborted' : 'climate-backend-fetch-error',
      false,
      {
        ...baseDiagnostics,
        backendHealthStatus,
        backendFetchErrorName: errorName,
        backendFetchErrorMessage: errorMessage,
      },
    );
  }
}
