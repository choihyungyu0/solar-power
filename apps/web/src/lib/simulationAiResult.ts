export type SimulationAiGrade = 'S' | 'A' | 'B' | 'C' | 'D';
export type SimulationSubsidyPolicyMode = 'gyeonggi_home_solar_only' | string;

export type SimulationAiFeatureScores = {
  shadingQuality: number;
  usableArea: number;
  generationPotential: number;
  economicValue: number;
  riskPenalty: number;
  positiveRawScore?: number;
};

export type SimulationAiCluster = {
  clusterId: number | string;
  clusterName: string;
  description?: string;
  modelType?: string;
  modelStatus?: string;
  confidence?: number;
  centroidSignals?: Record<string, number | string | null>;
};

export type SimulationAiSuitability = {
  modelType?: 'explainable_score_plus_kmeans_v1' | string;
  score: number;
  grade: SimulationAiGrade;
  label: string;
  cluster?: SimulationAiCluster;
  featureScores: SimulationAiFeatureScores;
  reasons: string[];
  warnings: string[];
};

export type SimulationAiFeatureImportance = {
  feature: string;
  label: string;
  importance: number;
};

export type SimulationAiGenerationPrediction = {
  modelType: 'random_forest_surrogate_v1' | 'fallback-formula-v1' | 'explainable-hybrid-regression-v1' | string;
  modelStatus?: string;
  annualGenerationKwh: number;
  monthlyGenerationKwh: number;
  confidence: number;
  confidenceLabel: '높음' | '중간' | '낮음' | string;
  featureImportance?: SimulationAiFeatureImportance[];
  isMeasuredGenerationModel?: boolean;
  trainingDataSource?: string;
  assumptions: string[];
};

export type SimulationAiPanelOptimizationSummary = {
  modelType?: 'shading_aware_optimizer_v1' | string;
  strategy: 'green-first-shading-aware' | string;
  objective: string;
  selectedPanelCount: number;
  excludedPanelCount: number;
  optimizationSummary: string;
  constraints: string[];
};

export type SimulationAiReportInputMetrics = {
  annualGenerationKwh: number;
  monthlyGenerationKwh: number[];
  estimatedInstallCostKrw: number;
  subsidyEstimateKrw: number;
  selfPaymentEstimateKrw: number;
  annualSavingKrw: number;
  paybackYears: number;
  subsidyProgramName: '경기 주택태양광 지원사업' | string;
  subsidyPolicyMode: SimulationSubsidyPolicyMode;
  subsidyStackingAllowed: boolean;
  subsidyStackingReason: string;
  installationSuitabilityScore: number;
  installationSuitabilityGrade: SimulationAiGrade;
  installationSuitabilityLabel: string;
  recommendedAction: string;
};

export type SimulationAiAgentPayload = {
  analysisResultId?: string | null;
  agentType?: 'ai_profit_subsidy_finance_report_agent' | string;
  agentName?: string;
  summaryForCounselor: string;
  reportInputMetrics?: SimulationAiReportInputMetrics;
  fieldCheckRequired?: string[];
  fieldCheckAffectsScore?: boolean;
  questionsToAskUser: string[];
  requiredDocuments: string[];
  nextStep: string;
  subsidyRagInput: {
    location:
      | string
      | {
          roadAddress?: string;
          jibunAddress?: string;
          latitude?: number | null;
          longitude?: number | null;
        };
    buildingUsage: string;
    installCapacityKw: number;
    estimatedInstallCostKrw: number;
    subsidyEstimateKrw?: number;
    selfPaymentEstimateKrw: number;
    paybackYears: number;
    suitabilityGrade: SimulationAiGrade | string;
    suitabilityCluster?: string;
    subsidyProgramName?: string;
    subsidyPolicyMode?: SimulationSubsidyPolicyMode;
    subsidyStackingAllowed?: boolean;
    subsidyStackingReason?: string;
    modelDisclosure?: string;
  };
  counselingHints?: {
    topReasons?: string[];
    warnings?: string[];
  };
};

export type SimulationAiModelMetadata = {
  modelVersion: string;
  modelStatus?: string;
  trainingDataSource: string;
  isMeasuredGenerationModel: boolean;
  disclosure?: string[];
  models?: Record<string, unknown>;
  featureColumns?: string[];
  rowCount?: number | null;
  trainedAt?: string | null;
  limitations?: string[];
  loadError?: string | null;
  featureImportance?: {
    generation?: SimulationAiFeatureImportance[];
    payback?: SimulationAiFeatureImportance[];
  };
};

export type SimulationAiResult = {
  analysisResultId?: string | null;
  modelVersion: string;
  summary: string;
  building?: Record<string, unknown>;
  roof?: Record<string, unknown>;
  shading?: Record<string, unknown>;
  suitability: SimulationAiSuitability;
  buildingSuitability?: SimulationAiSuitability;
  generationPrediction: SimulationAiGenerationPrediction;
  panelOptimization: SimulationAiPanelOptimizationSummary;
  economics?: Record<string, unknown>;
  aiModelMetadata?: SimulationAiModelMetadata;
  recommendedAction: string;
  agentPayload: SimulationAiAgentPayload;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function isSimulationAiResult(value: unknown): value is SimulationAiResult {
  if (!isRecord(value)) {
    return false;
  }

  const suitability = value.suitability;
  const generationPrediction = value.generationPrediction;
  const panelOptimization = value.panelOptimization;
  const agentPayload = value.agentPayload;

  return (
    typeof value.modelVersion === 'string' &&
    isRecord(suitability) &&
    typeof suitability.score === 'number' &&
    typeof suitability.grade === 'string' &&
    typeof suitability.label === 'string' &&
    isStringArray(suitability.reasons) &&
    isStringArray(suitability.warnings) &&
    isRecord(generationPrediction) &&
    typeof generationPrediction.annualGenerationKwh === 'number' &&
    typeof generationPrediction.monthlyGenerationKwh === 'number' &&
    isRecord(panelOptimization) &&
    typeof panelOptimization.selectedPanelCount === 'number' &&
    isRecord(agentPayload) &&
    typeof agentPayload.summaryForCounselor === 'string'
  );
}

export function formatAgentPayloadJson(agentPayload: SimulationAiAgentPayload) {
  return JSON.stringify(agentPayload, null, 2);
}
