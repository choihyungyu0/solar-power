import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { LuSearch } from 'react-icons/lu';
import AuthPanel from './components/AuthPanel';
import PolicyProgramList from './components/PolicyProgramList';
import RequestForm from './components/RequestForm';
import ReviewCards from './components/ReviewCards';
import SafeLocalImage from './components/SafeLocalImage';
import ServiceIntroSection from './components/ServiceIntroSection';
import SimulationResultCard from './components/SimulationResultCard';
import SolarMateHeader from './components/SolarMateHeader';
import { readLandingAddressText, saveLandingAddressDraft } from './lib/addressDraft';
import { calculateSolarSimulation } from './lib/solarCalculator';
import {
  fallbackInstallReviews,
  fallbackPolicyPrograms,
  loadInstallReviews,
  loadPolicyPrograms,
  saveSolarMvpSubmission,
} from './lib/solarMvpSupabase';
import type { InstallReview, PolicyProgram, SaveStatus, SolarRequestFormValues, SolarSimulationResult } from './lib/solarTypes';
import { isSupabaseConfigured, supabase, supabaseConfigMessage } from './lib/supabase';
import { useSupabaseSession } from './lib/useSupabaseSession';
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

type SavedRecordIds = {
  requestId: string;
  simulationId: string;
  notificationPreferenceId: string;
} | null;

const initialSaveStatus: SaveStatus = {
  state: 'idle',
  message: '요청서를 제출하면 데모 산식 계산과 Supabase 저장 상태가 표시됩니다.',
};

const businessFlowItems = [
  {
    title: '경기도/지자체',
    text: '태양광 예산 소진과 정책 참여 확대가 필요합니다.',
  },
  {
    title: '아파트/건물주',
    text: '전기요금 절감과 설치 가능성 확인이 필요합니다.',
  },
  {
    title: '우리 서비스',
    text: '적합지 발굴, 혜택 추정, 신청 지원, 알림 제공을 연결합니다.',
  },
  {
    title: '수익 모델',
    text: 'B2G 리포트/대시보드, 설치 중개 수수료, 정책지원 운영 대행으로 확장합니다.',
  },
];

const publicValueItems = [
  '도심 내 자가발전 확대',
  '송전 손실 완화',
  '공동주택 에너지 비용 부담 완화',
  '정책자금 접근성 향상',
  '경기도/지자체 탄소중립 정책 실행 지원',
];

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/risk-map" element={<RiskMapPage />} />
      <Route path="/simulation/setup" element={<SimulationSetupPage />} />
      <Route path="/simulation/result" element={<SimulationResultPage />} />
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
  const { session } = useSupabaseSession();
  const [heroAddress, setHeroAddress] = useState(() => readLandingAddressText());
  const [policies, setPolicies] = useState<PolicyProgram[]>(fallbackPolicyPrograms);
  const [reviews, setReviews] = useState<InstallReview[]>(fallbackInstallReviews);
  const [simulationResult, setSimulationResult] = useState<SolarSimulationResult | null>(null);
  const [lastRequestValues, setLastRequestValues] = useState<SolarRequestFormValues | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(initialSaveStatus);
  const [savedRecordIds, setSavedRecordIds] = useState<SavedRecordIds>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!window.location.hash) {
      return;
    }

    window.requestAnimationFrame(() => {
      document.querySelector(window.location.hash)?.scrollIntoView();
    });
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadMvpContent() {
      const [nextPolicies, nextReviews] = await Promise.all([
        loadPolicyPrograms(supabase),
        loadInstallReviews(supabase),
      ]);

      if (isMounted) {
        setPolicies(nextPolicies);
        setReviews(nextReviews);
      }
    }

    void loadMvpContent();

    return () => {
      isMounted = false;
    };
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

  const handleSolarRequestSubmit = async (values: SolarRequestFormValues) => {
    const nextResult = calculateSolarSimulation(values);

    setSimulationResult(nextResult);
    setLastRequestValues(values);
    setSavedRecordIds(null);

    if (!supabase || !isSupabaseConfigured) {
      setSaveStatus({
        state: 'local-only',
        message: 'Supabase 환경변수 미설정 상태입니다. 계산 결과와 알림 선호 채널은 화면에서만 확인됩니다.',
      });
      return;
    }

    if (!session?.user) {
      setSaveStatus({
        state: 'local-only',
        message: '로그인 전입니다. 계산은 완료되었고, 로그인 후 제출하면 Supabase RLS 기준으로 저장됩니다.',
      });
      return;
    }

    setIsSaving(true);
    setSaveStatus({
      state: 'saving',
      message: '요청서, 시뮬레이션 결과, mock 알림 선호 채널을 Supabase에 저장 중입니다.',
    });

    try {
      const savedIds = await saveSolarMvpSubmission(supabase, session.user.id, values, nextResult);

      setSavedRecordIds(savedIds);
      setSaveStatus({
        state: 'saved',
        message: 'Supabase에 저장되었습니다. 실제 보조금 수혜나 Kakao/SMS 발송은 아직 연결되지 않은 MVP 상태입니다.',
      });
    } catch (error) {
      setSaveStatus({
        state: 'error',
        message: `Supabase 저장 실패: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      setIsSaving(false);
    }
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

        <section className="mvpWorkspace" id="solar-mvp" aria-labelledby="solar-mvp-title">
          <div className="mvpWorkspaceHeader">
            <span className="panelKicker">Supabase-first MVP</span>
            <h2 id="solar-mvp-title">아파트 태양광 신청과 예상 혜택을 한 곳에서</h2>
            <p>
              전기요금 부담, 도심 송전 손실, 보조금 정보 복잡성을 함께 다루는 MVP입니다. 모든 금액과 발전량은 예상·추정·데모 산식이며 실제 공고 확인이 필요합니다.
            </p>
            <a className="primaryButton mvpStandaloneCta" href="#solar-request">
              우리 아파트 태양광 설치하기
            </a>
          </div>

          <div className="mvpWorkflowGrid">
            <AuthPanel
              supabase={supabase}
              session={session}
              isConfigured={isSupabaseConfigured}
              setupMessage={supabaseConfigMessage}
            />
            <RequestForm onSubmit={handleSolarRequestSubmit} isSaving={isSaving} />
            <SimulationResultCard result={simulationResult} saveStatus={saveStatus} />
            <NotificationStatusPanel values={lastRequestValues} saveStatus={saveStatus} savedRecordIds={savedRecordIds} />
          </div>

          <BusinessFlowSection />
          <PolicyProgramList policies={policies} />
          <ReviewCards reviews={reviews} />
        </section>
      </div>
    </main>
  );
}

function getContactMethodLabel(method: SolarRequestFormValues['contactMethod']) {
  if (method === 'kakao') {
    return '카카오';
  }

  if (method === 'sms') {
    return 'SMS';
  }

  return '이메일';
}

function NotificationStatusPanel({
  values,
  saveStatus,
  savedRecordIds,
}: {
  values: SolarRequestFormValues | null;
  saveStatus: SaveStatus;
  savedRecordIds: SavedRecordIds;
}) {
  const channelLabel = values ? getContactMethodLabel(values.contactMethod) : '미선택';
  const destination = values?.contactValue ?? '요청서 제출 후 표시';
  const mockStatus = saveStatus.state === 'saved' ? 'mock_ready 저장 완료' : 'mock_ready 미리보기';

  return (
    <section className="mvpPanel notificationPanel" aria-labelledby="notification-title">
      <span className="panelKicker">Mock Notification</span>
      <h2 id="notification-title">알림 선호 채널</h2>
      <dl>
        <div>
          <dt>채널</dt>
          <dd>{channelLabel}</dd>
        </div>
        <div>
          <dt>수신처</dt>
          <dd>{destination}</dd>
        </div>
        <div>
          <dt>상태</dt>
          <dd>{mockStatus}</dd>
        </div>
      </dl>
      {savedRecordIds && (
        <p className="panelNote">
          request {savedRecordIds.requestId.slice(0, 8)} · simulation {savedRecordIds.simulationId.slice(0, 8)}
        </p>
      )}
      <p className="panelNote">현재 MVP는 실제 카카오/SMS/이메일 발송을 수행하지 않고 선호 채널만 저장합니다.</p>
    </section>
  );
}

function BusinessFlowSection() {
  return (
    <section className="mvpSection businessFlowSection" aria-labelledby="business-flow-title">
      <div className="sectionHeader">
        <span className="panelKicker">Business & Public Value</span>
        <h2 id="business-flow-title">정책 실행과 아파트 절감을 연결하는 흐름</h2>
        <p>예산 소진, 신청 지원, 설치 중개, 정책지원 운영 대행까지 이어지는 사업 구조를 MVP 화면에서 확인할 수 있게 유지합니다.</p>
      </div>

      <div className="businessFlowGrid">
        {businessFlowItems.map((item) => (
          <article className="businessFlowCard" key={item.title}>
            <span>{item.title}</span>
            <p>{item.text}</p>
          </article>
        ))}
      </div>

      <ul className="publicValueList" aria-label="공공가치">
        {publicValueItems.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

export default App;
