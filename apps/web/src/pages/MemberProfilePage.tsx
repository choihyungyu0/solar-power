import { useMemo, useState } from 'react';
import {
  LuChartNoAxesColumnIncreasing,
  LuCircleUserRound,
  LuHeadphones,
  LuUserRound,
} from 'react-icons/lu';
import { readSimulationResultFromSession } from '../lib/simulationResultStorage';
import './MemberProfilePage.css';

const CONSULTATION_INQUIRY_STORAGE_KEY = 'solarmate:consultationInquiry';

type ProfileValues = {
  name: string;
  birthDate: string;
  phone: string;
  email: string;
};

type AddressSummary = {
  roadAddress: string;
  jibunAddress: string;
};

type StoredConsultationInquiry = {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
};

type ProfileField = {
  id: keyof ProfileValues | 'password';
  label: string;
  name?: keyof ProfileValues;
  buttonText?: string;
};

const fallbackProfileValues: ProfileValues = {
  name: '김솔라',
  birthDate: '1998.03.12',
  phone: '010-1234-5678',
  email: 'solarmate@example.com',
};

const fallbackAddress: AddressSummary = {
  roadAddress: '경기도 수원시 팔달구 경수대로 464',
  jibunAddress: '경기 수원시 팔달구 인계동 1017',
};

const profileFields: ProfileField[] = [
  {
    id: 'name',
    label: '이름',
    name: 'name',
  },
  {
    id: 'birthDate',
    label: '생년월일',
    name: 'birthDate',
  },
  {
    id: 'phone',
    label: '전화번호',
    name: 'phone',
    buttonText: '변경',
  },
  {
    id: 'email',
    label: '이메일',
    name: 'email',
    buttonText: '변경',
  },
  {
    id: 'password',
    label: '비밀번호',
    buttonText: '변경',
  },
];

function pickText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readConsultationInquiryFromSession() {
  try {
    const rawValue = window.sessionStorage.getItem(CONSULTATION_INQUIRY_STORAGE_KEY);

    if (!rawValue) {
      return null;
    }

    const parsedValue = JSON.parse(rawValue) as StoredConsultationInquiry;

    return parsedValue && typeof parsedValue === 'object' ? parsedValue : null;
  } catch {
    return null;
  }
}

function getInitialProfileValues(): ProfileValues {
  const inquiry = readConsultationInquiryFromSession();

  return {
    name: pickText(inquiry?.name) ?? fallbackProfileValues.name,
    birthDate: fallbackProfileValues.birthDate,
    phone: pickText(inquiry?.phone) ?? fallbackProfileValues.phone,
    email: pickText(inquiry?.email) ?? fallbackProfileValues.email,
  };
}

function getAddressSummary(): AddressSummary {
  const storedResult = readSimulationResultFromSession();

  return {
    roadAddress: pickText(storedResult?.building.roadAddress) ?? fallbackAddress.roadAddress,
    jibunAddress: pickText(storedResult?.building.jibunAddress) ?? fallbackAddress.jibunAddress,
  };
}

function showDemoChangeAlert() {
  window.alert('데모 화면에서는 실제 정보 변경이 저장되지 않습니다.');
}

function handleMemberLogout() {
  Object.keys(window.sessionStorage)
    .filter((key) => key.startsWith('solarmate:'))
    .forEach((key) => window.sessionStorage.removeItem(key));
  window.location.assign('/');
}

export default function MemberProfilePage() {
  const initialProfileValues = useMemo(() => getInitialProfileValues(), []);
  const address = useMemo(() => getAddressSummary(), []);
  const [profileValues, setProfileValues] = useState<ProfileValues>(initialProfileValues);

  const updateProfileValue = (name: keyof ProfileValues, value: string) => {
    setProfileValues((prevValues) => ({
      ...prevValues,
      [name]: value,
    }));
  };

  return (
    <div className="member-profile-page">
      <MemberProfileHeader />

      <main className="member-profile-main">
        <section className="member-profile-card" aria-labelledby="member-profile-title">
          <AddressBox address={address} />

          <section className="member-profile-hero">
            <div className="member-profile-hero-text">
              <h1 id="member-profile-title">회원정보 관리</h1>
              <p>내 정보를 확인하고 필요한 항목을 수정하세요</p>
            </div>

            <ProfileHeroGraphic />
          </section>

          <form className="member-profile-form" onSubmit={(event) => event.preventDefault()}>
            {profileFields.map((field) => {
              const fieldName = field.name;

              return (
                <ProfileRow
                  key={field.id}
                  field={field}
                  value={fieldName ? profileValues[fieldName] : ''}
                  onChange={fieldName ? (value) => updateProfileValue(fieldName, value) : undefined}
                />
              );
            })}

            <div className="member-profile-row">
              <span className="member-profile-label">간편로그인 연동</span>

              <button
                className="member-profile-naver-button"
                type="button"
                aria-label="네이버 간편로그인 연동"
                onClick={() => window.alert('네이버 간편로그인 연동은 추후 구현 예정입니다.')}
              >
                <span aria-hidden="true">N</span>
                네이버
              </button>
            </div>
          </form>

          <MemberProfileBottomTabs />
        </section>
      </main>
    </div>
  );
}

function MemberProfileHeader() {
  return (
    <header className="member-profile-header">
      <a className="member-profile-logo" href="/" aria-label="솔라메이트 홈">
        <span className="member-profile-logo-mark" aria-hidden="true">
          <span className="member-profile-logo-sun" />
          <span className="member-profile-logo-panel">
            {Array.from({ length: 6 }).map((_, index) => (
              <span key={index} />
            ))}
          </span>
        </span>

        <span className="member-profile-logo-text">
          <strong>솔라메이트</strong>
          <small>SolarMate</small>
        </span>
      </a>

      <nav className="member-profile-nav" aria-label="주요 메뉴">
        <a href="/solar-adoption">태양광 도입</a>
        <a href="/#service-intro">서비스 소개</a>
        <a href="/notice">공지사항</a>
        <a className="is-active" href="/member/as" aria-current="page">
          고객센터
        </a>
      </nav>

      <button className="member-profile-logout-button" type="button" onClick={handleMemberLogout}>
        <LuUserRound aria-hidden="true" />
        로그아웃
      </button>
    </header>
  );
}

function AddressBox({ address }: { address: AddressSummary }) {
  return (
    <section className="member-profile-address-box" aria-label="선택 주소 요약">
      <div className="member-profile-address-row">
        <span aria-hidden="true">•</span>
        <strong>도로명주소</strong>
        <p>{address.roadAddress}</p>
      </div>

      <div className="member-profile-address-row">
        <span aria-hidden="true">•</span>
        <strong>지번</strong>
        <p>{address.jibunAddress}</p>
      </div>
    </section>
  );
}

function ProfileHeroGraphic() {
  return (
    <div className="member-profile-hero-graphic" aria-hidden="true">
      <div className="member-profile-id-card">
        <span />
        <i />
        <i />
      </div>

      <div className="member-profile-circle">
        <span />
        <strong />
      </div>

      <div className="member-profile-shield">✓</div>
    </div>
  );
}

function ProfileRow({
  field,
  value,
  onChange,
}: {
  field: ProfileField;
  value: string;
  onChange?: (value: string) => void;
}) {
  const inputId = `member-profile-${field.id}`;

  return (
    <div className="member-profile-row">
      {field.name ? (
        <label className="member-profile-label" htmlFor={inputId}>
          {field.label}
        </label>
      ) : (
        <span className="member-profile-label">{field.label}</span>
      )}

      <div className={`member-profile-field-group ${field.buttonText ? 'has-button' : ''}`}>
        {field.name && (
          <input
            id={inputId}
            className="member-profile-input"
            name={field.name}
            type="text"
            value={value}
            onChange={(event) => onChange?.(event.target.value)}
          />
        )}

        {field.buttonText && (
          <button
            className="member-profile-change-button"
            type="button"
            aria-label={`${field.label} 변경`}
            onClick={showDemoChangeAlert}
          >
            {field.buttonText}
          </button>
        )}
      </div>
    </div>
  );
}

function MemberProfileBottomTabs() {
  return (
    <nav className="member-profile-bottom-tabs" aria-label="회원 메뉴">
      <button
        className="member-profile-tab-button"
        type="button"
        onClick={() => window.location.assign('/member/dashboard')}
      >
        <LuChartNoAxesColumnIncreasing aria-hidden="true" />
        발전량
      </button>

      <button className="member-profile-tab-button" type="button" onClick={() => window.location.assign('/member/as')}>
        <LuHeadphones aria-hidden="true" />
        A/S
      </button>

      <button className="member-profile-tab-button is-active" type="button" aria-current="page">
        <LuCircleUserRound aria-hidden="true" />
        회원관리
      </button>
    </nav>
  );
}
