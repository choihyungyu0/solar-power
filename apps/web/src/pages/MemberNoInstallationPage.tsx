import { useNavigate } from 'react-router-dom';
import { LuArrowRight, LuMap, LuMessageCircle, LuPanelTop } from 'react-icons/lu';
import SolarMateHeader from '../components/SolarMateHeader';
import './MemberNoInstallationPage.css';

export default function MemberNoInstallationPage() {
  const navigate = useNavigate();

  return (
    <div className="member-no-installation-page">
      <SolarMateHeader variant="member" />

      <main className="member-no-installation-main">
        <section className="member-no-installation-card" aria-labelledby="member-no-installation-title">
          <div className="member-no-installation-icon">
            <LuPanelTop aria-hidden="true" />
          </div>

          <p>데모 미설치자 화면</p>
          <h1 id="member-no-installation-title">설치 된 태양광이 없습니다.</h1>
          <span>태양광 설치하고 전기요금 절약하기</span>

          <div className="member-no-installation-actions">
            <button type="button" onClick={() => navigate('/consultation')}>
              <LuMessageCircle aria-hidden="true" />
              상담하기
            </button>
            <button type="button" onClick={() => navigate('/risk-map')}>
              <LuMap aria-hidden="true" />
              견적받기
              <LuArrowRight aria-hidden="true" />
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
