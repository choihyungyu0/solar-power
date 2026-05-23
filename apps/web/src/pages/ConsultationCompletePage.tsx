import { LuUserRound } from 'react-icons/lu';
import { readSimulationResultFromSession } from '../lib/simulationResultStorage';
import './ConsultationCompletePage.css';

const CONSULTATION_INQUIRY_STORAGE_KEY = 'solarmate:consultationInquiry';

type StoredConsultationInquiry = {
  name: string;
  phone: string;
  email: string;
  roadAddress: string;
  jibunAddress: string;
  monthlyPaymentKrw: number;
  createdAt: string;
};

type CompletionAddress = {
  roadAddress: string;
  jibunAddress: string;
};

const fallbackAddress: CompletionAddress = {
  roadAddress: '경기도 수원시 팔달구 경수대로 464',
  jibunAddress: '경기 수원시 팔달구 인계동 1017',
};

function readConsultationInquiryFromSession() {
  try {
    const rawValue = window.sessionStorage.getItem(CONSULTATION_INQUIRY_STORAGE_KEY);

    if (!rawValue) {
      return null;
    }

    const parsedValue = JSON.parse(rawValue) as Partial<StoredConsultationInquiry>;

    if (!parsedValue || typeof parsedValue !== 'object') {
      return null;
    }

    return parsedValue;
  } catch {
    return null;
  }
}

function pickText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getCompletionAddress(): CompletionAddress {
  const inquiry = readConsultationInquiryFromSession();
  const storedResult = readSimulationResultFromSession();

  return {
    roadAddress:
      pickText(inquiry?.roadAddress) ?? pickText(storedResult?.building.roadAddress) ?? fallbackAddress.roadAddress,
    jibunAddress:
      pickText(inquiry?.jibunAddress) ?? pickText(storedResult?.building.jibunAddress) ?? fallbackAddress.jibunAddress,
  };
}

function canSafelyGoBack() {
  try {
    if (!document.referrer || window.history.length <= 1) {
      return false;
    }

    return new URL(document.referrer).origin === window.location.origin;
  } catch {
    return false;
  }
}

function handlePreviousClick() {
  if (canSafelyGoBack()) {
    window.history.back();
    return;
  }

  window.location.assign('/consultation');
}

export default function ConsultationCompletePage() {
  const address = getCompletionAddress();

  return (
    <div className="consultation-complete-page">
      <CompletionHeader />

      <main className="consultation-complete-main">
        <section className="consultation-complete-card" aria-labelledby="consultation-complete-title">
          <AddressSummary address={address} />

          <section className="consultation-complete-result-box">
            <div id="consultation-complete-title" className="consultation-complete-title-bar">
              문의 접수 완료
            </div>

            <div className="consultation-complete-message">
              <h1>정상적으로 접수되었습니다.</h1>
              <p>담당 매니저가 순차적으로 연락드리겠습니다.</p>
              <p>(영업일 기준 1일 ~ 3일이 소요됩니다.)</p>
            </div>
          </section>
        </section>

        <button className="consultation-complete-prev-button" type="button" onClick={handlePreviousClick}>
          <span aria-hidden="true">‹</span>
          이전
        </button>
      </main>
    </div>
  );
}

function CompletionHeader() {
  return (
    <header className="consultation-complete-header">
      <a className="consultation-complete-logo" href="/" aria-label="솔라메이트 홈">
        <span className="consultation-complete-logo-mark" aria-hidden="true">
          <span className="consultation-complete-logo-sun" />
          <span className="consultation-complete-logo-panel">
            {Array.from({ length: 6 }).map((_, index) => (
              <span key={index} />
            ))}
          </span>
        </span>

        <span className="consultation-complete-logo-text">
          <strong>솔라메이트</strong>
          <small>SolarMate</small>
        </span>
      </a>

      <nav className="consultation-complete-nav" aria-label="주요 메뉴">
        <a href="/#service-intro">제품소개</a>
        <a href="/#service-intro-status">설치사례</a>
        <a href="/simulation/setup">이용안내</a>
        <a href="/#contact">고객지원</a>
        <a href="/">회사소개</a>
      </nav>

      <button className="consultation-complete-login-button" type="button">
        <LuUserRound aria-hidden="true" />
        로그인
      </button>
    </header>
  );
}

function AddressSummary({ address }: { address: CompletionAddress }) {
  return (
    <section className="consultation-complete-address-box" aria-label="문의 접수 주소">
      <div className="consultation-complete-address-row">
        <strong>도로명주소</strong>
        <p>{address.roadAddress}</p>
      </div>

      <div className="consultation-complete-address-divider" />

      <div className="consultation-complete-address-row">
        <strong>지번</strong>
        <p>{address.jibunAddress}</p>
      </div>
    </section>
  );
}
