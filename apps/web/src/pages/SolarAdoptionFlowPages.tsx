import { useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LuArrowLeft,
  LuArrowRight,
  LuBadgeCheck,
  LuCheck,
  LuCoins,
  LuMapPin,
  LuPanelTop,
  LuPhone,
  LuShieldCheck,
} from 'react-icons/lu';
import SolarMateHeader from '../components/SolarMateHeader';
import { readLandingAddressDraft, saveLandingAddressDraft } from '../lib/addressDraft';
import './SolarAdoptionFlowPages.css';

const SOLAR_ADOPTION_INQUIRY_STORAGE_KEY = 'solarmate:solarAdoptionInquiry';

type SolarAdoptionInquiry = {
  name: string;
  phone: string;
  email: string;
  roadAddress: string;
  agreed: true;
  createdAt: string;
};

type StepNavProps = {
  previousTo: string;
  nextTo?: string;
  nextLabel?: string;
};

const defaultAddress = '경기도 수원시 팔달구 경수대로 464';

function SolarAdoptionStepShell({
  currentStep,
  title,
  description,
  children,
}: {
  currentStep: number;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="solar-flow-page">
      <SolarMateHeader />

      <main className="solar-flow-main">
        <section className="solar-flow-card" aria-labelledby="solar-flow-title">
          <div className="solar-flow-stepper" aria-label="태양광 도입 단계">
            {[1, 2, 3, 4].map((step) => (
              <span key={step} className={step <= currentStep ? 'is-active' : ''}>
                {step}
              </span>
            ))}
          </div>

          <p className="solar-flow-eyebrow">태양광 도입 {currentStep}단계</p>
          <h1 id="solar-flow-title">{title}</h1>
          <p className="solar-flow-description">{description}</p>

          {children}
        </section>
      </main>
    </div>
  );
}

function StepNav({ previousTo, nextTo, nextLabel = '다음' }: StepNavProps) {
  const navigate = useNavigate();

  return (
    <div className="solar-flow-actions">
      <button className="solar-flow-outline-button" type="button" onClick={() => navigate(previousTo)}>
        <LuArrowLeft aria-hidden="true" />
        이전
      </button>

      {nextTo && (
        <button className="solar-flow-primary-button" type="button" onClick={() => navigate(nextTo)}>
          {nextLabel}
          <LuArrowRight aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function useSolarFlowAddress() {
  return useMemo(() => readLandingAddressDraft()?.address ?? defaultAddress, []);
}

export function SolarAdoptionStep1Page() {
  const navigate = useNavigate();
  const savedAddress = useSolarFlowAddress();
  const [address, setAddress] = useState(savedAddress);

  const handleAddressSave = () => {
    const savedDraft = saveLandingAddressDraft(address, 'landing-hero');

    if (!savedDraft) {
      window.alert('주소를 입력해주세요.');
      return;
    }

    window.alert('주소가 임시 저장되었습니다. 실제 주소 검증은 지도 선택 단계에서 연동 예정입니다.');
  };

  const handleNext = () => {
    const savedDraft = saveLandingAddressDraft(address, 'landing-hero');

    if (!savedDraft) {
      window.alert('주소를 입력해주세요.');
      return;
    }

    navigate('/solar-adoption/step-2');
  };

  return (
    <SolarAdoptionStepShell
      currentStep={1}
      title="설치하실 위치가 위 주소가 맞으신가요?"
      description="지도 기반 진단에서 선택한 주소 또는 입력한 주소를 확인해주세요."
    >
      <section className="solar-flow-address-panel" aria-label="설치 주소 확인">
        <LuMapPin aria-hidden="true" />
        <label htmlFor="solar-flow-address">설치 예정 주소</label>
        <input id="solar-flow-address" type="text" value={address} onChange={(event) => setAddress(event.target.value)} />
      </section>

      <div className="solar-flow-actions">
        <button className="solar-flow-outline-button" type="button" onClick={() => navigate('/solar-adoption')}>
          <LuArrowLeft aria-hidden="true" />
          이전
        </button>
        <button className="solar-flow-ghost-button" type="button" onClick={handleAddressSave}>
          주소 수정
        </button>
        <button className="solar-flow-primary-button" type="button" onClick={handleNext}>
          다음
          <LuArrowRight aria-hidden="true" />
        </button>
      </div>
    </SolarAdoptionStepShell>
  );
}

export function SolarAdoptionStep2Page() {
  const [selectedPanel, setSelectedPanel] = useState('500W 표준형');
  const [selectedAngle, setSelectedAngle] = useState('30도 고정형');

  return (
    <SolarAdoptionStepShell
      currentStep={2}
      title="기본 설치 옵션을 선택해주세요."
      description="MVP에서는 실제 구조 검토 전 단계의 데모 산식 기준 옵션입니다."
    >
      <div className="solar-flow-option-grid">
        {['500W 표준형', '640W 고효율형'].map((panel) => (
          <button
            key={panel}
            className={`solar-flow-option-card ${selectedPanel === panel ? 'is-selected' : ''}`}
            type="button"
            onClick={() => setSelectedPanel(panel)}
          >
            <LuPanelTop aria-hidden="true" />
            <strong>{panel}</strong>
            <span>{panel.includes('640') ? '면적 대비 발전량 상향 예상' : '공동주택 기본 검토안'}</span>
          </button>
        ))}

        {['30도 고정형', '35도 고정형'].map((angle) => (
          <button
            key={angle}
            className={`solar-flow-option-card ${selectedAngle === angle ? 'is-selected' : ''}`}
            type="button"
            onClick={() => setSelectedAngle(angle)}
          >
            <LuBadgeCheck aria-hidden="true" />
            <strong>{angle}</strong>
            <span>{angle.includes('30') ? '음영 간격과 면적 활용 균형' : '발전 효율 우선 검토안'}</span>
          </button>
        ))}
      </div>

      <StepNav previousTo="/solar-adoption/step-1" nextTo="/solar-adoption/step-3" />
    </SolarAdoptionStepShell>
  );
}

export function SolarAdoptionStep3Page() {
  return (
    <SolarAdoptionStepShell
      currentStep={3}
      title="도입비용과 지원 가능성을 확인해주세요."
      description="보조금은 확정 금액이 아니며 실제 공고 확인이 필요합니다."
    >
      <section className="solar-flow-cost-card" aria-label="도입비용 요약">
        <div>
          <span>도입비용</span>
          <strong>투자비 27,000,000원</strong>
        </div>
        <div>
          <span>지원 후보</span>
          <strong>최대 보조금 13,980,000원</strong>
        </div>
        <div>
          <span>예상 자부담</span>
          <strong>실 자부담금 13,020,000원</strong>
        </div>
        <div>
          <span>정책 금융</span>
          <strong>대출한도: 자부담의 75%</strong>
        </div>
      </section>

      <div className="solar-flow-loan-note">
        <LuCoins aria-hidden="true" />
        <p>
          월 9만원대로 (36개월 납입)
          <small>한국에너지공단 공동주택 기준 데모 안내이며 실제 보조금·금융 조건은 확인 필요합니다.</small>
        </p>
      </div>

      <StepNav previousTo="/solar-adoption/step-2" nextTo="/solar-adoption/step-4" />
    </SolarAdoptionStepShell>
  );
}

export function SolarAdoptionStep4Page() {
  const navigate = useNavigate();
  const address = useSolarFlowAddress();
  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    agreed: false,
  });

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value, checked, type } = event.target;

    setForm((prevForm) => ({
      ...prevForm,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const inquiry: SolarAdoptionInquiry = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      roadAddress: address,
      agreed: true,
      createdAt: new Date().toISOString(),
    };

    if (!inquiry.name || !inquiry.phone || !inquiry.email || !form.agreed) {
      window.alert('이름, 전화번호, 이메일, 개인정보 이용동의를 확인해주세요.');
      return;
    }

    window.sessionStorage.setItem(SOLAR_ADOPTION_INQUIRY_STORAGE_KEY, JSON.stringify(inquiry));
    navigate('/solar-adoption/complete');
  };

  return (
    <SolarAdoptionStepShell
      currentStep={4}
      title="상담을 위해 문의 정보를 남겨주세요."
      description="정확한 상담을 위해 위 주소가 맞는지 확인해주세요."
    >
      <section className="solar-flow-warning">
        <LuShieldCheck aria-hidden="true" />
        정확한 상담을 위해 위 주소가 맞는지 확인해주세요.
      </section>

      <form className="solar-flow-form" onSubmit={handleSubmit}>
        <label>
          <span>이름</span>
          <input name="name" type="text" value={form.name} onChange={handleChange} />
        </label>
        <label>
          <span>전화번호</span>
          <input name="phone" type="tel" value={form.phone} onChange={handleChange} />
        </label>
        <label>
          <span>이메일</span>
          <input name="email" type="email" value={form.email} onChange={handleChange} />
        </label>
        <label className="solar-flow-checkbox">
          <input name="agreed" type="checkbox" checked={form.agreed} onChange={handleChange} />
          <span>개인정보 이용동의</span>
        </label>

        <div className="solar-flow-actions">
          <button className="solar-flow-outline-button" type="button" onClick={() => navigate('/solar-adoption/step-3')}>
            <LuArrowLeft aria-hidden="true" />
            이전
          </button>
          <button className="solar-flow-primary-button" type="submit">
            태양광 문의접수
            <LuArrowRight aria-hidden="true" />
          </button>
        </div>
      </form>
    </SolarAdoptionStepShell>
  );
}

export function SolarAdoptionCompletePage() {
  const navigate = useNavigate();

  return (
    <div className="solar-flow-page">
      <SolarMateHeader />

      <main className="solar-flow-main">
        <section className="solar-flow-complete-card" aria-labelledby="solar-flow-complete-title">
          <div className="solar-flow-complete-icon">
            <LuCheck aria-hidden="true" />
          </div>

          <h1 id="solar-flow-complete-title">정상적으로 접수되었습니다.</h1>
          <p>담당 매니저가 순차적으로 연락드리겠습니다.</p>
          <p>(영업일 기준 1일 ~ 3일이 소요됩니다.)</p>

          <button className="solar-flow-primary-button" type="button" onClick={() => navigate('/solar-adoption')}>
            돌아가기
          </button>
        </section>
      </main>
    </div>
  );
}
