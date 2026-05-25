import { type ChangeEvent, type FormEvent, useState } from 'react';
import { saveDemoAuthState } from '../lib/demoAuth';
import './LoginPage.css';

type LoginFormState = {
  id: string;
  password: string;
};

function SolarMateLogo() {
  return (
    <a className="login-logo" href="/" aria-label="SolarMate 홈">
      <svg className="login-logo-icon" viewBox="0 0 82 60" fill="none" aria-hidden="true">
        <circle cx="22" cy="24" r="14" fill="#FDB813" />
        <path d="M22 3V11" stroke="#FDB813" strokeWidth="4" strokeLinecap="round" />
        <path d="M22 37V45" stroke="#FDB813" strokeWidth="4" strokeLinecap="round" />
        <path d="M1 24H9" stroke="#FDB813" strokeWidth="4" strokeLinecap="round" />
        <path d="M35 24H43" stroke="#FDB813" strokeWidth="4" strokeLinecap="round" />
        <path d="M7.2 9.2L12.8 14.8" stroke="#FDB813" strokeWidth="4" strokeLinecap="round" />
        <path d="M31.2 33.2L36.8 38.8" stroke="#FDB813" strokeWidth="4" strokeLinecap="round" />
        <path d="M36.8 9.2L31.2 14.8" stroke="#FDB813" strokeWidth="4" strokeLinecap="round" />
        <path d="M12.8 33.2L7.2 38.8" stroke="#FDB813" strokeWidth="4" strokeLinecap="round" />
        <path d="M38 26H75L68 51H31L38 26Z" fill="#1468E8" />
        <path d="M45 26L38 51" stroke="#ffffff" strokeWidth="2" opacity="0.85" />
        <path d="M55 26L50 51" stroke="#ffffff" strokeWidth="2" opacity="0.85" />
        <path d="M65 26L62 51" stroke="#ffffff" strokeWidth="2" opacity="0.85" />
        <path d="M35 36H72" stroke="#ffffff" strokeWidth="2" opacity="0.85" />
        <path d="M33 44H70" stroke="#ffffff" strokeWidth="2" opacity="0.85" />
      </svg>

      <span>SolarMate</span>
    </a>
  );
}

function UserIcon() {
  return (
    <svg width="31" height="31" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M4.5 20c1.3-4.2 4.1-6.2 7.5-6.2s6.2 2 7.5 6.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="47" height="47" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 14v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function JoinIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="9" cy="8" r="4" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M2.8 20c1.1-4 3.5-6 6.2-6 1.4 0 2.7.5 3.7 1.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="17.5" cy="17.5" r="3.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M17.5 15.8v3.4M15.8 17.5h3.4" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.9" />
      <path d="M15.4 15.4L21 21" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function LoginHeader() {
  const handleLoginClick = () => {
    if (window.location.pathname !== '/login') {
      window.location.assign('/login');
    }
  };

  return (
    <header className="login-header">
      <div className="login-header-inner">
        <SolarMateLogo />

        <nav className="login-nav" aria-label="주요 메뉴">
          <a href="/solar-adoption">태양광 도입</a>
          <a href="/#service-intro">서비스 소개</a>
          <a href="/notice">공지사항</a>
          <a href="/consultation">고객센터</a>
        </nav>

        <button className="login-header-button" type="button" onClick={handleLoginClick}>
          <UserIcon />
          로그인
        </button>
      </div>
    </header>
  );
}

export default function LoginPage() {
  const [form, setForm] = useState<LoginFormState>({
    id: '',
    password: '',
  });

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;

    setForm((prevForm) => ({
      ...prevForm,
      [name]: value,
    }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const userId = form.id.trim();
    const password = form.password.trim();

    if (!userId || !password) {
      window.alert('아이디와 비밀번호를 입력해주세요.');
      return;
    }

    saveDemoAuthState(userId);
    window.location.assign('/member/dashboard');
  };

  const handleSignupClick = () => {
    window.alert('회원가입 기능은 추후 구현 예정입니다.');
  };

  const handleFindAccountClick = () => {
    window.alert('ID/비밀번호 찾기 기능은 추후 구현 예정입니다.');
  };

  return (
    <div className="login-page">
      <LoginHeader />

      <main className="login-main">
        <section className="login-card" aria-labelledby="login-title">
          <div className="login-lock-circle">
            <LockIcon />
          </div>

          <h1 id="login-title">로그인</h1>
          <p>SolarMate 서비스를 이용하기 위해 로그인해주세요.</p>

          <form className="login-form" onSubmit={handleSubmit}>
            <div className="login-form-row">
              <label htmlFor="login-id">ID</label>
              <input
                id="login-id"
                name="id"
                type="text"
                value={form.id}
                autoComplete="username"
                placeholder="아이디를 입력해주세요."
                onChange={handleChange}
              />
            </div>

            <div className="login-form-row">
              <label htmlFor="login-password">PW</label>
              <input
                id="login-password"
                name="password"
                type="password"
                value={form.password}
                autoComplete="current-password"
                placeholder="비밀번호를 입력해주세요."
                onChange={handleChange}
              />
            </div>

            <button className="login-submit-button" type="submit">
              로그인
            </button>

            <div className="login-sub-button-row">
              <button type="button" className="login-outline-button" onClick={handleSignupClick}>
                <JoinIcon />
                회원가입
              </button>

              <button type="button" className="login-outline-button" onClick={handleFindAccountClick}>
                <SearchIcon />
                ID/비밀번호 찾기
              </button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
