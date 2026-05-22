import { area as turfArea } from '@turf/turf';
import { getPolygonCentroid, type Coordinate, type PolygonCoordinates } from './roofGeometry';

type LocalPoint = {
  x: number;
  y: number;
};

export type SolarPanelLayoutOptions = {
  panelWidthM?: number;
  panelHeightM?: number;
  rowGapM?: number;
  colGapM?: number;
  columnGapM?: number;
  roofMarginM?: number;
  usableAreaRatio?: number;
  maxPanels?: number;
};

export type SolarPanelLayoutResult = {
  panelPolygons: PolygonCoordinates[];
  roofAreaM2: number;
  usableAreaM2: number;
  panelCount: number;
  estimatedCapacityKw: number;
  warnings: string[];
  reason?: string;
};

type ResolvedSolarPanelLayoutOptions = {
  panelWidthM: number;
  panelHeightM: number;
  rowGapM: number;
  colGapM: number;
  roofMarginM: number;
  usableAreaRatio: number;
  maxPanels: number;
};

export const DEFAULT_SOLAR_PANEL_LAYOUT_OPTIONS: ResolvedSolarPanelLayoutOptions = {
  panelWidthM: 1.1,
  panelHeightM: 1.8,
  rowGapM: 0.8,
  colGapM: 0.45,
  roofMarginM: 5.0,
  usableAreaRatio: 0.58,
  maxPanels: 1000,
};

const PANEL_CAPACITY_KW = 0.5;
const SMALL_BUILDING_WARNING = '건물 면적이 작아 패널 배치가 어렵습니다.';
const PANEL_CAP_WARNING = '패널 개수가 비정상적으로 많아 상한을 적용했습니다.';

function resolveLayoutOptions(options: SolarPanelLayoutOptions): ResolvedSolarPanelLayoutOptions {
  return {
    ...DEFAULT_SOLAR_PANEL_LAYOUT_OPTIONS,
    ...options,
    colGapM: options.colGapM ?? options.columnGapM ?? DEFAULT_SOLAR_PANEL_LAYOUT_OPTIONS.colGapM,
  };
}

function closePolygon(polygon: PolygonCoordinates): PolygonCoordinates {
  if (polygon.length === 0) {
    return polygon;
  }

  const first = polygon[0];
  const last = polygon[polygon.length - 1];

  if (first[0] === last[0] && first[1] === last[1]) {
    return polygon;
  }

  return [...polygon, first];
}

function estimatePolygonAreaM2(polygon: PolygonCoordinates) {
  if (polygon.length < 4) {
    return 0;
  }

  try {
    return turfArea({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [closePolygon(polygon)],
      },
    });
  } catch {
    return 0;
  }
}

function createProjection(origin: Coordinate) {
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon = metersPerDegreeLat * Math.cos((origin[1] * Math.PI) / 180);

  return {
    toLocal: ([longitude, latitude]: Coordinate): LocalPoint => ({
      x: (longitude - origin[0]) * metersPerDegreeLon,
      y: (latitude - origin[1]) * metersPerDegreeLat,
    }),
    toCoordinate: ({ x, y }: LocalPoint): Coordinate => [
      origin[0] + x / metersPerDegreeLon,
      origin[1] + y / metersPerDegreeLat,
    ],
  };
}

function isPointInsidePolygon(point: LocalPoint, polygon: LocalPoint[]) {
  let isInside = false;

  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index, index += 1) {
    const current = polygon[index];
    const previous = polygon[previousIndex];
    const intersects =
      current.y > point.y !== previous.y > point.y &&
      point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y || 1e-9) + current.x;

    if (intersects) {
      isInside = !isInside;
    }
  }

  return isInside;
}

function createPanelRectangle(center: LocalPoint, width: number, height: number): LocalPoint[] {
  const halfWidth = width / 2;
  const halfHeight = height / 2;

  return [
    { x: center.x - halfWidth, y: center.y - halfHeight },
    { x: center.x + halfWidth, y: center.y - halfHeight },
    { x: center.x + halfWidth, y: center.y + halfHeight },
    { x: center.x - halfWidth, y: center.y + halfHeight },
    { x: center.x - halfWidth, y: center.y - halfHeight },
  ];
}

function getRectangleCentroid(rectangle: LocalPoint[]) {
  const vertices = rectangle.slice(0, 4);
  const summed = vertices.reduce(
    (accumulator, point) => ({
      x: accumulator.x + point.x,
      y: accumulator.y + point.y,
    }),
    { x: 0, y: 0 },
  );

  return {
    x: summed.x / vertices.length,
    y: summed.y / vertices.length,
  };
}

function canPlacePanel(rectangle: LocalPoint[], roofPolygon: LocalPoint[]) {
  const rectangleCorners = rectangle.slice(0, 4);

  return (
    isPointInsidePolygon(getRectangleCentroid(rectangle), roofPolygon) &&
    rectangleCorners.every((corner) => isPointInsidePolygon(corner, roofPolygon))
  );
}

export function createPanelRectanglesInsideRoof(
  roofPolygon: PolygonCoordinates,
  options: SolarPanelLayoutOptions = {},
): PolygonCoordinates[] {
  const mergedOptions = resolveLayoutOptions(options);
  const centroid = getPolygonCentroid(roofPolygon);
  const projection = createProjection(centroid);
  const localRoofPolygon = roofPolygon.map(projection.toLocal);
  const xs = localRoofPolygon.map((point) => point.x);
  const ys = localRoofPolygon.map((point) => point.y);
  const minX = Math.min(...xs) + mergedOptions.roofMarginM;
  const maxX = Math.max(...xs) - mergedOptions.roofMarginM;
  const minY = Math.min(...ys) + mergedOptions.roofMarginM;
  const maxY = Math.max(...ys) - mergedOptions.roofMarginM;
  const stepX = mergedOptions.panelWidthM + mergedOptions.colGapM;
  const stepY = mergedOptions.panelHeightM + mergedOptions.rowGapM;
  const panelRectangles: PolygonCoordinates[] = [];

  if (maxX - minX < mergedOptions.panelWidthM || maxY - minY < mergedOptions.panelHeightM) {
    return panelRectangles;
  }

  // MVP layout: align panels to the local bounding box and keep panel centroids inside the footprint-based roof estimate.
  // Exact clipping/rotation should later use real roof edge orientation and obstacle polygons.
  for (let y = minY + mergedOptions.panelHeightM / 2; y <= maxY - mergedOptions.panelHeightM / 2; y += stepY) {
    for (let x = minX + mergedOptions.panelWidthM / 2; x <= maxX - mergedOptions.panelWidthM / 2; x += stepX) {
      if (panelRectangles.length >= mergedOptions.maxPanels) {
        return panelRectangles;
      }

      const rectangle = createPanelRectangle({ x, y }, mergedOptions.panelWidthM, mergedOptions.panelHeightM);

      if (!canPlacePanel(rectangle, localRoofPolygon)) {
        continue;
      }

      panelRectangles.push(rectangle.map(projection.toCoordinate));
    }
  }

  return panelRectangles;
}

export function generateSolarPanelLayout(
  roofPolygon: PolygonCoordinates,
  options: SolarPanelLayoutOptions = {},
): SolarPanelLayoutResult {
  const mergedOptions = resolveLayoutOptions(options);
  const roofAreaM2 = estimatePolygonAreaM2(roofPolygon);
  const usableAreaM2 = roofAreaM2 * mergedOptions.usableAreaRatio;
  const panelAreaM2 = mergedOptions.panelWidthM * mergedOptions.panelHeightM;
  const usableAreaPanelLimit = Math.floor(usableAreaM2 / panelAreaM2);
  const warnings: string[] = [];

  if (roofAreaM2 <= 0 || usableAreaPanelLimit < 1) {
    return {
      panelPolygons: [],
      roofAreaM2,
      usableAreaM2,
      panelCount: 0,
      estimatedCapacityKw: 0,
      warnings: [SMALL_BUILDING_WARNING],
      reason: SMALL_BUILDING_WARNING,
    };
  }

  if (usableAreaPanelLimit > mergedOptions.maxPanels) {
    warnings.push(PANEL_CAP_WARNING);
  }

  const panelPolygons = createPanelRectanglesInsideRoof(roofPolygon, {
    ...mergedOptions,
    maxPanels: Math.min(usableAreaPanelLimit, mergedOptions.maxPanels),
  });

  if (panelPolygons.length === 0) {
    warnings.push(SMALL_BUILDING_WARNING);
  }

  if (panelPolygons.length >= mergedOptions.maxPanels && usableAreaPanelLimit > mergedOptions.maxPanels) {
    warnings.push(PANEL_CAP_WARNING);
  }

  const uniqueWarnings = [...new Set(warnings)];

  return {
    panelPolygons,
    roofAreaM2,
    usableAreaM2,
    panelCount: panelPolygons.length,
    estimatedCapacityKw: Number((panelPolygons.length * PANEL_CAPACITY_KW).toFixed(1)),
    warnings: uniqueWarnings,
    reason: panelPolygons.length === 0 ? SMALL_BUILDING_WARNING : undefined,
  };
}

export function generateSolarPanelGrid(
  roofPolygon: PolygonCoordinates,
  options: SolarPanelLayoutOptions = {},
): PolygonCoordinates[] {
  return generateSolarPanelLayout(roofPolygon, options).panelPolygons;
}
