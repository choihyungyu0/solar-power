import { Fragment, useCallback, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  LuChevronDown,
  LuChevronUp,
  LuRefreshCw,
  LuSearch,
  LuShieldCheck,
} from 'react-icons/lu';
import SolarMateHeader from '../components/SolarMateHeader';
import {
  ADMIN_CONSULTATION_STATUSES,
  fetchAdminConsultations,
  updateAdminConsultationStatus,
  type AdminConsultationRow,
  type AdminConsultationStatus,
} from '../lib/adminConsultationClient';
import './AdminConsultationsPage.css';

type StatusFilter = AdminConsultationStatus | 'all';

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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);

  const filteredRows = useMemo(() => {
    const searchText = searchValue.trim().toLowerCase();

    return rows.filter((row) => {
      const matchesStatus = statusFilter === 'all' || row.status === statusFilter;

      return matchesStatus && includesSearchText(row, searchText);
    });
  }, [rows, searchValue, statusFilter]);

  const statusCounts = useMemo(() => {
    return ADMIN_CONSULTATION_STATUSES.reduce<Record<AdminConsultationStatus, number>>(
      (counts, status) => ({
        ...counts,
        [status]: rows.filter((row) => row.status === status).length,
      }),
      {
        received: 0,
        contacted: 0,
        waiting_documents: 0,
        proposal_sent: 0,
        closed: 0,
      },
    );
  }, [rows]);

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

  return (
    <div className="admin-consultations-page">
      <SolarMateHeader />

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
                      <button
                        type="button"
                        className="admin-consultations-detail-button"
                        onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                      >
                        {expandedId === row.id ? <LuChevronUp aria-hidden="true" /> : <LuChevronDown aria-hidden="true" />}
                        보기
                      </button>
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
    </div>
  );
}
