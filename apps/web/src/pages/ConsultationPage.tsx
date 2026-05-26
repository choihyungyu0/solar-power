import { ChangeEvent, FormEvent, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LuChevronDown, LuHouse, LuMapPin, LuMessageCircle } from 'react-icons/lu';
import SolarMateHeader from '../components/SolarMateHeader';
import {
  CONSULTATION_REQUEST_ID_STORAGE_KEY,
  submitConsultationRequest,
} from '../lib/consultationClient';
import {
  attachConsultationRequestIdToStoredSimulationResult,
  PROFIT_REPORT_STORAGE_KEY,
  SELECTED_SIMULATION_RESULT_STORAGE_KEY,
} from '../lib/simulationResultStorage';
import './ConsultationPage.css';

const LEGACY_CONSULTATION_INQUIRY_STORAGE_KEY = 'solarmate:consultationInquiry';
const SERVICE_CONSULTATION_INQUIRY_STORAGE_KEY = 'solarmate:serviceConsultationInquiry';
const TEMPORARY_SAVE_MESSAGE = '서버 저장에 실패하여 임시 저장되었습니다. 네트워크 상태를 확인해주세요.';
const CONSULTATION_INPUT_LIMITS = {
  name: 50,
  contact: 50,
  email: 120,
  content: 2000,
};

const consultationTypes = [
  '설치 가능 여부 상담',
  '이전 설치 문의',
  '보조금 및 정책자금 안내',
  '일정 및 예상 비용 문의',
  '기타 문의',
];

const serviceItems = [
  '설치 가능 여부 상담',
  '이전 설치 문의',
  '보조금 및 정책자금 안내',
  '일정 및 예상 비용 문의',
];

type ConsultationAddress = {
  roadAddress: string;
  jibunAddress: string;
};

type ConsultationFormValues = {
  name: string;
  contact: string;
  email: string;
  consultationType: string;
  content: string;
  privacyAgreed: boolean;
  thirdPartyAgreed: boolean;
};

type ServiceConsultationInquiry = ConsultationFormValues &
  ConsultationAddress & {
    createdAt: string;
    analysisResultId?: string | null;
    consultationRequestId?: string | null;
    profitReportId?: string | null;
    serverSaveStatus?: 'saved' | 'temporary';
    serverSaveMessage?: string;
  };

type UnknownRecord = Record<string, unknown>;

const fallbackAddress: ConsultationAddress = {
  roadAddress: '경기도 수원시 영통구 경수대로 464',
  jibunAddress: '경기도 수원시 영통구 매탄동 1017',
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSessionJson(storageKey: string) {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const rawValue = window.sessionStorage.getItem(storageKey);

    return rawValue ? (JSON.parse(rawValue) as unknown) : null;
  } catch {
    return null;
  }
}

function getPathValue(value: unknown, path: string[]) {
  return path.reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), value);
}

function pickText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function extractAddress(value: unknown): ConsultationAddress | null {
  if (!isRecord(value)) {
    return null;
  }

  const roadAddress = pickText(
    getPathValue(value, ['building', 'roadAddress']),
    getPathValue(value, ['building', 'address']),
    getPathValue(value, ['selectedBuilding', 'roadAddress']),
    getPathValue(value, ['selectedBuilding', 'address']),
    value.roadAddress,
    value.address,
  );
  const jibunAddress = pickText(
    getPathValue(value, ['building', 'jibunAddress']),
    getPathValue(value, ['selectedBuilding', 'jibunAddress']),
    value.jibunAddress,
  );

  if (!roadAddress && !jibunAddress) {
    return null;
  }

  return {
    roadAddress: roadAddress ?? fallbackAddress.roadAddress,
    jibunAddress: jibunAddress ?? fallbackAddress.jibunAddress,
  };
}

function getConsultationAddress(): ConsultationAddress {
  const selectedSimulationAddress = extractAddress(readSessionJson(SELECTED_SIMULATION_RESULT_STORAGE_KEY));

  if (selectedSimulationAddress) {
    return selectedSimulationAddress;
  }

  const legacyInquiryAddress = extractAddress(readSessionJson(LEGACY_CONSULTATION_INQUIRY_STORAGE_KEY));

  if (legacyInquiryAddress) {
    return legacyInquiryAddress;
  }

  const serviceInquiryAddress = extractAddress(readSessionJson(SERVICE_CONSULTATION_INQUIRY_STORAGE_KEY));

  return serviceInquiryAddress ?? fallbackAddress;
}

function getSelectedSimulationContext() {
  const selectedSimulationResult = readSessionJson(SELECTED_SIMULATION_RESULT_STORAGE_KEY);

  if (!isRecord(selectedSimulationResult)) {
    return {
      analysisResultId: null,
      agentPayload: null,
      profitReportId: null,
      profitReportSummary: null,
    };
  }

  const analysisResultId = pickText(
    selectedSimulationResult.analysisResultId,
    getPathValue(selectedSimulationResult, ['aiSimulationResult', 'analysisResultId']),
    getPathValue(selectedSimulationResult, ['agentPayload', 'analysisResultId']),
  );
  const agentPayload = getPathValue(selectedSimulationResult, ['agentPayload']);
  const aiAgentPayload = getPathValue(selectedSimulationResult, ['aiSimulationResult', 'agentPayload']);
  const profitReport = readSessionJson(PROFIT_REPORT_STORAGE_KEY);
  const profitReportId = pickText(
    getPathValue(profitReport, ['profitReportId']),
    getPathValue(profitReport, ['report', 'source', 'profitReportId']),
  );
  const profitReportSummary = pickText(
    getPathValue(profitReport, ['report', 'reportNarrative', 'summary']),
    getPathValue(profitReport, ['report', 'reportNarrative', 'salesMessage']),
  );

  return {
    analysisResultId,
    agentPayload: isRecord(agentPayload) ? agentPayload : isRecord(aiAgentPayload) ? aiAgentPayload : null,
    profitReportId,
    profitReportSummary,
  };
}

function saveConsultationInquiry(inquiry: ServiceConsultationInquiry) {
  window.sessionStorage.setItem(SERVICE_CONSULTATION_INQUIRY_STORAGE_KEY, JSON.stringify(inquiry));

  window.sessionStorage.setItem(
    LEGACY_CONSULTATION_INQUIRY_STORAGE_KEY,
    JSON.stringify({
      ...inquiry,
      phone: inquiry.contact,
      type: inquiry.consultationType,
      message: inquiry.content,
      consultationRequestId: inquiry.consultationRequestId,
      analysisResultId: inquiry.analysisResultId,
    }),
  );
}

export default function ConsultationPage() {
  const navigate = useNavigate();
  const address = useMemo(() => getConsultationAddress(), []);
  const [formValues, setFormValues] = useState<ConsultationFormValues>({
    name: '',
    contact: '',
    email: '',
    consultationType: '',
    content: '',
    privacyAgreed: false,
    thirdPartyAgreed: false,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState('');

  const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const target = event.target;
    const { name, value } = target;
    const nextValue = target instanceof HTMLInputElement && target.type === 'checkbox' ? target.checked : value;

    setFormValues((prevValues) => ({
      ...prevValues,
      [name]: nextValue,
    }));
  };

  const handleHomeClick = () => {
    navigate('/');
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedFormValues = {
      name: formValues.name.trim(),
      contact: formValues.contact.trim(),
      email: formValues.email.trim(),
      consultationType: formValues.consultationType.trim(),
      content: formValues.content.trim(),
      privacyAgreed: formValues.privacyAgreed,
      thirdPartyAgreed: formValues.thirdPartyAgreed,
    };

    if (!trimmedFormValues.name || !trimmedFormValues.contact) {
      window.alert('이름과 연락처를 입력해주세요.');
      return;
    }

    if (!trimmedFormValues.privacyAgreed) {
      window.alert('개인정보 수집 및 이용에 동의해주세요.');
      return;
    }

    if (
      trimmedFormValues.name.length > CONSULTATION_INPUT_LIMITS.name ||
      trimmedFormValues.contact.length > CONSULTATION_INPUT_LIMITS.contact ||
      trimmedFormValues.email.length > CONSULTATION_INPUT_LIMITS.email ||
      trimmedFormValues.content.length > CONSULTATION_INPUT_LIMITS.content
    ) {
      window.alert('입력 가능한 글자 수를 초과했습니다.');
      return;
    }

    const selectedSimulationContext = getSelectedSimulationContext();
    const agentPayloadWithProfitReport = {
      ...(selectedSimulationContext.agentPayload ?? {}),
      ...(selectedSimulationContext.profitReportId || selectedSimulationContext.profitReportSummary
        ? {
            profitReport: {
              profitReportId: selectedSimulationContext.profitReportId,
              summary: selectedSimulationContext.profitReportSummary,
            },
          }
        : {}),
    };
    const rawContentWithProfitReport = selectedSimulationContext.profitReportSummary
      ? `${trimmedFormValues.content || 'AI 수익 리포트 기반 상담을 요청합니다.'}\n\nAI 수익 리포트 요약: ${
          selectedSimulationContext.profitReportSummary
        }`
      : trimmedFormValues.content;
    const contentWithProfitReport = rawContentWithProfitReport.slice(0, CONSULTATION_INPUT_LIMITS.content);
    const inquiry: ServiceConsultationInquiry = {
      ...trimmedFormValues,
      content: contentWithProfitReport,
      roadAddress: address.roadAddress,
      jibunAddress: address.jibunAddress,
      analysisResultId: selectedSimulationContext.analysisResultId,
      profitReportId: selectedSimulationContext.profitReportId,
      createdAt: new Date().toISOString(),
    };

    setIsSubmitting(true);
    setSubmitMessage('');
    window.sessionStorage.removeItem(CONSULTATION_REQUEST_ID_STORAGE_KEY);

    const response = await submitConsultationRequest({
      name: trimmedFormValues.name,
      contact: trimmedFormValues.contact,
      email: trimmedFormValues.email || undefined,
      consultationType: trimmedFormValues.consultationType || undefined,
      content: contentWithProfitReport || undefined,
      roadAddress: address.roadAddress,
      jibunAddress: address.jibunAddress,
      analysisResultId: selectedSimulationContext.analysisResultId,
      profitReportId: selectedSimulationContext.profitReportId,
      privacyAgreed: trimmedFormValues.privacyAgreed,
      thirdPartyAgreed: trimmedFormValues.thirdPartyAgreed,
      agentPayload: Object.keys(agentPayloadWithProfitReport).length > 0 ? agentPayloadWithProfitReport : null,
    });

    if (response.ok) {
      window.sessionStorage.setItem(CONSULTATION_REQUEST_ID_STORAGE_KEY, response.consultationRequestId);
      attachConsultationRequestIdToStoredSimulationResult(response.consultationRequestId);
      saveConsultationInquiry({
        ...inquiry,
        consultationRequestId: response.consultationRequestId,
        serverSaveStatus: 'saved',
        serverSaveMessage: response.message,
      });
      navigate('/consultation/complete');
      return;
    }

    saveConsultationInquiry({
      ...inquiry,
      serverSaveStatus: 'temporary',
      serverSaveMessage: TEMPORARY_SAVE_MESSAGE,
    });
    setSubmitMessage(TEMPORARY_SAVE_MESSAGE);
    window.alert(TEMPORARY_SAVE_MESSAGE);
    setIsSubmitting(false);
    navigate('/consultation/complete');
  };

  return (
    <div className="consultation-page">
      <SolarMateHeader />

      <main className="consultation-main">
        <section className="consultation-card" aria-labelledby="consultation-title">
          <div className="consultation-form-area">
            <h1 id="consultation-title" className="consultation-title">
              서비스 문의하기
            </h1>

            <AddressSummary address={address} />

            <form className="consultation-form" onSubmit={handleSubmit}>
              <label className="consultation-form-row" htmlFor="consultation-name">
                <span>이름</span>
                <input
                  id="consultation-name"
                  name="name"
                  type="text"
                  value={formValues.name}
                  maxLength={CONSULTATION_INPUT_LIMITS.name}
                  placeholder="이름을 입력해주세요."
                  onChange={handleChange}
                />
              </label>

              <label className="consultation-form-row" htmlFor="consultation-contact">
                <span>연락처</span>
                <input
                  id="consultation-contact"
                  name="contact"
                  type="text"
                  value={formValues.contact}
                  maxLength={CONSULTATION_INPUT_LIMITS.contact}
                  placeholder="연락처를 입력해주세요."
                  onChange={handleChange}
                />
              </label>

              <label className="consultation-form-row" htmlFor="consultation-email">
                <span>이메일</span>
                <input
                  id="consultation-email"
                  name="email"
                  type="email"
                  value={formValues.email}
                  maxLength={CONSULTATION_INPUT_LIMITS.email}
                  placeholder="선택 입력"
                  onChange={handleChange}
                />
              </label>

              <label className="consultation-form-row" htmlFor="consultation-type">
                <span>상담 유형</span>
                <span className="consultation-select-wrap">
                  <select
                    id="consultation-type"
                    name="consultationType"
                    className={formValues.consultationType ? '' : 'is-placeholder'}
                    value={formValues.consultationType}
                    onChange={handleChange}
                  >
                    <option value="" disabled>
                      상담 유형을 선택해주세요.
                    </option>
                    {consultationTypes.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                  <LuChevronDown aria-hidden="true" />
                </span>
              </label>

              <label className="consultation-form-row consultation-textarea-row" htmlFor="consultation-content">
                <span>상담 내용</span>
                <textarea
                  id="consultation-content"
                  name="content"
                  value={formValues.content}
                  maxLength={CONSULTATION_INPUT_LIMITS.content}
                  placeholder="상담 내용을 입력해주세요."
                  onChange={handleChange}
                />
              </label>

              <label className="consultation-consent-row" htmlFor="consultation-privacy-agreed">
                <input
                  id="consultation-privacy-agreed"
                  name="privacyAgreed"
                  type="checkbox"
                  checked={formValues.privacyAgreed}
                  onChange={handleChange}
                />
                <span>상담 접수를 위한 개인정보 수집 및 이용에 동의합니다.</span>
              </label>

              <label className="consultation-consent-row" htmlFor="consultation-third-party-agreed">
                <input
                  id="consultation-third-party-agreed"
                  name="thirdPartyAgreed"
                  type="checkbox"
                  checked={formValues.thirdPartyAgreed}
                  onChange={handleChange}
                />
                <span>설치 가능성 검토를 위해 협력 상담사에게 내용을 전달하는 것에 동의합니다.</span>
              </label>

              {submitMessage && <p className="consultation-submit-message">{submitMessage}</p>}

              <div className="consultation-button-row">
                <button className="consultation-home-button" type="button" onClick={handleHomeClick}>
                  <LuHouse aria-hidden="true" />
                  홈
                </button>

                <button className="consultation-submit-button" type="submit" disabled={isSubmitting}>
                  <LuMessageCircle aria-hidden="true" />
                  {isSubmitting ? '접수 중' : '상담 신청'}
                </button>
              </div>
            </form>
          </div>

          <aside className="consultation-info-card" aria-label="상담 가능 항목">
            <img
              className="consultation-info-image"
              src="/assets/consultation/consultation-solar-house.png"
              alt="태양광 패널이 설치된 주택 일러스트"
            />

            <h2>
              태양광 설치/이전
              <br />
              보조금 문의
            </h2>

            <div className="consultation-info-divider" />

            <ul>
              {serviceItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </aside>
        </section>
      </main>
    </div>
  );
}

function AddressSummary({ address }: { address: ConsultationAddress }) {
  return (
    <section className="consultation-address-box" aria-label="상담 주소 요약">
      <div className="consultation-address-row">
        <LuMapPin aria-hidden="true" />
        <strong>도로명 주소</strong>
        <p>{address.roadAddress}</p>
      </div>

      <div className="consultation-address-row">
        <span className="consultation-land-icon" aria-hidden="true" />
        <strong>지번</strong>
        <p>{address.jibunAddress}</p>
      </div>
    </section>
  );
}
