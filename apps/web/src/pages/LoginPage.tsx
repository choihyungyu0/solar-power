import { type ChangeEvent, type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LuShieldCheck } from 'react-icons/lu';
import SolarMateHeader from '../components/SolarMateHeader';
import { clearDemoAuth, setDemoAuth } from '../lib/demoAuth';
import { isSupabaseConfigured, supabase, supabaseConfigMessage } from '../lib/supabase';
import { useSupabaseSession } from '../lib/useSupabaseSession';
import './LoginPage.css';

type AuthMode = 'login' | 'signup';

type LoginFormState = {
  email: string;
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

function getFriendlyAuthError(message: string) {
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('invalid login')) {
    return '이메일 또는 비밀번호를 다시 확인해 주세요.';
  }

  if (lowerMessage.includes('already registered') || lowerMessage.includes('already exists')) {
    return '이미 가입된 이메일입니다. 로그인으로 진행해 주세요.';
  }

  if (lowerMessage.includes('password')) {
    return '비밀번호는 Supabase 설정 기준을 충족해야 합니다.';
  }

  return message;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const { session } = useSupabaseSession();
  const [mode, setMode] = useState<AuthMode>('login');
  const [form, setForm] = useState<LoginFormState>({
    email: '',
    password: '',
  });
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;

    setForm((prevForm) => ({
      ...prevForm,
      [name]: value,
    }));
  };

  const handleDashboardClick = () => {
    if (session?.user) {
      setDemoAuth(session.user.email ?? session.user.id);
    }

    navigate('/member/dashboard?tab=generation');
  };

  const handleAdminClick = () => {
    navigate('/admin/consultations');
  };

  const handleLogout = async () => {
    await supabase?.auth.signOut();
    clearDemoAuth();
    setMessage('로그아웃되었습니다.');
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!supabase || !isSupabaseConfigured) {
      setMessage(supabaseConfigMessage);
      return;
    }

    const email = form.email.trim();
    const password = form.password.trim();

    if (!email || !password) {
      setMessage('이메일과 비밀번호를 입력해 주세요.');
      return;
    }

    setIsSubmitting(true);
    setMessage('');

    const response =
      mode === 'signup'
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password });

    setIsSubmitting(false);

    if (response.error) {
      setMessage(getFriendlyAuthError(response.error.message));
      return;
    }

    if (mode === 'signup') {
      if (response.data.session) {
        setDemoAuth(response.data.user?.email ?? email);
        navigate('/member/dashboard?tab=generation');
        return;
      }

      setMode('login');
      setMessage('회원가입 요청이 완료되었습니다. 이메일 확인 설정이 켜져 있으면 메일함을 확인해 주세요.');
      return;
    }

    setDemoAuth(response.data.user?.email ?? email);
    navigate('/member/dashboard?tab=generation');
  };

  const handleSignupClick = () => {
    setMode((currentMode) => (currentMode === 'signup' ? 'login' : 'signup'));
    setMessage('');
  };

  const handleFindAccountClick = async () => {
    if (!supabase || !isSupabaseConfigured) {
      setMessage(supabaseConfigMessage);
      return;
    }

    const email = form.email.trim();

    if (!email) {
      setMessage('비밀번호 재설정 메일을 받을 이메일을 먼저 입력해 주세요.');
      return;
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email);

    setMessage(error ? getFriendlyAuthError(error.message) : '비밀번호 재설정 메일 요청을 보냈습니다.');
  };

  return (
    <div className="login-page">
      <SolarMateHeader />

      <main className="login-main">
        <section className="login-card" aria-labelledby="login-title">
          <div className="login-lock-circle">
            <LockIcon />
          </div>

          <h1 id="login-title">{session?.user ? '로그인 상태' : mode === 'signup' ? '회원가입' : '로그인'}</h1>
          <p>Supabase 이메일/비밀번호 계정으로 요청서와 시뮬레이션 결과를 사용자별로 저장합니다.</p>
          {!isSupabaseConfigured && (
            <p className="login-demo-help">{supabaseConfigMessage}</p>
          )}

          {session?.user ? (
            <div className="login-session-panel">
              <strong>{session.user.email}</strong>
              <span>현재 Supabase Auth 세션으로 로그인되어 있습니다.</span>
              <button className="login-submit-button" type="button" onClick={handleDashboardClick}>
                대시보드로 이동
              </button>
              <button className="login-outline-button" type="button" onClick={handleLogout}>
                로그아웃
              </button>
              <button className="login-admin-button" type="button" onClick={handleAdminClick}>
                <LuShieldCheck aria-hidden="true" />
                관리자 화면으로 이동
              </button>
            </div>
          ) : (
            <form className="login-form" onSubmit={handleSubmit}>
              <div className="login-form-row">
                <label htmlFor="login-email">Email</label>
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  value={form.email}
                  autoComplete="email"
                  placeholder="manager@example.com"
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
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  placeholder="비밀번호를 입력해 주세요."
                  onChange={handleChange}
                />
              </div>

              <button className="login-submit-button" type="submit" disabled={isSubmitting}>
                {isSubmitting ? '처리 중' : mode === 'signup' ? '회원가입' : '로그인'}
              </button>

              <div className="login-sub-button-row">
                <button type="button" className="login-outline-button" onClick={handleSignupClick}>
                  <JoinIcon />
                  {mode === 'signup' ? '로그인으로' : '회원가입'}
                </button>

                <button type="button" className="login-outline-button" onClick={handleFindAccountClick}>
                  <SearchIcon />
                  비밀번호 찾기
                </button>
              </div>

              <button type="button" className="login-admin-button" onClick={handleAdminClick}>
                <LuShieldCheck aria-hidden="true" />
                관리자 화면으로 이동
              </button>
            </form>
          )}

          {message && <p className="login-form-message">{message}</p>}
        </section>
      </main>
    </div>
  );
}
