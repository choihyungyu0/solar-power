import { useEffect, useMemo, useState, type FocusEvent, type FormEvent } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { LuSearch } from 'react-icons/lu';
import SafeLocalImage from './components/SafeLocalImage';
import ServiceIntroSection from './components/ServiceIntroSection';
import SolarMateHeader from './components/SolarMateHeader';
import { readLandingAddressText, saveLandingAddressDraft } from './lib/addressDraft';
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

type HeroAddressOption = {
  apartmentName: string;
  address: string;
  region: string;
  note: string;
};

const heroAddressOptions: HeroAddressOption[] = [
  {
    apartmentName: '동탄 반송 예시단지',
    address: '경기도 화성시 동탄구 반송동 88-12',
    region: '화성시 동탄구',
    note: '경기도 서비스 지역',
  },
  {
    apartmentName: '동탄능동마을 주공아파트',
    address: '경기도 화성시 동탄구 능동 1083',
    region: '화성시 동탄구',
    note: '공동주택 후보',
  },
  {
    apartmentName: '동탄능동마을주공아파트',
    address: '경기도 화성시 동탄구 능동 1110',
    region: '화성시 동탄구',
    note: '공동주택 후보',
  },
  {
    apartmentName: '능동역 이지더원 아파트',
    address: '경기도 화성시 동탄구 능동 1109',
    region: '화성시 동탄구',
    note: '주소 검색 예시',
  },
  {
    apartmentName: '수원 팔달 상담 예시 주소',
    address: '경기도 수원시 팔달구 경수대로 464',
    region: '수원시 팔달구',
    note: '상담 흐름 예시',
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
  const [heroAddress, setHeroAddress] = useState(() => readLandingAddressText());
  const [isHeroAddressOptionsOpen, setIsHeroAddressOptionsOpen] = useState(false);

  const filteredHeroAddressOptions = useMemo(() => {
    const query = heroAddress.trim().toLowerCase();

    if (!query) {
      return heroAddressOptions;
    }

    return heroAddressOptions.filter((option) =>
      `${option.apartmentName} ${option.address} ${option.region} ${option.note}`.toLowerCase().includes(query),
    );
  }, [heroAddress]);

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

  const handleHeroAddressBlur = (event: FocusEvent<HTMLDivElement>) => {
    const nextFocusedElement = event.relatedTarget;

    if (nextFocusedElement && event.currentTarget.contains(nextFocusedElement as Node)) {
      return;
    }

    setIsHeroAddressOptionsOpen(false);
  };

  const handleHeroAddressOptionSelect = (address: string) => {
    setHeroAddress(address);
    setIsHeroAddressOptionsOpen(false);
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
                <div className="heroAddressCombobox" onBlur={handleHeroAddressBlur}>
                  <label className="heroAddressField" htmlFor="hero-address-input">
                    <span>아파트 주소</span>
                    <input
                      id="hero-address-input"
                      type="text"
                      value={heroAddress}
                      placeholder="예: 경기도 화성시 동탄구 반송동 88-12"
                      autoComplete="off"
                      aria-autocomplete="list"
                      aria-controls="hero-address-options"
                      aria-expanded={isHeroAddressOptionsOpen}
                      onFocus={() => setIsHeroAddressOptionsOpen(true)}
                      onChange={(event) => {
                        setHeroAddress(event.target.value);
                        setIsHeroAddressOptionsOpen(true);
                      }}
                    />
                  </label>

                  {isHeroAddressOptionsOpen && (
                    <div id="hero-address-options" className="heroAddressOptions" role="listbox" aria-label="아파트 주소 후보">
                      <div className="heroAddressOptionsHeader">주소 후보</div>
                      {filteredHeroAddressOptions.length > 0 ? (
                        filteredHeroAddressOptions.map((option) => (
                          <button
                            key={option.address}
                            className="heroAddressOption"
                            type="button"
                            role="option"
                            aria-selected={heroAddress === option.address}
                            onClick={() => handleHeroAddressOptionSelect(option.address)}
                          >
                            <span className="heroAddressOptionName">{option.apartmentName}</span>
                            <span className="heroAddressOptionAddress">{option.address}</span>
                            <span className="heroAddressOptionMeta">
                              {option.region} · {option.note}
                            </span>
                          </button>
                        ))
                      ) : (
                        <div className="heroAddressNoOption" role="status">
                          <strong>입력한 주소로 계속 진행</strong>
                          <span>정확한 매칭은 다음 지도 단계에서 확인합니다.</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <button className="primaryButton" type="submit">
                  <LuSearch aria-hidden="true" />
                  우리 아파트 태양광 설치하기
                </button>
              </form>
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
