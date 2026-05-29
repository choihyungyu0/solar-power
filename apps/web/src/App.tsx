import { useEffect, useState, type FocusEvent, type FormEvent } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import {
  LuArrowRight,
  LuBot,
  LuBuilding2,
  LuCircleCheck,
  LuFileText,
  LuFileSearch,
  LuMapPin,
  LuMenu,
  LuMessageCircle,
  LuPhone,
  LuSunMedium,
} from 'react-icons/lu';
import SolarMateHeader from './components/SolarMateHeader';
import { saveLandingAddressDraft } from './lib/addressDraft';
import AdminConsultationsPage from './pages/AdminConsultationsPage';
import ConsultationCompletePage from './pages/ConsultationCompletePage';
import ConsultationPage from './pages/ConsultationPage';
import LoginPage from './pages/LoginPage';
import MemberDashboardPage from './pages/MemberDashboardPage';
import MemberNoInstallationPage from './pages/MemberNoInstallationPage';
import NoticePage from './pages/NoticePage';
import RiskMapPage from './pages/RiskMapPage';
import SolarAdoptionPage from './pages/SolarAdoptionPage';
import {
  SolarAdoptionCompletePage,
  SolarAdoptionStep1Page,
  SolarAdoptionStep2Page,
  SolarAdoptionStep3Page,
  SolarAdoptionStep4Page,
} from './pages/SolarAdoptionFlowPages';
import SimulationResultPage from './pages/SimulationResultPage';
import SimulationSetupPage from './pages/SimulationSetupPage';

const heroAddressExamples = [
  {
    label: '동탄 공동주택 예시',
    address: '경기도 화성시 동탄구 반송동 88-12',
    meta: '기본 데모 주소',
  },
  {
    label: '수원 아파트 예시',
    address: '경기도 수원시 팔달구 경수대로 464',
    meta: '도심형 공동주택',
  },
  {
    label: '성남 아파트 예시',
    address: '경기도 성남시 분당구 판교역로 166',
    meta: '업무지구 인근',
  },
  {
    label: '고양 아파트 예시',
    address: '경기도 고양시 일산동구 중앙로 1275',
    meta: '대단지 검토 예시',
  },
];

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/risk-map" element={<RiskMapPage />} />
      <Route path="/simulation/setup" element={<SimulationSetupPage />} />
      <Route path="/simulation/result" element={<SimulationResultPage view="detail" />} />
      <Route path="/simulation/profit-report" element={<SimulationResultPage view="profit" />} />
      <Route path="/simulation/ai-suitability" element={<Navigate to="/simulation/profit-report" replace />} />
      <Route path="/solar-adoption" element={<HomePage />} />
      <Route path="/solar-adoption/step-1" element={<SolarAdoptionStep1Page />} />
      <Route path="/solar-adoption/step-2" element={<SolarAdoptionStep2Page />} />
      <Route path="/solar-adoption/step-3" element={<SolarAdoptionStep3Page />} />
      <Route path="/solar-adoption/step-4" element={<SolarAdoptionStep4Page />} />
      <Route path="/solar-adoption/complete" element={<SolarAdoptionCompletePage />} />
      <Route path="/service" element={<SolarAdoptionPage />} />
      <Route path="/notice" element={<NoticePage />} />
      <Route path="/consultation" element={<ConsultationPage />} />
      <Route path="/consultation/complete" element={<ConsultationCompletePage />} />
      <Route path="/admin/consultations" element={<AdminConsultationsPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/member/dashboard" element={<MemberDashboardPage />} />
      <Route path="/member/no-installation" element={<MemberNoInstallationPage />} />
      <Route path="/member/as" element={<Navigate to="/member/dashboard?tab=as" replace />} />
      <Route path="/member/profile" element={<Navigate to="/member/dashboard?tab=profile" replace />} />
      <Route path="/customer-center" element={<Navigate to="/member/dashboard?tab=as" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function HomePage() {
  const navigate = useNavigate();
  const [heroAddress, setHeroAddress] = useState('');
  const [isHeroAddressExamplesOpen, setIsHeroAddressExamplesOpen] = useState(false);
  const [isHeaderScrolled, setIsHeaderScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsHeaderScrolled(window.scrollY > 20);
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleHeroAddressSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const savedDraft = saveLandingAddressDraft(heroAddress || '경기도 화성시 동탄구 반송동 88-12', 'landing-hero');

    if (!savedDraft) {
      window.alert('주소를 입력해 주세요.');
      return;
    }

    navigate('/risk-map');
  };

  const handleHeroAddressBlur = (event: FocusEvent<HTMLFormElement>) => {
    const nextFocusedElement = event.relatedTarget as Node | null;

    if (nextFocusedElement && event.currentTarget.contains(nextFocusedElement)) {
      return;
    }

    setIsHeroAddressExamplesOpen(false);
  };

  const handleHeroAddressExampleSelect = (address: string) => {
    setHeroAddress(address);
    setIsHeroAddressExamplesOpen(false);
  };

  const handleHeroScrollHintClick = () => {
    document.getElementById('solsol-cases-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const caseCards = [
    {
      tone: 'blue',
      icon: <LuBot />,
      label: '사용자 테스트 후기',
      quote: '복잡할 줄 알았는데, 단계별로 안내가 잘 되어 이해하기 쉬웠어요.',
      name: '김ㅇㅇ 님',
      saving: '1,120,000원',
      point: '경제성',
    },
    {
      tone: 'green',
      icon: <LuBuilding2 />,
      label: '도입 사례 예시',
      quote: '보조금 조건을 자동으로 매칭해줘서 신청 준비가 훨씬 빨라졌어요.',
      name: '이ㅇㅇ 님',
      saving: '980,000원',
      point: '신속한 진행',
    },
    {
      tone: 'orange',
      icon: <LuFileSearch />,
      label: '파일럿 피드백',
      quote: '정보가 투명하게 정리되어 있어 의사결정에 큰 도움이 되었습니다.',
      name: '박ㅇㅇ 님',
      saving: '1,350,000원',
      point: '정보 투명성',
    },
  ];

  const trustItems = ['정확한 비용 예측', '맞춤형 설계 제안', '전문 시공 & 사후관리'];

  return (
    <main className="pageShell solsolLanding">
      <section className="solsolHero" aria-labelledby="solsol-hero-title">
        <SolarMateHeader appearance="hero" isScrolled={isHeaderScrolled} />
        <button className="solsolMobileMenuButton" type="button" onClick={() => navigate('/service')} aria-label="메뉴 보기">
          <LuMenu aria-hidden="true" />
        </button>

        <div className="solsolHeroContent">
          <p className="solsolHeroEyebrow">우리 아파트 태양광 설치하기</p>
          <h1 id="solsol-hero-title">
            지역별 차등
            <br />
            <span className="solsolHeroGradientText">전기요금제</span>가
            <br />
            걱정된다면?
          </h1>
          <p className="solsolHeroLead">
            경기도 아파트 주소를 입력하면
            <br />
            설치 가능 여부와 예상 절감액을 바로 확인해드려요.
          </p>

          <button className="solsolCheckLink" type="button" onClick={() => navigate('/solar-adoption/step-1')}>
            <span className="solsolCheckText">무료 진단으로 예상 절감액 보기</span>
            <span className="solsolCheckIcon" aria-hidden="true">
              <LuArrowRight />
            </span>
          </button>

          <form
            className={`solsolSearchForm${isHeroAddressExamplesOpen ? ' isExamplesOpen' : ''}`}
            onSubmit={handleHeroAddressSubmit}
            onBlur={handleHeroAddressBlur}
            aria-label="태양광 설치 주소 입력"
          >
            <label className="solsolSearchField" htmlFor="solsol-hero-address">
              <span className="solsolSearchFieldLabel">아파트 주소</span>
              <span className="solsolSearchInputRow">
                <LuMapPin aria-hidden="true" />
                <input
                  id="solsol-hero-address"
                  type="text"
                  aria-label="아파트 주소"
                  aria-expanded={isHeroAddressExamplesOpen}
                  aria-controls="solsol-address-examples"
                  value={heroAddress}
                  placeholder="예: 경기도 화성시 동탄구 반송동 88-12"
                  onFocus={() => setIsHeroAddressExamplesOpen(true)}
                  onClick={() => setIsHeroAddressExamplesOpen(true)}
                  onChange={(event) => {
                    setHeroAddress(event.target.value);
                    setIsHeroAddressExamplesOpen(true);
                  }}
                />
              </span>
            </label>
            {isHeroAddressExamplesOpen && (
              <div id="solsol-address-examples" className="solsolAddressExamples" aria-label="주소 예시">
                <div className="solsolAddressExamplesHeader">주소 예시</div>
                {heroAddressExamples.map((example) => (
                  <button
                    key={example.address}
                    className="solsolAddressExampleButton"
                    type="button"
                    aria-pressed={heroAddress === example.address}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => handleHeroAddressExampleSelect(example.address)}
                  >
                    <strong>{example.label}</strong>
                    <span>{example.address}</span>
                    <em>{example.meta}</em>
                  </button>
                ))}
              </div>
            )}
            <button className="solsolSearchButton" type="submit">
              <LuSunMedium aria-hidden="true" />
              <span className="solsolSearchButtonCopy">
                <strong>우리집 태양광 진단하기</strong>
                <small>무료 · 30초 확인</small>
              </span>
            </button>
          </form>

          <ul className="solsolTrustList" aria-label="쏠쏠햇 서비스 강점">
            {trustItems.map((item) => (
              <li key={item}>
                <LuCircleCheck aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>

          <button className="solsolHeroScrollHint" type="button" onClick={handleHeroScrollHintClick}>
            아래에서 도입 사례 시뮬레이션을 확인해보세요
            <LuArrowRight aria-hidden="true" />
          </button>
        </div>

        <aside className="solsolQuickBar" aria-label="빠른 상담 메뉴">
          <div className="solsolQuickBrand">
            <img src="/assets/logo.png" alt="" aria-hidden="true" />
            <span>빠른 상담</span>
          </div>
          <button type="button" onClick={() => navigate('/consultation')}>
            <span>
              <LuPhone aria-hidden="true" />
            </span>
            설치문의
          </button>
          <button type="button" onClick={() => navigate('/consultation')}>
            <span>
              <LuMessageCircle aria-hidden="true" />
            </span>
            상담톡
          </button>
          <button type="button" onClick={() => navigate('/service')}>
            <span>
              <LuFileText aria-hidden="true" />
            </span>
            사례보기
          </button>
          <button type="button" onClick={() => navigate('/consultation')}>
            <span>
              <LuMapPin aria-hidden="true" />
            </span>
            오시는 길
          </button>
          <div className="solsolQuickPhone">
            <small>고객센터</small>
            <strong>1544<br />1234</strong>
          </div>
        </aside>

        <button className="solsolFloatingChat" type="button" onClick={() => navigate('/consultation')}>
          <LuMessageCircle aria-hidden="true" />
          빠른 상담
        </button>

        <button className="solsolBottomConsult" type="button" onClick={() => navigate('/consultation')}>
          <span className="solsolBottomConsultIcon" aria-hidden="true">
            <LuPhone />
          </span>
          <span className="solsolBottomConsultCopy">
            <strong>무료 상담하기</strong>
            <small>전문 상담사가 빠르게 도와드려요</small>
          </span>
          <LuArrowRight className="solsolBottomConsultArrow" aria-hidden="true" />
        </button>
      </section>

      <section className="solsolCases" aria-labelledby="solsol-cases-title">
        <div className="solsolCasesTop">
          <h2 id="solsol-cases-title">도입 시뮬레이션 후기</h2>
          <p>후기는 실제 고객 후기가 아닌 서비스 화면 예시 문구입니다.</p>
        </div>

        <div className="solsolCaseGrid">
          {caseCards.map((card) => (
            <article className={`solsolCaseCard ${card.tone}`} key={card.label}>
              <span className="solsolCaseIcon" aria-hidden="true">
                {card.icon}
              </span>
              <div className="solsolCaseBody">
                <span className="solsolCaseLabel">{card.label}</span>
                <blockquote>“ {card.quote} ”</blockquote>
                <strong className="solsolCaseName">{card.name}</strong>
                <div className="solsolCaseStats">
                  <div>
                    <span>예상 연간 절감액</span>
                    <strong>{card.saving}</strong>
                  </div>
                  <div>
                    <span>만족 포인트</span>
                    <em>{card.point}</em>
                  </div>
                </div>
              </div>
              <button
                className="solsolCaseArrow"
                type="button"
                onClick={() => navigate('/service')}
                aria-label={`${card.label} 자세히 보기`}
              >
                <LuArrowRight aria-hidden="true" />
              </button>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

export default App;
