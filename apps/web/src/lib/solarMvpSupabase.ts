import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  InstallReview,
  PolicyProgram,
  PolicyStatus,
  SolarRequestFormValues,
  SolarSimulationResult,
} from './solarTypes';

type PolicyProgramRow = {
  id: string;
  title: string;
  region: string | null;
  target: string | null;
  support_type: string | null;
  amount_text: string | null;
  source_name: string | null;
  source_url: string | null;
  status: string | null;
  last_checked_at: string | null;
  note: string | null;
};

type InstallReviewRow = {
  id: string;
  apartment_name: string | null;
  region: string | null;
  content: string;
  saving_text: string | null;
  rating: number | null;
  is_demo: boolean | null;
};

const policyStatuses: PolicyStatus[] = ['확인 필요', '접수중', '마감 임박', '마감'];

export const fallbackPolicyPrograms: PolicyProgram[] = [
  {
    id: 'fallback-gyeonggi-solar',
    title: '경기도 공동주택 태양광 지원 후보',
    region: '경기도',
    target: '공동주택, 공공임대, 관리주체 검토 단지',
    supportType: '설치비 일부 보조 또는 정책사업 연계',
    amountText: '연도별 공고 확인 필요',
    sourceName: '경기도/지자체 공고',
    sourceUrl: null,
    status: '확인 필요',
    lastCheckedAt: null,
    note: '데모 후보입니다. 실제 지원 대상, 예산, 접수 가능 여부는 해당 연도 공고 확인이 필요합니다.',
  },
  {
    id: 'fallback-knrec',
    title: '한국에너지공단 주택·건물 지원사업 후보',
    region: '전국',
    target: '주택, 건물, 공동 이용부 전기 절감 검토 대상',
    supportType: '보조금 또는 정책자금',
    amountText: '사업 공고 및 예산 기준 확인 필요',
    sourceName: '한국에너지공단',
    sourceUrl: 'https://www.knrec.or.kr/',
    status: '접수중',
    lastCheckedAt: null,
    note: 'MVP 후보 데이터입니다. 수혜가 보장되지 않으며 실제 공고 조건 확인이 필요합니다.',
  },
  {
    id: 'fallback-b2g-carbon-budget',
    title: '지자체 탄소중립 예산 연계 후보',
    region: '화성시/경기도',
    target: '도심 자가발전 확대와 공공가치가 있는 단지',
    supportType: 'B2G 리포트, 정책지원 운영 대행 연계',
    amountText: '예산 편성 및 과제화 검토 필요',
    sourceName: '지자체 정책 과제',
    sourceUrl: null,
    status: '마감 임박',
    lastCheckedAt: null,
    note: '정책 참여 확대와 예산 소진 개선 관점의 후보입니다. 실제 사업화는 지자체 협의가 필요합니다.',
  },
];

export const fallbackInstallReviews: InstallReview[] = [
  {
    id: 'fallback-review-1',
    apartmentName: '햇빛마을 아파트',
    region: '경기 남부',
    content: '공용 전기요금 부담과 설치 가능성을 한 화면에서 비교할 수 있어 입주민 설명 자료로 쓰기 좋았습니다.',
    savingText: '예상 절감액 확인',
    rating: 5,
    isDemo: true,
  },
  {
    id: 'fallback-review-2',
    apartmentName: '도심그린 공공주택',
    region: '경기권',
    content: '보조금 후보가 확정이 아니라 확인 필요 상태로 표시되어 의사결정 리스크를 설명하기 쉬웠습니다.',
    savingText: '정책 후보 확인',
    rating: 5,
    isDemo: true,
  },
  {
    id: 'fallback-review-3',
    apartmentName: '새빛타운',
    region: '화성시',
    content: '세대수, 옥상 면적, 월 전기요금만으로 1차 검토를 빠르게 시작할 수 있었습니다.',
    savingText: '설치 검토 시작',
    rating: 4,
    isDemo: true,
  },
];

function normalizePolicyStatus(status: string | null): PolicyStatus {
  return policyStatuses.includes(status as PolicyStatus) ? (status as PolicyStatus) : '확인 필요';
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function toPolicyProgram(row: PolicyProgramRow): PolicyProgram {
  return {
    id: row.id,
    title: row.title,
    region: row.region ?? '지역 확인 필요',
    target: row.target ?? '대상 확인 필요',
    supportType: row.support_type ?? '지원 형태 확인 필요',
    amountText: row.amount_text ?? '공고 확인 필요',
    sourceName: row.source_name ?? '공고 확인 필요',
    sourceUrl: row.source_url,
    status: normalizePolicyStatus(row.status),
    lastCheckedAt: row.last_checked_at,
    note: row.note ?? '실제 공고 확인이 필요한 후보입니다.',
  };
}

function toInstallReview(row: InstallReviewRow): InstallReview {
  return {
    id: row.id,
    apartmentName: row.apartment_name ?? '익명 단지',
    region: row.region ?? '지역 비공개',
    content: row.content,
    savingText: row.saving_text ?? '예상 효과 확인',
    rating: row.rating ?? 5,
    isDemo: row.is_demo ?? true,
  };
}

export async function loadPolicyPrograms(client: SupabaseClient | null) {
  if (!client) {
    return fallbackPolicyPrograms;
  }

  const { data, error } = await client
    .from('subsidy_programs')
    .select('id,title,region,target,support_type,amount_text,source_name,source_url,status,last_checked_at,note')
    .order('created_at', { ascending: false });

  if (error || !data || data.length === 0) {
    return fallbackPolicyPrograms;
  }

  return (data as PolicyProgramRow[]).map(toPolicyProgram);
}

export async function loadInstallReviews(client: SupabaseClient | null) {
  if (!client) {
    return fallbackInstallReviews;
  }

  const { data, error } = await client
    .from('install_reviews')
    .select('id,apartment_name,region,content,saving_text,rating,is_demo')
    .order('created_at', { ascending: false })
    .limit(6);

  if (error || !data || data.length === 0) {
    return fallbackInstallReviews;
  }

  return (data as InstallReviewRow[]).map(toInstallReview);
}

export async function saveSolarMvpSubmission(
  client: SupabaseClient,
  userId: string,
  values: SolarRequestFormValues,
  result: SolarSimulationResult,
) {
  const { data: requestRow, error: requestError } = await client
    .from('apartment_solar_requests')
    .insert({
      user_id: userId,
      apartment_name: values.apartmentName,
      address: values.address,
      household_count: values.householdCount,
      roof_area_m2: values.roofAreaM2,
      monthly_electric_bill_krw: values.monthlyElectricBillKrw,
      contact_method: values.contactMethod,
      contact_value: values.contactValue,
      status: 'submitted',
      memo: 'React + TypeScript MVP demo formula submission',
    })
    .select('id')
    .single();

  if (requestError || !requestRow?.id) {
    throw new Error(`요청 저장 실패: ${requestError ? getErrorMessage(requestError) : 'request id missing'}`);
  }

  const requestId = requestRow.id as string;

  const { data: simulationRow, error: simulationError } = await client
    .from('solar_simulations')
    .insert({
      request_id: requestId,
      user_id: userId,
      suitability_score: result.suitabilityScore,
      suitability_grade: result.suitabilityGrade,
      recommended_capacity_kw: result.recommendedCapacityKw,
      panel_count: result.panelCount,
      expected_monthly_generation_kwh: result.expectedMonthlyGenerationKwh,
      expected_yearly_generation_kwh: result.expectedYearlyGenerationKwh,
      expected_yearly_saving_krw: result.expectedYearlySavingKrw,
      estimated_install_cost_krw: result.estimatedInstallCostKrw,
      estimated_subsidy_krw: result.estimatedSubsidyKrw,
      estimated_policy_loan_limit_krw: result.policyLoanLimitKrw,
      estimated_self_payment_krw: result.estimatedSelfPaymentKrw,
      payback_years: result.paybackYears,
      household_monthly_benefit_krw: result.householdMonthlyBenefitKrw,
      calculation_version: 'demo-v1-typescript',
    })
    .select('id')
    .single();

  if (simulationError || !simulationRow?.id) {
    throw new Error(`시뮬레이션 저장 실패: ${simulationError ? getErrorMessage(simulationError) : 'simulation id missing'}`);
  }

  const { data: notificationRow, error: notificationError } = await client
    .from('notification_preferences')
    .insert({
      user_id: userId,
      request_id: requestId,
      method: values.contactMethod,
      destination: values.contactValue,
      enabled: true,
      mock_status: 'mock_ready',
    })
    .select('id')
    .single();

  if (notificationError || !notificationRow?.id) {
    throw new Error(
      `알림 선호 채널 저장 실패: ${notificationError ? getErrorMessage(notificationError) : 'notification id missing'}`,
    );
  }

  return {
    requestId,
    simulationId: simulationRow.id as string,
    notificationPreferenceId: notificationRow.id as string,
  };
}
