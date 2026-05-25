import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  LuBotMessageSquare,
  LuChartNoAxesColumnIncreasing,
  LuChevronDown,
  LuChevronUp,
  LuCirclePlus,
  LuCircleUserRound,
  LuHeadphones,
} from 'react-icons/lu';
import SolarMateHeader from '../components/SolarMateHeader';
import {
  buildScenarioDayCards,
  formatKrw,
  formatKw,
  formatKwh,
  loadSelectedSimulationResult,
  normalizeDashboardData,
  type NormalizedDashboardData,
  type ScenarioComparisonBar,
  type ScenarioDayCard,
} from '../lib/memberDashboardData';
import { isDemoLoggedIn } from '../lib/demoAuth';
import { SELECTED_SIMULATION_RESULT_STORAGE_KEY } from '../lib/simulationResultStorage';
import './MemberDashboardPage.css';

export type DashboardTab = 'generation' | 'as' | 'profile';
type GenerationTab = 'realtime' | 'hourly' | 'monthly' | 'pattern';

type MemberDashboardPageProps = {
  initialTab?: DashboardTab;
};

type FaqItem = {
  question: string;
  answer: string;
};

type ProfileValues = {
  name: string;
  birthDate: string;
  phone: string;
  email: string;
};

type ProfileField = {
  id: keyof ProfileValues | 'password';
  label: string;
  name?: keyof ProfileValues;
  buttonText?: string;
};

type StoredConsultationInquiry = {
  name?: unknown;
  contact?: unknown;
  phone?: unknown;
  email?: unknown;
};

const dashboardTabs: { id: DashboardTab; label: string; icon: typeof LuChartNoAxesColumnIncreasing }[] = [
  {
    id: 'generation',
    label: '발전량',
    icon: LuChartNoAxesColumnIncreasing,
  },
  {
    id: 'as',
    label: 'A/S',
    icon: LuHeadphones,
  },
  {
    id: 'profile',
    label: '회원관리',
    icon: LuCircleUserRound,
  },
];

const generationTabs: { id: GenerationTab; label: string }[] = [
  {
    id: 'realtime',
    label: '실시간 요금',
  },
  {
    id: 'hourly',
    label: '시간별 사용량',
  },
  {
    id: 'monthly',
    label: '월별 사용량',
  },
  {
    id: 'pattern',
    label: '패턴분석',
  },
];

const faqItems: FaqItem[] = [
  {
    question: '전기 발전이 안돼요',
    answer:
      '인버터 상태, 차단기 여부, 모니터링 장치 연결 상태 등을 확인해주세요.\n그래도 해결되지 않으면 A/S 접수를 통해 전문가의 도움을 받으실 수 있습니다.',
  },
  {
    question: '발전량이 줄었어요',
    answer:
      '날씨, 계절, 음영, 패널 오염, 장비 상태에 따라 발전량이 달라질 수 있습니다.\n최근 발전량 추이를 확인하고 필요 시 점검을 신청해주세요.',
  },
  {
    question: '질문 1',
    answer: '자주 묻는 질문 내용을 준비 중입니다.',
  },
  {
    question: '질문 2',
    answer: '자주 묻는 질문 내용을 준비 중입니다.',
  },
];

const CONSULTATION_INQUIRY_STORAGE_KEY = 'solarmate:consultationInquiry';
const SERVICE_CONSULTATION_INQUIRY_STORAGE_KEY = 'solarmate:serviceConsultationInquiry';

const fallbackProfileValues: ProfileValues = {
  name: '김솔라',
  birthDate: '1998.03.12',
  phone: '010-1234-5678',
  email: 'solarmate@example.com',
};

const profileFields: ProfileField[] = [
  {
    id: 'name',
    label: '이름',
    name: 'name',
  },
  {
    id: 'birthDate',
    label: '생년월일',
    name: 'birthDate',
  },
  {
    id: 'phone',
    label: '전화번호',
    name: 'phone',
    buttonText: '변경',
  },
  {
    id: 'email',
    label: '이메일',
    name: 'email',
    buttonText: '변경',
  },
  {
    id: 'password',
    label: '비밀번호',
    buttonText: '변경',
  },
];

export default function MemberDashboardPage({ initialTab }: MemberDashboardPageProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tabFromUrl = parseDashboardTab(searchParams.get('tab'));
  const [activeTab, setActiveTab] = useState<DashboardTab>(() => initialTab ?? tabFromUrl ?? 'generation');
  const selectedSimulationPayload = useMemo(() => loadSelectedSimulationResult(), []);
  const hasSelectedSimulationResult = useMemo(() => hasSelectedSimulationResultInSession(), []);
  const dashboardData = useMemo(() => normalizeDashboardData(selectedSimulationPayload), [selectedSimulationPayload]);
  const scenarioCards = useMemo(() => buildScenarioDayCards(dashboardData), [dashboardData]);
  const showDemoNotice = !isDemoLoggedIn();

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
      return;
    }

    if (tabFromUrl) {
      setActiveTab(tabFromUrl);
    }
  }, [initialTab, tabFromUrl]);

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }

    console.debug('[MemberDashboardPage]', {
      dashboardDataSource: dashboardData.source,
      hasSelectedSimulationResult,
      annualGenerationKwh: dashboardData.solar.annualGenerationKwh,
      monthlyGenerationKwhLength: dashboardData.solar.monthlyGenerationKwh.length,
    });
  }, [
    dashboardData.source,
    dashboardData.solar.annualGenerationKwh,
    dashboardData.solar.monthlyGenerationKwh.length,
    hasSelectedSimulationResult,
  ]);

  const isDemoSource = dashboardData.source === 'demo';
  const badgeText = isDemoSource ? '데모 대시보드 데이터' : '선택 건물 분석값 기반';
  const noticeText = isDemoSource
    ? '데모 산식 기반 예상 시나리오입니다. 실제 계량기 사용량이나 실측 발전량으로 표시하지 않습니다.'
    : '선택 건물 분석값 기반 시나리오입니다.';
  const handleDashboardTabClick = (tab: DashboardTab) => {
    setActiveTab(tab);
    navigate(`/member/dashboard?tab=${tab}`);
  };

  return (
    <div className="member-dashboard-page">
      <SolarMateHeader variant="member" />

      <main className="member-dashboard-main">
        {showDemoNotice && <p className="member-dashboard-soft-notice">데모 화면입니다. 로그인 후 이용하는 화면입니다.</p>}

        <section
          className="member-dashboard-shell"
          aria-label="회원 대시보드"
          data-dashboard-source={dashboardData.source}
          data-has-selected-simulation-result={hasSelectedSimulationResult}
        >
          <div className="member-dashboard-tab-content">
            {activeTab === 'generation' && (
              <GenerationDashboard
                dashboardData={dashboardData}
                scenarioCards={scenarioCards}
                badgeText={badgeText}
                noticeText={noticeText}
                isDemoSource={isDemoSource}
              />
            )}

            {activeTab === 'as' && <MemberAsPanel />}

            {activeTab === 'profile' && <MemberProfilePanel data={dashboardData} />}
          </div>

          <nav className="member-dashboard-tab-row" aria-label="회원 메뉴">
            {dashboardTabs.map((tab) => {
              const isActive = tab.id === activeTab;
              const TabIcon = tab.icon;

              return (
                <button
                  key={tab.id}
                  className={`member-dashboard-tab-button ${isActive ? 'is-active' : ''} ${
                    tab.id === 'profile' && isActive ? 'is-profile-active' : ''
                  }`}
                  type="button"
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => handleDashboardTabClick(tab.id)}
                >
                  <TabIcon aria-hidden="true" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </section>
      </main>
    </div>
  );
}

function GenerationDashboard({
  dashboardData,
  scenarioCards,
  badgeText,
  noticeText,
  isDemoSource,
}: {
  dashboardData: NormalizedDashboardData;
  scenarioCards: ScenarioDayCard[];
  badgeText: string;
  noticeText: string;
  isDemoSource: boolean;
}) {
  const [activeGenerationTab, setActiveGenerationTab] = useState<GenerationTab>('realtime');

  return (
    <>
      <div className="member-dashboard-warranty-row">
        <strong>보증기한</strong>
        <div className="member-dashboard-warranty-bar" aria-label="보증기한 상태 표시" />
      </div>

      <section className="member-dashboard-generation-card" aria-labelledby="member-dashboard-title">
        <div className="member-dashboard-title-row">
          <h1 id="member-dashboard-title">
            <span aria-hidden="true" />
            태양광 발전량 확인하기
          </h1>
          <p className={isDemoSource ? 'is-demo' : ''}>{badgeText}</p>
        </div>

        <DashboardSummary data={dashboardData} />

        <p className="member-dashboard-scenario-note">{noticeText}</p>

        <nav className="member-dashboard-generation-tab-row" aria-label="발전량 세부 메뉴">
          {generationTabs.map((tab) => (
            <button
              key={tab.id}
              className={activeGenerationTab === tab.id ? 'is-active' : ''}
              type="button"
              aria-current={activeGenerationTab === tab.id ? 'page' : undefined}
              onClick={() => setActiveGenerationTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {activeGenerationTab === 'realtime' && (
          <RealtimeGenerationPanel dashboardData={dashboardData} scenarioCards={scenarioCards} />
        )}

        {activeGenerationTab === 'hourly' && <HourlyUsagePanel scenarioCards={scenarioCards} />}

        {activeGenerationTab === 'monthly' && <MonthlyUsagePanel dashboardData={dashboardData} />}

        {activeGenerationTab === 'pattern' && <PatternAnalysisPanel dashboardData={dashboardData} />}
      </section>
    </>
  );
}

function RealtimeGenerationPanel({
  dashboardData,
  scenarioCards,
}: {
  dashboardData: NormalizedDashboardData;
  scenarioCards: ScenarioDayCard[];
}) {
  const representativeCard = scenarioCards[1] ?? scenarioCards[0];
  const currentEstimatedCharge = representativeCard ? representativeCard.dailyBillKrw * 30 : 0;
  const generationOffsetKwh = representativeCard ? representativeCard.dailyGenerationKwh * 30 : dashboardData.solar.annualGenerationKwh / 12;
  const generationOffsetKrw = generationOffsetKwh * dashboardData.solar.electricityPriceKrwPerKwh;

  return (
    <section className="member-dashboard-generation-panel" aria-label="실시간 요금 데모 대시보드">
      <div className="member-dashboard-realtime-summary">
        <article>
          <span>현재 예상 요금</span>
          <strong>{formatKrw(currentEstimatedCharge)}</strong>
          <p>선택 건물 분석값 기반 월 환산 시나리오</p>
        </article>
        <article>
          <span>발전 상쇄량</span>
          <strong>{formatKwh(generationOffsetKwh)}</strong>
          <p>예상 태양광 발전으로 상쇄 가능한 월 사용량</p>
        </article>
        <article>
          <span>예상 절감 효과</span>
          <strong>{formatKrw(generationOffsetKrw)}</strong>
          <p>실제 계량기 데이터가 아닌 데모 대시보드 데이터</p>
        </article>
      </div>

      <div className="member-dashboard-meter-grid">
        {scenarioCards.map((card) => (
          <ScenarioMeterCard key={`${card.id}-${card.month}`} card={card} />
        ))}
      </div>
    </section>
  );
}

function HourlyUsagePanel({ scenarioCards }: { scenarioCards: ScenarioDayCard[] }) {
  const representativeCard = scenarioCards[1] ?? scenarioCards[0];
  const usageTotal = representativeCard?.segments.reduce((sum, segment) => sum + segment.usagePercent, 0) ?? 1;
  const generationTotal = representativeCard?.segments.reduce((sum, segment) => sum + segment.generationPercent, 0) ?? 1;
  const rows =
    representativeCard?.segments.map((segment) => ({
      hour: segment.hour,
      usageKwh: (representativeCard.dailyUsageKwh * segment.usagePercent) / usageTotal,
      generationKwh:
        generationTotal > 0 ? (representativeCard.dailyGenerationKwh * segment.generationPercent) / generationTotal : 0,
      usagePercent: segment.usagePercent,
      generationPercent: segment.generationPercent,
    })) ?? [];

  return (
    <section className="member-dashboard-generation-panel" aria-label="시간별 사용량">
      <div className="member-dashboard-panel-heading">
        <h2>시간별 사용량</h2>
        <p>24시간 예상 사용량과 태양광 발전량을 단순 시나리오로 비교합니다.</p>
      </div>

      <div className="member-dashboard-hourly-list">
        {rows.map((row) => (
          <div className="member-dashboard-hourly-row" key={row.hour}>
            <strong>{String(row.hour).padStart(2, '0')}시</strong>
            <div className="member-dashboard-hourly-bars">
              <span className="is-usage" style={{ width: `${Math.max(8, row.usagePercent)}%` }}>
                {formatKwh(row.usageKwh)}
              </span>
              <span className="is-generation" style={{ width: `${Math.max(0, row.generationPercent)}%` }}>
                {row.generationKwh > 0 ? formatKwh(row.generationKwh) : ''}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function MonthlyUsagePanel({ dashboardData }: { dashboardData: NormalizedDashboardData }) {
  const maxGeneration = Math.max(...dashboardData.solar.monthlyGenerationKwh, 1);

  return (
    <section className="member-dashboard-generation-panel" aria-label="월별 사용량">
      <div className="member-dashboard-panel-heading">
        <h2>월별 사용량</h2>
        <p>선택 건물 분석값 또는 데모 산식 기반 월별 발전량/사용량 예상입니다.</p>
      </div>

      <div className="member-dashboard-monthly-list">
        {dashboardData.solar.monthlyGenerationKwh.map((generationKwh, index) => {
          const month = index + 1;
          const usageKwh = getMonthlyUsageEstimate(dashboardData, index, generationKwh);
          const maxValue = Math.max(maxGeneration, usageKwh, 1);

          return (
            <div className="member-dashboard-monthly-row" key={month}>
              <strong>{month}월</strong>
              <div className="member-dashboard-monthly-bars">
                <span className="is-generation" style={{ width: `${Math.max(8, (generationKwh / maxValue) * 100)}%` }}>
                  발전 {formatKwh(generationKwh)}
                </span>
                <span className="is-usage" style={{ width: `${Math.max(8, (usageKwh / maxValue) * 100)}%` }}>
                  사용 {formatKwh(usageKwh)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PatternAnalysisPanel({ dashboardData }: { dashboardData: NormalizedDashboardData }) {
  const annualGeneration = dashboardData.solar.annualGenerationKwh;
  const monthlyAverage = annualGeneration / 12;
  const bestMonthIndex = dashboardData.solar.monthlyGenerationKwh.indexOf(Math.max(...dashboardData.solar.monthlyGenerationKwh));

  return (
    <section className="member-dashboard-generation-panel" aria-label="패턴분석">
      <div className="member-dashboard-panel-heading">
        <h2>패턴분석</h2>
        <p>AI처럼 보이는 실시간 분석이 아니라, 저장된 분석값과 고정 규칙으로 만든 설명 가능한 데모 요약입니다.</p>
      </div>

      <div className="member-dashboard-pattern-grid">
        <article>
          <strong>오전/오후 사용량이 높습니다.</strong>
          <p>공동주택 공용부 사용 패턴을 가정한 데모 시나리오에서 출근 전후와 저녁 시간대 사용량이 높게 표시됩니다.</p>
        </article>
        <article>
          <strong>태양광 발전 시간대와 자가소비 시간이 일부 일치합니다.</strong>
          <p>10시부터 15시까지 발전량이 높아 공용부 부하 일부를 상쇄할 가능성이 있습니다.</p>
        </article>
        <article>
          <strong>{bestMonthIndex + 1}월 발전량이 가장 높게 추정됩니다.</strong>
          <p>월평균 예상 발전량은 {formatKwh(monthlyAverage)}이며, 계절과 음영 조건에 따라 실제 값은 달라질 수 있습니다.</p>
        </article>
      </div>
    </section>
  );
}

function MemberAsPanel() {
  const [openFaqIndex, setOpenFaqIndex] = useState(0);
  const [isAsFormOpen, setIsAsFormOpen] = useState(false);
  const [asSymptom, setAsSymptom] = useState('');

  const handleToggleFaq = (index: number) => {
    setOpenFaqIndex((prevIndex) => (prevIndex === index ? -1 : index));
  };

  const handleSaveAsRequest = () => {
    const selectedIssue = faqItems[openFaqIndex]?.question ?? '선택 안 함';
    const draft = {
      type: 'A/S',
      selectedIssue,
      symptom: asSymptom.trim(),
      createdAt: new Date().toISOString(),
    };

    sessionStorage.setItem('solarmate:asRequestDraft', JSON.stringify(draft));
    window.alert('A/S 접수가 저장되었습니다. 실제 접수 연동은 추후 구현 예정입니다.');
  };

  const handleChatbotClick = () => {
    window.alert('챗봇 상담은 추후 구현 예정입니다.');
  };

  return (
    <section className="member-dashboard-as-panel" aria-labelledby="member-dashboard-as-title">
      <section className="member-dashboard-as-hero">
        <div className="member-dashboard-as-hero-copy">
          <h1 id="member-dashboard-as-title">A/S 도움이 필요하신가요?</h1>
          <p>문제를 선택하고 빠르게 접수하세요</p>
        </div>

        <img className="member-dashboard-as-hero-image" src="/assets/support/as-headset.png" alt="A/S 상담 헤드셋" />
      </section>

      <section className="member-dashboard-as-faq-section" aria-labelledby="member-dashboard-as-faq-title">
        <h2 id="member-dashboard-as-faq-title">A/S 자주 묻는 문제</h2>

        <div className="member-dashboard-as-faq-list">
          {faqItems.map((item, index) => {
            const isOpen = openFaqIndex === index;

            return (
              <article className={`member-dashboard-as-faq-item ${isOpen ? 'is-open' : ''}`} key={item.question}>
                <button
                  className="member-dashboard-as-faq-question"
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={`member-dashboard-as-answer-${index}`}
                  onClick={() => handleToggleFaq(index)}
                >
                  <span>{item.question}</span>
                  {isOpen ? <LuChevronUp aria-hidden="true" /> : <LuChevronDown aria-hidden="true" />}
                </button>

                {isOpen && (
                  <p className="member-dashboard-as-faq-answer" id={`member-dashboard-as-answer-${index}`}>
                    {item.answer}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className="member-dashboard-as-action-row" aria-label="A/S 상담 액션">
        <button className="member-dashboard-as-primary-action" type="button" onClick={() => setIsAsFormOpen((isOpen) => !isOpen)}>
          <LuCirclePlus aria-hidden="true" />
          A/S 접수하기
        </button>

        <button className="member-dashboard-as-outline-action" type="button" onClick={handleChatbotClick}>
          <LuBotMessageSquare aria-hidden="true" />
          챗봇
        </button>
      </section>

      {isAsFormOpen && (
        <section className="member-dashboard-as-request-form" aria-label="A/S 접수 입력">
          <div>
            <strong>회원정보 확인</strong>
            <p>데모 회원 정보와 선택 건물 기준으로 임시 접수합니다.</p>
          </div>

          <label htmlFor="member-dashboard-as-symptom">
            증상 입력
            <textarea
              id="member-dashboard-as-symptom"
              value={asSymptom}
              placeholder="예: 최근 발전량이 평소보다 줄었어요."
              onChange={(event) => setAsSymptom(event.target.value)}
            />
          </label>

          <button type="button" onClick={handleSaveAsRequest}>
            접수하기
          </button>
        </section>
      )}
    </section>
  );
}

function MemberProfilePanel({ data }: { data: NormalizedDashboardData }) {
  const initialProfileValues = useMemo(() => getInitialProfileValues(), []);
  const [profileValues, setProfileValues] = useState<ProfileValues>(initialProfileValues);
  const address = data.building;

  const updateProfileValue = (name: keyof ProfileValues, value: string) => {
    setProfileValues((prevValues) => ({
      ...prevValues,
      [name]: value,
    }));
  };

  return (
    <section className="member-dashboard-profile-panel" aria-labelledby="member-dashboard-profile-title">
      <section className="member-dashboard-profile-address-box" aria-label="선택 주소 요약">
        <div className="member-dashboard-profile-address-row">
          <span aria-hidden="true">•</span>
          <strong>도로명주소</strong>
          <p>{address.roadAddress}</p>
        </div>

        <div className="member-dashboard-profile-address-row">
          <span aria-hidden="true">•</span>
          <strong>지번</strong>
          <p>{address.jibunAddress}</p>
        </div>
      </section>

      <section className="member-dashboard-profile-hero">
        <div className="member-dashboard-profile-hero-text">
          <h1 id="member-dashboard-profile-title">회원정보 관리</h1>
          <p>내 정보를 확인하고 필요한 항목을 수정하세요</p>
        </div>

        <ProfileHeroGraphic />
      </section>

      <form className="member-dashboard-profile-form" onSubmit={(event) => event.preventDefault()}>
        {profileFields.map((field) => {
          const fieldName = field.name;

          return (
            <ProfileRow
              key={field.id}
              field={field}
              value={fieldName ? profileValues[fieldName] : ''}
              onChange={fieldName ? (value) => updateProfileValue(fieldName, value) : undefined}
            />
          );
        })}

        <div className="member-dashboard-profile-row">
          <span className="member-dashboard-profile-label">간편로그인 연동</span>

          <button
            className="member-dashboard-profile-naver-button"
            type="button"
            aria-label="네이버 간편로그인 연동"
            onClick={() => window.alert('네이버 간편로그인 연동은 추후 구현 예정입니다.')}
          >
            <span aria-hidden="true">N</span>
            네이버
          </button>
        </div>
      </form>
    </section>
  );
}

function ProfileHeroGraphic() {
  return (
    <div className="member-dashboard-profile-hero-graphic" aria-hidden="true">
      <div className="member-dashboard-profile-id-card">
        <span />
        <i />
        <i />
      </div>

      <div className="member-dashboard-profile-circle">
        <span />
        <strong />
      </div>

      <div className="member-dashboard-profile-shield">✓</div>
    </div>
  );
}

function ProfileRow({
  field,
  value,
  onChange,
}: {
  field: ProfileField;
  value: string;
  onChange?: (value: string) => void;
}) {
  const inputId = `member-dashboard-profile-${field.id}`;

  return (
    <div className="member-dashboard-profile-row">
      {field.name ? (
        <label className="member-dashboard-profile-label" htmlFor={inputId}>
          {field.label}
        </label>
      ) : (
        <span className="member-dashboard-profile-label">{field.label}</span>
      )}

      <div className={`member-dashboard-profile-field-group ${field.buttonText ? 'has-button' : ''}`}>
        {field.name && (
          <input
            id={inputId}
            className="member-dashboard-profile-input"
            name={field.name}
            type="text"
            value={value}
            onChange={(event) => onChange?.(event.target.value)}
          />
        )}

        {field.buttonText && (
          <button
            className="member-dashboard-profile-change-button"
            type="button"
            aria-label={`${field.label} 변경`}
            onClick={showDemoChangeAlert}
          >
            {field.buttonText}
          </button>
        )}
      </div>
    </div>
  );
}

function DashboardSummary({ data }: { data: NormalizedDashboardData }) {
  const sourceLabel = getDashboardSourceLabel(data);
  const summaryItems = [
    ['연간 발전 예상', formatKwh(data.solar.annualGenerationKwh)],
    ['설치용량', formatKw(data.solar.installCapacityKw)],
    ['예상 패널 수', `${data.solar.panelCount.toLocaleString('ko-KR')}개`],
    ['연간 절감 예상', formatKrw(data.solar.annualSavingKrw)],
  ];

  return (
    <section className="member-dashboard-data-strip" aria-label="선택 건물 분석 요약">
      <div className="member-dashboard-address-summary">
        <span>도로명주소</span>
        <strong>{data.building.roadAddress}</strong>
        <small>{data.building.jibunAddress}</small>
      </div>

      <div className="member-dashboard-source-summary">
        <span>데이터 기준</span>
        <strong>{sourceLabel}</strong>
        {data.building.buildingId && <small>건물 ID {data.building.buildingId}</small>}
      </div>

      {summaryItems.map(([label, value]) => (
        <div className="member-dashboard-metric-summary" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </section>
  );
}

function ScenarioMeterCard({ card }: { card: ScenarioDayCard }) {
  return (
    <article className="member-dashboard-meter-card" aria-label={`${card.month}월 ${card.sourceLabel}`}>
      <div className="member-dashboard-meter-top">
        <button type="button" aria-label={`${card.date} 이전 시나리오`}>
          ‹
        </button>
        <div className="member-dashboard-date-box">{card.date}</div>
        <span className="member-dashboard-target-icon" aria-hidden="true">
          ◎
        </span>
        <div className="member-dashboard-day-box">{card.day}</div>
        <button type="button" aria-label={`${card.date} 다음 시나리오`}>
          ›
        </button>
      </div>

      <RadialMeter card={card} />
      <RadialChartLegend />

      <div className="member-dashboard-meter-meta">
        <div className="member-dashboard-stage-line">
          <span className={`member-dashboard-stage-dot is-${card.stageColor}`} aria-hidden="true" />
          <p>{card.stage}</p>
        </div>

        <div className="member-dashboard-weather-line">
          <span aria-hidden="true">☀</span>
          <p>{card.temp}</p>
        </div>
      </div>

      <p className="member-dashboard-card-source">{card.sourceLabel}</p>

      <div className={`member-dashboard-usage-box ${card.id === 3 ? 'is-mixed' : ''}`}>
        {card.bars.map((bar, index) => (
          <ProgressRow key={`${card.id}-${bar.group ?? 'single'}-${bar.label}-${index}`} bar={bar} />
        ))}
      </div>
    </article>
  );
}

function RadialMeter({ card }: { card: ScenarioDayCard }) {
  const shouldShowGenerationSegments = card.dailyGenerationKwh > 0;
  const generationOpacity = Math.min(1, 0.42 + card.visualGenerationRatio * 0.58);

  return (
    <div className="member-dashboard-radial-area">
      <svg className="member-dashboard-radial-svg" viewBox="0 0 260 260" role="img" aria-label={`${card.month}월 대표일 시간대별 시나리오 그래프`}>
        <circle className="member-dashboard-outer-ring" cx="130" cy="130" r="115" />
        <circle className="member-dashboard-middle-ring" cx="130" cy="130" r="88" />

        {card.segments.map((segment, index) => {
          const angle = index * 15 - 90;
          const inner = 56;
          const outer = 56 + segment.usagePercent * 0.68;
          const start = polarToCartesian(130, 130, inner, angle);
          const end = polarToCartesian(130, 130, outer, angle);
          const style = {
            '--segment-color': getUsageSegmentColor(segment.usagePercent),
          } as CSSProperties;

          return (
            <line
              key={`${card.id}-usage-segment-${segment.hour}`}
              className="member-dashboard-radial-segment"
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              style={style}
            />
          );
        })}

        {shouldShowGenerationSegments &&
          card.segments.map((segment, index) => {
            if (segment.generationPercent <= 0) {
              return null;
            }

            const angle = index * 15 - 90;
            const inner = 56;
            const generationVisualPercent = Math.max(16, segment.generationPercent * card.visualGenerationRatio);
            const outer = 56 + generationVisualPercent * 0.68;
            const start = polarToCartesian(130, 130, inner, angle);
            const end = polarToCartesian(130, 130, outer, angle);
            const style = {
              '--generation-opacity': generationOpacity,
            } as CSSProperties;

            return (
              <line
                key={`${card.id}-generation-segment-${segment.hour}`}
                className="member-dashboard-radial-segment is-generation"
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
                style={style}
              />
            );
          })}

        <circle className="member-dashboard-center-hole" cx="130" cy="130" r="54" />

        <text className="member-dashboard-time-label is-top" x="130" y="22">
          24시
        </text>
        <text className="member-dashboard-time-label is-right-top" x="205" y="52">
          3시
        </text>
        <text className="member-dashboard-time-label is-right" x="238" y="132">
          6시
        </text>
        <text className="member-dashboard-time-label is-right-bottom" x="210" y="210">
          9시
        </text>
        <text className="member-dashboard-time-label is-bottom" x="130" y="251">
          12시
        </text>
        <text className="member-dashboard-time-label is-left-bottom" x="51" y="210">
          15시
        </text>
        <text className="member-dashboard-time-label is-left" x="18" y="132">
          18시
        </text>
        <text className="member-dashboard-time-label is-left-top" x="56" y="52">
          21시
        </text>
      </svg>

      <div className="member-dashboard-radial-center">
        <p>일 사용량</p>
        <strong>{formatKwh(card.dailyUsageKwh)}</strong>
        <span>({formatKrw(card.dailyBillKrw)})</span>
        <p className="member-dashboard-generation-label">일 발전량</p>
        <strong className="member-dashboard-generation-value">{formatKwh(card.dailyGenerationKwh)}</strong>
      </div>

      <div className="member-dashboard-number-badge">{card.id}</div>
      <div className="member-dashboard-tooltip">{card.tooltip}</div>
    </div>
  );
}

function RadialChartLegend() {
  return (
    <div className="member-dashboard-radial-legend" aria-label="방사형 차트 범례">
      <span>
        <i className="is-usage" aria-hidden="true" />
        노랑/주황: 예상 전기 사용량
      </span>
      <span>
        <i className="is-generation" aria-hidden="true" />
        파랑: 예상 태양광 발전량
      </span>
    </div>
  );
}

function ProgressRow({ bar }: { bar: ScenarioComparisonBar }) {
  const fillStyle = { width: `${bar.percent}%` };

  return (
    <div className="member-dashboard-progress-row">
      {bar.group ? (
        <div className="member-dashboard-progress-label-combo">
          <span className={`member-dashboard-side-label is-${bar.color}`}>{bar.group}</span>
          <strong>{bar.label}</strong>
        </div>
      ) : (
        <strong className="member-dashboard-progress-label">{bar.label}</strong>
      )}

      <div className="member-dashboard-progress-track">
        <span className={`member-dashboard-progress-fill is-${bar.color}`} style={fillStyle}>
          {bar.cost ?? ''}
        </span>
      </div>

      <em>{bar.value}</em>
    </div>
  );
}

function getDashboardSourceLabel(data: NormalizedDashboardData) {
  if (data.source === 'climate-live-hybrid') {
    return 'climate.gg live hybrid 분석';
  }

  if (data.source === 'pv-analysis') {
    return 'PV 분석 저장 결과';
  }

  return data.isFallbackDemo ? '데모 대시보드 데이터' : '선택 건물 추정 시나리오';
}

function parseDashboardTab(tab: string | null): DashboardTab | null {
  if (tab === 'as' || tab === 'profile' || tab === 'generation') {
    return tab;
  }

  return null;
}

function getMonthlyUsageEstimate(data: NormalizedDashboardData, monthIndex: number, generationKwh: number) {
  const monthlyElectricityKwh = data.solar.monthlyElectricityKwh;

  if (Array.isArray(monthlyElectricityKwh)) {
    return Math.max(0, monthlyElectricityKwh[monthIndex] ?? generationKwh * 1.35);
  }

  if (typeof monthlyElectricityKwh === 'number' && Number.isFinite(monthlyElectricityKwh)) {
    return Math.max(0, monthlyElectricityKwh);
  }

  return Math.max(0, generationKwh * 1.35 + 420);
}

function hasSelectedSimulationResultInSession() {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.sessionStorage.getItem(SELECTED_SIMULATION_RESULT_STORAGE_KEY) !== null;
}

function pickText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readConsultationInquiryFromSession() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const rawValue =
      window.sessionStorage.getItem(SERVICE_CONSULTATION_INQUIRY_STORAGE_KEY) ??
      window.sessionStorage.getItem(CONSULTATION_INQUIRY_STORAGE_KEY);

    if (!rawValue) {
      return null;
    }

    const parsedValue = JSON.parse(rawValue) as StoredConsultationInquiry;

    return parsedValue && typeof parsedValue === 'object' ? parsedValue : null;
  } catch {
    return null;
  }
}

function getInitialProfileValues(): ProfileValues {
  const inquiry = readConsultationInquiryFromSession();

  return {
    name: pickText(inquiry?.name) ?? fallbackProfileValues.name,
    birthDate: fallbackProfileValues.birthDate,
    phone: pickText(inquiry?.contact) ?? pickText(inquiry?.phone) ?? fallbackProfileValues.phone,
    email: pickText(inquiry?.email) ?? fallbackProfileValues.email,
  };
}

function showDemoChangeAlert() {
  window.alert('데모 화면에서는 실제 정보 변경이 저장되지 않습니다.');
}

function polarToCartesian(cx: number, cy: number, r: number, angle: number) {
  const radian = (angle * Math.PI) / 180;

  return {
    x: cx + r * Math.cos(radian),
    y: cy + r * Math.sin(radian),
  };
}

function getUsageSegmentColor(value: number) {
  if (value >= 84) {
    return '#ff5a00';
  }

  if (value >= 62) {
    return '#ffc400';
  }

  if (value >= 46) {
    return '#ffe58a';
  }

  return '#e8f2dc';
}
