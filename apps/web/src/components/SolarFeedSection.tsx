import SafeLocalImage from './SafeLocalImage';

type FeedCard = {
  title: string;
  description: string;
  image: string;
  alt: string;
};

type PolicyNewsItem = {
  title: string;
  date: string;
};

type ContactItem = {
  title: string;
  description: string;
  image: string;
  alt: string;
};

const feedCards: FeedCard[] = [
  {
    title: '2026 태양광 보조금 주요 정책 요약',
    description: '최신 지원 조건과 신청 흐름을 한눈에 정리했어요.',
    image: '/assets/landing/feed-policy-summary.png',
    alt: '정책 문서와 체크 표시가 있는 태양광 보조금 요약 이미지',
  },
  {
    title: '아파트 태양광 도입 사례',
    description: '실제 단지의 도입 방식과 기대 효과를 확인해보세요.',
    image: '/assets/landing/feed-adoption-case.png',
    alt: '옥상에 태양광 패널이 설치된 아파트 단지 이미지',
  },
  {
    title: '관리비 절감을 위한 에너지 절약 팁',
    description: '일상에서 실천 가능한 절감 노하우를 소개합니다.',
    image: '/assets/landing/feed-energy-tip.png',
    alt: '초록 잎이 들어간 전구 모양 에너지 절약 이미지',
  },
];

const policyNewsItems: PolicyNewsItem[] = [
  { title: '2026년 주택태양광 지원사업 공고 확인', date: '2025.05.20' },
  { title: '지자체별 보조금 예산 소진 현황 업데이트', date: '2025.05.16' },
  { title: '공동주택 태양광 설치 기준 안내', date: '2025.05.12' },
  { title: '전기요금 인상 반영 시뮬레이션 업데이트', date: '2025.05.08' },
];

const faqItems = [
  '우리 아파트도 설치 가능한가요?',
  '예상 절감액은 어떻게 계산되나요?',
  '보조금은 언제 확정되나요?',
  '회원가입 없이도 확인할 수 있나요?',
];

const contactItems: ContactItem[] = [
  {
    title: '채팅 상담하기',
    description: '실시간 상담',
    image: '/assets/landing/contact-chat.png',
    alt: '채팅 상담 말풍선 이미지',
  },
  {
    title: '전화 상담하기',
    description: '평일 09:00 ~ 18:00',
    image: '/assets/landing/contact-phone.png',
    alt: '전화 상담 수화기 이미지',
  },
  {
    title: '문의 남기기',
    description: '답변 1~2일 내',
    image: '/assets/landing/contact-mail.png',
    alt: '문의 메일 봉투 이미지',
  },
];

function SolarFeedSection() {
  return (
    <section className="solarFeedSection" id="solar-feed" aria-labelledby="solar-feed-title">
      <div className="solarFeedInner">
        <div className="solarFeedTop">
          <div className="solarFeedIntro">
            <h2 id="solar-feed-title">솔라피드</h2>
            <p>태양광 최신 정보와 유용한 인사이트를 전달합니다.</p>
            <button type="button">전체 콘텐츠 보기 →</button>
          </div>

          <div className="solarFeedCards">
            {feedCards.map((card) => (
              <article className="solarFeedCard" key={card.title}>
                <SafeLocalImage src={card.image} alt={card.alt} className="solarFeedCardImage" />
                <h3>{card.title}</h3>
                <p>{card.description}</p>
              </article>
            ))}
            {feedCards.map((card) => (
              <article className="solarFeedCard feedDuplicate" key={`${card.title}-duplicate`} aria-hidden="true">
                <SafeLocalImage src={card.image} alt="" className="solarFeedCardImage" />
                <h3>{card.title}</h3>
                <p>{card.description}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="solarFeedContentGrid">
          <section className="feedPanel policyNewsPanel" aria-labelledby="policy-news-title">
            <div className="feedPanelTitleRow">
              <h2 id="policy-news-title">태양광 정책 소식</h2>
              <span>정책 업데이트</span>
            </div>

            <ul className="policyNewsList">
              {policyNewsItems.map((item) => (
                <li key={item.title}>
                  <span className="policyDot" aria-hidden="true" />
                  <p>{item.title}</p>
                  <time>{item.date}</time>
                  <button type="button" aria-label={`${item.title} 자세히 보기`}>
                    ›
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="feedPanel faqPanel" aria-labelledby="faq-title">
            <h2 id="faq-title">자주 묻는 질문</h2>
            <div className="faqRows">
              {faqItems.map((item) => (
                <button type="button" key={item}>
                  <span>{item}</span>
                  <strong aria-hidden="true">⌄</strong>
                </button>
              ))}
            </div>
          </section>

          <div className="solarFeedSupportRow">
            <section className="noticePanel" aria-labelledby="notice-title">
              <SafeLocalImage
                src="/assets/landing/notice-alert.png"
                alt="중요 안내를 나타내는 알림등 이미지"
                className="noticeImage"
              />
              <div>
                <h2 id="notice-title">안내 사항</h2>
                <p>정책 변경 및 서비스 점검 등 중요 안내를 확인하세요.</p>
                <button type="button">자세히 보기 →</button>
              </div>
            </section>

            <section className="customerPanel" aria-labelledby="customer-title">
              <h2 id="customer-title">고객센터</h2>
              <div className="customerItems">
                {contactItems.map((item) => (
                  <button type="button" key={item.title}>
                    <SafeLocalImage src={item.image} alt={item.alt} className="customerImage" />
                    <strong>{item.title}</strong>
                    <span>{item.description}</span>
                  </button>
                ))}
              </div>
            </section>
          </div>
        </div>

        <p className="solarFeedDemoNote">
          정책 소식과 피드 콘텐츠는 MVP 화면 구성을 위한 서비스 예시입니다. 실제 보조금과 절감 효과는 공고 기준 확인이 필요합니다.
        </p>
      </div>

      <footer className="solarFooter">
        <div className="solarFooterInner">
          <div className="solarFooterBrand">
            <a className="solarFooterLogo" href="/" aria-label="솔라메이트 홈">
              <span className="solarFooterLogoMark" aria-hidden="true" />
              <span>
                <strong>솔라메이트</strong>
                <small>SolarMate</small>
              </span>
            </a>
            <p>아파트 태양광 도입의 모든 과정을 쉽고 투명하게 도와드리는 파트너, 솔라메이트</p>
            <div className="solarSocialLinks" aria-label="소셜 링크 예시">
              <span>N</span>
              <span>▶</span>
              <span>◎</span>
            </div>
          </div>

          <div className="solarFooterColumn">
            <h3>회사 정보</h3>
            <p>
              (주)솔라메이트
              <br />
              서울특별시 강남구 테헤란로 123, 10층 (역삼동)
              <br />
              대표이사: 김태양
              <br />
              사업자등록번호: 123-45-67890
            </p>
          </div>

          <div className="solarFooterColumn">
            <h3>서비스</h3>
            <a href="#service-intro">서비스 소개</a>
            <a href="#service-intro-status">예상 절감액</a>
            <a href="#service-intro">설치 사례</a>
            <a href="#solar-feed">정책 정보</a>
            <a href="#contact">고객센터</a>
          </div>

          <div className="solarFooterColumn">
            <h3>지원 및 다운로드</h3>
            <p>솔라메이트 앱 다운로드</p>
            <div className="solarStoreButtons">
              <button type="button">App Store에서 다운로드</button>
              <button type="button">Google Play에서 다운로드</button>
            </div>
            <a className="solarDownloadLink" href="/">
              브로셔 다운로드 ↓
            </a>
          </div>

          <div className="solarFooterColumn solarFooterContact">
            <h3>고객센터</h3>
            <strong>1800-1234</strong>
            <p>
              평일 09:00 ~ 18:00 (주말/공휴일 휴무)
              <br />
              help@solarmate.co.kr
            </p>
          </div>
        </div>

        <div className="solarFooterBottom">
          <p>© 2025 SolarMate. All rights reserved.</p>
          <div>
            <a href="/">회사소개</a>
            <a href="/">이용약관</a>
            <a href="/">개인정보처리방침</a>
          </div>
        </div>
      </footer>
    </section>
  );
}

export default SolarFeedSection;
