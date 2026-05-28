import { useMemo } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { LuUserRound } from 'react-icons/lu';
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

      <button
        className={`solarmate-header-auth ${location.pathname === '/login' && !isLoggedIn ? 'is-active' : ''}`}
        type="button"
        onClick={handleAuthClick}
      >
        <LuUserRound aria-hidden="true" />
        {isLoggedIn ? '로그아웃' : '로그인'}
      </button>
    </header>
  );
}
