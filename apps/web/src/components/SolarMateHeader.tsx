import { useMemo } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { LuUserRound } from 'react-icons/lu';
import { clearDemoAuth, getDemoAuth } from '../lib/demoAuth';
import './SolarMateHeader.css';

type SolarMateHeaderProps = {
  variant?: 'public' | 'member';
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

export default function SolarMateHeader({ variant = 'public' }: SolarMateHeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const demoAuth = useMemo(() => getDemoAuth(), [location.pathname, location.search]);
  const isLoggedIn = demoAuth?.isLoggedIn === true;

  const handleAuthClick = () => {
    if (isLoggedIn) {
      clearDemoAuth();
      navigate('/login');
      return;
    }

    navigate('/login');
  };

  return (
    <header className={`solarmate-header ${variant === 'member' ? 'is-member' : ''}`}>
      <NavLink className="solarmate-header-logo" to="/" aria-label="SolarMate 홈">
        <span className="solarmate-header-logo-mark" aria-hidden="true">
          <span className="solarmate-header-logo-sun" />
          <span className="solarmate-header-logo-panel">
            {Array.from({ length: 6 }).map((_, index) => (
              <span key={index} />
            ))}
          </span>
        </span>

        <span className="solarmate-header-logo-text">
          <strong>SolarMate</strong>
          <small>솔라메이트</small>
        </span>
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
