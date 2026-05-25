import { useNavigate } from 'react-router-dom';
import {
  LuArrowRight,
  LuBuilding2,
  LuChartNoAxesColumnIncreasing,
  LuCloudSun,
  LuMap,
  LuMessageCircle,
  LuSparkles,
} from 'react-icons/lu';
import SolarMateHeader from '../components/SolarMateHeader';
import SafeLocalImage from '../components/SafeLocalImage';
import './ServicePage.css';

const serviceFeatures = [
  {
    icon: LuMap,
    title: '3D 지도 기반 건물 선택',
    description: 'VWorld 지도에서 공동주택 위치와 건물 후보를 확인하고 분석 흐름으로 연결합니다.',
  },
  {
    icon: LuSparkles,
    title: 'AI/공공데이터 기반 태양광 설치 가능성 분석',
    description: '건물, 일사량, 정책 데이터를 조합해 예상 설치 가능성과 다음 행동을 안내합니다.',
  },
  {
    icon: LuCloudSun,
    title: '음영 분석',
    description: '기후 분석 백엔드와 샘플 데이터를 활용해 옥상 음영 영향을 시나리오로 보여줍니다.',
  },
  {
    icon: LuChartNoAxesColumnIncreasing,
    title: '예상 발전량/절감액',
    description: '발전량, 전기요금 절감, 보조금 후보를 추정값으로 제공하며 실제 공고 확인이 필요함을 표시합니다.',
  },
  {
    icon: LuMessageCircle,
    title: '상담 연결',
    description: '설치 가능성이 있는 단지를 상담 신청과 mock 알림 선호 채널로 자연스럽게 연결합니다.',
  },
];

export default function ServicePage() {
  const navigate = useNavigate();

  return (
    <div className="service-page">
      <SolarMateHeader />

      <main className="service-page-main">
        <section className="service-page-hero" aria-labelledby="service-page-title">
          <div className="service-page-hero-copy">
            <p>서비스 소개</p>
            <h1 id="service-page-title">아파트 태양광 도입을 한 번에 판단하는 SolarMate</h1>
            <span>
              전기요금 부담, 도심 자가발전, 보조금 복잡성을 한 흐름으로 정리해 설치 가능성부터 상담 신청까지
              이어줍니다.
            </span>

            <div className="service-page-actions">
              <button type="button" onClick={() => navigate('/solar-adoption')}>
                태양광 도입하기
                <LuArrowRight aria-hidden="true" />
              </button>
              <button type="button" onClick={() => navigate('/risk-map')}>
                전기세 위험 지도 보기
                <LuMap aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="service-page-hero-image">
            <SafeLocalImage
              src="/assets/landing/service-map-apartment.png"
              fallbackSrc="/assets/landing/urban-solar-building.png"
              alt="지도 기반 아파트 태양광 서비스 예시"
            />
          </div>
        </section>

        <section className="service-page-flow" aria-label="서비스 작동 방식">
          <article>
            <LuBuilding2 aria-hidden="true" />
            <strong>아파트/건물주</strong>
            <p>전기요금 절감과 설치 가능성 확인이 필요함</p>
          </article>
          <article>
            <LuSparkles aria-hidden="true" />
            <strong>우리 서비스</strong>
            <p>적합지 발굴, 혜택 추정, 신청 지원, 알림 제공</p>
          </article>
          <article>
            <LuChartNoAxesColumnIncreasing aria-hidden="true" />
            <strong>경기도/지자체</strong>
            <p>정책 참여 확대와 탄소중립 실행 지원</p>
          </article>
        </section>

        <section className="service-page-feature-grid" aria-label="주요 기능">
          {serviceFeatures.map((feature) => {
            const FeatureIcon = feature.icon;

            return (
              <article key={feature.title}>
                <FeatureIcon aria-hidden="true" />
                <h2>{feature.title}</h2>
                <p>{feature.description}</p>
              </article>
            );
          })}
        </section>
      </main>
    </div>
  );
}
