import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { LuSearch } from 'react-icons/lu';
import SafeLocalImage from './components/SafeLocalImage';
import ServiceIntroSection from './components/ServiceIntroSection';
import SolarMateHeader from './components/SolarMateHeader';
import { readLandingAddressText, saveLandingAddressDraft } from './lib/addressDraft';
import ConsultationCompletePage from './pages/ConsultationCompletePage';
import ConsultationPage from './pages/ConsultationPage';
import LoginPage from './pages/LoginPage';
import MemberDashboardPage from './pages/MemberDashboardPage';
import MemberNoInstallationPage from './pages/MemberNoInstallationPage';
import NoticePage from './pages/NoticePage';
import RiskMapPage from './pages/RiskMapPage';
import ServicePage from './pages/ServicePage';
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
      <Route path="/simulation/result" element={<SimulationResultPage />} />
      <Route path="/solar-adoption" element={<SolarAdoptionPage />} />
      <Route path="/solar-adoption/step-1" element={<SolarAdoptionStep1Page />} />
      <Route path="/solar-adoption/step-2" element={<SolarAdoptionStep2Page />} />
      <Route path="/solar-adoption/step-3" element={<SolarAdoptionStep3Page />} />
      <Route path="/solar-adoption/step-4" element={<SolarAdoptionStep4Page />} />
      <Route path="/solar-adoption/complete" element={<SolarAdoptionCompletePage />} />
      <Route path="/service" element={<ServicePage />} />
      <Route path="/notice" element={<NoticePage />} />
      <Route path="/consultation" element={<ConsultationPage />} />
      <Route path="/consultation/complete" element={<ConsultationCompletePage />} />
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
  const [heroAddress, setHeroAddress] = useState(() => readLandingAddressText());

  useEffect(() => {
    if (!window.location.hash) {
      return;
    }

    window.requestAnimationFrame(() => {
      document.querySelector(window.location.hash)?.scrollIntoView();
    });
  }, []);

  const handleHeroAddressSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const savedDraft = saveLandingAddressDraft(heroAddress, 'landing-hero');

    if (!savedDraft) {
      window.alert('주소를 입력해 주세요.');
      return;
    }

    navigate('/risk-map');
  };

  return (
    <main className="pageShell">
      <div className="siteFrame">
        <SolarMateHeader />

        <section className="heroSection" aria-labelledby="hero-title">
          <div className="heroCopy">
            <span className="eyebrow">정책자금과 에너지 금융으로</span>
            <h1 id="hero-title">
              부담 없이 태양광 설치하기
              <br />
            </h1>
            <p className="heroDescription">(서비스 지역 : 경기도)</p>
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
                  우리 아파트 태양광 설치하기
                </button>
              </form>
              <button className="secondaryButton" type="button" onClick={() => navigate('/risk-map')}>
                전기세 위험 지도 보기
              </button>
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
