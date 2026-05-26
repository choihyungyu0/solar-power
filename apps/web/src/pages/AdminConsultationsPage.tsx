import { Fragment, useCallback, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  LuChevronDown,
  LuChevronUp,
  LuFileText,
  LuRefreshCw,
  LuSearch,
  LuShieldCheck,
  LuUserRound,
  LuX,
} from 'react-icons/lu';
import {
  ADMIN_CONSULTATION_STATUSES,
  fetchAdminConsultations,
  getConsultationProfitReport,
  updateAdminConsultationStatus,
  type AdminConsultationRow,
  type AdminConsultationProfitReport,
  type AdminConsultationStatus,
} from '../lib/adminConsultationClient';
import './AdminConsultationsPage.css';

type StatusFilter = AdminConsultationStatus | 'all';
type ProfitReportModalState = {
  row: AdminConsultationRow;
  report: AdminConsultationProfitReport | null;
  isLoading: boolean;
  errorMessage: string;
};

const statusLabels: Record<AdminConsultationStatus, string> = {
  received: '접수',
  contacted: '연락 완료',
  waiting_documents: '서류 대기',
  proposal_sent: '제안 발송',
  closed: '종료',
};

function formatDate(value: string | null) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatNumber(value: number | null, unit: string) {
  if (value === null) {
    return '-';
  }

  return `${Math.round(value).toLocaleString('ko-KR')}${unit}`;
}

function formatKrw(value: number | null) {
  if (value === null) {
    return '-';
  }

  return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

function formatYears(value: number | null) {
  if (value === null || value <= 0) {
    return '-';
  }

  return `약 ${value.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}년`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getPathValue(value: unknown, path: string[]) {
  return path.reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), value);
}

function getPathNumber(value: unknown, path: string[]) {
  const candidate = getPathValue(value, path);

  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
}

function getPathText(value: unknown, path: string[]) {
  const candidate = getPathValue(value, path);

  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
}

function getPathTextArray(value: unknown, path: string[]) {
  const candidate = getPathValue(value, path);

  return Array.isArray(candidate)
    ? candidate.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function includesSearchText(row: AdminConsultationRow, searchText: string) {
  if (!searchText) {
    return true;
  }

  const target = [
    row.name,
    row.contact,
    row.email,
    row.consultationType,
    row.roadAddress,
    row.status,
    row.suitabilityGrade,
    row.source,
    row.isTest ? '테스트 데이터' : '',
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return target.includes(searchText);
}

export default function AdminConsultationsPage() {
  const [adminKey, setAdminKey] = useState('');
  const [rows, setRows] = useState<AdminConsultationRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchValue, setSearchValue] = useState('');
  const [showTestData, setShowTestData] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [profitReportModal, setProfitReportModal] = useState<ProfitReportModalState | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);

  const visibleRows = useMemo(
    () => rows.filter((row) => showTestData || row.isTest !== true),
    [rows, showTestData],
  );

  const filteredRows = useMemo(() => {
    const searchText = searchValue.trim().toLowerCase();

    return visibleRows.filter((row) => {
      const matchesStatus = statusFilter === 'all' || row.status === statusFilter;

      return matchesStatus && includesSearchText(row, searchText);
    });
  }, [visibleRows, searchValue, statusFilter]);

  const statusCounts = useMemo(() => {
    return ADMIN_CONSULTATION_STATUSES.reduce<Record<AdminConsultationStatus, number>>(
      (counts, status) => ({
        ...counts,
        [status]: visibleRows.filter((row) => row.status === status).length,
      }),
      {
        received: 0,
        contacted: 0,
        waiting_documents: 0,
        proposal_sent: 0,
        closed: 0,
      },
    );
  }, [visibleRows]);

  const loadConsultations = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const nextRows = await fetchAdminConsultations(adminKey);

      setRows(nextRows);
      setLastLoadedAt(new Date().toISOString());
      setSuccessMessage(`${nextRows.length.toLocaleString('ko-KR')}건의 상담 신청을 불러왔습니다.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '관리자 상담 목록을 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, [adminKey]);

  const handleLoadSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void loadConsultations();
  };

  const handleStatusChange = async (id: string, status: AdminConsultationStatus) => {
    setUpdatingId(id);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const response = await updateAdminConsultationStatus(id, status, adminKey);

      setRows((currentRows) =>
        currentRows.map((row) => (row.id === response.id ? { ...row, status: response.status } : row)),
      );
      setSuccessMessage(`상담 상태를 '${statusLabels[response.status]}'로 변경했습니다.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '상담 상태를 변경하지 못했습니다.');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleStatusSelect = (event: ChangeEvent<HTMLSelectElement>, row: AdminConsultationRow) => {
    const nextStatus = event.target.value as AdminConsultationStatus;

    if (nextStatus !== row.status) {
      void handleStatusChange(row.id, nextStatus);
    }
  };

  const handleProfitReportOpen = async (row: AdminConsultationRow) => {
    setProfitReportModal({
      row,
      report: null,
      isLoading: true,
      errorMessage: '',
    });

    try {
      const report = await getConsultationProfitReport(row.id, adminKey);

      setProfitReportModal({
        row,
        report,
        isLoading: false,
        errorMessage: '',
      });
    } catch (error) {
      setProfitReportModal({
        row,
        report: null,
        isLoading: false,
        errorMessage: error instanceof Error ? error.message : '수익 리포트를 불러오지 못했습니다.',
      });
    }
  };

  const handleProfitReportClose = () => {
    setProfitReportModal(null);
  };

  return (
    <div className="admin-consultations-page">
      <header className="admin-consultations-header">
        <a className="admin-consultations-brand" href="/" aria-label="이코햇 홈">
          <span className="admin-consultations-brand-mark" aria-hidden="true">
            <span />
            <span />
          </span>
          <span>
            <strong>이코햇</strong>
            <small>SolarMate Admin</small>
          </span>
        </a>

        <div className="admin-consultations-header-actions">
          <a href="/login">
            <LuUserRound aria-hidden="true" />
            로그인 화면
          </a>
        </div>
      </header>

      <main className="admin-consultations-main">
        <section className="admin-consultations-toolbar" aria-labelledby="admin-consultations-title">
          <div>
            <span>SolarMate Admin</span>
            <h1 id="admin-consultations-title">상담 신청 관리</h1>
          </div>

          <form className="admin-consultations-key-form" onSubmit={handleLoadSubmit}>
            <label htmlFor="admin-key-input">
              <LuShieldCheck aria-hidden="true" />
              <input
                id="admin-key-input"
                type="password"
                value={adminKey}
                placeholder="관리자 키"
                onChange={(event) => setAdminKey(event.target.value)}
              />
            </label>

            <button type="submit" disabled={isLoading}>
              <LuRefreshCw aria-hidden="true" />
              {isLoading ? '불러오는 중' : '새로고침'}
            </button>
            <p>키 저장 안 함 · 새로고침하면 다시 입력해야 합니다.</p>
          </form>
        </section>

        <section className="admin-consultations-summary" aria-label="상담 상태 요약">
          {ADMIN_CONSULTATION_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              className={statusFilter === status ? 'is-active' : ''}
              onClick={() => setStatusFilter(statusFilter === status ? 'all' : status)}
            >
              <span>{statusLabels[status]}</span>
              <strong>{statusCounts[status].toLocaleString('ko-KR')}</strong>
            </button>
          ))}
        </section>

        <section className="admin-consultations-controls" aria-label="상담 목록 필터">
          <label htmlFor="admin-consultation-search">
            <LuSearch aria-hidden="true" />
            <input
              id="admin-consultation-search"
              type="search"
              value={searchValue}
              placeholder="이름, 연락처, 주소 검색"
              onChange={(event) => setSearchValue(event.target.value)}
            />
          </label>

          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
            <option value="all">전체 상태</option>
            {ADMIN_CONSULTATION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {statusLabels[status]}
              </option>
            ))}
          </select>

          <p>
            {filteredRows.length.toLocaleString('ko-KR')}건
            {lastLoadedAt ? ` · ${formatDate(lastLoadedAt)} 기준` : ''}
          </p>

          <label className="admin-consultations-test-toggle">
            <input
              type="checkbox"
              checked={showTestData}
              onChange={(event) => setShowTestData(event.target.checked)}
            />
            테스트 데이터 보기
          </label>
        </section>

        {errorMessage && (
          <p className="admin-consultations-error" role="alert">
            {errorMessage}
          </p>
        )}

        {successMessage && (
          <p className="admin-consultations-success" role="status">
            {successMessage}
          </p>
        )}

        <section className="admin-consultations-table-frame" aria-label="상담 신청 목록">
          <table>
            <thead>
              <tr>
                <th>접수일</th>
                <th>고객</th>
                <th>상담 유형</th>
                <th>주소</th>
                <th>AI 적합도</th>
                <th>상태</th>
                <th>상세</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <Fragment key={row.id}>
                  <tr>
                    <td>{formatDate(row.createdAt)}</td>
                    <td>
                      <strong>{row.name || '-'}</strong>
                      <span>{row.contact || '-'}</span>
                      {row.isTest && <em className="admin-consultations-test-badge">테스트</em>}
                    </td>
                    <td>{row.consultationType || '-'}</td>
                    <td>{row.roadAddress || '-'}</td>
                    <td>
                      <strong>{row.suitabilityGrade || '-'}</strong>
                      <span>{row.suitabilityScore !== null ? `${row.suitabilityScore}점` : '-'}</span>
                    </td>
                    <td>
                      <select
                        value={row.status}
                        disabled={updatingId === row.id}
                        onChange={(event) => handleStatusSelect(event, row)}
                        aria-label={`${row.name || '상담'} 상태 변경`}
                      >
                        {ADMIN_CONSULTATION_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {statusLabels[status]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <div className="admin-consultations-row-actions">
                        <button
                          type="button"
                          className="admin-consultations-detail-button"
                          onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                        >
                          {expandedId === row.id ? <LuChevronUp aria-hidden="true" /> : <LuChevronDown aria-hidden="true" />}
                          보기
                        </button>
                        <button
                          type="button"
                          className="admin-consultations-report-button"
                          onClick={() => void handleProfitReportOpen(row)}
                        >
                          <LuFileText aria-hidden="true" />
                          수익 리포트 보기
                        </button>
                      </div>
                    </td>
                  </tr>

                  {expandedId === row.id && (
                    <tr className="admin-consultations-detail-row" key={`${row.id}-detail`}>
                      <td colSpan={7}>
                        <dl>
                          <div>
                            <dt>이메일</dt>
                            <dd>{row.email || '-'}</dd>
                          </div>
                          <div>
                            <dt>분석 ID</dt>
                            <dd>{row.analysisResultId || '-'}</dd>
                          </div>
                          <div>
                            <dt>수익 리포트 ID</dt>
                            <dd>{row.profitReportId || '-'}</dd>
                          </div>
                          <div>
                            <dt>예상 연간 발전량</dt>
                            <dd>{formatNumber(row.annualGenerationKwh, 'kWh')}</dd>
                          </div>
                          <div>
                            <dt>예상 설치 용량</dt>
                            <dd>{row.installCapacityKw !== null ? `${row.installCapacityKw.toLocaleString('ko-KR')}kW` : '-'}</dd>
                          </div>
                          <div>
                            <dt>예상 초기 현금 필요액</dt>
                            <dd>{formatKrw(row.estimatedCashNeededKrw)}</dd>
                          </div>
                          <div>
                            <dt>추정 회수기간</dt>
                            <dd>{formatYears(row.paybackYears)}</dd>
                          </div>
                          <div>
                            <dt>보조금 기준</dt>
                            <dd>{row.subsidyProgramName || '-'}</dd>
                          </div>
                          <div>
                            <dt>대출 상태</dt>
                            <dd>{row.loanApprovalStatus || '-'}</dd>
                          </div>
                          <div>
                            <dt>데이터 구분</dt>
                            <dd>{row.isTest ? '테스트 데이터' : '운영 데이터'}</dd>
                          </div>
                          <div>
                            <dt>source</dt>
                            <dd>{row.source || '-'}</dd>
                          </div>
                        </dl>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}

              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="admin-consultations-empty">
                    조회된 상담 신청이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </main>

      {profitReportModal && (
        <ProfitReportModal modalState={profitReportModal} onClose={handleProfitReportClose} />
      )}
    </div>
  );
}

function ProfitReportModal({
  modalState,
  onClose,
}: {
  modalState: ProfitReportModalState;
  onClose: () => void;
}) {
  const report = modalState.report?.report ?? null;
  const markdown = modalState.report?.reportMarkdown ?? '';
  const suitabilityGrade = getPathText(report, ['fourMetrics', 'subsidyAndSuitability', 'installationSuitabilityGrade']);
  const suitabilityScore = getPathNumber(report, ['fourMetrics', 'subsidyAndSuitability', 'installationSuitabilityScore']);
  const suitabilityLabel = getPathText(report, ['fourMetrics', 'subsidyAndSuitability', 'installationSuitabilityLabel']);
  const annualGenerationKwh = getPathNumber(report, ['fourMetrics', 'expectedGeneration', 'annualGenerationKwh']);
  const annualSavingKrw = getPathNumber(report, ['fourMetrics', 'payback', 'annualSavingKrw']);
  const installCostKrw = getPathNumber(report, ['netInvestment', 'estimatedInstallCostKrw']);
  const subsidyKrw = getPathNumber(report, ['netInvestment', 'subsidyEstimateKrw']);
  const loanLimitKrw = getPathNumber(report, ['loanSupportScenario', 'estimatedLoanLimitKrw']);
  const monthlyPaymentKrw = getPathNumber(report, ['loanSupportScenario', 'monthlyPaymentEstimateKrw']);
  const loanApprovalStatus = getPathText(report, ['loanSupportScenario', 'loanApprovalStatus']);
  const cashNeededKrw = getPathNumber(report, ['netInvestment', 'cashNeededKrw']);
  const paybackYears = getPathNumber(report, ['netInvestment', 'paybackYears']);
  const disclaimers = getPathTextArray(report, ['riskDisclaimers']);

  return (
    <div className="admin-report-modal-backdrop" role="presentation">
      <section
        className="admin-report-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-profit-report-title"
      >
        <div className="admin-report-modal-header">
          <div>
            <span>AI 수익·보조금·금융 리포트</span>
            <h2 id="admin-profit-report-title">수익 리포트 상세</h2>
            <p>{modalState.row.name || '상담 신청'} · {modalState.row.roadAddress || '주소 확인 필요'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="수익 리포트 닫기">
            <LuX aria-hidden="true" />
          </button>
        </div>

        {modalState.isLoading && <p className="admin-report-modal-status">수익 리포트를 불러오는 중입니다.</p>}

        {modalState.errorMessage && (
          <p className="admin-report-modal-error" role="alert">
            {modalState.errorMessage}
          </p>
        )}

        {report && (
          <>
            <dl className="admin-report-card-grid">
              <div>
                <dt>AI 적합도</dt>
                <dd>
                  {suitabilityGrade || '-'}
                  {suitabilityScore !== null ? ` · ${suitabilityScore}점` : ''}
                </dd>
                <p>{suitabilityLabel || '검토 필요'}</p>
              </div>
              <div>
                <dt>예상 발전량</dt>
                <dd>{formatNumber(annualGenerationKwh, 'kWh')}</dd>
                <p>연 절감/수익 {formatKrw(annualSavingKrw)} 추정</p>
              </div>
              <div>
                <dt>설치비/보조금</dt>
                <dd>{formatKrw(installCostKrw)}</dd>
                <p>보조금 {formatKrw(subsidyKrw)} · 확인 필요</p>
              </div>
              <div>
                <dt>대출 검토 시나리오</dt>
                <dd>{formatKrw(loanLimitKrw)}</dd>
                <p>{loanApprovalStatus || '금융기관 심사 필요'} · 월 {formatKrw(monthlyPaymentKrw)} 추정</p>
              </div>
              <div>
                <dt>실투자금/회수기간</dt>
                <dd>{formatKrw(cashNeededKrw)}</dd>
                <p>{formatYears(paybackYears)} 추정</p>
              </div>
            </dl>

            <section className="admin-report-warning-box">
              <strong>주의사항</strong>
              <ul>
                {(disclaimers.length > 0 ? disclaimers : ['보조금, 대출, 발전량은 예상·추정 값이며 실제 확인이 필요합니다.']).map(
                  (item) => (
                    <li key={item}>{item}</li>
                  ),
                )}
              </ul>
            </section>

            <details className="admin-report-preview">
              <summary>reportMarkdown 보기</summary>
              <pre>{markdown || 'Markdown 리포트가 없습니다.'}</pre>
            </details>

            <details className="admin-report-preview">
              <summary>개발자 JSON 보기</summary>
              <pre>{JSON.stringify(report, null, 2)}</pre>
            </details>
          </>
        )}
      </section>
    </div>
  );
}
