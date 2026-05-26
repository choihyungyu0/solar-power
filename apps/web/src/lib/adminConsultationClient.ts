export const ADMIN_CONSULTATION_STATUSES = [
  'received',
  'contacted',
  'waiting_documents',
  'proposal_sent',
  'closed',
] as const;

export type AdminConsultationStatus = (typeof ADMIN_CONSULTATION_STATUSES)[number];

export type AdminConsultationRow = {
  id: string;
  createdAt: string | null;
  name: string | null;
  contact: string | null;
  email: string | null;
  consultationType: string | null;
  roadAddress: string | null;
  status: AdminConsultationStatus;
  analysisResultId: string | null;
  suitabilityScore: number | null;
  suitabilityGrade: string | null;
  annualGenerationKwh: number | null;
  installCapacityKw: number | null;
  profitReportId: string | null;
  estimatedCashNeededKrw: number | null;
  paybackYears: number | null;
  subsidyProgramName: string | null;
  loanApprovalStatus: string | null;
};

type AdminStatusUpdateResponse = {
  ok: true;
  id: string;
  status: AdminConsultationStatus;
};

function getClimateBackendBaseUrl() {
  return (import.meta.env.VITE_CLIMATE_BACKEND_BASE_URL ?? '').trim().replace(/\/+$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readErrorMessage(payload: unknown, fallback: string) {
  if (isRecord(payload) && typeof payload.detail === 'string') {
    return payload.detail;
  }

  if (isRecord(payload) && typeof payload.message === 'string') {
    return payload.message;
  }

  return fallback;
}

function createAdminHeaders(adminKey: string) {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  const trimmedKey = adminKey.trim();

  if (trimmedKey) {
    headers['X-SolarMate-Admin-Key'] = trimmedKey;
  }

  return headers;
}

function isAdminConsultationStatus(value: unknown): value is AdminConsultationStatus {
  return ADMIN_CONSULTATION_STATUSES.includes(value as AdminConsultationStatus);
}

function normalizeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function normalizeConsultationRow(value: unknown): AdminConsultationRow | null {
  if (!isRecord(value) || typeof value.id !== 'string') {
    return null;
  }

  return {
    id: value.id,
    createdAt: normalizeText(value.createdAt),
    name: normalizeText(value.name),
    contact: normalizeText(value.contact),
    email: normalizeText(value.email),
    consultationType: normalizeText(value.consultationType),
    roadAddress: normalizeText(value.roadAddress),
    status: isAdminConsultationStatus(value.status) ? value.status : 'received',
    analysisResultId: normalizeText(value.analysisResultId),
    suitabilityScore: normalizeNumber(value.suitabilityScore),
    suitabilityGrade: normalizeText(value.suitabilityGrade),
    annualGenerationKwh: normalizeNumber(value.annualGenerationKwh),
    installCapacityKw: normalizeNumber(value.installCapacityKw),
    profitReportId: normalizeText(value.profitReportId),
    estimatedCashNeededKrw: normalizeNumber(value.estimatedCashNeededKrw),
    paybackYears: normalizeNumber(value.paybackYears),
    subsidyProgramName: normalizeText(value.subsidyProgramName),
    loanApprovalStatus: normalizeText(value.loanApprovalStatus),
  };
}

export async function fetchAdminConsultations(adminKey: string): Promise<AdminConsultationRow[]> {
  const baseUrl = getClimateBackendBaseUrl();

  if (!baseUrl) {
    throw new Error('관리자 API 서버 주소가 설정되지 않았습니다.');
  }

  const response = await fetch(`${baseUrl}/api/admin/consultations`, {
    method: 'GET',
    headers: createAdminHeaders(adminKey),
  });
  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new Error(readErrorMessage(payload, `관리자 상담 목록 요청 실패: HTTP ${response.status}`));
  }

  if (!Array.isArray(payload)) {
    throw new Error('관리자 상담 목록 응답 형식이 올바르지 않습니다.');
  }

  return payload
    .map((item) => normalizeConsultationRow(item))
    .filter((item): item is AdminConsultationRow => item !== null);
}

export async function updateAdminConsultationStatus(
  id: string,
  status: AdminConsultationStatus,
  adminKey: string,
): Promise<AdminStatusUpdateResponse> {
  const baseUrl = getClimateBackendBaseUrl();

  if (!baseUrl) {
    throw new Error('관리자 API 서버 주소가 설정되지 않았습니다.');
  }

  const response = await fetch(`${baseUrl}/api/admin/consultations/${id}/status`, {
    method: 'PATCH',
    headers: {
      ...createAdminHeaders(adminKey),
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({ status }),
  });
  const payload = (await response.json().catch(() => null)) as unknown;

  if (
    response.ok &&
    isRecord(payload) &&
    payload.ok === true &&
    typeof payload.id === 'string' &&
    isAdminConsultationStatus(payload.status)
  ) {
    return {
      ok: true,
      id: payload.id,
      status: payload.status,
    };
  }

  throw new Error(readErrorMessage(payload, `상담 상태 변경 실패: HTTP ${response.status}`));
}
