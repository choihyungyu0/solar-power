import SafeLocalImage from './components/SafeLocalImage';
import SolarFeedSection from './components/SolarFeedSection';
import ServiceIntroSection from './components/ServiceIntroSection';

function App() {
  return (
    <main className="pageShell">
      <div className="siteFrame">
        <header className="landingHeader">
          <a className="logo" href="/" aria-label="솔라메이트 홈">
            <span className="sunMark" aria-hidden="true" />
            <span>
              <strong>솔라메이트</strong>
              <small>SolarMate</small>
            </span>
          </a>

          <nav className="desktopNav" aria-label="주요 메뉴">
            <a href="#service-intro">서비스 소개</a>
            <a href="#service-intro-status">분석 현황</a>
            <a href="#solar-feed">솔라피드</a>
            <a href="#service-intro-process">이용 방법</a>
            <a href="#contact">고객센터</a>
          </nav>

          <div className="headerActions">
            <button className="loginButton" type="button">
              로그인
            </button>
            <a className="primaryButton headerCta" href="#service-intro">
              시뮬레이션 시작
            </a>
          </div>
        </header>

        <section className="heroSection" aria-labelledby="hero-title">
          <div className="heroCopy">
            <span className="eyebrow">Apartment Solar MVP</span>
            <h1 id="hero-title">
              우리 아파트 태양광
              <br />
              설치 가능성을
              <br />
              한 번에 확인하세요
            </h1>
            <p className="heroDescription">
              전기요금 부담, 보조금 공고, 설치 가능성 판단을
              <br />
              따로 찾아보지 않도록 아파트 조건 기반의
              <br />
              예상 리포트와 다음 실행 단계를 제공합니다.
            </p>
            <p className="disclaimer">
              예상 절감액과 정책지원 후보는 추정값입니다.
              <br />
              실제 신청 전 현장조사와 공고 기준 확인이 필요합니다.
            </p>
            <div className="heroActions">
              <a className="primaryButton" href="#service-intro">
                우리 아파트 태양광 설치하기
              </a>
              <a className="secondaryButton" href="#service-intro">
                서비스 소개 보기
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

        <SolarFeedSection />

        <section className="ctaPanel" id="contact">
          <div>
            <h2>신청 지원과 알림은 데모 단계로 준비 중입니다</h2>
            <p>
              실제 KakaoTalk, SMS 발송이나 실시간 보조금 데이터 연동은 아직 구현하지 않았습니다.
              현재 화면은 MVP 서비스 흐름을 보여주는 프론트엔드 예시입니다.
            </p>
          </div>
          <a className="primaryButton" href="#service-intro">
            우리 아파트 태양광 설치하기
          </a>
        </section>
      </div>
    </main>
  );
}

export default App;
