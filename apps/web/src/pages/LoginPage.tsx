import { type ChangeEvent, type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SolarMateHeader from '../components/SolarMateHeader';
import { setDemoAuth } from '../lib/demoAuth';
import './LoginPage.css';

type LoginFormState = {
  id: string;
  password: string;
};

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

export default function LoginPage() {
  const navigate = useNavigate();
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

    const authState = setDemoAuth(userId);

    if (authState.role === 'uninstalled') {
      navigate('/member/no-installation');
      return;
    }

    navigate('/member/dashboard?tab=generation');
  };

  const handleSignupClick = () => {
    window.alert('회원가입 기능은 추후 구현 예정입니다.');
  };

  const handleFindAccountClick = () => {
    window.alert('ID/비밀번호 찾기 기능은 추후 구현 예정입니다.');
  };

  return (
    <div className="login-page">
      <SolarMateHeader />

      <main className="login-main">
        <section className="login-card" aria-labelledby="login-title">
          <div className="login-lock-circle">
            <LockIcon />
          </div>

          <h1 id="login-title">로그인</h1>
          <p>이코햇 서비스를 이용하기 위해 로그인해주세요.</p>
          <p className="login-demo-help">
            데모 로그인: 아무 ID/PW 입력 시 설치자 화면으로 이동합니다. ID에 guest 또는 미설치를 입력하면 미설치자 화면으로 이동합니다.
          </p>

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
