import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LuArrowRight, LuMap } from 'react-icons/lu';
import SolarMateHeader from '../components/SolarMateHeader';
import './SolarAdoptionPage.css';

const processImagePath = '/assets/process/business-process-flow.png';

export default function SolarAdoptionPage() {
  const [hasImageError, setHasImageError] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="solar-adoption-page">
      <SolarMateHeader />

      <main className="solar-adoption-main">
        <section className="solar-adoption-panel" aria-labelledby="solar-adoption-title">
          <section className="solar-adoption-hero" aria-labelledby="solar-adoption-title">
            <p>(대충) 태양광 어려우셨죠?</p>
            <h1 id="solar-adoption-title">태양광 쉽게 설치할 수 있게 도와드려요</h1>
            <div className="solar-adoption-cta-row">
              <button className="solar-adoption-primary-cta" type="button" onClick={() => navigate('/risk-map')}>
                <LuMap aria-hidden="true" />
                우리 아파트 가능성 확인하기
              </button>
              <button className="solar-adoption-secondary-cta" type="button" onClick={() => navigate('/solar-adoption/step-1')}>
                주소 입력하기
                <LuArrowRight aria-hidden="true" />
              </button>
            </div>
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
