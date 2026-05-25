import type { CSSProperties } from 'react';
import type { IconType } from 'react-icons';
import {
  LuBell,
  LuBuilding2,
  LuChartNoAxesColumnIncreasing,
  LuChevronRight,
  LuCircleCheck,
  LuCoins,
  LuInfo,
  LuMapPin,
  LuMenu,
  LuPhone,
  LuSunMedium,
  LuZap,
} from 'react-icons/lu';
import {
  readSimulationResultFromSession,
  saveSimulationResultToSession,
  type SimulationResultSource,
  type StoredSimulationResult,
} from '../lib/simulationResultStorage';
import './SimulationResultPage.css';

type SectionColor = 'orange' | 'green' | 'blue';
type ValueTone = 'orange' | 'green' | 'blue' | 'navy';

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

function SimulationResultPage() {
  const storedResult = readSimulationResultFromSession();
  const normalized = normalizeResult(storedResult ?? fallbackDemoResult);
  const { result } = normalized;
  const sourceLabel = getSourceLabel(result.source);
  const isDemo = result.source === 'demo';
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

  return (
    <div className="simulationResultPage">
      <ResultHeader selectedResult={normalized.result} />

      <main className="simulationResultMain">
        <section className="resultTitleArea" aria-labelledby="simulation-result-title">
          <div>
            <span className={`resultSourcePill ${isDemo ? 'isDemo' : ''}`}>{sourceLabel}</span>
            <h1 id="simulation-result-title">설치 결과 시뮬레이션</h1>
            <p>선택하신 아파트의 태양광 설치 비용, 예상 수익, 절감 효과를 확인해보세요.</p>
          </div>
          <a className="mapBackButton" href="/risk-map">
            지도 다시 보기
          </a>
        </section>

        <section className="simulationResultLayout">
          <div className="simulationResultContent">
            <AddressSummary result={result} />

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
          </div>

          <CostPanel normalized={normalized} />
        </section>

        <p className="resultBottomNote">
          <LuInfo aria-hidden="true" />
          본 시뮬레이션은 예상치로 실제 결과와 다를 수 있습니다.
        </p>
      </main>
    </div>
  );
}

function ResultHeader({ selectedResult }: { selectedResult: StoredSimulationResult }) {
  const handleLoginClick = () => {
    saveSimulationResultToSession(selectedResult);
    window.location.assign('/login');
  };

  return (
    <header className="resultSiteHeader">
      <a className="resultLogo" href="/" aria-label="솔라메이트 홈">
        <span className="resultLogoMark" aria-hidden="true">
          <img src="/assets/landing/apartment-isometric.png" alt="" />
        </span>
        <strong>
          <span className="resultLogoKorean">솔라메이트</span>
          <small>SolarMate</small>
        </strong>
      </a>

      <nav className="resultNav" aria-label="주요 메뉴">
        <a href="/solar-adoption">태양광 도입</a>
        <a href="/#service-intro">서비스 소개</a>
        <a href="/notice">공지사항</a>
        <a href="/consultation">상담하기</a>
      </nav>

      <div className="resultHeaderActions">
        <button className="resultLoginButton" type="button" onClick={handleLoginClick}>
          로그인
        </button>
        <a className="resultHeaderCta" href="/simulation/setup">
          우리 아파트 태양광 설치하기
        </a>
      </div>

      <div className="resultMobileHeaderActions" aria-label="모바일 빠른 메뉴">
        <button type="button" aria-label="알림">
          <LuBell aria-hidden="true" />
        </button>
        <button type="button" aria-label="메뉴">
          <LuMenu aria-hidden="true" />
        </button>
      </div>
    </header>
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
