import { useEffect } from 'react';
import SafeLocalImage from './components/SafeLocalImage';
import SolarFeedSection from './components/SolarFeedSection';
import ServiceIntroSection from './components/ServiceIntroSection';
import RiskMapPage from './pages/RiskMapPage';
import SimulationSetupPage from './pages/SimulationSetupPage';

const heroMetrics = [
  {
    label: '예상',
    title: '예상 연간 절감액',
    value: '18,720,000원',
    image: '/assets/landing/savings-chart-icon.png',
    alt: '상승 그래프 아이콘',
  },
  {
    label: '예상',
    title: '예상 보조금',
    value: '72,800,000원',
    image: '/assets/landing/subsidy-coin-icon.png',
    alt: '보조금 동전 아이콘',
  },
  {
    label: '예상',
    title: '예상 회수기간',
    value: '4.6년',
    image: '/assets/landing/payback-clock-icon.png',
    alt: '회수기간 시계 아이콘',
  },
];

const featureCards = [
  {
    title: '전기세 위험 3D 지도',
    description: '브이월드 3D 지도에서 건물을 선택하고 전기세 상승 위험과 태양광 대응 여지를 먼저 확인하세요.',
    image: '/assets/landing/apartment-isometric.png',
    alt: '태양광 패널이 설치된 아파트 아이콘',
  },
  {
    title: '보조금·정책자금 안내',
    description: '최신 보조금과 정책자금 정보를 한눈에 확인하고, 신청 조건과 절차까지 안내해 드립니다.',
    image: '/assets/landing/policy-document-coin.png',
    alt: '정책 문서와 동전 아이콘',
  },
  {
    title: '알림 센터',
    description: '정책 변경, 공고 오픈, 마감 임박까지 중요한 정보를 놓치지 않도록 알림으로 알려드립니다.',
    image: '/assets/landing/notification-bell.png',
    alt: '알림 종 아이콘',
  },
];

function App() {
  const pathname = window.location.pathname.replace(/\/$/, '') || '/';
  const isRiskMapPage = pathname === '/risk-map';
  const isSimulationSetupPage = pathname === '/simulation/setup';

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
            <a href="/simulation/setup">우리 아파트 가상설치</a>
            <a href="#service-intro">서비스 소개</a>
            <a href="#solar-feed">공지사항</a>
            <a href="#contact">고객센터</a>
          </nav>

          <div className="headerActions">
            <button className="loginButton" type="button">
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
              <a className="primaryButton" href="/simulation/setup">
                주소 입력하기
              </a>
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

          <div className="metricStack" aria-label="태양광 설치 예상 지표">
            {heroMetrics.map((metric) => (
              <article className="metricCard" key={metric.title}>
                <SafeLocalImage src={metric.image} alt={metric.alt} className="metricIcon" />
                <div>
                  <span>{metric.label}</span>
                  <h2>{metric.title}</h2>
                  <strong>{metric.value}</strong>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="featureCards" aria-label="주요 서비스">
          {featureCards.map((card) => (
            <article className="featureCard" key={card.title}>
              <SafeLocalImage src={card.image} alt={card.alt} className="featureImage" />
              <div>
                <h2>{card.title}</h2>
                <p>{card.description}</p>
              </div>
              <span className="roundLink" aria-hidden="true">
                ›
              </span>
            </article>
          ))}
        </section>

        <ServiceIntroSection />

        <SolarFeedSection />

        <section className="ctaPanel" id="contact">
          <div>
            <h2>신청 지원과 알림은 데모 단계로 준비 중입니다</h2>
            <p>
              실제 KakaoTalk, SMS 발송이나 실시간 보조금 데이터 연동은 아직 구현하지 않았습니다.
              현재 화면은 MVP 서비스 흐름을 보여주는 프론트엔드 예시입니다.
            </p>
          </div>
          <a className="primaryButton" href="/simulation/setup">
            우리 아파트 태양광 설치하기
          </a>
        </section>
      </div>
    </main>
  );
}

export default App;
