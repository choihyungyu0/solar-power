import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LuArrowLeft, LuChevronRight } from 'react-icons/lu';
import SolarMateHeader from '../components/SolarMateHeader';
import './NoticePage.css';

type NewsItem = {
  title: string;
  date: string;
};

type FaqItem = {
  question: string;
  answer: string;
};

const newsItems: NewsItem[] = [
  {
    title: '2026년 주택태양광 지원사업 공고 확인',
    date: '2025.05.20',
  },
  {
    title: '지자체 보조금 예산 소진 현황 업데이트',
    date: '2025.05.16',
  },
  {
    title: '공동주택 태양광 설치 기준 안내',
    date: '2025.05.12',
  },
  {
    title: '전기요금 인상 반영 시뮬레이션 업데이트',
    date: '2025.05.08',
  },
];

const faqItems: FaqItem[] = [
  {
    question: '우리 집도 설치 가능한가요?',
    answer:
      '건물 옥상 면적, 음영, 구조안전성, 관리주체 협의 여부에 따라 달라질 수 있습니다. 이코햇은 3D 지도와 공공데이터 기반으로 1차 가능성을 안내합니다.',
  },
  {
    question: '예상 절감액은 어떻게 계산되나요?',
    answer:
      '예상 발전량, 전기요금 단가, 자가소비 절감 효과, 설치 조건을 기반으로 산정한 시뮬레이션 값입니다.',
  },
  {
    question: '보조금은 언제 확정되나요?',
    answer:
      '보조금은 공고 시점, 예산 소진 여부, 신청 조건에 따라 달라질 수 있어 실제 신청 단계에서 최종 확인이 필요합니다.',
  },
  {
    question: '회원가입 없이도 확인할 수 있나요?',
    answer:
      '기본적인 가능성 확인은 회원가입 없이 이용할 수 있으며, 상담 신청이나 알림 신청 단계에서 연락처 입력이 필요할 수 있습니다.',
  },
];

export default function NoticePage() {
  const navigate = useNavigate();
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);

  const handleToggleFaq = (index: number) => {
    setOpenFaqIndex((prevIndex) => (prevIndex === index ? null : index));
  };

  const handleBackClick = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    navigate('/');
  };

  return (
    <div className="notice-page">
      <SolarMateHeader />

      <main className="notice-main">
        <section className="notice-card" aria-label="공지사항과 자주 묻는 질문">
          <section className="notice-policy-section" aria-labelledby="notice-policy-title">
            <div className="notice-section-top">
              <div className="notice-title-group">
                <h1 id="notice-policy-title">태양광 정책 소식</h1>
                <span>정책 업데이트</span>
              </div>

              <button className="notice-more-button" type="button">
                더보기
                <LuChevronRight aria-hidden="true" />
              </button>
            </div>

            <div className="notice-news-list">
              {newsItems.map((item) => (
                <button className="notice-news-row" type="button" key={item.title}>
                  <span className="notice-news-left">
                    <span className="notice-green-dot" aria-hidden="true" />
                    <strong>{item.title}</strong>
                  </span>

                  <span className="notice-news-right">
                    <span>{item.date}</span>
                    <LuChevronRight aria-hidden="true" />
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="notice-faq-section" aria-labelledby="notice-faq-title">
            <div className="notice-faq-top">
              <h2 id="notice-faq-title">자주 묻는 질문</h2>

              <button className="notice-more-button" type="button">
                더보기
                <LuChevronRight aria-hidden="true" />
              </button>
            </div>

            <div className="notice-faq-list">
              {faqItems.map((item, index) => {
                const isOpen = openFaqIndex === index;

                return (
                  <div className={`notice-faq-item ${isOpen ? 'is-open' : ''}`} key={item.question}>
                    <button
                      className="notice-faq-question"
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => handleToggleFaq(index)}
                    >
                      <span>{item.question}</span>
                      <em aria-hidden="true">{isOpen ? '⌃' : '⌄'}</em>
                    </button>

                    {isOpen && <p className="notice-faq-answer">{item.answer}</p>}
                  </div>
                );
              })}
            </div>
          </section>

          <button className="notice-back-button" type="button" onClick={handleBackClick}>
            <LuArrowLeft aria-hidden="true" />
            돌아가기
          </button>
        </section>
      </main>
    </div>
  );
}
