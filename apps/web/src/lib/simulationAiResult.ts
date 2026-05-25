export type SimulationAiGrade = 'S' | 'A' | 'B' | 'C' | 'D';

export type SimulationAiFeatureScores = {
  shadingQuality: number;
  usableArea: number;
  generationPotential: number;
  economicValue: number;
  riskPenalty: number;
  positiveRawScore?: number;
};

export type SimulationAiSuitability = {
  score: number;
  grade: SimulationAiGrade;
  label: string;
  featureScores: SimulationAiFeatureScores;
  reasons: string[];
  warnings: string[];
};

export type SimulationAiGenerationPrediction = {
  modelType: 'explainable-hybrid-regression-v1' | string;
  annualGenerationKwh: number;
  monthlyGenerationKwh: number;
  confidence: number;
  confidenceLabel: '높음' | '중간' | '낮음' | string;
  assumptions: string[];
};

export type SimulationAiPanelOptimizationSummary = {
  strategy: 'green-first-shading-aware' | string;
  objective: string;
  selectedPanelCount: number;
  excludedPanelCount: number;
  optimizationSummary: string;
  constraints: string[];
};

export type SimulationAiAgentPayload = {
  summaryForCounselor: string;
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
    selfPaymentEstimateKrw: number;
    paybackYears: number;
    suitabilityGrade: SimulationAiGrade | string;
  };
  counselingHints?: {
    topReasons?: string[];
    warnings?: string[];
  };
};

export type SimulationAiResult = {
  modelVersion: string;
  summary: string;
  suitability: SimulationAiSuitability;
  generationPrediction: SimulationAiGenerationPrediction;
  panelOptimization: SimulationAiPanelOptimizationSummary;
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
