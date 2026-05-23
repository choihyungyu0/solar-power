import { createDefaultPvAnalysisInput, createFallbackPvAnalysisResult, createSafePvAnalysisInputSummary } from './normalizePvAnalysis';
import type { ClimateRooftopAnalysisInput, PvAnalysisInput, PvAnalysisProxyResponse } from '../types/pvAnalysis';

const PV_ANALYSIS_PROXY_PATH = '/api/pv-analysis';

function createClientFallbackResponse(
  input: PvAnalysisInput,
  message: string,
  identity?: Pick<
    ClimateRooftopAnalysisInput,
    'selectedBuildingId' | 'selectedAnalysisSessionId' | 'roofSource'
  >,
): PvAnalysisProxyResponse {
  const fallbackInput = createDefaultPvAnalysisInput(input);

  return {
    ok: false,
    fallback: true,
    message,
    input: createSafePvAnalysisInputSummary(fallbackInput),
    result: createFallbackPvAnalysisResult(fallbackInput),
    selectedBuildingId: identity?.selectedBuildingId ?? null,
    selectedAnalysisSessionId: identity?.selectedAnalysisSessionId ?? null,
    roofSource: identity?.roofSource ?? null,
    diagnostics: {
      requestSelectedBuildingId: identity?.selectedBuildingId ?? null,
      requestSessionId: identity?.selectedAnalysisSessionId ?? null,
      ignoredStaleLiveResponse: false,
    },
  };
}

export async function requestPvAnalysis(input: PvAnalysisInput): Promise<PvAnalysisProxyResponse> {
  try {
    const response = await fetch(PV_ANALYSIS_PROXY_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        Accept: 'application/json',
      },
      body: JSON.stringify(input),
    });
    const payload = (await response.json().catch(() => null)) as PvAnalysisProxyResponse | null;

    if (payload && typeof payload === 'object' && 'ok' in payload) {
      return payload;
    }
  } catch {
    // The server proxy owns external API details; the browser only needs a safe fallback shape.
  }

  return createClientFallbackResponse(input, '발전량 분석 프록시 응답을 받지 못해 데모 산식으로 표시합니다.');
}

export async function requestClimateRooftopAnalysis(
  input: ClimateRooftopAnalysisInput,
): Promise<PvAnalysisProxyResponse> {
  return createClientFallbackResponse(
    input,
    'climate.gg 라이브 분석은 별도 백엔드 서버 연동 예정이라 기본 시나리오 산식으로 표시합니다.',
    input,
  );
}
