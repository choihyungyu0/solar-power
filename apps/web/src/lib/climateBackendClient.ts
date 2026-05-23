import type {
  ClimateLiveAnalysisFailureResponse,
  ClimateLiveAnalysisRequest,
  ClimateLiveAnalysisResponse,
} from '../types/climateBundle';

const CLIMATE_BACKEND_TIMEOUT_MS = 6000;

function getClimateBackendBaseUrl() {
  return (import.meta.env.VITE_CLIMATE_BACKEND_BASE_URL ?? '').trim().replace(/\/+$/, '');
}

function createDisabledResponse(input: ClimateLiveAnalysisRequest): ClimateLiveAnalysisFailureResponse {
  return {
    ok: false,
    source: 'climate.gg-live-hybrid',
    selectedBuildingId: input.selectedBuildingId ?? null,
    selectedAnalysisSessionId: input.selectedAnalysisSessionId ?? null,
    disabled: true,
    message: 'climate.gg 라이브 분석은 별도 백엔드 서버 연동 예정입니다.',
    fallbackRecommended: true,
    diagnostics: {
      requestSelectedBuildingId: input.selectedBuildingId ?? null,
      requestSessionId: input.selectedAnalysisSessionId ?? null,
      ignoredStaleLiveResponse: false,
      fallbackReason: 'climate-live-backend-disabled',
    },
  };
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
    return createDisabledResponse(input);
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), CLIMATE_BACKEND_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/api/climate-rooftop-analysis`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        Accept: 'application/json',
      },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as ClimateLiveAnalysisResponse | null;

    if (payload && typeof payload === 'object' && 'ok' in payload) {
      return payload;
    }
  } catch {
    // The UI keeps the local footprint panel layout when the future backend is unavailable.
  } finally {
    window.clearTimeout(timeoutId);
  }

  return {
    ...createDisabledResponse(input),
    disabled: false,
    message: 'climate.gg 별도 백엔드 응답을 받지 못해 기본 패널 배치를 유지합니다.',
  };
}
