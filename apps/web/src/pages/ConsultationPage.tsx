import { FormEvent, useMemo, useState } from 'react';
import { LuChevronLeft, LuChevronRight, LuCircleAlert, LuUserRound } from 'react-icons/lu';
import { readSimulationResultFromSession, type StoredSimulationResult } from '../lib/simulationResultStorage';
import './ConsultationPage.css';

const CONSULTATION_INQUIRY_STORAGE_KEY = 'solarmate:consultationInquiry';
const DEFAULT_MONTHLY_PAYMENT_KRW = 60_000;
const DEFAULT_PAYMENT_MONTHS = 36;

type ConsultationFormValues = {
  name: string;
  phone: string;
  email: string;
};

type AgreementValues = {
  privacy: boolean;
  thirdParty: boolean;
};

type ConsultationSimulationSolar = StoredSimulationResult['solar'] & {
  monthlyPaymentKrw?: unknown;
};

type ConsultationData = {
  roadAddress: string;
  jibunAddress: string;
  monthlyPaymentKrw: number;
  paymentMonths: number;
  investmentKrw: number | null;
  subsidyMaxKrw: number | null;
  selfPaymentKrw: number | null;
  loanLimitKrw: number | null;
};

const fallbackConsultationData: ConsultationData = {
  roadAddress: '경기도 수원시 팔달구 경수대로 464',
  jibunAddress: '경기 수원시 팔달구 인계동 1017',
  monthlyPaymentKrw: DEFAULT_MONTHLY_PAYMENT_KRW,
  paymentMonths: DEFAULT_PAYMENT_MONTHS,
  investmentKrw: null,
  subsidyMaxKrw: null,
  selfPaymentKrw: null,
  loanLimitKrw: null,
};

function toFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function pickNumber(value: unknown, fallback: number) {
  return toFiniteNumber(value) ?? fallback;
}

function getConsultationData(): ConsultationData {
  const storedResult = readSimulationResultFromSession();

  if (!storedResult) {
    return fallbackConsultationData;
  }

  const solar = storedResult.solar as ConsultationSimulationSolar;

  return {
    roadAddress: storedResult.building.roadAddress || fallbackConsultationData.roadAddress,
    jibunAddress: storedResult.building.jibunAddress || fallbackConsultationData.jibunAddress,
    monthlyPaymentKrw: pickNumber(solar.monthlyPaymentKrw, DEFAULT_MONTHLY_PAYMENT_KRW),
    paymentMonths: DEFAULT_PAYMENT_MONTHS,
    investmentKrw: toFiniteNumber(solar.investmentKrw),
    subsidyMaxKrw: toFiniteNumber(solar.subsidyMaxKrw),
    selfPaymentKrw: toFiniteNumber(solar.selfPaymentKrw),
    loanLimitKrw: toFiniteNumber(solar.loanLimitKrw),
  };
}

function formatPaymentText(monthlyPaymentKrw: number) {
  if (monthlyPaymentKrw === DEFAULT_MONTHLY_PAYMENT_KRW) {
    return '월 6만원으로';
  }

  return `월 ${Math.round(monthlyPaymentKrw).toLocaleString('ko-KR')}원으로`;
}

function ConsultationPage() {
  const consultationData = useMemo(() => getConsultationData(), []);
  const [formValues, setFormValues] = useState<ConsultationFormValues>({
    name: '',
    phone: '',
    email: '',
  });
  const [agreements, setAgreements] = useState<AgreementValues>({
    privacy: false,
    thirdParty: false,
  });
  const [errorMessage, setErrorMessage] = useState('');

  const updateFormValue = (key: keyof ConsultationFormValues, value: string) => {
    setFormValues((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const toggleAgreement = (key: keyof AgreementValues) => {
    setAgreements((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleBackClick = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    window.location.assign('/simulation/result');
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const hasMissingFormValue = !formValues.name.trim() || !formValues.phone.trim() || !formValues.email.trim();
    const hasMissingAgreement = !agreements.privacy || !agreements.thirdParty;

    if (hasMissingFormValue || hasMissingAgreement) {
      setErrorMessage('필수 항목을 입력하고 개인정보 동의에 체크해주세요.');
      window.alert('필수 항목을 입력하고 개인정보 동의에 체크해주세요.');
      return;
    }

    const inquiry = {
      name: formValues.name.trim(),
      phone: formValues.phone.trim(),
      email: formValues.email.trim(),
      roadAddress: consultationData.roadAddress,
      jibunAddress: consultationData.jibunAddress,
      monthlyPaymentKrw: consultationData.monthlyPaymentKrw,
      createdAt: new Date().toISOString(),
    };

    window.sessionStorage.setItem(CONSULTATION_INQUIRY_STORAGE_KEY, JSON.stringify(inquiry));
    setErrorMessage('');
    window.location.assign('/consultation/complete');
  };

  return (
    <div className="consultation-page">
      <ConsultationHeader />

      <main className="consultation-main">
        <section className="consultation-card" aria-labelledby="consultation-title">
          <h1 id="consultation-title" className="consultation-title">
            태양광 문의접수
          </h1>

          <div className="consultation-address-box" aria-label="상담 신청 주소">
            <div className="consultation-address-row">
              <span>도로명주소</span>
              <strong>{consultationData.roadAddress}</strong>
            </div>
            <div className="consultation-address-row">
              <span>지번</span>
              <strong>{consultationData.jibunAddress}</strong>
            </div>
          </div>

          <div className="consultation-notice-bar">
            <LuCircleAlert aria-hidden="true" />
            <span>주소 확인 경고 문구</span>
          </div>

          <form className="consultation-form" onSubmit={handleSubmit}>
            <ConsultationFormRow
              id="consultation-name"
              label="이름"
              value={formValues.name}
              placeholder="이름을 입력해주세요"
              onChange={(value) => updateFormValue('name', value)}
            />
            <ConsultationFormRow
              id="consultation-phone"
              label="전화번호"
              value={formValues.phone}
              placeholder="전화번호를 입력해주세요"
              onChange={(value) => updateFormValue('phone', value)}
            />
            <ConsultationFormRow
              id="consultation-email"
              label="이메일"
              value={formValues.email}
              placeholder="이메일을 입력해주세요"
              onChange={(value) => updateFormValue('email', value)}
            />

            <div className="consultation-form-row consultation-consent-row">
              <span className="consultation-label">
                개인정보
                <br />
                이용동의
              </span>

              <div className="consultation-consent-list">
                <label className="consultation-check-line">
                  <input
                    type="checkbox"
                    checked={agreements.privacy}
                    onChange={() => toggleAgreement('privacy')}
                  />
                  <span className="consultation-custom-check" aria-hidden="true" />
                  <span>개인정보 수집 및 이용에 동의합니다. (필수)</span>
                </label>

                <label className="consultation-check-line">
                  <input
                    type="checkbox"
                    checked={agreements.thirdParty}
                    onChange={() => toggleAgreement('thirdParty')}
                  />
                  <span className="consultation-custom-check" aria-hidden="true" />
                  <span>개인정보 제3자 제공에 동의합니다. (필수)</span>
                </label>
              </div>
            </div>

            {errorMessage && (
              <p className="consultation-message is-error" role="alert">
                {errorMessage}
              </p>
            )}

            <div className="consultation-bottom-bar">
              <div className="consultation-price">
                <strong>{formatPaymentText(consultationData.monthlyPaymentKrw)}</strong>
                <span>({consultationData.paymentMonths}개월 납입)</span>
              </div>

              <button className="consultation-submit-button" type="submit">
                태양광 문의접수
                <LuChevronRight aria-hidden="true" />
              </button>
            </div>
          </form>
        </section>

        <button className="consultation-back-button" type="button" onClick={handleBackClick}>
          <LuChevronLeft aria-hidden="true" />
          이전
        </button>
      </main>
    </div>
  );
}

function ConsultationHeader() {
  return (
    <header className="consultation-header">
      <a className="consultation-logo" href="/" aria-label="솔라메이트 홈">
        <span className="consultation-logo-mark" aria-hidden="true">
          <span className="consultation-logo-sun" />
          <span className="consultation-logo-panel">
            {Array.from({ length: 6 }).map((_, index) => (
              <span key={index} />
            ))}
          </span>
        </span>

        <span className="consultation-logo-text">
          <strong>솔라메이트</strong>
          <small>SolarMate</small>
        </span>
      </a>

      <nav className="consultation-nav" aria-label="주요 메뉴">
        <a href="/#service-intro">제품소개</a>
        <a href="/#service-intro-status">설치사례</a>
        <a href="/simulation/setup">이용안내</a>
        <a href="/notice">공지사항</a>
        <a href="/">회사소개</a>
      </nav>

      <button
        className="consultation-login-button"
        type="button"
        onClick={() => window.location.assign('/member/dashboard')}
      >
        <LuUserRound aria-hidden="true" />
        로그인
      </button>
    </header>
  );
}

function ConsultationFormRow({
  id,
  label,
  value,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="consultation-form-row">
      <label className="consultation-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="consultation-input"
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export default ConsultationPage;
