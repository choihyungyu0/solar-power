type SolarSimulationOverlayProps = {
  isActive: boolean;
  estimatedCapacityKw: number;
  fallbackMessage: string;
};

const panelCells = Array.from({ length: 36 }, (_, index) => index);

function SolarSimulationOverlay({ isActive, estimatedCapacityKw, fallbackMessage }: SolarSimulationOverlayProps) {
  if (!isActive) {
    return null;
  }

  return (
    <div className="solarSimulationOverlay" aria-label="태양광 가상 설치 시각화">
      <div className="selectedRoofOverlay">
        <div className="panelGrid" aria-hidden="true">
          {panelCells.map((cell) => (
            <span key={cell} />
          ))}
        </div>
      </div>

      <div className="solarMapLabel">
        <strong>태양광 가상 설치</strong>
        <span>예상 {estimatedCapacityKw.toLocaleString('ko-KR')}kW</span>
      </div>

      <div className="solarMapDisclaimer">{fallbackMessage}</div>
    </div>
  );
}

export default SolarSimulationOverlay;
