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
      errorType?: string;
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
      errorType: isRecord(data) && typeof data.errorType === 'string' ? data.errorType : `HTTP_${response.status}`,
      error: isRecord(data) && typeof data.error === 'string' ? data.error : '상담 신청 저장에 실패했습니다.',
    };
  } catch (error) {
    return {
      ok: false,
      errorType: error instanceof Error ? error.name : 'FetchError',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
