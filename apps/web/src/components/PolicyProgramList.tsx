import type { PolicyProgram } from '../lib/solarTypes';

type PolicyProgramListProps = {
  policies: PolicyProgram[];
};

function PolicyProgramList({ policies }: PolicyProgramListProps) {
  return (
    <section className="mvpSection" id="policy-programs" aria-labelledby="policy-title">
      <div className="sectionHeader">
        <span className="panelKicker">Policy Candidates</span>
        <h2 id="policy-title">보조금·정책자금 후보</h2>
        <p>지원 확정이 아니라 실제 공고 확인이 필요한 후보 목록입니다.</p>
      </div>
      <div className="policyGrid">
        {policies.map((policy) => (
          <article className="policyCard" key={policy.id}>
            <div className="policyCardTop">
              <span className={`statusPill status-${policy.status.replace(/\s/g, '-')}`}>{policy.status}</span>
              <strong>{policy.region}</strong>
            </div>
            <h3>{policy.title}</h3>
            <dl>
              <div>
                <dt>대상</dt>
                <dd>{policy.target}</dd>
              </div>
              <div>
                <dt>지원 형태</dt>
                <dd>{policy.supportType}</dd>
              </div>
              <div>
                <dt>금액</dt>
                <dd>{policy.amountText}</dd>
              </div>
            </dl>
            <p>{policy.note}</p>
            {policy.sourceUrl ? (
              <a href={policy.sourceUrl} target="_blank" rel="noreferrer">
                출처 확인
              </a>
            ) : (
              <span className="sourceText">{policy.sourceName}</span>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

export default PolicyProgramList;
