import { useNavigate } from 'react-router-dom';
import SolarMateHeader from '../components/SolarMateHeader';
import { CONSULTATION_REQUEST_ID_STORAGE_KEY } from '../lib/consultationClient';
import { readSimulationResultFromSession } from '../lib/simulationResultStorage';
import './ConsultationCompletePage.css';

const CONSULTATION_INQUIRY_STORAGE_KEY = 'solarmate:consultationInquiry';
const SERVICE_CONSULTATION_INQUIRY_STORAGE_KEY = 'solarmate:serviceConsultationInquiry';

type StoredConsultationInquiry = {
  name?: string;
  contact?: string;
  consultationType?: string;
  content?: string;
  phone?: string;
  email?: string;
  roadAddress: string;
  jibunAddress: string;
  monthlyPaymentKrw?: number;
  consultationRequestId?: string | null;
  serverSaveMessage?: string;
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
    const rawValue =
      window.sessionStorage.getItem(SERVICE_CONSULTATION_INQUIRY_STORAGE_KEY) ??
      window.sessionStorage.getItem(CONSULTATION_INQUIRY_STORAGE_KEY);

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

function getConsultationRequestId() {
  const inquiry = readConsultationInquiryFromSession();

  return (
    pickText(window.sessionStorage.getItem(CONSULTATION_REQUEST_ID_STORAGE_KEY)) ??
    pickText(inquiry?.consultationRequestId)
  );
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

export default function ConsultationCompletePage() {
  const navigate = useNavigate();
  const address = getCompletionAddress();
  const consultationRequestId = getConsultationRequestId();

  return (
    <div className="consultation-complete-page">
      <SolarMateHeader />

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
              <p>{consultationRequestId ? `접수번호: ${consultationRequestId}` : '임시 접수 상태입니다.'}</p>
            </div>
          </section>
        </section>

        <button className="consultation-complete-prev-button" type="button" onClick={() => navigate('/service')}>
          <span aria-hidden="true">‹</span>
          이전
        </button>
      </main>
    </div>
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
