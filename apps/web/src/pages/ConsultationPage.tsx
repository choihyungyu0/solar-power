import { ChangeEvent, FormEvent, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LuChevronDown, LuHouse, LuMapPin, LuMessageCircle } from 'react-icons/lu';
import SolarMateHeader from '../components/SolarMateHeader';
import { SELECTED_SIMULATION_RESULT_STORAGE_KEY } from '../lib/simulationResultStorage';
import './ConsultationPage.css';

const LEGACY_CONSULTATION_INQUIRY_STORAGE_KEY = 'solarmate:consultationInquiry';
const SERVICE_CONSULTATION_INQUIRY_STORAGE_KEY = 'solarmate:serviceConsultationInquiry';

const consultationTypes = [
  '설치 가능 여부 상담',
  '이전 설치 문의',
  '보조금 및 지원 정책 안내',
  '절차 및 예상 비용 문의',
  '기타 문의',
];

const serviceItems = [
  '설치 가능 여부 상담',
  '이전 설치 문의',
  '보조금 및 지원 정책 안내',
  '절차 및 예상 비용 문의',
];

type ConsultationAddress = {
  roadAddress: string;
  jibunAddress: string;
};

type ConsultationFormValues = {
  name: string;
  contact: string;
  consultationType: string;
  content: string;
};

type ServiceConsultationInquiry = ConsultationFormValues &
  ConsultationAddress & {
    createdAt: string;
  };

type UnknownRecord = Record<string, unknown>;

const fallbackAddress: ConsultationAddress = {
  roadAddress: '경기도 수원시 팔달구 경수대로 464',
  jibunAddress: '경기도 수원시 팔달구 인계동 1017',
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

function saveConsultationInquiry(inquiry: ServiceConsultationInquiry) {
  window.sessionStorage.setItem(SERVICE_CONSULTATION_INQUIRY_STORAGE_KEY, JSON.stringify(inquiry));

  // Keep older dashboard/complete-page readers working while the new service key is adopted.
  window.sessionStorage.setItem(
    LEGACY_CONSULTATION_INQUIRY_STORAGE_KEY,
    JSON.stringify({
      ...inquiry,
      phone: inquiry.contact,
      email: '',
      type: inquiry.consultationType,
      message: inquiry.content,
    }),
  );
}

export default function ConsultationPage() {
  const navigate = useNavigate();
  const address = useMemo(() => getConsultationAddress(), []);
  const [formValues, setFormValues] = useState<ConsultationFormValues>({
    name: '',
    contact: '',
    consultationType: '',
    content: '',
  });

  const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = event.target;

    setFormValues((prevValues) => ({
      ...prevValues,
      [name]: value,
    }));
  };

  const handleHomeClick = () => {
    navigate('/');
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedFormValues = {
      name: formValues.name.trim(),
      contact: formValues.contact.trim(),
      consultationType: formValues.consultationType.trim(),
      content: formValues.content.trim(),
    };
    const hasMissingValue =
      !trimmedFormValues.name ||
      !trimmedFormValues.contact ||
      !trimmedFormValues.consultationType ||
      !trimmedFormValues.content;

    if (hasMissingValue) {
      window.alert('필수 항목을 입력해주세요.');
      return;
    }

    saveConsultationInquiry({
      ...trimmedFormValues,
      roadAddress: address.roadAddress,
      jibunAddress: address.jibunAddress,
      createdAt: new Date().toISOString(),
    });
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
                  placeholder="연락처를 입력해주세요."
                  onChange={handleChange}
                />
              </label>

              <label className="consultation-form-row" htmlFor="consultation-type">
                <span>상담유형</span>
                <span className="consultation-select-wrap">
                  <select
                    id="consultation-type"
                    name="consultationType"
                    className={formValues.consultationType ? '' : 'is-placeholder'}
                    value={formValues.consultationType}
                    onChange={handleChange}
                  >
                    <option value="" disabled>
                      상담유형을 선택해주세요.
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
                <span>상담내용</span>
                <textarea
                  id="consultation-content"
                  name="content"
                  value={formValues.content}
                  placeholder="상담내용을 입력해주세요."
                  onChange={handleChange}
                />
              </label>

              <div className="consultation-button-row">
                <button className="consultation-home-button" type="button" onClick={handleHomeClick}>
                  <LuHouse aria-hidden="true" />
                  홈
                </button>

                <button className="consultation-submit-button" type="submit">
                  <LuMessageCircle aria-hidden="true" />
                  상담신청
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
        <strong>도로명주소</strong>
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
