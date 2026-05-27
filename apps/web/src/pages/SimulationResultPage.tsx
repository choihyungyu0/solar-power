import { useCallback, useState, type CSSProperties } from 'react';
import type { IconType } from 'react-icons';
import {
  LuBuilding2,
  LuChartNoAxesColumnIncreasing,
  LuChevronLeft,
  LuChevronRight,
  LuCircleCheck,
  LuCoins,
  LuInfo,
  LuMapPin,
  LuPhone,
  LuPrinter,
  LuSunMedium,
  LuZap,
} from 'react-icons/lu';
import SolarMateHeader from '../components/SolarMateHeader';
import { generateProfitReport } from '../lib/profitReportClient';
import { formatAgentPayloadJson } from '../lib/simulationAiResult';
import {
  readProfitReportFromSession,
  readSimulationResultFromSession,
  saveProfitReportToSession,
  saveSimulationResultToSession,
  type SimulationResultSource,
  type StoredProfitReport,
  type StoredSimulationResult,
} from '../lib/simulationResultStorage';
import './SimulationResultPage.css';

type SectionColor = 'orange' | 'green' | 'blue';
type ValueTone = 'orange' | 'green' | 'blue' | 'navy';
type SimulationResultView = 'detail' | 'profit' | 'suitability';

type SimulationResultPageProps = {
  view?: SimulationResultView;
};

type ResultMetric = {
  label: string;
  value: string;
  tone: ValueTone;
};

type ResultSection = {
  title: string;
  color: SectionColor;
  icon: IconType;
  image: string;
  imageAlt: string;
  metrics: ResultMetric[];
};

type NormalizedResult = {
  result: StoredSimulationResult;
  panelCount: number;
  installCapacityKw: number;
  annualGenerationKwh: number;
  annualSavingKrw: number;
  paybackYears: number | null;
  investmentKrw: number;
  subsidyMaxKrw: number;
  selfPaymentKrw: number;
  loanLimitKrw: number;
  carbonReductionKg: number;
  pineTreeEffect: number;
  firstYearSavingKrw: number;
  tenYearSavingKrw: number;
  twentyYearSavingKrw: number;
  monthlyGeneration: number[];
  yearlyRevenue: number[];
};

const resultImages = {
  building: '/assets/result/result-building-solar.png',
  profit: '/assets/result/result-profit-panel.png',
  saving: '/assets/result/result-saving-house.png',
  tree: '/assets/result/result-tree.png',
  co2: '/assets/result/result-co2.png',
  coins: '/assets/result/result-coins.png',
};

const fallbackDemoResult: StoredSimulationResult = {
  building: {
    name: '시나리오 기준 아파트',
    roadAddress: '경기도 수원시 팔달구 경수대로 464',
    jibunAddress: '경기도 수원시 팔달구 인계동 1017',
    buildingId: 'demo-result-building',
  },
  solar: {
    investmentKrw: 27_324_000,
    panelCount: 46,
    installCapacityKw: 23,
    annualSavingKrw: 6_087_790,
    paybackYears: 5,
    annualGenerationKwh: 32_041,
    firstYearSavingKrw: 5_511_052,
    tenYearSavingKrw: 53_886_922,
    twentyYearSavingKrw: 105_139_319,
    pineTreeEffect: 109_684,
    carbonReductionKg: 15_319,
    subsidyMaxKrw: 13_000_000,
    selfPaymentKrw: 14_000_000,
    loanLimitKrw: 10_500_000,
    monthlyGeneration: [1525, 1229, 2179, 3012, 3522, 3864, 3133, 2446, 1775, 1256, 1068, 1112],
    yearlyRevenue: [
      5_272_700, 5_546_000, 5_869_000, 5_435_500, 5_446_500, 5_416_500, 5_171_500, 5_115_900,
      5_086_500, 5_110_000, 5_220_300, 5_174_500, 5_015_300, 4_921_500, 4_923_100, 4_827_200,
      4_923_500, 4_889_500, 4_856_800, 4_765_500,
    ],
  },
  source: 'demo',
  storedAt: 'demo',
};

const badges = ['공동주택', '가상설치 가능', '예상 분석 완료'];

function toFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function pickNumber(value: unknown, fallback: number) {
  return toFiniteNumber(value) ?? fallback;
}

function createMonthlyGenerationFallback(annualGenerationKwh: number) {
  const seasonalWeights = [0.052, 0.057, 0.077, 0.094, 0.109, 0.116, 0.109, 0.095, 0.084, 0.074, 0.063, 0.07];
  const weightTotal = seasonalWeights.reduce((sum, weight) => sum + weight, 0);

  return seasonalWeights.map((weight) => Math.round((annualGenerationKwh * weight) / weightTotal));
}

function createYearlyRevenueFallback(annualSavingKrw: number) {
  return Array.from({ length: 20 }, (_, index) => Math.round(annualSavingKrw * Math.max(0.86, 1 - index * 0.006)));
}

function normalizeSeries(values: unknown, length: number, fallback: number[]) {
  const sourceValues = Array.isArray(values) ? values : [];

  return Array.from({ length }, (_, index) => {
    const sourceValue = toFiniteNumber(sourceValues[index]);

    return Math.round(sourceValue ?? fallback[index] ?? 0);
  });
}

function normalizeResult(result: StoredSimulationResult): NormalizedResult {
  const fallbackSolar = fallbackDemoResult.solar;
  const solar = result.solar ?? fallbackSolar;
  const investmentKrw = pickNumber(solar.investmentKrw, fallbackSolar.investmentKrw);
  const subsidyMaxKrw = pickNumber(solar.subsidyMaxKrw, fallbackSolar.subsidyMaxKrw);
  const selfPaymentFallback = Math.max(0, investmentKrw - subsidyMaxKrw);
  const selfPaymentKrw = pickNumber(solar.selfPaymentKrw, selfPaymentFallback);
  const loanLimitKrw = pickNumber(solar.loanLimitKrw, Math.round(selfPaymentKrw * 0.75));
  const annualSavingKrw = pickNumber(solar.annualSavingKrw, fallbackSolar.annualSavingKrw);
  const paybackCandidate = toFiniteNumber(solar.paybackYears);
  const annualGenerationKwh = pickNumber(solar.annualGenerationKwh, fallbackSolar.annualGenerationKwh);
  const monthlyGenerationSource = solar.monthlyGenerationKwh ?? solar.monthlyGeneration;

  return {
    result,
    panelCount: Math.round(pickNumber(solar.panelCount, fallbackSolar.panelCount)),
    installCapacityKw: pickNumber(solar.installCapacityKw, fallbackSolar.installCapacityKw),
    annualGenerationKwh: Math.round(annualGenerationKwh),
    annualSavingKrw: Math.round(annualSavingKrw),
    paybackYears: annualSavingKrw > 0 ? paybackCandidate && paybackCandidate > 0 ? paybackCandidate : investmentKrw / annualSavingKrw : null,
    investmentKrw: Math.round(investmentKrw),
    subsidyMaxKrw: Math.round(subsidyMaxKrw),
    selfPaymentKrw: Math.round(selfPaymentKrw),
    loanLimitKrw: Math.round(loanLimitKrw),
    carbonReductionKg: Math.round(pickNumber(solar.carbonReductionKg, fallbackSolar.carbonReductionKg)),
    pineTreeEffect: Math.round(pickNumber(solar.pineTreeEffect, fallbackSolar.pineTreeEffect)),
    firstYearSavingKrw: Math.round(pickNumber(solar.firstYearSavingKrw, annualSavingKrw)),
    tenYearSavingKrw: Math.round(pickNumber(solar.tenYearSavingKrw, annualSavingKrw * 10)),
    twentyYearSavingKrw: Math.round(pickNumber(solar.twentyYearSavingKrw, annualSavingKrw * 20)),
    monthlyGeneration: normalizeSeries(
      monthlyGenerationSource,
      12,
      createMonthlyGenerationFallback(annualGenerationKwh),
    ),
    yearlyRevenue: normalizeSeries(solar.yearlyRevenue, 20, createYearlyRevenueFallback(annualSavingKrw)),
  };
}

function formatKrw(value: number) {
  return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

function formatOptionalKrw(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? formatKrw(value) : '확인 필요';
}

function formatSimilarity(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '확인 필요';
}

function formatPercent(value: number) {
  return `${value.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function formatKwh(value: number) {
  return `${Math.round(value).toLocaleString('ko-KR')} kWh`;
}

function formatKw(value: number) {
  return `${value.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}kW`;
}

function formatPaybackYears(value: number | null) {
  if (!value || value <= 0) {
    return '계산 불가';
  }

  return `약 ${value.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}년`;
}

function formatOptionalPaybackYears(value: number) {
  return formatPaybackYears(value > 0 ? value : null);
}

function formatChartKrw(value: number) {
  return value >= 10_000 ? `${Math.round(value / 10_000).toLocaleString('ko-KR')}만원` : formatKrw(value);
}

function getSourceLabel(source: SimulationResultSource) {
  if (source === 'climate-live-hybrid') {
    return 'climate.gg live hybrid 기준 예상값';
  }

  if (source === 'pv-analysis') {
    return 'PV 분석 기준 예상값';
  }

  return '시나리오 기준 예시값';
}

function getChartMax(values: number[]) {
  const maxValue = Math.max(1, ...values);
  const unit = maxValue > 100_000 ? 1_000_000 : 500;

  return Math.ceil((maxValue * 1.14) / unit) * unit;
}

function getInvestmentReturnRate(normalized: NormalizedResult) {
  if (normalized.investmentKrw <= 0) {
    return 0;
  }

  return (normalized.annualSavingKrw / normalized.investmentKrw) * 100;
}

function createCumulativeValues(values: number[]) {
  let total = 0;

  return values.map((value) => {
    total += value;

    return total;
  });
}

function getCostItems(normalized: NormalizedResult) {
  return [
    { label: '투자비', value: formatKrw(normalized.investmentKrw), tone: 'blue' as ValueTone },
    { label: '최대 보조금', value: formatKrw(normalized.subsidyMaxKrw), tone: 'green' as ValueTone },
    { label: '자부담금', value: formatKrw(normalized.selfPaymentKrw), tone: 'orange' as ValueTone },
    { label: '대출한도 (75%)', value: formatKrw(normalized.loanLimitKrw), tone: 'navy' as ValueTone },
  ];
}

function ProfitReportSection({
  result,
  profitReport,
  status,
  message,
  canGenerate,
  actions,
}: {
  result: StoredSimulationResult;
  profitReport: StoredProfitReport | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  message: string;
  canGenerate: boolean;
  actions: {
    onGenerate: () => void;
    onConsultationApply: () => void;
  };
}) {
  const [activePage, setActivePage] = useState(1);
  const report = profitReport?.report;

  if (!report) {
    return (
      <section className="profitReportSection" aria-label="AI 태양광 도입 종합 보고서">
        <div className="profitReportHeader">
          <div>
            <span>AI 수익·보조금·금융 리포트</span>
            <h2>AI 태양광 도입 종합 보고서</h2>
          </div>
        </div>
        <p className="profitReportMessage">
          {status === 'loading'
            ? message
            : status === 'error'
              ? message
              : canGenerate
                ? 'AI 분석 결과를 바탕으로 수익·보조금·금융 리포트를 생성할 수 있습니다.'
                : 'AI 리포트 입력값을 준비 중입니다. /risk-map에서 분석을 먼저 실행해주세요.'}
        </p>
        <button
          className="consultApplyButton profitReportCta"
          type="button"
          disabled={!canGenerate || status === 'loading'}
          onClick={actions.onGenerate}
        >
          <LuChartNoAxesColumnIncreasing aria-hidden="true" />
          {status === 'loading' ? '수익 리포트 생성 중' : '수익 리포트 생성하기'}
        </button>
      </section>
    );
  }

  const fourMetrics = report.fourMetrics;
  const generation = fourMetrics.expectedGeneration;
  const cost = fourMetrics.costAndSelfPayment;
  const payback = fourMetrics.payback;
  const suitability = fourMetrics.subsidyAndSuitability;
  const loanScenario = report.loanSupportScenario;
  const netInvestment = report.netInvestment;
  const narrative = report.reportNarrative;
  const primaryReference = report.sourceReferences?.[0];
  const primaryRagMatch = report.subsidyRagContext?.matches?.[0];
  const subsidyProgramName =
    primaryRagMatch?.programName || primaryReference?.sourceTitle || suitability.subsidyProgramName;
  const reportId = profitReport.profitReportId?.slice(0, 8);
  const pageCount = 3;

  return (
    <section className={`profitReportSection profitReportPagedView is-page-${activePage}`} aria-label="AI 태양광 도입 종합 보고서">
      <div className="profitReportPagerBar" aria-label="AI 수익 리포트 페이지 이동">
        <div className="profitReportDots" aria-hidden="true">
          {Array.from({ length: pageCount }, (_, index) => (
            <i className={activePage === index + 1 ? 'isActive' : ''} key={index} />
          ))}
        </div>
        <div className="profitReportPagerControls">
          <button
            type="button"
            onClick={() => setActivePage((current) => Math.max(1, current - 1))}
            disabled={activePage === 1}
            aria-label="이전 페이지"
          >
            <LuChevronLeft aria-hidden="true" />
          </button>
          <strong>{activePage} / {pageCount}</strong>
          <button
            type="button"
            onClick={() => setActivePage((current) => Math.min(pageCount, current + 1))}
            disabled={activePage === pageCount}
            aria-label="다음 페이지"
          >
            <LuChevronRight aria-hidden="true" />
          </button>
        </div>
      </div>

      {activePage === 1 && (
        <>
          <AddressSummary result={result} />

          <div className="profitReportHeader">
            <div>
              <span>AI 수익·보조금·금융 리포트</span>
              <h2>AI 태양광 도입 종합 보고서</h2>
            </div>
            {reportId && <strong>리포트 ID {reportId}</strong>}
          </div>

          <div className="profitNarrativeBox">
            <span className="profitNarrativeIcon" aria-hidden="true">
              <LuInfo />
            </span>
            <div>
              <strong>{narrative.headline}</strong>
              <p>{narrative.summary}</p>
              <p>{narrative.salesMessage}</p>
            </div>
            <button className="consultApplyButton profitReportCta" type="button" onClick={actions.onConsultationApply}>
              <LuPhone aria-hidden="true" />
              상담 신청하기
            </button>
          </div>

          <div className="profitReportCardGrid is-summary">
            <ProfitMetricTile
              color="blue"
              icon={LuCircleCheck}
              label="AI 적합도"
              value={`${suitability.installationSuitabilityGrade}등급 · ${suitability.installationSuitabilityScore}점`}
              note={suitability.installationSuitabilityLabel}
            />
            <ProfitMetricTile
              color="green"
              icon={LuZap}
              label="예상 발전 수익"
              value={formatKwh(generation.annualGenerationKwh)}
              note={`연 절감/수익 ${formatKrw(payback.annualSavingKrw)} 추정`}
            />
            <ProfitMetricTile
              color="orange"
              icon={LuCoins}
              label="실투자금/회수기간"
              value={formatKrw(netInvestment.cashNeededKrw)}
              note={`약 ${formatPaybackYears(netInvestment.paybackYears)} 추정`}
            />
          </div>
        </>
      )}

      {activePage === 2 && (
        <>
          <div className="profitReportHeader is-detail">
            <div>
              <span>AI 수익·보조금·금융 리포트</span>
              <h2>AI 수익 리포트 상세 분석</h2>
              <p>태양광 도입을 위한 핵심 지표와 금융 분석을 상세하게 확인하세요.</p>
            </div>
          </div>

          <div className="profitReportCardGrid is-detail">
            <ProfitMetricTile
              color="blue"
              icon={LuCircleCheck}
              label="AI 적합도"
              value={`${suitability.installationSuitabilityGrade}등급 · ${suitability.installationSuitabilityScore}점`}
              note={suitability.installationSuitabilityLabel}
            />
            <ProfitMetricTile
              color="green"
              icon={LuZap}
              label="예상 발전 수익"
              value={formatKwh(generation.annualGenerationKwh)}
              note={`연 절감·수익 ${formatKrw(payback.annualSavingKrw)} 추정`}
            />
            <ProfitMetricTile
              color="purple"
              icon={LuCoins}
              label="설치 비용/보조금"
              value={formatKrw(cost.estimatedInstallCostKrw)}
              note={`${subsidyProgramName} 기준`}
            />
            <ProfitMetricTile
              color="cyan"
              icon={LuBuilding2}
              label="대출 지원 시나리오"
              value={formatKrw(loanScenario.estimatedLoanLimitKrw)}
              note={loanScenario.loanApprovalStatus}
            />
            <ProfitMetricTile
              color="orange"
              icon={LuChartNoAxesColumnIncreasing}
              label="실투자금/회수기간"
              value={formatKrw(netInvestment.cashNeededKrw)}
              note={`약 ${formatPaybackYears(netInvestment.paybackYears)} 추정`}
            />
          </div>

          <section className="profitReviewPointPanel" aria-label="금융 설치 검토 포인트">
            <h3>금융·설치 검토 포인트</h3>
            <div>
              <article>
                <span className="profitPointIcon is-green" aria-hidden="true">
                  <LuCoins />
                </span>
                <strong>예상 연간 절감·수익</strong>
                <p>
                  연간 발전량 {formatKwh(generation.annualGenerationKwh)} 기준으로 전기요금 절감 및 판매 수익을
                  합산하면 연간 약 <b>{formatKrw(payback.annualSavingKrw)}</b>의 효과가 예상됩니다.
                </p>
              </article>
              <article>
                <span className="profitPointIcon is-purple" aria-hidden="true">
                  <LuCircleCheck />
                </span>
                <strong>보조금 영향</strong>
                <p>
                  {subsidyProgramName} 적용 시 약 <b>{formatKrw(netInvestment.subsidyEstimateKrw)}</b>의 보조금 혜택을
                  검토할 수 있습니다.
                </p>
              </article>
              <article>
                <span className="profitPointIcon is-cyan" aria-hidden="true">
                  <LuBuilding2 />
                </span>
                <strong>금융·대출 시나리오</strong>
                <p>
                  금융기관 대출 지원 시 약 <b>{formatKrw(loanScenario.estimatedLoanLimitKrw)}</b>까지 지원 가능하며,
                  최종 실투자금은 약 <b>{formatKrw(netInvestment.cashNeededKrw)}</b>로 추정됩니다.
                </p>
              </article>
            </div>
          </section>

          <div className="profitDisclaimerBox">
            <strong>확인 필요</strong>
            <ul>
              {report.riskDisclaimers.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </>
      )}

      {activePage === 3 && (
        <>
          <div className="profitReportHeader is-reference">
            <div>
              <span>보조금 근거 및 참고 정보</span>
              <h2>보조금 근거 및 참고 정보</h2>
              <p>보조금 판단의 근거 문서와 참고 정보를 확인하고, 다음 단계를 진행하세요.</p>
            </div>
          </div>

          <SubsidyRagEvidence report={report} />

          <details className="agentPayloadPreview">
            <summary>개발자 JSON · profitReport</summary>
            <pre>{JSON.stringify(report, null, 2)}</pre>
          </details>

          <section className="profitNextStepPanel" aria-label="다음 단계">
            <div>
              <span className="profitPointIcon is-orange" aria-hidden="true">
                <LuPhone />
              </span>
              <div>
                <strong>다음 단계</strong>
                <p>{report.cta.primaryMessage}</p>
                <ul>
                  <li>예상 보조금 가능성 확인</li>
                  <li>자부담 및 세부 설치 비용 안내</li>
                  <li>신청 절차 및 서류 준비 안내</li>
                </ul>
              </div>
            </div>
            <button className="consultApplyButton profitReportCta" type="button" onClick={actions.onConsultationApply}>
              <LuPhone aria-hidden="true" />
              상담 신청하기
            </button>
          </section>
        </>
      )}
    </section>
  );
}

function ProfitMetricTile({
  color,
  icon: Icon,
  label,
  value,
  note,
}: {
  color: 'blue' | 'green' | 'purple' | 'cyan' | 'orange';
  icon: IconType;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <article className={`profitMetricTile is-${color}`}>
      <span className="profitMetricIcon" aria-hidden="true">
        <Icon />
      </span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <p>{note}</p>
      </div>
    </article>
  );
}

function SubsidyRagEvidence({ report }: { report: NonNullable<StoredProfitReport['report']> }) {
  const ragContext = report.subsidyRagContext;
  const matches = ragContext?.matches ?? [];
  const references = report.sourceReferences ?? [];

  if (!ragContext?.enabled || matches.length === 0) {
    return (
      <section className="subsidyRagEvidenceBox">
        <div>
          <span>보조금 RAG 근거</span>
          <strong>정책 매트릭스 기준 표시</strong>
        </div>
        <p>보조금 RAG 근거가 없어 정책 매트릭스 기준으로 표시합니다. 실제 지원 여부는 최신 공고 확인이 필요합니다.</p>
      </section>
    );
  }

  return (
    <section className="subsidyRagEvidenceBox">
      <div>
        <span>보조금 RAG 근거</span>
        <strong>{references[0]?.sourceTitle || matches[0]?.sourceTitle || '검색된 보조금 근거'}</strong>
      </div>
      <ul className="subsidyRagSourceList">
        {matches.slice(0, 3).map((match, index) => (
          <li key={`${match.sourceTitle ?? 'source'}-${index}`}>
            <div>
              <strong>{match.programName || String(report.subsidyMatrix.programName || '보조금 공고 확인 필요')}</strong>
              <span>
                {[match.regionSido, match.regionSigungu].filter(Boolean).join(' ')}
                {match.sourceYear ? ` · ${match.sourceYear}` : ''}
                {` · 유사도 ${formatSimilarity(match.similarity)}`}
              </span>
            </div>
            <p>
              보조금 {formatOptionalKrw(match.subsidyAmountKrw ?? match.maxSubsidyKrw)} · 자부담{' '}
              {formatOptionalKrw(match.selfPaymentKrw)} · 중복지원 {match.stackingAllowed ? '검토 필요' : '불가'}
            </p>
            <details>
              <summary>근거 chunk 보기</summary>
              <pre>{match.chunkText || '근거 텍스트가 없습니다.'}</pre>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SimulationResultPage({ view = 'detail' }: SimulationResultPageProps) {
  const storedResult = readSimulationResultFromSession();
  const normalized = normalizeResult(storedResult ?? fallbackDemoResult);
  const { result } = normalized;
  const [profitReport, setProfitReport] = useState<StoredProfitReport | null>(() => readProfitReportFromSession());
  const [profitReportStatus, setProfitReportStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(() =>
    readProfitReportFromSession() ? 'ready' : 'idle',
  );
  const [profitReportMessage, setProfitReportMessage] = useState('');
  const sourceLabel = getSourceLabel(result.source);
  const isDemo = result.source === 'demo';
  const isDetailView = view === 'detail';
  const isProfitView = view === 'profit';
  const isSuitabilityView = view === 'suitability';
  const pageCopy = {
    detail: {
      title: '결과 상세보기',
      description: '선택하신 아파트의 설치 비용, 예상 발전량, 절감 효과를 자세히 확인해보세요.',
    },
    profit: {
      title: 'AI 수익 리포트',
      description: '예상 수익, 보조금, 금융 시나리오를 도입 판단용 리포트로 확인해보세요.',
    },
    suitability: {
      title: 'AI 설치 적합도',
      description: '음영, 면적, 발전량 추정 기반의 AI 설치 적합도와 검토 근거를 확인해보세요.',
    },
  }[view];
  const cumulativeSaving = createCumulativeValues(normalized.yearlyRevenue);
  const cumulativeNetProfit = cumulativeSaving.map((value) => Math.max(0, value - normalized.selfPaymentKrw));
  const resultSections: ResultSection[] = [
    {
      title: '투자',
      color: 'blue',
      icon: LuChartNoAxesColumnIncreasing,
      image: resultImages.profit,
      imageAlt: '태양광 투자 수익 예상 이미지',
      metrics: [
        { label: '투자 수익률', value: formatPercent(getInvestmentReturnRate(normalized)), tone: 'blue' },
        { label: '투자 회수 기간', value: formatPaybackYears(normalized.paybackYears), tone: 'blue' },
        { label: '20년 총 수익', value: formatKrw(normalized.twentyYearSavingKrw), tone: 'blue' },
      ],
    },
    {
      title: '수익',
      color: 'green',
      icon: LuZap,
      image: resultImages.building,
      imageAlt: '태양광 패널이 설치된 아파트 예상 이미지',
      metrics: [
        { label: '연간 발전량', value: formatKwh(normalized.annualGenerationKwh), tone: 'green' },
        { label: '연간 매출', value: formatKrw(normalized.annualSavingKrw), tone: 'green' },
        { label: '20년 총 매출', value: formatKrw(cumulativeSaving[cumulativeSaving.length - 1] ?? 0), tone: 'green' },
      ],
    },
    {
      title: '절감',
      color: 'orange',
      icon: LuCoins,
      image: resultImages.saving,
      imageAlt: '태양광 주택과 예상 절감 효과 이미지',
      metrics: [
        { label: '연간 전기요금 절감', value: formatKrw(normalized.firstYearSavingKrw), tone: 'orange' },
        { label: '20년 총 절감액', value: formatKrw(normalized.twentyYearSavingKrw), tone: 'orange' },
        { label: '전기요금 상승 반영', value: '연 2.0%', tone: 'orange' },
      ],
    },
  ];

  const handleProfitReportGenerate = useCallback(async () => {
    if (profitReportStatus === 'loading') {
      return;
    }

    if (!result.aiSimulationResult || !result.agentPayload) {
      setProfitReportStatus('error');
      setProfitReportMessage('AI 수익 리포트를 만들 분석 결과가 없습니다. /risk-map에서 분석을 먼저 실행해주세요.');
      return;
    }

    setProfitReportStatus('loading');
    setProfitReportMessage('AI 수익·보조금·금융 리포트를 생성하고 있습니다.');

    const response = await generateProfitReport({
      analysisResultId: result.analysisResultId,
      aiSimulationResult: result.aiSimulationResult,
      agentPayload: result.agentPayload,
    });

    if (response.ok) {
      const nextReport = {
        profitReportId: response.profitReportId,
        report: response.report,
        reportMarkdown: response.reportMarkdown,
        dbSaveStatus: response.dbSaveStatus,
        storedAt: new Date().toISOString(),
      };

      saveProfitReportToSession(nextReport);
      setProfitReport(nextReport);
      setProfitReportStatus('ready');
      setProfitReportMessage('AI 수익 리포트가 생성되었습니다.');
      return;
    }

    setProfitReportStatus('error');
    setProfitReportMessage(response.message ?? 'AI 수익 리포트를 생성하지 못했습니다.');
  }, [
    profitReportStatus,
    result.agentPayload,
    result.aiSimulationResult,
    result.analysisResultId,
  ]);

  const handleConsultationApply = useCallback(() => {
    saveSimulationResultToSession(result);
    window.location.assign('/consultation');
  }, [result]);

  const handlePrintSave = useCallback(() => {
    window.print();
  }, []);

  const profitReportActions = {
    onGenerate: handleProfitReportGenerate,
    onConsultationApply: handleConsultationApply,
  };

  return (
    <div className="simulationResultPage">
      <SolarMateHeader onBeforeLogin={() => saveSimulationResultToSession(normalized.result)} />

      <main className="simulationResultMain">
        <section className="resultTitleArea" aria-labelledby="simulation-result-title">
          <div>
            <span className={`resultSourcePill ${isDemo ? 'isDemo' : ''}`}>{sourceLabel}</span>
            <h1 id="simulation-result-title">{pageCopy.title}</h1>
            <p>{pageCopy.description}</p>
          </div>
          <div className="resultTitleActions">
            <button className="printSaveButton" type="button" onClick={handlePrintSave}>
              <LuPrinter aria-hidden="true" />
              PDF로 저장
            </button>
            <a className="mapBackButton" href="/risk-map">
              지도 다시 보기
            </a>
          </div>
        </section>

        <section className={`simulationResultLayout ${isDetailView ? '' : 'isSingleColumn'}`}>
          <div className="simulationResultContent">
            {!isProfitView && <AddressSummary result={result} />}

            {isDetailView && (
              <>
                <MobileCostCard normalized={normalized} />

                <div className="resultMetricGrid">
                  {resultSections.map((section) => (
                    <ResultSectionCard key={section.title} section={section} />
                  ))}
                </div>

                <div className="ecoCardGrid">
                  <EcoCard
                    image={resultImages.tree}
                    title="첫해 소나무 심는 효과"
                    value={`${normalized.pineTreeEffect.toLocaleString('ko-KR')}그루`}
                    alt="소나무 효과 이미지"
                  />
                  <EcoCard
                    image={resultImages.co2}
                    title="첫해 탄소 감축량"
                    value={`${normalized.carbonReductionKg.toLocaleString('ko-KR')}kgCO₂`}
                    alt="탄소 감축량 이미지"
                  />
                </div>

                <div className="resultChartGrid">
                  <TrendLineChart
                    title="20년 수익 추이"
                    netProfit={cumulativeNetProfit}
                    cumulativeSaving={cumulativeSaving}
                  />

                  <BarChart
                    title="월간 발전량 차트"
                    data={normalized.monthlyGeneration}
                    labels={normalized.monthlyGeneration.map((_, index) => `${index + 1}월`)}
                    valueFormatter={(value) => `${Math.round(value).toLocaleString('ko-KR')}kWh`}
                  />
                </div>
              </>
            )}

            {isProfitView && (
              <ProfitReportSection
                result={result}
                profitReport={profitReport}
                status={profitReportStatus}
                message={profitReportMessage}
                canGenerate={Boolean(result.aiSimulationResult?.agentPayload?.reportInputMetrics)}
                actions={profitReportActions}
              />
            )}

            {isSuitabilityView &&
              (result.aiSimulationResult ? (
                <AiAnalysisReport aiResult={result.aiSimulationResult} />
              ) : (
                <AnalysisEmptyState
                  title="AI 설치 적합도 결과가 없습니다."
                  message="/risk-map에서 건물을 선택하고 발전량 분석을 먼저 실행해주세요."
                />
              ))}
          </div>

          {isDetailView && <CostPanel normalized={normalized} />}
        </section>

        <p className="resultBottomNote">
          <LuInfo aria-hidden="true" />
          본 시뮬레이션은 예상치로 실제 결과와 다를 수 있습니다.
        </p>

        <section className="printContactCta" aria-label="인쇄용 상담 안내">
          <strong>우리 아파트 태양광 설치하기</strong>
          <p>예상 리포트를 바탕으로 실제 보조금, 대출 가능성, 현장 확인 항목을 상담에서 검토하세요.</p>
        </section>
      </main>
    </div>
  );
}

function AnalysisEmptyState({ title, message }: { title: string; message: string }) {
  return (
    <section className="analysisEmptyState" aria-label="분석 결과 없음">
      <strong>{title}</strong>
      <p>{message}</p>
      <a className="mapBackButton" href="/risk-map">
        지도에서 분석하기
      </a>
    </section>
  );
}

function AiAnalysisReport({ aiResult }: { aiResult: NonNullable<StoredSimulationResult['aiSimulationResult']> }) {
  const suitability = aiResult.buildingSuitability ?? aiResult.suitability;
  const warnings = suitability.warnings;
  const questions = aiResult.agentPayload.questionsToAskUser;
  const requiredDocuments = aiResult.agentPayload.requiredDocuments;
  const reportInputMetrics = aiResult.agentPayload.reportInputMetrics;
  const fieldCheckRequired = aiResult.agentPayload.fieldCheckRequired ?? [];
  const cluster = suitability.cluster;

  return (
    <section className="aiAnalysisReport" aria-label="AI 분석 리포트">
      <div className="aiReportHeader">
        <div>
          <span>AI 분석 리포트</span>
          <h2>설치 적합도 {suitability.grade}등급</h2>
        </div>
        <strong>{suitability.score}점</strong>
      </div>

      <p className="aiReportSummary">{aiResult.agentPayload.summaryForCounselor}</p>

      {reportInputMetrics && (
        <>
          <dl className="aiReportMetricTable" aria-label="상담 에이전트 4대 입력 지표">
            <div>
              <dt>예상 발전량</dt>
              <dd>{formatKwh(reportInputMetrics.annualGenerationKwh)}</dd>
            </div>
            <div>
              <dt>투입 비용 / 자부담</dt>
              <dd>
                {formatKrw(reportInputMetrics.estimatedInstallCostKrw)} /{' '}
                {formatKrw(reportInputMetrics.selfPaymentEstimateKrw)}
              </dd>
            </div>
            <div>
              <dt>회수기간</dt>
              <dd>{formatOptionalPaybackYears(reportInputMetrics.paybackYears)}</dd>
            </div>
            <div>
              <dt>보조금 / 설치 적합도</dt>
              <dd>
                {reportInputMetrics.installationSuitabilityGrade}등급 ·{' '}
                {formatKrw(reportInputMetrics.subsidyEstimateKrw)} 추정
              </dd>
            </div>
          </dl>

          <p className="aiReportPolicyNote">
            보조금은 {reportInputMetrics.subsidyProgramName} 단일 기준으로 표시합니다. 실제 지원 여부는
            공고와 예산 잔여 여부에 따라 달라질 수 있습니다.
          </p>
        </>
      )}

      <dl className="aiReportGrid">
        <div>
          <dt>발전량 모델</dt>
          <dd>{aiResult.generationPrediction.modelType}</dd>
        </div>
        <div>
          <dt>군집 유형</dt>
          <dd>{cluster?.clusterName ?? '군집 확인 필요'}</dd>
        </div>
        <div>
          <dt>권장 조치</dt>
          <dd>{aiResult.recommendedAction}</dd>
        </div>
        <div>
          <dt>예상 발전량</dt>
          <dd>{aiResult.generationPrediction.annualGenerationKwh.toLocaleString('ko-KR')}kWh/년</dd>
        </div>
        <div>
          <dt>배치 요약</dt>
          <dd>{aiResult.panelOptimization.optimizationSummary}</dd>
        </div>
        <div>
          <dt>예측 신뢰도</dt>
          <dd>{aiResult.generationPrediction.confidenceLabel}</dd>
        </div>
      </dl>

      {cluster?.description && <p className="aiReportSummary">{cluster.description}</p>}

      {warnings.length > 0 && (
        <div className="aiReportList">
          <strong>주의 항목</strong>
          <ul>
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {fieldCheckRequired.length > 0 && (
        <div className="aiReportList">
          <strong>현장 확인 필요</strong>
          <ul>
            {fieldCheckRequired.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p>위 항목은 AI가 확정하지 않으며 리포트 경고 및 상담 확인 항목으로만 사용합니다.</p>
        </div>
      )}

      {questions.length > 0 && (
        <div className="aiReportList">
          <strong>상담 시 확인 질문</strong>
          <ul>
            {questions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </div>
      )}

      {requiredDocuments.length > 0 && (
        <div className="aiReportList">
          <strong>필요 서류</strong>
          <ul>
            {requiredDocuments.map((documentName) => (
              <li key={documentName}>{documentName}</li>
            ))}
          </ul>
        </div>
      )}

      <details className="agentPayloadPreview">
        <summary>개발자 JSON · agentPayload</summary>
        <pre>{formatAgentPayloadJson(aiResult.agentPayload)}</pre>
      </details>
    </section>
  );
}

function AddressSummary({ result }: { result: StoredSimulationResult }) {
  return (
    <section className="resultAddressSummary" aria-label="선택 건물 주소 요약">
      <div className="addressHeaderLine">
        <span className="addressPinIcon" aria-hidden="true">
          <LuMapPin />
        </span>
        <div>
          <strong>{result.building.name}</strong>
          <p>{result.building.roadAddress}</p>
        </div>
        <LuChevronRight className="addressChevronIcon" aria-hidden="true" />
      </div>

      <div className="addressRows">
        <div>
          <span>도로명주소</span>
          <strong>{result.building.roadAddress}</strong>
        </div>
        <div>
          <span>지번</span>
          <strong>{result.building.jibunAddress}</strong>
        </div>
      </div>

      <div className="resultBadgeGroup">
        {badges.map((badge, index) => {
          const BadgeIcon = index === 0 ? LuBuilding2 : index === 1 ? LuSunMedium : LuCircleCheck;

          return (
            <span className={`resultBadge badge${index + 1}`} key={badge}>
              <BadgeIcon aria-hidden="true" />
              {badge}
            </span>
          );
        })}
      </div>
    </section>
  );
}

function ResultSectionCard({ section }: { section: ResultSection }) {
  const SectionIcon = section.icon;

  return (
    <section className={`resultMetricSection is-${section.color}`}>
      <div className={`metricSectionHeader is-${section.color}`}>
        <span className="metricSectionIcon" aria-hidden="true">
          <SectionIcon />
        </span>
        <strong>{section.title}</strong>
      </div>
      <div className="metricSectionBody">
        <div className="metricGrid">
          {section.metrics.map((metric) => (
            <article className="metricItem" key={metric.label}>
              <span>{metric.label}</span>
              <strong className={`tone-${metric.tone}`}>{metric.value}</strong>
            </article>
          ))}
        </div>

        <img className="sectionResultImage" src={section.image} alt={section.imageAlt} />
      </div>
    </section>
  );
}

function EcoCard({ image, title, value, alt }: { image: string; title: string; value: string; alt: string }) {
  return (
    <section className="ecoResultCard">
      <img src={image} alt={alt} />
      <div>
        <span>{title}</span>
        <strong>{value}</strong>
      </div>
    </section>
  );
}

function TrendLineChart({
  title,
  netProfit,
  cumulativeSaving,
}: {
  title: string;
  netProfit: number[];
  cumulativeSaving: number[];
}) {
  const allValues = [...netProfit, ...cumulativeSaving];
  const maxValue = getChartMax(allValues);
  const axisValues = [maxValue, maxValue * 0.75, maxValue * 0.5, maxValue * 0.25, 0];
  const startYear = 2025;
  const width = 680;
  const height = 232;
  const padding = { top: 24, right: 96, bottom: 42, left: 54 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const labelIndexes = [0, 5, 10, 15, 19].filter((index) => index < cumulativeSaving.length);

  const getPoint = (value: number, index: number, total: number) => {
    const ratio = total > 1 ? index / (total - 1) : 0;
    const x = padding.left + ratio * plotWidth;
    const y = padding.top + plotHeight - (value / maxValue) * plotHeight;

    return [x, y] as const;
  };

  const createPath = (values: number[]) =>
    values
      .map((value, index) => {
        const [x, y] = getPoint(value, index, values.length);

        return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');

  const netProfitPath = createPath(netProfit);
  const cumulativeSavingPath = createPath(cumulativeSaving);
  const lastNetProfitPoint = getPoint(netProfit[netProfit.length - 1] ?? 0, Math.max(0, netProfit.length - 1), netProfit.length);
  const lastSavingPoint = getPoint(
    cumulativeSaving[cumulativeSaving.length - 1] ?? 0,
    Math.max(0, cumulativeSaving.length - 1),
    cumulativeSaving.length,
  );

  return (
    <section className="resultChartCard trendChartCard">
      <div className="chartCardHeader">
        <h2>{title}</h2>
        <span>(단위: 만원)</span>
      </div>

      <div className="trendLegend" aria-label="수익 추이 범례">
        <span className="legendNet">누적 순수익</span>
        <span className="legendSaving">누적 절감액 (전기요금)</span>
      </div>

      <svg className="trendChartSvg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="20년 수익 추이 그래프">
        {axisValues.map((value) => {
          const y = padding.top + plotHeight - (value / maxValue) * plotHeight;

          return (
            <g key={value}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} className="trendGridLine" />
              <text x={padding.left - 12} y={y + 4} className="trendAxisLabel" textAnchor="end">
                {formatChartKrw(value).replace('만원', '')}
              </text>
            </g>
          );
        })}

        <path d={netProfitPath} className="trendLine trendLineNet" />
        <path d={cumulativeSavingPath} className="trendLine trendLineSaving" />

        {netProfit.map((value, index) => {
          const [x, y] = getPoint(value, index, netProfit.length);

          return <circle key={`net-${index}-${value}`} cx={x} cy={y} r="4.5" className="trendDot trendDotNet" />;
        })}

        {cumulativeSaving.map((value, index) => {
          const [x, y] = getPoint(value, index, cumulativeSaving.length);

          return <circle key={`saving-${index}-${value}`} cx={x} cy={y} r="4.5" className="trendDot trendDotSaving" />;
        })}

        {labelIndexes.map((index) => {
          const [x] = getPoint(0, index, cumulativeSaving.length);

          return (
            <text key={index} x={x} y={height - 12} className="trendYearLabel" textAnchor="middle">
              {startYear + index}
            </text>
          );
        })}

        <text x={lastSavingPoint[0] + 18} y={lastSavingPoint[1] + 4} className="trendEndLabel trendEndSaving">
          {formatChartKrw(cumulativeSaving[cumulativeSaving.length - 1] ?? 0)}
        </text>
        <text x={lastNetProfitPoint[0] + 18} y={lastNetProfitPoint[1] + 4} className="trendEndLabel trendEndNet">
          {formatChartKrw(netProfit[netProfit.length - 1] ?? 0)}
        </text>
      </svg>

      <p className="chartNotice">전기요금 연 2.0% 상승 가정 시 추정값입니다.</p>
    </section>
  );
}

function BarChart({
  title,
  data,
  labels,
  valueFormatter,
  notice,
}: {
  title: string;
  data: number[];
  labels: string[];
  valueFormatter: (value: number) => string;
  notice?: string;
}) {
  const maxValue = getChartMax(data);
  const axisValues = [maxValue, maxValue * 0.75, maxValue * 0.5, maxValue * 0.25, 0];

  return (
    <section className="resultChartCard">
      <h2>{title}</h2>
      <div className="chartScrollArea">
        <div className="chartAxis" aria-hidden="true">
          {axisValues.map((value) => (
            <span key={value}>{valueFormatter(value)}</span>
          ))}
        </div>
        <div className="chartPlot">
          <div className="chartGridLines" aria-hidden="true">
            {axisValues.map((value) => (
              <span key={value} />
            ))}
          </div>
          <div className="chartBars">
            {data.map((value, index) => {
              const style = {
                '--bar-height': `${Math.max(4, (value / maxValue) * 100)}%`,
              } as CSSProperties;

              return (
                <div className="chartBarItem" key={`${labels[index]}-${value}`}>
                  <div className="chartBarTrack">
                    <span className="chartBar" style={style}>
                      <em>{valueFormatter(value)}</em>
                    </span>
                  </div>
                  <strong>{labels[index]}</strong>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {notice && <p className="chartNotice">{notice}</p>}
    </section>
  );
}

function MobileCostCard({ normalized }: { normalized: NormalizedResult }) {
  const handleConsultationApply = () => {
    saveSimulationResultToSession(normalized.result);
    window.location.assign('/consultation');
  };

  return (
    <section className="resultMobileCostCard" aria-label="모바일 도입비용">
      <div className="mobileCostHeader">
        <span aria-hidden="true">
          <LuCoins />
        </span>
        <strong>도입비용</strong>
        <img src={resultImages.building} alt="태양광 패널이 설치된 아파트 예상 이미지" />
      </div>

      <dl className="mobileCostGrid">
        {getCostItems(normalized).map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd className={`tone-${item.tone}`}>{item.value}</dd>
          </div>
        ))}
      </dl>

      <button className="consultApplyButton mobileConsultButton" type="button" onClick={handleConsultationApply}>
        <LuPhone aria-hidden="true" />
        상담 신청하기
      </button>
    </section>
  );
}

function CostPanel({ normalized }: { normalized: NormalizedResult }) {
  const handleConsultationApply = () => {
    saveSimulationResultToSession(normalized.result);
    window.location.assign('/consultation');
  };

  const costItems = getCostItems(normalized);

  return (
    <aside className="resultCostPanel" aria-label="도입비용">
      <div className="costPanelHeader">
        <img src={resultImages.coins} alt="도입비용 동전 이미지" />
        <strong>도입비용</strong>
      </div>

      <dl className="costPanelList">
        {costItems.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>

      <section className="policyInfoBox">
        <span>정책자금 기준 예시</span>
        <p>출처 한국에너지공단 신재생에너지센터</p>
        <strong>중소·중견기업 융자지원사업 (Financing Program)</strong>
        <button type="button">자세히 보기</button>
      </section>

      <button className="consultApplyButton" type="button" onClick={handleConsultationApply}>
        <LuPhone aria-hidden="true" />
        상담 신청하기
      </button>
    </aside>
  );
}

export default SimulationResultPage;
