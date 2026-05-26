import type { SimulationAiAgentPayload } from './simulationAiResult';

export const CONSULTATION_REQUEST_ID_STORAGE_KEY = 'solarmate:consultationRequestId';

export type ConsultationSubmitPayload = {
  name: string;
  contact: string;
  email?: string;
  consultationType?: string;
  content?: string;
  roadAddress?: string;
  jibunAddress?: string;
  analysisResultId?: string | null;
  privacyAgreed: boolean;
  thirdPartyAgreed?: boolean;
  agentPayload?: SimulationAiAgentPayload | Record<string, unknown> | null;
};

export type ConsultationSubmitResponse =
  | {
      ok: true;
      consultationRequestId: string;
      message: string;
    }
  | {
      ok: false;
      message?: string;
      errorType?: string;
      reason?: string;
      error?: string;
    };

function getClimateBackendBaseUrl() {
  return (import.meta.env.VITE_CLIMATE_BACKEND_BASE_URL ?? '').trim().replace(/\/+$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function submitConsultationRequest(
  payload: ConsultationSubmitPayload,
): Promise<ConsultationSubmitResponse> {
  const baseUrl = getClimateBackendBaseUrl();

  if (!baseUrl) {
    return {
      ok: false,
      message: '상담 서버가 설정되지 않아 임시 저장합니다.',
      errorType: 'BackendNotConfigured',
      error: 'VITE_CLIMATE_BACKEND_BASE_URL is empty.',
    };
  }

  try {
    const response = await fetch(`${baseUrl}/api/consultations`, {
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
      typeof data.consultationRequestId === 'string'
    ) {
      return {
        ok: true,
        consultationRequestId: data.consultationRequestId,
        message: typeof data.message === 'string' ? data.message : '상담 신청이 접수되었습니다.',
      };
    }

    return {
      ok: false,
      message:
        isRecord(data) && typeof data.message === 'string'
          ? data.message
          : '상담 신청 저장 중 오류가 발생했습니다.',
      errorType: isRecord(data) && typeof data.errorType === 'string' ? data.errorType : `HTTP_${response.status}`,
      reason: isRecord(data) && typeof data.reason === 'string' ? data.reason : undefined,
      error: isRecord(data) && typeof data.error === 'string' ? data.error : 'consultation save failed.',
    };
  } catch (error) {
    return {
      ok: false,
      message: '상담 신청 저장 중 오류가 발생했습니다.',
      errorType: error instanceof Error ? error.name : 'FetchError',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
