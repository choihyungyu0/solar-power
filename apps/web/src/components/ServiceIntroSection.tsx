type ReviewCard = {
  badge: string;
  quote: string;
  name: string;
  saving: string;
  point: string;
  tone: 'blue' | 'green' | 'orange';
};

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
    <section className="serviceIntro reviewOnlyIntro" id="service-intro" aria-labelledby="service-intro-title">
      <div className="serviceIntroInner">
        <div className="introReviewHeader" id="service-intro-status">
          <h2 id="service-intro-title">도입 사례 시뮬레이션</h2>
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
      </div>
    </section>
  );
}

export default ServiceIntroSection;
