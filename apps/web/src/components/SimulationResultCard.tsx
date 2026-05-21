import type { SaveStatus, SolarSimulationResult } from '../lib/solarTypes';

type SimulationResultCardProps = {
  result: SolarSimulationResult | null;
  saveStatus: SaveStatus;
};

function formatKrw(value: number) {
  return `${value.toLocaleString('ko-KR')}원`;
}

function formatKwh(value: number) {
  return `${value.toLocaleString('ko-KR')}kWh`;
}

function SimulationResultCard({ result, saveStatus }: SimulationResultCardProps) {
  if (!result) {
    return (
      <section className="mvpPanel resultPanel emptyResultPanel" aria-label="시뮬레이션 결과">
        <span className="panelKicker">Demo Formula</span>
        <h2>예상 결과 대기 중</h2>
        <p>왼쪽 요청서를 제출하면 TypeScript 데모 산식으로 결과가 계산됩니다.</p>
      </section>
    );
  }

  const metrics = [
    ['추천 용량', `${result.recommendedCapacityKw.toLocaleString('ko-KR')}kW`],
    ['패널 수', `${result.panelCount.toLocaleString('ko-KR')}장`],
    ['월 발전량', formatKwh(result.expectedMonthlyGenerationKwh)],
    ['연 발전량', formatKwh(result.expectedYearlyGenerationKwh)],
    ['연 절감액', formatKrw(result.expectedYearlySavingKrw)],
    ['설치비', formatKrw(result.estimatedInstallCostKrw)],
    ['추정 보조금', formatKrw(result.estimatedSubsidyKrw)],
    ['자부담', formatKrw(result.estimatedSelfPaymentKrw)],
    ['정책융자 한도', formatKrw(result.policyLoanLimitKrw)],
    ['회수기간', `${result.paybackYears.toLocaleString('ko-KR')}년`],
  ];

  return (
    <section className="mvpPanel resultPanel" aria-labelledby="simulation-result-title">
      <div className="resultHeader">
        <div>
          <span className="panelKicker">Simulation Result</span>
          <h2 id="simulation-result-title">예상 태양광 결과</h2>
        </div>
        <strong className="scoreBadge">
          {result.suitabilityScore}점 · {result.suitabilityGrade}
        </strong>
      </div>
      <div className="resultGrid">
        {metrics.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="householdBenefit">
        <span>세대당 월 환산 혜택</span>
        <strong>예상 {formatKrw(result.householdMonthlyBenefitKrw)}</strong>
      </div>
      <p className="panelNote">{result.demoFormulaNote}</p>
      <p className={`saveStatus is-${saveStatus.state}`}>{saveStatus.message}</p>
    </section>
  );
}

export default SimulationResultCard;
