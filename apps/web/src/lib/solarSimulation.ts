const INSTALLABLE_AREA_RATIO = 0.35;
const PANEL_CAPACITY_DENSITY_KW_PER_M2 = 0.18;
const ANNUAL_GENERATION_KWH_PER_KW = 1265;
const ELECTRICITY_VALUE_KRW_PER_KWH = 150;

// MVP assumptions for first-pass visualization only.
// These are not exact engineering values and must be replaced with site survey,
// shading, structural, panel-spec, and tariff data before real proposals.
export function estimateInstallableArea(roofAreaM2: number): number {
  return roofAreaM2 * INSTALLABLE_AREA_RATIO;
}

export function estimateCapacityKw(installableAreaM2: number): number {
  return installableAreaM2 * PANEL_CAPACITY_DENSITY_KW_PER_M2;
}

export function estimateAnnualGenerationKwh(capacityKw: number): number {
  return capacityKw * ANNUAL_GENERATION_KWH_PER_KW;
}

export function estimateAnnualSavingsKrw(annualGenerationKwh: number): number {
  return annualGenerationKwh * ELECTRICITY_VALUE_KRW_PER_KWH;
}
