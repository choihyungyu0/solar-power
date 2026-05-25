import { Link } from 'react-router-dom';
import SolarMateHeader from '../components/SolarMateHeader';

export default function MemberNoInstallationPage() {
  return (
    <div className="pageShell">
      <SolarMateHeader variant="member" />
      <main style={{ padding: '72px clamp(24px, 6vw, 96px)', background: '#f6f9fc', minHeight: 'calc(100dvh - 92px)' }}>
        <section
          style={{
            maxWidth: 920,
            margin: '0 auto',
            border: '1px solid #e1e8f2',
            borderRadius: 18,
            padding: '42px clamp(24px, 5vw, 56px)',
            background: '#ffffff',
            boxShadow: '0 18px 38px rgba(15, 23, 42, 0.08)',
          }}
          aria-labelledby="member-no-installation-title"
        >
          <p className="sectionBadge">회원 대시보드</p>
          <h1
            id="member-no-installation-title"
            style={{ margin: '14px 0 14px', color: '#05070b', fontSize: 'clamp(34px, 5vw, 54px)', lineHeight: 1.15 }}
          >
            아직 등록된 태양광 설비가 없습니다.
          </h1>
          <p style={{ margin: '0 0 28px', color: '#475569', fontSize: 18, lineHeight: 1.75 }}>
            우리 아파트 주소를 입력하면 설치 가능성, 예상 발전량, 정책 지원 후보를 먼저 확인할 수 있습니다.
          </p>
          <Link className="primaryButton" to="/risk-map">
            우리 아파트 태양광 설치하기
          </Link>
        </section>
      </main>
    </div>
  );
}
