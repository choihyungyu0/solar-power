import { useMemo, useState } from 'react';
import type { IconType } from 'react-icons';
import {
  LuArrowLeft,
  LuArrowRight,
  LuBadgeCheck,
  LuBuilding2,
  LuChartNoAxesColumnIncreasing,
  LuCheck,
  LuCoins,
  LuMapPin,
  LuPanelTop,
  LuRuler,
  LuShieldCheck,
} from 'react-icons/lu';
import SafeLocalImage from '../components/SafeLocalImage';
import SolarMateHeader from '../components/SolarMateHeader';
import { readLandingAddressDraft } from '../lib/addressDraft';
import './SimulationSetupPage.css';

type PanelOption = {
  id: string;
  watt: number;
  efficiency: string;
  size: string;
  weight: string;
  warranty: string;
  image: string;
  fallbackImage: string;
  alt: string;
};

type AngleOption = {
  id: string;
  angle: number;
  efficiency: string;
  shadeDistance: string;
  capacity: string;
  image: string;
  fallbackImage: string;
  alt: string;
};

const panelOptions: PanelOption[] = [
  {
    id: 'panel-500',
    watt: 500,
    efficiency: '21.6%',
    size: '1,038×2,228×35mm',
    weight: '24.9kg',
    warranty: '25년 성능보증',
    image: '/assets/simulation/panel-500w.webp',
    fallbackImage: '/assets/simulation/panel-500w.webp.png',
    alt: '500W 태양광 패널',
  },
  {
    id: 'panel-640',
    watt: 640,
    efficiency: '22.9%',
    size: '2,465×1,134×30mm',
    weight: '34.7kg',
    warranty: '30년 성능보증',
    image: '/assets/simulation/panel-640w.webp',
    fallbackImage: '/assets/simulation/panel-640w.webp.png',
    alt: '640W 태양광 패널',
  },
];

const angleOptions: AngleOption[] = [
  {
    id: 'angle-30',
    angle: 30,
    efficiency: '97%',
    shadeDistance: '감소',
    capacity: '증가',
    image: '/assets/simulation/panel-angle-tilt.webp',
    fallbackImage: '/assets/simulation/panel-angle-tilt.webp.png',
    alt: '30도 경사 태양광 패널',
  },
  {
    id: 'angle-35',
    angle: 35,
    efficiency: '99%',
    shadeDistance: '증가',
    capacity: '감소',
    image: '/assets/simulation/panel-angle-tilt.webp',
    fallbackImage: '/assets/simulation/panel-angle-tilt.webp.png',
    alt: '35도 경사 태양광 패널',
  },
];

function SimulationSetupPage() {
  const [selectedPanelId, setSelectedPanelId] = useState('panel-500');
  const [selectedAngleId, setSelectedAngleId] = useState('angle-30');
  const addressDraft = useMemo(() => readLandingAddressDraft(), []);
  const selectedAddress = addressDraft?.address ?? '경기도 수원시 팔달구 경수대로 464';
  const selectedJibunAddress = addressDraft
    ? '지도에서 건물 선택 시 실제 건물 polygon 데이터로 반영'
    : '경기도 수원시 팔달구 인계동 1017';

  const selectedPanel = useMemo(
    () => panelOptions.find((panel) => panel.id === selectedPanelId) ?? panelOptions[0],
    [selectedPanelId],
  );

  const selectedAngle = useMemo(
    () => angleOptions.find((angle) => angle.id === selectedAngleId) ?? angleOptions[0],
    [selectedAngleId],
  );

  const summary = useMemo(() => {
    const savingEffect = selectedPanel.watt >= 640 ? '상향 예상' : '양호';
    const suitability = selectedAngle.angle === 35 ? '면적 검토 필요' : '높음';

    return {
      generationEfficiency: selectedAngle.efficiency,
      savingEffect,
      suitability,
    };
  }, [selectedAngle, selectedPanel]);

  const goHome = () => {
    window.location.href = '/risk-map';
  };

  const goNext = () => {
    window.location.href = '/simulation/result';
  };

  return (
    <main className="simulationSetupPage">
      <SolarMateHeader />

      <div className="simulationSetupMain">
        <section className="setupTopSection" aria-labelledby="simulation-setup-title">
          <div className="setupTitleBox">
            <h1 id="simulation-setup-title">태양광 설치 시뮬레이션</h1>
            <p>우리 집에 맞는 패널과 설치 각도를 선택해 예상 발전량과 절감효과를 확인하세요.</p>
          </div>

          <article className="setupAddressCard" aria-label="분석 대상 주소">
            <div className="setupAddressLines">
              <AddressRow label={addressDraft ? '입력주소' : '도로명주소'} value={selectedAddress} />
              <AddressRow label={addressDraft ? '데이터 연결' : '지번'} value={selectedJibunAddress} />
            </div>

            <div className="setupBadges" aria-label="주소 분석 상태">
              <StatusBadge icon={addressDraft ? LuMapPin : LuBuilding2} tone="blue" label={addressDraft ? '입력 주소 반영' : '공동주택'} />
              <StatusBadge icon={LuBadgeCheck} tone="green" label="가상설치 가능" />
              <StatusBadge icon={LuBadgeCheck} tone="indigo" label="예상 분석 준비 완료" />
            </div>
          </article>
        </section>

        <section className="setupContentLayout" aria-label="태양광 설치 조건 선택">
          <div className="setupOptionColumn">
            <OptionSectionTitle icon={LuPanelTop} title="적용할 패널을 선택하세요." />

            <div className="setupOptionGrid">
              {panelOptions.map((panel) => (
                <PanelOptionCard
                  key={panel.id}
                  panel={panel}
                  isSelected={selectedPanelId === panel.id}
                  onSelect={() => setSelectedPanelId(panel.id)}
                />
              ))}
            </div>

            <OptionSectionTitle icon={LuRuler} title="적용할 패널 경사각을 선택하세요." />

            <div className="setupOptionGrid">
              {angleOptions.map((angle) => (
                <AngleOptionCard
                  key={angle.id}
                  angle={angle}
                  isSelected={selectedAngleId === angle.id}
                  onSelect={() => setSelectedAngleId(angle.id)}
                />
              ))}
            </div>
          </div>

          <aside className="setupSummaryPanel" aria-label="선택 결과 요약">
            <h2>선택 결과 요약</h2>

            <div className="setupSummaryList">
              <SummaryItem icon={LuPanelTop} tone="blue" label="선택 패널" value={`${selectedPanel.watt}W`} />
              <SummaryItem icon={LuRuler} tone="green" label="선택 경사각" value={`${selectedAngle.angle}°`} />
              <SummaryItem
                icon={LuChartNoAxesColumnIncreasing}
                tone="purple"
                label="예상 발전 효율"
                value={summary.generationEfficiency}
              />
              <SummaryItem icon={LuCoins} tone="yellow" label="예상 절감 효과" value={summary.savingEffect} />
              <SummaryItem icon={LuShieldCheck} tone="mint" label="예상 설치 적합도" value={summary.suitability} />
            </div>

            <div className="setupSummaryDivider" />

            <SafeLocalImage
              src="/assets/simulation/building-solar-preview.webp"
              fallbackSrc="/assets/simulation/building-solar-preview.webp.png"
              alt="태양광 패널이 설치된 아파트 미리보기"
              className="setupPreviewImage"
            />

            <p className="setupSummaryNote">
              예상·추정 값은 데모 산식 기준입니다. 실제 공고 확인, 구조 검토, 현장조사가 필요합니다.
            </p>
          </aside>
        </section>

        <div className="setupBottomActions">
          <button className="setupPreviousButton" type="button" onClick={goHome}>
            <LuArrowLeft aria-hidden="true" />
            이전
          </button>
          <button className="setupNextButton" type="button" onClick={goNext}>
            다음
            <LuArrowRight aria-hidden="true" />
          </button>
        </div>
      </div>
    </main>
  );
}

function AddressRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="setupAddressRow">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusBadge({ icon: Icon, tone, label }: { icon: IconType; tone: string; label: string }) {
  return (
    <span className={`setupBadge is-${tone}`}>
      <Icon aria-hidden="true" />
      {label}
    </span>
  );
}

function OptionSectionTitle({ icon: Icon, title }: { icon: IconType; title: string }) {
  return (
    <div className="setupSectionTitle">
      <Icon aria-hidden="true" />
      <strong>{title}</strong>
    </div>
  );
}

function PanelOptionCard({
  panel,
  isSelected,
  onSelect,
}: {
  panel: PanelOption;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button className={`setupOptionCard ${isSelected ? 'isSelected' : ''}`} type="button" onClick={onSelect} aria-pressed={isSelected}>
      <SelectionMark isSelected={isSelected} />
      <h2>{panel.watt}W</h2>
      <div className="setupOptionImageWrap">
        <SafeLocalImage src={panel.image} fallbackSrc={panel.fallbackImage} alt={panel.alt} className="setupPanelImage" />
      </div>
      <SpecTable
        rows={[
          ['출력', `${panel.watt}W`],
          ['효율', panel.efficiency],
          ['크기', panel.size],
          ['무게', panel.weight],
          ['품질보증', panel.warranty],
        ]}
      />
    </button>
  );
}

function AngleOptionCard({
  angle,
  isSelected,
  onSelect,
}: {
  angle: AngleOption;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`setupOptionCard setupAngleCard ${isSelected ? 'isSelected' : ''}`}
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
    >
      <SelectionMark isSelected={isSelected} />
      <h2>{angle.angle}°</h2>
      <div className="setupOptionImageWrap isAngle">
        <SafeLocalImage src={angle.image} fallbackSrc={angle.fallbackImage} alt={angle.alt} className="setupAngleImage" />
      </div>
      <SpecTable
        rows={[
          ['각도', `${angle.angle}도`],
          ['효율', angle.efficiency],
          ['이격거리', angle.shadeDistance],
          ['설치용량', angle.capacity],
        ]}
      />
    </button>
  );
}

function SelectionMark({ isSelected }: { isSelected: boolean }) {
  return <span className="setupSelectionMark">{isSelected && <LuCheck aria-hidden="true" />}</span>;
}

function SpecTable({ rows }: { rows: [string, string][] }) {
  return (
    <table className="setupSpecTable">
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <th>{label}</th>
            <td>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SummaryItem({
  icon: Icon,
  tone,
  label,
  value,
}: {
  icon: IconType;
  tone: string;
  label: string;
  value: string;
}) {
  return (
    <div className="setupSummaryItem">
      <span className={`setupSummaryIcon is-${tone}`}>
        <Icon aria-hidden="true" />
      </span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

export default SimulationSetupPage;
