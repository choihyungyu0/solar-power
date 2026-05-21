export type ContactMethod = 'kakao' | 'sms' | 'email';

export type SolarRequestFormValues = {
  apartmentName: string;
  address: string;
  householdCount: number;
  roofAreaM2: number;
  monthlyElectricBillKrw: number;
  contactMethod: ContactMethod;
  contactValue: string;
};

export type SolarSimulationResult = {
  recommendedCapacityKw: number;
  panelCount: number;
  expectedMonthlyGenerationKwh: number;
  expectedYearlyGenerationKwh: number;
  expectedYearlySavingKrw: number;
  estimatedInstallCostKrw: number;
  estimatedSubsidyKrw: number;
  estimatedSelfPaymentKrw: number;
  policyLoanLimitKrw: number;
  paybackYears: number;
  suitabilityScore: number;
  suitabilityGrade: string;
  householdMonthlyBenefitKrw: number;
  demoFormulaNote: string;
};

export type PolicyStatus = '확인 필요' | '접수중' | '마감 임박' | '마감';

export type PolicyProgram = {
  id: string;
  title: string;
  region: string;
  target: string;
  supportType: string;
  amountText: string;
  sourceName: string;
  sourceUrl: string | null;
  status: PolicyStatus;
  lastCheckedAt: string | null;
  note: string;
};

export type InstallReview = {
  id: string;
  apartmentName: string;
  region: string;
  content: string;
  savingText: string;
  rating: number;
  isDemo: boolean;
};

export type SaveStatus =
  | { state: 'idle'; message: string }
  | { state: 'local-only'; message: string }
  | { state: 'saving'; message: string }
  | { state: 'saved'; message: string }
  | { state: 'error'; message: string };
