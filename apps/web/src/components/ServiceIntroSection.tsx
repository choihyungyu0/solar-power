import SafeLocalImage from './SafeLocalImage';

type ProcessCard = {
  number: string;
  title: string;
  description: string;
  image: string;
  fallbackImage?: string;
  alt: string;
};

type MetricCard = {
  title: string;
  value: string;
  description: string;
  image: string;
  alt: string;
  tone: 'blue' | 'green' | 'purple' | 'orange';
};

type ReviewCard = {
  badge: string;
  quote: string;
  name: string;
  saving: string;
  point: string;
  tone: 'blue' | 'green' | 'orange';
};

const processCards: ProcessCard[] = [
  {
    number: '01',
    title: '가능성 확인',
    description: '옥상·일사량·전기사용량 데이터를 바탕으로 설치 가능성을 분석합니다.',
    image: '/assets/landing/intro-step-feasibility.png',
    fallbackImage: '/assets/landing/apartment-isometric.png',
    alt: '태양광 패널이 있는 아파트 건물 아이콘',
  },
  {
    number: '02',
    title: '도입 비용 판단',
    description: '예상 절감액, 보조금, 자기부담금, 회수기간을 계산합니다.',
    image: '/assets/landing/intro-step-cost.png',
    alt: '동전이 놓인 계산기 아이콘',
  },
  {
    number: '03',
    title: '실행 지원',
    description: '보조금 공고, 예산 소진, 신청 진행 상황을 알림으로 제공합니다.',
    image: '/assets/landing/intro-step-support.png',
    alt: '알림 말풍선이 있는 종 아이콘',
  },
];

const metricCards: MetricCard[] = [
  {
    title: '파일럿 분석 단지 수',
    value: '120건',
    description: '아파트 단지 대상 파일럿 분석 완료',
    image: '/assets/landing/intro-pilot-count.png',
    alt: '파란색 아파트 건물 아이콘',
    tone: 'blue',
  },
  {
    title: '시뮬레이션 기준 예상 절감액',
    value: '18,720,000원',
    description: '파일럿 단지 평균 기준 연간 예상 절감액',
    image: '/assets/landing/intro-savings.png',
    alt: '동전 더미 아이콘',
    tone: 'green',
  },
  {
    title: '보조금 조건 매칭 항목',
    value: '9개',
    description: '지자체별 보조금 조건 매칭 항목 수',
    image: '/assets/landing/intro-subsidy-match.png',
    alt: '체크리스트 클립보드 아이콘',
    tone: 'purple',
  },
  {
    title: '사용자 테스트 만족도',
    value: '4.8 / 5.0',
    description: '사용자 테스트 참여자 평균 만족도',
    image: '/assets/landing/intro-satisfaction.png',
    alt: '노란색 별 아이콘',
    tone: 'orange',
  },
];

const reviewCards: ReviewCard[] = [
  {
    badge: '사용자 테스트 후기',
    quote: '복잡할 줄 알았는데, 단계별로 안내가 잘 되어 이해하기 쉬웠어요.',
    name: '김○○ 님',
    saving: '1,120,000원',
    point: '경제성',
    tone: 'blue',
  },
  {
    badge: '도입 사례 예시',
    quote: '보조금 조건을 자동으로 매칭해줘서 신청 준비가 훨씬 빨라졌어요.',
    name: '이○○ 님',
    saving: '980,000원',
    point: '신속한 진행',
    tone: 'green',
  },
  {
    badge: '파일럿 피드백',
    quote: '정보가 투명하게 정리되어 있어 의사결정에 큰 도움이 되었습니다.',
    name: '박○○ 님',
    saving: '1,350,000원',
    point: '정보 투명성',
    tone: 'orange',
  },
];

function ServiceIntroSection() {
  return (
    <section className="serviceIntro" id="service-intro" aria-labelledby="service-intro-title">
      <div className="serviceIntroInner">
        <div className="serviceIntroHeader">
          <h2 id="service-intro-title">단순 시뮬레이션에서 끝나지 않습니다</h2>
          <p>기존 태양광 가능성 확인을 넘어, 실제 도입 결정을 돕는 실행 지원 서비스를 제공합니다.</p>
        </div>

        <div className="introProcessGrid" id="service-intro-process">
          {processCards.map((card) => (
            <article className="introProcessCard" key={card.number}>
              <SafeLocalImage
                src={card.image}
                fallbackSrc={card.fallbackImage}
                alt={card.alt}
                className="introProcessImage"
              />
              <div className="introProcessText">
                <span className="introNumberBadge">{card.number}</span>
                <h3>{card.title}</h3>
                <p>{card.description}</p>
              </div>
            </article>
          ))}
        </div>

        <div className="introFeatureGrid" id="service-intro-status">
          <article className="introFeaturePanel">
            <div className="introFeatureText">
              <h3>서비스 소개</h3>
              <p>아파트 태양광 가상설치, 보조금 조건 매칭, 맞춤 리포트를 한곳에서 제공합니다.</p>
            </div>
            <div className="dashboardMockup" aria-label="태양광 분석 대시보드 예시" role="img">
              <div className="mockToolbar">
                <span />
                <span />
                <span />
              </div>
              <div className="mockDashboardBody">
                <div className="mockApartment" />
                <div className="mockChart">
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
                <div className="mockDonut" />
              </div>
            </div>
          </article>

          <article className="introFeaturePanel mapPanel">
            <div className="introFeatureText">
              <h3>분석 현황</h3>
              <p>파일럿 분석 단지와 시뮬레이션 기준 절감 효과를 확인하세요.</p>
            </div>
            <div className="apartmentMapVisual">
              <SafeLocalImage
                src="/assets/landing/intro-step-feasibility.png"
                fallbackSrc="/assets/landing/apartment-isometric.png"
                alt="지도 핀과 함께 표시된 아파트 태양광 분석 대상"
                className="mapApartmentImage"
              />
              <span className="mapPin" aria-hidden="true" />
            </div>
          </article>
        </div>

        <div className="introMetricGrid">
          {metricCards.map((metric) => (
            <article className="introMetricCard" key={metric.title}>
              <SafeLocalImage src={metric.image} alt={metric.alt} className="introMetricImage" />
              <div>
                <h3>{metric.title}</h3>
                <strong className={`metricValue ${metric.tone}`}>{metric.value}</strong>
                <p>{metric.description}</p>
              </div>
            </article>
          ))}
        </div>
        <p className="introDisclaimer">
          위 수치는 서비스 화면 예시 및 파일럿 기준 추정값입니다. 실제 결과는 건물 조건, 전기사용량,
          현장조사, 공고 기준에 따라 달라질 수 있습니다.
        </p>

        <div className="introReviewHeader">
          <h2>도입 사례 시뮬레이션</h2>
          <p>후기는 실제 고객 후기가 아닌 서비스 화면 예시 문구입니다.</p>
        </div>

        <div className="introReviewGrid">
          {reviewCards.map((review) => (
            <article className="introReviewCard" key={review.name}>
              <div className="reviewCopy">
                <span className={`reviewBadge ${review.tone}`}>{review.badge}</span>
                <p>“{review.quote}”</p>
                <strong>{review.name}</strong>
              </div>
              <div className={`reviewResultBox ${review.tone}`}>
                <span>예상 연간 절감액</span>
                <strong>{review.saving}</strong>
                <hr />
                <span>만족 포인트</span>
                <b>{review.point}</b>
              </div>
            </article>
          ))}
        </div>

        <div className="solarFeedPreview" id="solar-feed">
          <div>
            <h2>솔라피드</h2>
            <p>태양광 보조금과 예산 소진 현황을 한눈에 확인하세요.</p>
          </div>
          <div className="solarFeedTabs" aria-label="솔라피드 미리보기 탭">
            <button type="button" className="active">
              보조금 공고
            </button>
            <button type="button">예산 소진 현황</button>
          </div>
        </div>
      </div>
    </section>
  );
}

export default ServiceIntroSection;
