import { useState } from 'react';
import SolarMateHeader from '../components/SolarMateHeader';
import './SolarAdoptionPage.css';

const processImagePath = '/assets/process/business-process-flow.png';

export default function SolarAdoptionPage() {
  const [hasImageError, setHasImageError] = useState(false);

  return (
    <div className="solar-adoption-page">
      <SolarMateHeader />

      <main className="solar-adoption-main">
        <section className="solar-adoption-panel" aria-labelledby="solar-adoption-title">
          <section className="solar-adoption-hero" aria-labelledby="solar-adoption-title">
            <p>태양광 어려우셨죠?</p>
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
