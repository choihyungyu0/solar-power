import { useState, type CSSProperties } from 'react';
import './MemberDashboardPage.css';

type DashboardTab = 'generation' | 'as' | 'member';

type BarColor = 'teal' | 'purple' | 'orange' | 'yellow' | 'blue' | 'sky';

type MeterBar = {
  label: string;
  cost?: string;
  value: string;
  color: BarColor;
  percent: number;
  group?: '수전' | '발전';
};

type MeterCard = {
  id: number;
  date: string;
  day: string;
  usage: string;
  usageMoney: string;
  generation: string;
  stage: string;
  stageColor: 'green' | 'yellow';
  temp: string;
  tooltip: string;
  values: number[];
  mode?: 'mixed';
  bars: MeterBar[];
};

const meterCards: MeterCard[] = [
  {
    id: 1,
    date: '2022-07-11',
    day: '월',
    usage: '26.130 kWh',
    usageMoney: '(2,435원)',
    generation: '0 kWh',
    stage: '1단계 : 68.3원/kWh',
    stageColor: 'green',
    temp: '최고 29.6°C / 최저 22.3°C',
    tooltip: '사용량 1시 : 0.426kWh',
    values: [62, 70, 76, 82, 88, 76, 68, 58, 50, 45, 42, 48, 56, 64, 72, 80, 86, 76, 68, 60, 52, 46, 42, 44],
    bars: [
      { label: '당일', cost: '2,435원', value: '26.130 kWh', color: 'teal', percent: 78 },
      { label: '전일', cost: '1,310원', value: '14.056 kWh', color: 'purple', percent: 45 },
    ],
  },
  {
    id: 2,
    date: '2022-07-19',
    day: '화',
    usage: '12.960 kWh',
    usageMoney: '(2,434원)',
    generation: '0 kWh',
    stage: '2단계 : 162.9원/kWh',
    stageColor: 'yellow',
    temp: '최고 30.3°C / 최저 22.2°C',
    tooltip: '사용량 2시 : 0.466kWh',
    values: [72, 88, 78, 70, 62, 54, 46, 38, 30, 26, 22, 30, 42, 56, 64, 70, 68, 58, 46, 34, 24, 20, 24, 32],
    bars: [
      { label: '당일', cost: '2,434원', value: '12.960 kWh', color: 'teal', percent: 66 },
      { label: '전일', cost: '2,350원', value: '15.174 kWh', color: 'purple', percent: 78 },
    ],
  },
  {
    id: 3,
    date: '2022-08-16',
    day: '화',
    usage: '17.674 kWh',
    usageMoney: '(1,647원)',
    generation: '25.632 kWh',
    stage: '1단계 : 68.3원/kWh',
    stageColor: 'green',
    temp: '최고 30.4°C / 최저 23.1°C',
    tooltip: '사용량 9시 : 0.546kWh',
    mode: 'mixed',
    values: [40, 52, 68, 82, 88, 74, 55, 34, 22, 15, 18, 24, 38, 58, 72, 66, 48, 30, 20, 18, 22, 26, 30, 36],
    bars: [
      { label: '당일', cost: '647원', value: '17.674 kWh', color: 'orange', percent: 52, group: '수전' },
      { label: '전일', cost: '2,335원', value: '25.049 kWh', color: 'yellow', percent: 78, group: '수전' },
      { label: '당일', value: '25.632 kWh', color: 'blue', percent: 82, group: '발전' },
      { label: '전일', value: '5.032 kWh', color: 'sky', percent: 24, group: '발전' },
    ],
  },
];

const dashboardTabs: { id: DashboardTab; label: string; placeholder: string }[] = [
  {
    id: 'generation',
    label: '발전량',
    placeholder: '',
  },
  {
    id: 'as',
    label: 'A/S',
    placeholder: 'A/S 접수 및 처리 현황은 추후 연동 예정입니다.',
  },
  {
    id: 'member',
    label: '회원관리',
    placeholder: '회원 정보와 상담 이력은 추후 연동 예정입니다.',
  },
];

function stayOnDashboard() {
  if (window.location.pathname !== '/member/dashboard') {
    window.location.assign('/member/dashboard');
  }
}

export default function MemberDashboardPage() {
  const [activeTab, setActiveTab] = useState<DashboardTab>('generation');
  const activeTabInfo = dashboardTabs.find((tab) => tab.id === activeTab) ?? dashboardTabs[0];

  return (
    <div className="member-dashboard-page">
      <MemberDashboardHeader />

      <main className="member-dashboard-main">
        <section className="member-dashboard-shell" aria-label="회원 발전량 대시보드">
          <div className="member-dashboard-warranty-row">
            <strong>보증기한</strong>
            <div className="member-dashboard-warranty-bar" aria-label="보증기한 상태 표시" />
          </div>

          <section className="member-dashboard-generation-card" aria-labelledby="member-dashboard-title">
            <div className="member-dashboard-title-row">
              <h1 id="member-dashboard-title">
                <span aria-hidden="true" />
                태양광 발전량 확인하기
              </h1>
              <p>데모 대시보드 데이터입니다.</p>
            </div>

            <div className="member-dashboard-meter-grid">
              {meterCards.map((card) => (
                <MeterCardView key={card.id} card={card} />
              ))}
            </div>
          </section>

          <div className="member-dashboard-tab-row" role="tablist" aria-label="대시보드 보기 선택">
            {dashboardTabs.map((tab) => {
              const isActive = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  className={`member-dashboard-tab-button ${isActive ? 'is-active' : ''}`}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {activeTab !== 'generation' && (
            <section className="member-dashboard-placeholder" role="status">
              <strong>{activeTabInfo.label}</strong>
              <p>{activeTabInfo.placeholder}</p>
            </section>
          )}
        </section>
      </main>
    </div>
  );
}

function MemberDashboardHeader() {
  return (
    <header className="member-dashboard-header">
      <a className="member-dashboard-logo" href="/" aria-label="솔라메이트 홈">
        <span className="member-dashboard-logo-mark" aria-hidden="true">
          <span className="member-dashboard-logo-sun" />
          <span className="member-dashboard-logo-panel">
            {Array.from({ length: 6 }).map((_, index) => (
              <span key={index} />
            ))}
          </span>
        </span>

        <span className="member-dashboard-logo-text">
          <strong>솔라메이트</strong>
          <small>SolarMate</small>
        </span>
      </a>

      <nav className="member-dashboard-nav" aria-label="주요 메뉴">
        <a className="is-active" href="/solar-adoption" aria-current="page">
          태양광 도입
        </a>
        <a href="/#service-intro">서비스 소개</a>
        <a href="/notice">공지사항</a>
        <a href="/#contact">고객센터</a>
      </nav>

      <button className="member-dashboard-login-button" type="button" onClick={stayOnDashboard}>
        로그인
      </button>
    </header>
  );
}

function MeterCardView({ card }: { card: MeterCard }) {
  return (
    <article className="member-dashboard-meter-card" aria-label={`${card.date} 발전량 데모 카드`}>
      <div className="member-dashboard-meter-top">
        <button type="button" aria-label={`${card.date} 이전 날짜`}>
          ‹
        </button>
        <div className="member-dashboard-date-box">{card.date}</div>
        <span className="member-dashboard-target-icon" aria-hidden="true">
          ◎
        </span>
        <div className="member-dashboard-day-box">{card.day}</div>
        <button type="button" aria-label={`${card.date} 다음 날짜`}>
          ›
        </button>
      </div>

      <RadialMeter card={card} />

      <div className="member-dashboard-meter-meta">
        <div className="member-dashboard-stage-line">
          <span className={`member-dashboard-stage-dot is-${card.stageColor}`} aria-hidden="true" />
          <p>{card.stage}</p>
        </div>

        <div className="member-dashboard-weather-line">
          <span aria-hidden="true">☀</span>
          <p>{card.temp}</p>
        </div>
      </div>

      <div className={`member-dashboard-usage-box ${card.mode === 'mixed' ? 'is-mixed' : ''}`}>
        {card.bars.map((bar, index) => (
          <ProgressRow key={`${card.id}-${bar.group ?? 'single'}-${bar.label}-${index}`} bar={bar} />
        ))}
      </div>
    </article>
  );
}

function RadialMeter({ card }: { card: MeterCard }) {
  return (
    <div className="member-dashboard-radial-area">
      <svg className="member-dashboard-radial-svg" viewBox="0 0 260 260" role="img" aria-label={`${card.date} 시간대별 사용량 그래프`}>
        <circle className="member-dashboard-outer-ring" cx="130" cy="130" r="115" />
        <circle className="member-dashboard-middle-ring" cx="130" cy="130" r="88" />

        {card.values.map((value, index) => {
          const angle = index * 15 - 90;
          const inner = 56;
          const outer = 56 + value * 0.68;
          const start = polarToCartesian(130, 130, inner, angle);
          const end = polarToCartesian(130, 130, outer, angle);
          const style = {
            '--segment-color': getSegmentColor(card, index, value),
          } as CSSProperties;

          return (
            <line
              key={`${card.id}-segment-${index}`}
              className="member-dashboard-radial-segment"
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              style={style}
            />
          );
        })}

        <circle className="member-dashboard-center-hole" cx="130" cy="130" r="54" />

        <text className="member-dashboard-time-label is-top" x="130" y="22">
          24시
        </text>
        <text className="member-dashboard-time-label is-right-top" x="205" y="52">
          3시
        </text>
        <text className="member-dashboard-time-label is-right" x="238" y="132">
          6시
        </text>
        <text className="member-dashboard-time-label is-right-bottom" x="210" y="210">
          9시
        </text>
        <text className="member-dashboard-time-label is-bottom" x="130" y="251">
          12시
        </text>
        <text className="member-dashboard-time-label is-left-bottom" x="51" y="210">
          15시
        </text>
        <text className="member-dashboard-time-label is-left" x="18" y="132">
          18시
        </text>
        <text className="member-dashboard-time-label is-left-top" x="56" y="52">
          21시
        </text>
      </svg>

      <div className="member-dashboard-radial-center">
        <p>일 사용량</p>
        <strong>{card.usage}</strong>
        <span>{card.usageMoney}</span>
        <p className="member-dashboard-generation-label">일 발전량</p>
        <strong className="member-dashboard-generation-value">{card.generation}</strong>
      </div>

      <div className="member-dashboard-number-badge">{card.id}</div>
      <div className="member-dashboard-tooltip">{card.tooltip}</div>
    </div>
  );
}

function ProgressRow({ bar }: { bar: MeterBar }) {
  const fillStyle = { width: `${bar.percent}%` };

  return (
    <div className="member-dashboard-progress-row">
      {bar.group ? (
        <div className="member-dashboard-progress-label-combo">
          <span className={`member-dashboard-side-label is-${bar.color}`}>{bar.group}</span>
          <strong>{bar.label}</strong>
        </div>
      ) : (
        <strong className="member-dashboard-progress-label">{bar.label}</strong>
      )}

      <div className="member-dashboard-progress-track">
        <span className={`member-dashboard-progress-fill is-${bar.color}`} style={fillStyle}>
          {bar.cost ?? ''}
        </span>
      </div>

      <em>{bar.value}</em>
    </div>
  );
}

function polarToCartesian(cx: number, cy: number, r: number, angle: number) {
  const radian = (angle * Math.PI) / 180;

  return {
    x: cx + r * Math.cos(radian),
    y: cy + r * Math.sin(radian),
  };
}

function getSegmentColor(card: MeterCard, index: number, value: number) {
  if (card.mode === 'mixed') {
    if (index >= 10 && index <= 15) {
      return '#78b9e8';
    }

    if (value >= 80) {
      return '#ff5a00';
    }

    if (value >= 60) {
      return '#ffc400';
    }

    return '#e7f2d6';
  }

  if (value >= 84) {
    return '#ff5a00';
  }

  if (value >= 62) {
    return '#ffc400';
  }

  if (value >= 46) {
    return '#ffe58a';
  }

  return '#e8f2dc';
}
