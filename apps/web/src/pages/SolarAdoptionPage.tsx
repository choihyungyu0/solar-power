import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LuArrowRight } from 'react-icons/lu';
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
            <p>경기 태양보조금 신청 절차</p>
            <h1 id="solar-adoption-title">
              행정은 <mark>간단히</mark>
              <br />
              자부담은 <mark>가볍게</mark>
            </h1>
            <span>모든 과정을 쏠쏠햇이 쉽게 도와드려요!</span>
            <button type="button" onClick={() => navigate('/solar-adoption/step-1')}>
              우리 집 태양광 설치하기
              <LuArrowRight aria-hidden="true" />
            </button>
          </section>

          <section className="solar-adoption-process" aria-labelledby="solar-adoption-process-title">
            <div className="solar-adoption-process-heading">
              <div>
                <p>신청부터 사후관리까지</p>
                <h2 id="solar-adoption-process-title">경기 태양보조금 신청 절차</h2>
              </div>
              <span>실제 지원 조건과 접수 상태는 공고 확인이 필요합니다.</span>
            </div>

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
