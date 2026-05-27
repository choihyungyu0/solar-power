import type { Session, SupabaseClient } from '@supabase/supabase-js';
import type { FormEvent } from 'react';
import { useState } from 'react';
import { clearDemoAuth } from '../lib/demoAuth';
import { createPrivacyConsentMetadata } from '../lib/memberProfile';

type AuthPanelProps = {
  supabase: SupabaseClient | null;
  session: Session | null;
  isConfigured: boolean;
  setupMessage: string;
};

function getFriendlyAuthError(message: string) {
  if (message.toLowerCase().includes('invalid login')) {
    return '이메일 또는 비밀번호를 다시 확인해 주세요.';
  }

  if (message.toLowerCase().includes('password')) {
    return '비밀번호는 Supabase 설정 기준을 충족해야 합니다.';
  }

  return message;
}

function AuthPanel({ supabase, session, isConfigured, setupMessage }: AuthPanelProps) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [privacyAgreed, setPrivacyAgreed] = useState(false);
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase || !isConfigured) {
      setMessage(setupMessage);
      return;
    }

    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();
    const trimmedName = name.trim();

    if (!trimmedEmail || !trimmedPassword) {
      setMessage('이메일과 비밀번호를 입력해 주세요.');
      return;
    }

    if (mode === 'signup' && !trimmedName) {
      setMessage('회원가입을 위해 이름을 입력해 주세요.');
      return;
    }

    if (mode === 'signup' && !privacyAgreed) {
      setMessage('회원가입을 위해 개인정보 수집 및 이용에 동의해 주세요.');
      return;
    }

    setIsSubmitting(true);
    setMessage('');

    const response =
      mode === 'signup'
        ? await supabase.auth.signUp({
            email: trimmedEmail,
            password: trimmedPassword,
            options: {
              data: createPrivacyConsentMetadata(trimmedName),
            },
          })
        : await supabase.auth.signInWithPassword({ email: trimmedEmail, password: trimmedPassword });

    setIsSubmitting(false);

    if (response.error) {
      setMessage(getFriendlyAuthError(response.error.message));
      return;
    }

    setMessage(mode === 'signup' ? '회원가입 요청이 완료되었습니다. 이메일 확인 설정이 켜져 있으면 메일함을 확인해 주세요.' : '로그인되었습니다.');
  }

  async function handleLogout() {
    if (!supabase) {
      return;
    }

    await supabase.auth.signOut();
    clearDemoAuth();
    setMessage('로그아웃되었습니다.');
  }

  if (session?.user) {
    return (
      <section className="mvpPanel authPanel" aria-label="로그인 상태">
        <span className="panelKicker">Supabase Auth</span>
        <h2>로그인 상태</h2>
        <p className="signedInEmail">{session.user.email}</p>
        <button className="ghostButton" type="button" onClick={handleLogout}>
          로그아웃
        </button>
        <p className="panelNote">요청서, 시뮬레이션 결과, 알림 선호 채널이 사용자별 Row Level Security 정책으로 저장됩니다.</p>
      </section>
    );
  }

  return (
    <section className="mvpPanel authPanel" aria-label="로그인 및 회원가입">
      <span className="panelKicker">Supabase Auth</span>
      <h2>계정 연결</h2>
      {!isConfigured && (
        <p className="setupNotice">{setupMessage}</p>
      )}
      <div className="segmentedControl" role="tablist" aria-label="인증 모드">
        <button className={mode === 'login' ? 'isActive' : ''} type="button" onClick={() => setMode('login')}>
          로그인
        </button>
        <button className={mode === 'signup' ? 'isActive' : ''} type="button" onClick={() => setMode('signup')}>
          회원가입
        </button>
      </div>
      <form className="authForm" onSubmit={handleSubmit}>
        <label>
          이메일
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="manager@example.com" />
        </label>
        <label>
          비밀번호
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="8자 이상" />
        </label>
        {mode === 'signup' && (
          <>
            <label>
              이름
              <input value={name} onChange={(event) => setName(event.target.value)} type="text" placeholder="예: 김솔라" />
            </label>
            <section className="authPrivacyBox" aria-label="개인정보 수집 및 이용 동의">
              <strong>개인정보 수집 및 이용 동의</strong>
              <p>계정 생성, 요청서·시뮬레이션 저장, 상담 및 알림 선호 관리에 필요한 정보만 MVP 범위에서 저장합니다.</p>
              <label>
                <input
                  type="checkbox"
                  checked={privacyAgreed}
                  onChange={(event) => setPrivacyAgreed(event.target.checked)}
                />
                위 개인정보 수집 및 이용에 동의합니다. (필수)
              </label>
            </section>
          </>
        )}
        <button className="primaryButton mvpPrimaryButton" type="submit" disabled={isSubmitting}>
          {isSubmitting ? '처리 중' : mode === 'login' ? '로그인' : '회원가입'}
        </button>
      </form>
      {message && <p className="formMessage">{message}</p>}
    </section>
  );
}

export default AuthPanel;
