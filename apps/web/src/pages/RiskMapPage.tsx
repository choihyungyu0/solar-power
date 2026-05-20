import { useCallback, useEffect, useState } from 'react';
import {
  initVWorld3DMap,
  loadVWorldScript,
  type VWorldMapController,
  type VWorldSelection,
} from '../lib/loadVWorldScript';
import './RiskMapPage.css';

const MAP_CONTAINER_ID = 'vworld-risk-map';

type MapLoadStatus = 'loading' | 'ready' | 'error';

type SelectedBuilding = {
  apartmentName: string;
  address: string;
  currentMonthlyFee: string;
  monthlyUsage: string;
  riskLevel: '낮음' | '보통' | '높음' | '위험 높음';
  fiveYearExtraCost: string;
  solarPotential: string;
  subsidyReview: string;
  selectionNote: string;
};

const demoBuilding: SelectedBuilding = {
  apartmentName: '한빛마을 3단지',
  address: '경기도 성남시 분당구 예시로 123',
  currentMonthlyFee: '추정 2,450,000원',
  monthlyUsage: '추정 12,500kWh',
  riskLevel: '위험 높음',
  fiveYearExtraCost: '예상 31,800,000원',
  solarPotential: '절감 가능성 양호',
  subsidyReview: '검토 가능',
  selectionNote: '지도에서 건물을 선택하면 이 영역이 선택 위치 기준 데모 값으로 갱신됩니다.',
};

const riskLegendItems = [
  { label: '낮음', tone: 'low' },
  { label: '보통', tone: 'medium' },
  { label: '높음', tone: 'high' },
  { label: '위험 높음', tone: 'critical' },
];

const buildingFields = [
  ['아파트명', 'apartmentName'],
  ['주소', 'address'],
  ['현재 월 공용부 전기요금', 'currentMonthlyFee'],
  ['월 전기사용량', 'monthlyUsage'],
  ['전기세 상승 위험 등급', 'riskLevel'],
  ['5년 누적 추가 부담 예상', 'fiveYearExtraCost'],
  ['태양광 도입 시 예상 절감 가능성', 'solarPotential'],
  ['보조금 검토 가능성', 'subsidyReview'],
] as const;

function RiskMapPage() {
  const [mapStatus, setMapStatus] = useState<MapLoadStatus>('loading');
  const [selectedBuilding, setSelectedBuilding] = useState<SelectedBuilding>(demoBuilding);
  const [analysisStatus, setAnalysisStatus] = useState('');

  const handleMapSelection = useCallback((selection?: VWorldSelection) => {
    const coordinateText =
      selection?.longitude && selection.latitude
        ? `선택 좌표 ${selection.latitude.toFixed(5)}, ${selection.longitude.toFixed(5)} 기준 1차 추정입니다.`
        : '선택 위치 기준 1차 추정입니다.';

    setSelectedBuilding({
      ...demoBuilding,
      selectionNote: `${coordinateText} 실제 건물 속성 연결은 현장조사와 공공데이터 매칭이 필요합니다.`,
    });
    setAnalysisStatus('');
  }, []);

  useEffect(() => {
    let isMounted = true;
    let controller: VWorldMapController | null = null;

    setMapStatus('loading');

    loadVWorldScript()
      .then(() => {
        if (!isMounted) {
          return;
        }

        controller = initVWorld3DMap({
          mapId: MAP_CONTAINER_ID,
          onSelect: handleMapSelection,
        });
        setMapStatus('ready');
      })
      .catch(() => {
        if (isMounted) {
          setMapStatus('error');
        }
      });

    return () => {
      isMounted = false;
      controller?.dispose();
    };
  }, [handleMapSelection]);

  return (
    <main className="riskMapPage">
      <header className="landingHeader riskMapHeader">
        <a className="logo" href="/" aria-label="솔라메이트 홈">
          <span className="sunMark" aria-hidden="true" />
          <span>
            <strong>솔라메이트</strong>
            <small>SolarMate</small>
          </span>
        </a>

        <nav className="desktopNav" aria-label="주요 메뉴">
          <a href="/#service-intro">서비스 소개</a>
          <a href="/risk-map">전기세 위험 진단</a>
          <a href="/#service-intro-status">절감 시나리오</a>
          <a href="/#solar-feed">정책 지원</a>
          <a href="/#contact">고객센터</a>
        </nav>

        <div className="headerActions">
          <button className="loginButton" type="button">
            로그인
          </button>
          <a className="primaryButton headerCta" href="/risk-map">
            무료 진단 시작
          </a>
        </div>
      </header>

      <section className="riskMapIntro" aria-labelledby="risk-map-title">
        <span className="riskMapEyebrow">전기세 위험 지도</span>
        <div>
          <h1 id="risk-map-title">지도에서 우리 아파트의 전기세 위험을 확인하세요</h1>
          <p>
            3D 지도에서 건물을 선택하면 전기세 상승 위험 등급과 태양광 대응 가능성을 확인할 수 있습니다.
          </p>
        </div>
      </section>

      <section className="riskMapWorkspace" aria-label="전기세 위험 지도 작업 영역">
        <div className="riskMapCanvasColumn">
          <div className="vworldMapShell" onClick={() => handleMapSelection()} role="presentation">
            <div className="mapControlOverlay" aria-label="지도 검색 및 필터">
              <label>
                <span>주소 또는 아파트명 검색</span>
                <input type="search" placeholder="예: 분당구 한빛마을" />
              </label>

              <label>
                <span>지역 선택</span>
                <select defaultValue="seongnam">
                  <option value="seongnam">성남시 분당구</option>
                  <option value="suwon">수원시</option>
                  <option value="goyang">고양시</option>
                  <option value="yongin">용인시</option>
                </select>
              </label>

              <label>
                <span>위험 등급 필터</span>
                <select defaultValue="all">
                  <option value="all">전체</option>
                  <option value="low">낮음</option>
                  <option value="medium">보통</option>
                  <option value="high">높음</option>
                  <option value="critical">위험 높음</option>
                </select>
              </label>
            </div>

            <div id={MAP_CONTAINER_ID} className="vworldMapCanvas" aria-label="브이월드 3D 지도" />

            {mapStatus === 'loading' && (
              <div className="mapStateOverlay" role="status">
                브이월드 3D 지도를 불러오는 중입니다...
              </div>
            )}

            {mapStatus === 'error' && (
              <div className="mapStateOverlay mapStateOverlayError" role="alert">
                브이월드 3D 지도 로드에 실패했습니다. API 키, SDK URL, 허용 도메인을 확인해주세요.
              </div>
            )}

            <div className="riskLegend" aria-label="위험 등급 범례">
              {riskLegendItems.map((item) => (
                <span key={item.label}>
                  <i className={`legendDot legendDot-${item.tone}`} aria-hidden="true" />
                  {item.label}
                </span>
              ))}
            </div>
          </div>
        </div>

        <aside className="riskInfoPanel" id="analysis-panel" aria-label="선택 건물 위험 정보">
          <div className="riskInfoHeader">
            <div>
              <span>시나리오 기준 · 현장조사 필요</span>
              <h2>선택 건물 정보</h2>
            </div>
            <strong>{selectedBuilding.riskLevel}</strong>
          </div>

          <dl className="buildingInfoList">
            {buildingFields.map(([label, key]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{selectedBuilding[key]}</dd>
              </div>
            ))}
          </dl>

          <p className="selectionNote">{selectedBuilding.selectionNote}</p>

          <div className="riskScenarioBox">
            <h3>정책 지원 메모</h3>
            <p>
              보조금은 공고 기준 확인 필요 상태입니다. 접수 가능 여부와 지원 규모는 지자체 예산, 건물 조건,
              신청 시점에 따라 달라질 수 있습니다.
            </p>
          </div>

          <button
            className="riskAnalysisButton"
            type="button"
            onClick={() => setAnalysisStatus('선택 건물 기준 위험 분석 시나리오 초안이 준비되었습니다.')}
          >
            이 건물로 위험 분석 시작
          </button>

          {analysisStatus && <p className="analysisStatus">{analysisStatus}</p>}

          <p className="riskDisclaimer">
            본 결과는 입력값과 공공데이터 기반의 1차 추정 결과입니다. 실제 전기요금, 설치 가능성, 절감 효과는
            계약 방식, 세대 구성, 현장조사, 정책 공고 기준에 따라 달라질 수 있습니다.
          </p>
        </aside>
      </section>
    </main>
  );
}

export default RiskMapPage;
