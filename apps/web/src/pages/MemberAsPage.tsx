import { useState } from 'react';
import {
  LuBotMessageSquare,
  LuChartNoAxesColumnIncreasing,
  LuChevronDown,
  LuChevronUp,
  LuCirclePlus,
  LuCircleUserRound,
  LuHeadphones,
  LuUserRound,
} from 'react-icons/lu';
import './MemberAsPage.css';

type FaqItem = {
  question: string;
  answer: string;
};

const faqItems: FaqItem[] = [
  {
    question: '전기 발전이 안돼요',
    answer:
      '인버터 상태, 차단기 여부, 모니터링 장치 연결 상태 등을 확인해주세요.\n그래도 해결되지 않으면 A/S 접수를 통해 전문가의 도움을 받으실 수 있습니다.',
  },
  {
    question: '발전량이 줄었어요',
    answer:
      '날씨, 계절, 음영, 패널 오염, 장비 상태에 따라 발전량이 달라질 수 있습니다.\n최근 발전량 추이를 확인하고 필요 시 점검을 신청해주세요.',
  },
  {
    question: '질문 1',
    answer: '자주 묻는 질문 내용을 준비 중입니다.',
  },
  {
    question: '질문 2',
    answer: '자주 묻는 질문 내용을 준비 중입니다.',
  },
];

export default function MemberAsPage() {
  const [openFaqIndex, setOpenFaqIndex] = useState(0);

  const handleToggleFaq = (index: number) => {
    setOpenFaqIndex((prevIndex) => (prevIndex === index ? -1 : index));
  };

  const handleSubmitAsRequest = () => {
    const selectedIssue = faqItems[openFaqIndex]?.question ?? '선택 안 함';
    const draft = {
      type: 'A/S',
      selectedIssue,
      createdAt: new Date().toISOString(),
    };

    sessionStorage.setItem('solarmate:asRequestDraft', JSON.stringify(draft));
    window.alert('A/S 접수 화면은 추후 연동 예정입니다.');
  };

  const handleChatbotClick = () => {
    window.alert('챗봇 상담은 추후 연동 예정입니다.');
  };

  const goMemberProfile = () => {
    window.location.assign('/member/profile');
  };

  return (
    <div className="member-as-page">
      <MemberAsHeader />

      <main className="member-as-main">
        <section className="member-as-card" aria-label="A/S 고객센터">
          <section className="member-as-hero" aria-labelledby="member-as-title">
            <div className="member-as-hero-copy">
              <h1 id="member-as-title">A/S 도움이 필요하신가요?</h1>
              <p>문제를 선택하고 빠르게 접수하세요</p>
            </div>

            <img className="member-as-hero-image" src="/assets/support/as-headset.png" alt="A/S 상담 헤드셋" />
          </section>

          <section className="member-as-faq-section" aria-labelledby="member-as-faq-title">
            <h2 id="member-as-faq-title">A/S 자주 묻는 문제</h2>

            <div className="member-as-faq-list">
              {faqItems.map((item, index) => {
                const isOpen = openFaqIndex === index;

                return (
                  <article className={`member-as-faq-item ${isOpen ? 'is-open' : ''}`} key={item.question}>
                    <button
                      className="member-as-faq-question"
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={`member-as-answer-${index}`}
                      onClick={() => handleToggleFaq(index)}
                    >
                      <span>{item.question}</span>
                      {isOpen ? <LuChevronUp aria-hidden="true" /> : <LuChevronDown aria-hidden="true" />}
                    </button>

                    {isOpen && (
                      <p className="member-as-faq-answer" id={`member-as-answer-${index}`}>
                        {item.answer}
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          </section>

          <section className="member-as-action-row" aria-label="A/S 상담 액션">
            <button className="member-as-primary-action" type="button" onClick={handleSubmitAsRequest}>
              <LuCirclePlus aria-hidden="true" />
              A/S 접수하기
            </button>

            <button className="member-as-outline-action" type="button" onClick={handleChatbotClick}>
              <LuBotMessageSquare aria-hidden="true" />
              챗봇
            </button>
          </section>

          <nav className="member-as-bottom-tabs" aria-label="회원 메뉴">
            <button className="member-as-tab-button" type="button" onClick={() => window.location.assign('/member/dashboard')}>
              <LuChartNoAxesColumnIncreasing aria-hidden="true" />
              발전량
            </button>

            <button className="member-as-tab-button is-active" type="button" aria-current="page">
              <LuHeadphones aria-hidden="true" />
              A/S
            </button>

            <button
              className="member-as-tab-button"
              type="button"
              onClick={goMemberProfile}
            >
              <LuCircleUserRound aria-hidden="true" />
              회원관리
            </button>
          </nav>
        </section>
      </main>
    </div>
  );
}

function handleMemberLogout() {
  Object.keys(window.sessionStorage)
    .filter((key) => key.startsWith('solarmate:'))
    .forEach((key) => window.sessionStorage.removeItem(key));
  window.location.assign('/');
}

function MemberAsHeader() {
  return (
    <header className="member-as-header">
      <a className="member-as-logo" href="/" aria-label="솔라메이트 홈">
        <span className="member-as-logo-mark" aria-hidden="true">
          <span className="member-as-logo-sun" />
          <span className="member-as-logo-panel">
            {Array.from({ length: 6 }).map((_, index) => (
              <span key={index} />
            ))}
          </span>
        </span>

        <span className="member-as-logo-text">
          <strong>솔라메이트</strong>
          <small>SolarMate</small>
        </span>
      </a>

      <nav className="member-as-nav" aria-label="주요 메뉴">
        <a href="/solar-adoption">태양광 도입</a>
        <a href="/#service-intro">서비스 소개</a>
        <a href="/notice">공지사항</a>
        <a className="is-active" href="/member/as" aria-current="page">
          고객센터
        </a>
      </nav>

      <button className="member-as-login-button" type="button" onClick={handleMemberLogout}>
        <LuUserRound aria-hidden="true" />
        로그아웃
      </button>
    </header>
  );
}
