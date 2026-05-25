import { useEffect, useState, type FormEvent } from 'react';
import { LuSearch } from 'react-icons/lu';
import SafeLocalImage from './components/SafeLocalImage';
import ServiceIntroSection from './components/ServiceIntroSection';
import { readLandingAddressText, saveLandingAddressDraft } from './lib/addressDraft';
import ConsultationCompletePage from './pages/ConsultationCompletePage';
import ConsultationPage from './pages/ConsultationPage';
import LoginPage from './pages/LoginPage';
import MemberDashboardPage from './pages/MemberDashboardPage';
import NoticePage from './pages/NoticePage';
import RiskMapPage from './pages/RiskMapPage';
import SolarAdoptionPage from './pages/SolarAdoptionPage';
import SimulationResultPage from './pages/SimulationResultPage';
import SimulationSetupPage from './pages/SimulationSetupPage';

function App() {
  const pathname = window.location.pathname.replace(/\/$/, '') || '/';
  const [heroAddress, setHeroAddress] = useState(() => readLandingAddressText());
  const isRiskMapPage = pathname === '/risk-map';
  const isSimulationSetupPage = pathname === '/simulation/setup';
  const isSimulationResultPage = pathname === '/simulation/result';
  const isConsultationPage = pathname === '/consultation';
  const isConsultationCompletePage = pathname === '/consultation/complete';
  const isSolarAdoptionPage = pathname === '/solar-adoption';
  const isNoticePage = pathname === '/notice';
  const isLoginPage = pathname === '/login';
  const isMemberDashboardPage = pathname === '/member/dashboard';
  const isMemberAsPage = pathname === '/member/as' || pathname === '/customer-center';
  const isMemberProfilePage = pathname === '/member/profile';

  useEffect(() => {
    if (!window.location.hash) {
      return;
    }

    window.requestAnimationFrame(() => {
      document.querySelector(window.location.hash)?.scrollIntoView();
    });
  }, []);

  if (isRiskMapPage) {
    return <RiskMapPage />;
  }

  if (isSimulationSetupPage) {
    return <SimulationSetupPage />;
  }

  if (isSimulationResultPage) {
    return <SimulationResultPage />;
  }

  if (isConsultationPage) {
    return <ConsultationPage />;
  }

  if (isConsultationCompletePage) {
    return <ConsultationCompletePage />;
  }

  if (isSolarAdoptionPage) {
    return <SolarAdoptionPage />;
  }

  if (isNoticePage) {
    return <NoticePage />;
  }

  if (isLoginPage) {
    return <LoginPage />;
  }

  if (isMemberDashboardPage) {
    return <MemberDashboardPage />;
  }

  if (isMemberAsPage) {
    return <MemberDashboardPage initialTab="as" />;
  }

  if (isMemberProfilePage) {
    return <MemberDashboardPage initialTab="profile" />;
  }

  const goLoginPage = () => {
    window.location.assign('/login');
  };

  const handleHeroAddressSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const savedDraft = saveLandingAddressDraft(heroAddress, 'landing-hero');

    if (!savedDraft) {
      window.alert('주소를 입력해 주세요.');
      return;
    }

    window.location.assign('/simulation/setup');
  };

  return (
    <main className="pageShell">
      <div className="siteFrame">
        <header className="landingHeader">
          <a className="logo" href="/" aria-label="솔라메이트 홈">
            <span className="sunMark" aria-hidden="true" />
            <span>
              <strong>로고</strong>
              <small />
            </span>
          </a>

          <nav className="desktopNav" aria-label="주요 메뉴">
            <a href="/solar-adoption">태양광 도입</a>
            <a href="/#service-intro">서비스 소개</a>
            <a href="/notice">공지사항</a>
            <a href="/consultation">상담하기</a>
          </nav>

          <div className="headerActions">
            <button className="loginButton" type="button" onClick={goLoginPage}>
              로그인
            </button>
            <a className="primaryButton headerCta" href="/simulation/setup">
              우리 아파트 가능성 확인하기
            </a>
          </div>
        </header>

        <section className="heroSection" aria-labelledby="hero-title">
          <div className="heroCopy">
            <span className="eyebrow">정책자금과 에너지 금융으로</span>
            <h1 id="hero-title">
              부담 없이 태양광 설치하기
              <br />
            </h1>
            <p className="heroDescription">
              (서비스 지역 : 경기도)
            </p>
            <p className="disclaimer">
              ※ 시뮬레이션 결과는 건축물 정보, 일사량,
              <br />
              전기사용량, 정책 데이터 기준의 예상값입니다.
            </p>
            <div className="heroActions">
              <form className="heroAddressForm" onSubmit={handleHeroAddressSubmit}>
                <label className="heroAddressField" htmlFor="hero-address-input">
                  <span>아파트 주소</span>
                  <input
                    id="hero-address-input"
                    type="text"
                    value={heroAddress}
                    placeholder="예: 경기도 화성시 동탄구 반송동 88-12"
                    onChange={(event) => setHeroAddress(event.target.value)}
                  />
                </label>
                <button className="primaryButton" type="submit">
                  <LuSearch aria-hidden="true" />
                  주소 입력하기
                </button>
              </form>
              <a className="secondaryButton" href="#service-intro-status">
                (서비스 지역 : 경기도)
              </a>
            </div>
          </div>

          <div className="heroVisual" aria-label="도심 아파트 태양광 이미지">
            <SafeLocalImage
              src="/assets/landing/urban-solar-building.png"
              fallbackSrc="/assets/landing/apartment-isometric.png"
              alt="태양광 패널이 설치된 도심 아파트"
              className="heroImage"
            />
          </div>

        </section>

        <ServiceIntroSection />
      </div>
    </main>
  );
}

export default App;
