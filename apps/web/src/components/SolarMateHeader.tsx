import { useMemo } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { LuChevronRight, LuUserRound } from 'react-icons/lu';
import { clearDemoAuth, getDemoAuth } from '../lib/demoAuth';
import { supabase } from '../lib/supabase';
import { useSupabaseSession } from '../lib/useSupabaseSession';
import './SolarMateHeader.css';

type SolarMateHeaderProps = {
  variant?: 'public' | 'member';
  onBeforeLogin?: () => void;
  onBeforeLogout?: () => void;
};

const navItems = [
  {
    label: '태양광 도입',
    to: '/solar-adoption',
  },
  {
    label: '서비스 소개',
    to: '/service',
  },
  {
    label: '공지사항',
    to: '/notice',
  },
  {
    label: '상담하기',
    to: '/consultation',
  },
];

export default function SolarMateHeader({ variant = 'public', onBeforeLogin, onBeforeLogout }: SolarMateHeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = useSupabaseSession();
  const demoAuth = useMemo(() => getDemoAuth(), [location.pathname, location.search]);
  const isSupabaseLoggedIn = Boolean(session?.user);
  const isLoggedIn = isSupabaseLoggedIn || demoAuth?.isLoggedIn === true;

  const handleAuthClick = async () => {
    if (isLoggedIn) {
      onBeforeLogout?.();
      if (isSupabaseLoggedIn) {
        await supabase?.auth.signOut();
      }
      clearDemoAuth();
      navigate('/login');
      return;
    }

    onBeforeLogin?.();
    navigate('/login');
  };

  const handleLoginClick = () => {
    onBeforeLogin?.();
    navigate('/login?mode=login');
  };

  const handleSignupClick = () => {
    onBeforeLogin?.();
    navigate('/login?mode=signup');
  };

  return (
    <header className={`solarmate-header ${variant === 'member' ? 'is-member' : ''}`}>
      <NavLink className="solarmate-header-logo" to="/" aria-label="이코햇 홈">
        <img className="solarmate-header-logo-image" src="/assets/logo.png" alt="이코햇" />
      </NavLink>

      <nav className="solarmate-header-nav" aria-label="주요 메뉴">
        {navItems.map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'is-active' : undefined)}>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="solarmate-header-auth-group" aria-label="계정 메뉴">
        {isLoggedIn ? (
          <button className="solarmate-header-auth is-logout" type="button" onClick={handleAuthClick}>
            <LuUserRound aria-hidden="true" />
            로그아웃
          </button>
        ) : (
          <>
            <button
              className={`solarmate-header-auth is-signup ${
                location.pathname === '/login' && location.search.includes('mode=signup') ? 'is-active' : ''
              }`}
              type="button"
              onClick={handleSignupClick}
            >
              <span aria-hidden="true" className="solarmate-header-auth-icon">
                <LuChevronRight />
              </span>
              회원가입
            </button>
            <button
              className={`solarmate-header-auth is-login ${
                location.pathname === '/login' && !location.search.includes('mode=signup') ? 'is-active' : ''
              }`}
              type="button"
              onClick={handleLoginClick}
            >
              <span aria-hidden="true" className="solarmate-header-auth-icon">
                <LuChevronRight />
              </span>
              로그인
            </button>
          </>
        )}
      </div>
    </header>
  );
}
