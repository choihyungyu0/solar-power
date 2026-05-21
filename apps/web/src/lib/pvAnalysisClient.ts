import { createDefaultPvAnalysisInput, createFallbackPvAnalysisResult, createSafePvAnalysisInputSummary } from './normalizePvAnalysis';
import type { PvAnalysisInput, PvAnalysisProxyResponse } from '../types/pvAnalysis';

const PV_ANALYSIS_PROXY_PATH = '/api/pv-analysis';

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

  const fallbackInput = createDefaultPvAnalysisInput(input);

  return {
    ok: false,
    fallback: true,
    message: '발전량 분석 프록시 응답을 받지 못해 데모 산식으로 표시합니다.',
    input: createSafePvAnalysisInputSummary(fallbackInput),
    result: createFallbackPvAnalysisResult(fallbackInput),
  };
}

