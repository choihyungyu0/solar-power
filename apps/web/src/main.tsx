import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

type SimulationResult = {
  suitabilityScore: number;
  suitabilityGrade: string;
  usableRoofAreaM2: number;
  recommendedCapacityKw: number;
  annualGenerationKwh: number;
  annualSavingsKrw: number;
  estimatedInstallCostKrw: number;
  estimatedPolicySupportKrw: number;
  ownerPaymentKrw: number;
  simplePaybackYears: number | null;
  co2ReductionKg: number;
  policyNotice: string;
  nextActions: string[];
};

type Review = {
  name: string;
  type: string;
  quote: string;
  metric: string;
};

type Policy = {
  id: string;
  name: string;
  target: string;
  amountDisplay: string;
  status: string;
  sourceUrl: string;
  mvpUse: string;
};

const money = (value: number) => new Intl.NumberFormat('ko-KR').format(value) + '원';
const number = (value: number) => new Intl.NumberFormat('ko-KR').format(value);

function App() {
  const [form, setForm] = useState({
    address: '경기도 성남시 분당구 샘플아파트',
    buildingType: 'apartment',
    householdCount: 420,
    roofAreaM2: 2400,
    monthlyElectricBillKrw: 7200000,
    shadeScore: 82,
    roofUsableRatio: 0.42,
    averageDailySunHours: 3.7,
    electricityPriceKrwPerKwh: 165,
  });
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [status, setStatus] = useState('입력값을 바꾸고 시뮬레이션을 실행해보세요.');
  const [authMessage, setAuthMessage] = useState('로그인하면 리포트 저장과 알림 설정이 가능합니다.');

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/reviews`).then(r => r.json()).then(data => setReviews(data.items ?? [])).catch(() => setReviews([]));
    fetch(`${API_BASE_URL}/api/policies`).then(r => r.json()).then(data => setPolicies(data.items ?? [])).catch(() => setPolicies([]));
  }, []);

  const completion = useMemo(() => {
    if (!result) return 32;
    return Math.min(96, Math.round(result.suitabilityScore));
  }, [result]);

  function updateField(key: string, value: string) {
    setForm(prev => ({
      ...prev,
      [key]: ['address', 'buildingType'].includes(key) ? value : Number(value),
    }));
  }

  async function runSimulation(event: FormEvent) {
    event.preventDefault();
    setStatus('태양광 적합도와 정책 후보를 계산하는 중입니다...');
    try {
      const response = await fetch(`${API_BASE_URL}/api/solar/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      setResult(data.result);
      setStatus('시뮬레이션이 완료되었습니다. 알림 신청 또는 리포트 저장으로 이어갈 수 있습니다.');
    } catch (error) {
      setStatus('API 연결에 실패했습니다. 백엔드가 http://localhost:8000 에서 실행 중인지 확인해주세요.');
    }
  }

  async function mockRegister() {
    const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '최현규', email: 'demo@example.com', password: '123456', userType: 'resident' }),
    });
    const data = await response.json();
    setAuthMessage(data.message ?? '회원가입 목업 완료');
  }

  async function subscribeAlert(channel: 'kakao' | 'sms' | 'email' | 'web') {
    const response = await fetch(`${API_BASE_URL}/api/alerts/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '최현규',
        phoneOrEmail: channel === 'email' ? 'demo@example.com' : '010-0000-0000',
        channel,
        address: form.address,
        topic: 'all',
      }),
    });
    const data = await response.json();
    setStatus(data.message ?? '알림 신청 완료');
  }

  return (
    <main>
      <nav className="nav">
        <strong>Solar Apt.</strong>
        <a href="#service">서비스소개</a>
        <a href="#install">가상설치</a>
        <a href="#policy">정책자금</a>
        <a href="#reviews">가입후기</a>
        <button onClick={mockRegister}>회원가입/로그인</button>
      </nav>

      <section className="hero" id="service">
        <div className="heroText">
          <span className="eyebrow">도심 속 태양광 전환 플랫폼</span>
          <h1>우리 아파트 태양광 설치하기</h1>
          <p>
            전기요금은 오르고, 태양광 보조금은 매년 공고를 놓치기 쉽습니다.
            이 서비스는 아파트·공동주택의 설치 가능성, 예상 절감액, 정책자금 후보를 한 번에 보여줍니다.
          </p>
          <div className="heroActions">
            <a className="primary" href="#install">가상설치 시작</a>
            <a className="secondary" href="#policy">정책자금 보기</a>
          </div>
        </div>
        <div className="cityCard" aria-label="도심 속 태양광 시각화">
          <div className="sun" />
          <div className="skyline">
            <div className="building tall"><span /></div>
            <div className="building mid"><span /></div>
            <div className="building low"><span /></div>
          </div>
          <div className="solarRoof">
            <i /><i /><i /><i /><i /><i />
          </div>
          <p>옥상 면적 · 음영 · 일사량 · 보조금 후보를 결합한 도심형 태양광 리포트</p>
        </div>
      </section>

      <section className="metrics">
        <article><strong>01</strong><span>설치 적합도</span></article>
        <article><strong>02</strong><span>예상 절감액</span></article>
        <article><strong>03</strong><span>정책자금 후보</span></article>
        <article><strong>04</strong><span>카톡/SMS 알림</span></article>
      </section>

      <section className="panel" id="install">
        <div className="sectionTitle">
          <span>핵심 기능</span>
          <h2>태양광 가상설치 시뮬레이션</h2>
          <p>실시간 현장 측정 전 단계에서 “이 아파트가 검토할 만한가?”를 빠르게 판단합니다.</p>
        </div>

        <div className="simGrid">
          <form className="form" onSubmit={runSimulation}>
            <label>주소/단지명<input value={form.address} onChange={e => updateField('address', e.target.value)} /></label>
            <label>건물 유형
              <select value={form.buildingType} onChange={e => updateField('buildingType', e.target.value)}>
                <option value="apartment">아파트</option>
                <option value="public_housing">공공주택</option>
                <option value="commercial">상가/건물</option>
                <option value="single_house">단독주택</option>
              </select>
            </label>
            <label>세대수<input type="number" value={form.householdCount} onChange={e => updateField('householdCount', e.target.value)} /></label>
            <label>옥상 면적 ㎡<input type="number" value={form.roofAreaM2} onChange={e => updateField('roofAreaM2', e.target.value)} /></label>
            <label>월 전기요금<input type="number" value={form.monthlyElectricBillKrw} onChange={e => updateField('monthlyElectricBillKrw', e.target.value)} /></label>
            <label>음영 점수<input type="range" min="0" max="100" value={form.shadeScore} onChange={e => updateField('shadeScore', e.target.value)} /><b>{form.shadeScore}점</b></label>
            <button className="primary full" type="submit">우리 아파트 태양광 설치하기</button>
          </form>

          <div className="resultCard">
            <div className="progress"><span style={{ width: `${completion}%` }} /></div>
            <p className="status">{status}</p>
            {result ? (
              <>
                <h3>{result.suitabilityGrade} · {result.suitabilityScore}점</h3>
                <div className="resultGrid">
                  <article><span>추천 용량</span><strong>{result.recommendedCapacityKw} kW</strong></article>
                  <article><span>연 발전량</span><strong>{number(result.annualGenerationKwh)} kWh</strong></article>
                  <article><span>연 절감액</span><strong>{money(result.annualSavingsKrw)}</strong></article>
                  <article><span>정책지원 추정</span><strong>{money(result.estimatedPolicySupportKrw)}</strong></article>
                  <article><span>회수기간</span><strong>{result.simplePaybackYears ?? '-'}년</strong></article>
                  <article><span>CO₂ 절감</span><strong>{number(result.co2ReductionKg)} kg</strong></article>
                </div>
                <p className="notice">{result.policyNotice}</p>
                <ul>{result.nextActions.map(action => <li key={action}>{action}</li>)}</ul>
              </>
            ) : (
              <div className="empty">
                <h3>아직 계산 전입니다</h3>
                <p>기본 입력값으로 바로 실행하면 데모 결과를 볼 수 있습니다.</p>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="panel dark" id="policy">
        <div className="sectionTitle">
          <span>정책자금</span>
          <h2>받을 수 있는 보조금과 신청 타이밍을 놓치지 않게</h2>
          <p>정확한 지원금액은 매년 공고 기준으로 갱신하고, MVP에서는 후보 정책과 신청 알림을 먼저 제공합니다.</p>
        </div>
        <div className="policyGrid">
          {policies.map(policy => (
            <article key={policy.id}>
              <span>{policy.status}</span>
              <h3>{policy.name}</h3>
              <p>{policy.target}</p>
              <strong>{policy.amountDisplay}</strong>
              <small>{policy.mvpUse}</small>
            </article>
          ))}
        </div>
        <div className="alertBox">
          <div>
            <h3>실시간이 아니어도 괜찮은 알림 구조</h3>
            <p>공고 시작, 서류 누락, 예상 혜택 리포트 생성 완료를 카카오톡·SMS·이메일·웹 알림으로 전달합니다.</p>
          </div>
          <div className="alertButtons">
            <button onClick={() => subscribeAlert('kakao')}>카톡 알림</button>
            <button onClick={() => subscribeAlert('sms')}>문자 알림</button>
            <button onClick={() => subscribeAlert('web')}>웹 알림</button>
          </div>
        </div>
      </section>

      <section className="panel" id="reviews">
        <div className="sectionTitle">
          <span>가입후기</span>
          <h2>도입 검토자의 언어로 보여주는 후기</h2>
        </div>
        <div className="reviewGrid">
          {reviews.map(review => (
            <article key={review.name}>
              <b>{review.type}</b>
              <p>“{review.quote}”</p>
              <strong>{review.metric}</strong>
              <span>{review.name}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="panel authPanel">
        <div>
          <span className="eyebrow">회원 기능</span>
          <h2>가입 후 리포트 저장 · 알림 설정 · 서류 진행상태 관리</h2>
          <p>{authMessage}</p>
        </div>
        <button className="primary" onClick={mockRegister}>회원가입 목업 실행</button>
      </section>

      <footer>
        <strong>Solar Apt.</strong>
        <p>공공성 + 사업성: 경기도 태양광 예산 소진 지원, 공동주택 자가발전 확대, 도심 전력수요 완화.</p>
      </footer>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
