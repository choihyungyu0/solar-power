import { useState, type FormEvent } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import {
  LuArrowRight,
  LuFileText,
  LuMapPin,
  LuMenu,
  LuMessageCircle,
  LuPhone,
  LuSunMedium,
} from 'react-icons/lu';
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

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/risk-map" element={<RiskMapPage />} />
      <Route path="/simulation/setup" element={<SimulationSetupPage />} />
      <Route path="/simulation/result" element={<SimulationResultPage view="detail" />} />
      <Route path="/simulation/profit-report" element={<SimulationResultPage view="profit" />} />
      <Route path="/simulation/ai-suitability" element={<SimulationResultPage view="suitability" />} />
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
  const [heroAddress, setHeroAddress] = useState('경기도 화성시 동탄구 반송동 88-12');

  const handleHeroAddressSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const savedDraft = saveLandingAddressDraft(heroAddress || '경기도 화성시 동탄구 반송동 88-12', 'landing-hero');

    if (!savedDraft) {
      window.alert('주소를 입력해 주세요.');
      return;
    }

    navigate('/risk-map');
  };

  const caseCards = [
    {
      tone: 'blue',
      label: '사용자 테스트 후기',
      quote: '복잡할 줄 알았는데, 단계별로 안내가 잘 되어 이해하기 쉬웠어요.',
      name: '김ㅇㅇ 님',
      saving: '1,120,000원',
      point: '경제성',
    },
    {
      tone: 'green',
      label: '도입 사례 예시',
      quote: '보조금 조건을 자동으로 매칭해줘서 신청 준비가 훨씬 빨라졌어요.',
      name: '이ㅇㅇ 님',
      saving: '980,000원',
      point: '신속한 진행',
    },
    {
      tone: 'orange',
      label: '파일럿 피드백',
      quote: '정보가 투명하게 정리되어 있어 의사결정에 큰 도움이 되었습니다.',
      name: '박ㅇㅇ 님',
      saving: '1,350,000원',
      point: '정보 투명성',
    },
  ];

  return (
    <main className="pageShell solsolLanding">
      <section className="solsolHero" aria-labelledby="solsol-hero-title">
        <header className="solsolHeader" aria-label="쏠쏠햇 상단 메뉴">
          <button className="solsolLogoButton" type="button" onClick={() => navigate('/')}>
            <img src="/assets/logo.png" alt="쏠쏠햇" />
          </button>
          <nav className="solsolNav" aria-label="주요 메뉴">
            <button className="isActive" type="button" onClick={() => navigate('/solar-adoption')}>
              태양광 도입
            </button>
            <button type="button" onClick={() => navigate('/service')}>
              서비스 소개
            </button>
            <button type="button" onClick={() => navigate('/notice')}>
              공지사항
            </button>
            <button type="button" onClick={() => navigate('/consultation')}>
              상담하기
            </button>
          </nav>
          <div className="solsolHeaderActions">
            <button className="solsolSignupButton" type="button" onClick={() => navigate('/login?mode=signup')}>
              <span className="solsolAuthArrow" aria-hidden="true">
                <LuArrowRight />
              </span>
              회원가입
            </button>
            <button className="solsolLoginButton" type="button" onClick={() => navigate('/login?mode=login')}>
              <span className="solsolAuthArrow" aria-hidden="true">
                <LuArrowRight />
              </span>
              로그인
            </button>
            <button className="solsolMenuButton" type="button" onClick={() => navigate('/service')} aria-label="메뉴 열기">
              <LuMenu />
            </button>
          </div>
        </header>

        <div className="solsolHeroContent">
          <h1 id="solsol-hero-title">
            지역별 차등
            <br />
            전기요금제가
            <br />
            걱정된다면?
          </h1>

          <button className="solsolCheckLink" type="button" onClick={() => navigate('/solar-adoption/step-1')}>
            태양광 설치 확인하기
            <span aria-hidden="true">
              <LuArrowRight />
            </span>
          </button>

          <form className="solsolSearchForm" onSubmit={handleHeroAddressSubmit} aria-label="태양광 설치 주소 입력">
            <label className="solsolSearchField">
              <LuMapPin aria-hidden="true" />
              <input
                aria-label="아파트 주소"
                value={heroAddress}
                placeholder="주소를 입력하여 예상 발전량과 비용을 확인해 보세요"
                onChange={(event) => setHeroAddress(event.target.value)}
              />
            </label>
            <button className="solsolSearchButton" type="submit">
              <LuSunMedium aria-hidden="true" />
              <span>우리 아파트</span>
              태양광 설치하기
            </button>
          </form>
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
            <strong>1544<br />5579</strong>
          </div>
        </aside>

        <button className="solsolFloatingChat" type="button" onClick={() => navigate('/consultation')}>
          <LuMessageCircle aria-hidden="true" />
          상담하기
        </button>
      </section>

      <section className="solsolCases" aria-labelledby="solsol-cases-title">
        <div className="solsolCasesTop">
          <h2 id="solsol-cases-title">도입 사례 시뮬레이션</h2>
          <p>후기는 실제 고객 후기가 아닌 서비스 화면 예시 문구입니다.</p>
        </div>

        <div className="solsolCaseGrid">
          {caseCards.map((card) => (
            <article className={`solsolCaseCard ${card.tone}`} key={card.label}>
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
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

export default App;
