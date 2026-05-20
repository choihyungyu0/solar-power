import { getPolygonCentroid, type Coordinate, type PolygonCoordinates } from './roofGeometry';

type LocalPoint = {
  x: number;
  y: number;
};

export type SolarPanelLayoutOptions = {
  panelWidthM?: number;
  panelHeightM?: number;
  rowGapM?: number;
  columnGapM?: number;
  maxPanels?: number;
};

const DEFAULT_PANEL_OPTIONS = {
  panelWidthM: 1.1,
  panelHeightM: 1.8,
  rowGapM: 0.4,
  columnGapM: 0.2,
  maxPanels: 180,
};

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

export function createPanelRectanglesInsideRoof(
  roofPolygon: PolygonCoordinates,
  options: SolarPanelLayoutOptions = {},
): PolygonCoordinates[] {
  const mergedOptions = { ...DEFAULT_PANEL_OPTIONS, ...options };
  const centroid = getPolygonCentroid(roofPolygon);
  const projection = createProjection(centroid);
  const localRoofPolygon = roofPolygon.map(projection.toLocal);
  const xs = localRoofPolygon.map((point) => point.x);
  const ys = localRoofPolygon.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const stepX = mergedOptions.panelWidthM + mergedOptions.columnGapM;
  const stepY = mergedOptions.panelHeightM + mergedOptions.rowGapM;
  const panelRectangles: PolygonCoordinates[] = [];

  // MVP layout: align panels to the polygon bounding box and keep panels whose center is inside the roof.
  // Exact clipping/rotation should later use real roof edge orientation and obstacle polygons.
  for (
    let y = minY + mergedOptions.panelHeightM / 2;
    y <= maxY - mergedOptions.panelHeightM / 2;
    y += stepY
  ) {
    for (
      let x = minX + mergedOptions.panelWidthM / 2;
      x <= maxX - mergedOptions.panelWidthM / 2;
      x += stepX
    ) {
      if (panelRectangles.length >= mergedOptions.maxPanels) {
        return panelRectangles;
      }

      const center = { x, y };

      if (!isPointInsidePolygon(center, localRoofPolygon)) {
        continue;
      }

      panelRectangles.push(createPanelRectangle(center, mergedOptions.panelWidthM, mergedOptions.panelHeightM).map(projection.toCoordinate));
    }
  }

  return panelRectangles;
}

export function generateSolarPanelGrid(
  roofPolygon: PolygonCoordinates,
  options: SolarPanelLayoutOptions = {},
): PolygonCoordinates[] {
  return createPanelRectanglesInsideRoof(roofPolygon, options);
}
