import { useState } from 'react';
import { LuUserRound } from 'react-icons/lu';
import './SolarAdoptionPage.css';

const processImagePath = '/assets/process/business-process-flow.png';

export default function SolarAdoptionPage() {
  const [hasImageError, setHasImageError] = useState(false);

  return (
    <div className="solar-adoption-page">
      <SolarAdoptionHeader />

      <main className="solar-adoption-main">
        <section className="solar-adoption-panel" aria-labelledby="solar-adoption-title">
          <section className="solar-adoption-hero" aria-labelledby="solar-adoption-title">
            <p>(대충) 태양광 어려우셨죠?</p>
            <h1 id="solar-adoption-title">태양광 쉽게 설치할 수 있게 도와드려요</h1>
          </section>

          <section className="solar-adoption-process" aria-labelledby="solar-adoption-process-title">
            <h2 id="solar-adoption-process-title">사업 진행절차</h2>

            <div className="solar-adoption-image-scroll">
              {hasImageError ? (
                <div className="solar-adoption-image-fallback" role="status">
                  사업 진행절차 이미지를 불러오지 못했습니다.
                </div>
              ) : (
                <img
                  className="solar-adoption-process-image"
                  src={processImagePath}
                  alt="경기도 주택태양광 사업 진행절차"
                  onError={() => setHasImageError(true)}
                />
              )}
            </div>
          </section>
        </section>
      </main>
    </div>
  );
}

function SolarAdoptionHeader() {
  return (
    <header className="solar-adoption-header">
      <a className="solar-adoption-logo" href="/" aria-label="솔라메이트 홈">
        <span className="solar-adoption-logo-mark" aria-hidden="true">
          <span className="solar-adoption-logo-sun" />
          <span className="solar-adoption-logo-panel">
            {Array.from({ length: 6 }).map((_, index) => (
              <span key={index} />
            ))}
          </span>
        </span>

        <span className="solar-adoption-logo-text">
          <strong>솔라메이트</strong>
          <small>SolarMate</small>
        </span>
      </a>

      <nav className="solar-adoption-nav" aria-label="주요 메뉴">
        <a className="active" href="/solar-adoption" aria-current="page">
          태양광 도입
        </a>
        <a href="/#service-intro">서비스 소개</a>
        <a href="/notice">공지사항</a>
        <a href="/member/as">고객센터</a>
      </nav>

      <button
        className="solar-adoption-login-button"
        type="button"
        onClick={() => window.location.assign('/member/dashboard')}
      >
        <LuUserRound aria-hidden="true" />
        로그인
      </button>
    </header>
  );
}
