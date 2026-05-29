import type {
  ProfitReportDbSaveStatus,
  ProfitReportJson,
  ProfitReportResponse,
  ProfitReportUserFinanceInput,
} from '../types/climateBundle';
import type { SimulationAiAgentPayload, SimulationAiResult } from './simulationAiResult';

export type GenerateProfitReportPayload = {
  analysisResultId?: string | null;
  aiSimulationResult?: SimulationAiResult | Record<string, unknown> | null;
  agentPayload?: SimulationAiAgentPayload | Record<string, unknown> | null;
  userFinanceInput?: ProfitReportUserFinanceInput;
};

function getClimateBackendBaseUrl() {
  return (import.meta.env.VITE_CLIMATE_BACKEND_BASE_URL ?? '').trim().replace(/\/+$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function generateProfitReport(
  payload: GenerateProfitReportPayload,
): Promise<ProfitReportResponse> {
  const baseUrl = getClimateBackendBaseUrl();

  if (!baseUrl) {
    return {
      ok: false,
      message: 'AI 맞춤형 설치 리포트 서버가 설정되지 않았습니다.',
      errorType: 'BackendNotConfigured',
      reason: 'VITE_CLIMATE_BACKEND_BASE_URL is empty.',
    };
  }

  try {
    const response = await fetch(`${baseUrl}/api/ai-profit-report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data = (await response.json().catch(() => null)) as unknown;

    if (
      response.ok &&
      isRecord(data) &&
      data.ok === true &&
      isRecord(data.report) &&
      typeof data.reportMarkdown === 'string'
    ) {
      return {
        ok: true,
        profitReportId: typeof data.profitReportId === 'string' ? data.profitReportId : null,
        report: data.report as ProfitReportJson,
        reportMarkdown: data.reportMarkdown,
        dbSaveStatus: isRecord(data.dbSaveStatus)
          ? (data.dbSaveStatus as ProfitReportDbSaveStatus)
          : { enabled: false },
      };
    }

    return {
      ok: false,
      message:
        isRecord(data) && typeof data.message === 'string'
          ? data.message
          : 'AI 맞춤형 설치 리포트를 생성하지 못했습니다.',
      errorType: isRecord(data) && typeof data.errorType === 'string' ? data.errorType : `HTTP_${response.status}`,
      reason: isRecord(data) && typeof data.reason === 'string' ? data.reason : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      message: 'AI 맞춤형 설치 리포트를 생성하지 못했습니다.',
      errorType: error instanceof Error ? error.name : 'FetchError',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
