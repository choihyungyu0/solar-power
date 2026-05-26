import { useEffect, useRef } from 'react';
import { getPolygonCentroid, type Coordinate, type PolygonCoordinates } from '../lib/roofGeometry';
import { getViewerDebugId } from '../lib/vworldCesiumViewer';

export type VWorldSolarPanelSource = 'self' | 'climate-live' | 'static-poc';

export type VWorldSolarPanelLayerStatus = {
  state: 'idle' | 'rendered' | 'fallback' | 'error';
  message: string;
  panelPolygonCount: number;
  panelEntityCount: number;
  firstPanelCoordinates: PolygonCoordinates | null;
  entityCountBefore: number | null;
  entityCountAfter: number | null;
  terrainHeightM: number | null;
  roofHeightM: number;
  finalPanelHeightM: number | null;
  renderMethod: string;
  renderMode: string;
  depthTestAgainstTerrain: boolean | null;
  viewerCanvasSize: { width: number; height: number } | null;
  viewerEntityCount: number | null;
  viewerDebugId: string | null;
  debugEntityAdded: boolean;
  debugLiftApplied: boolean;
  heightMessage?: string;
  selectedBuildingId?: string | null;
  selectedAnalysisSessionId?: string | null;
  panelSource?: VWorldSolarPanelSource;
};

export type VWorldSolarPanelBuildingFeature = {
  id?: string | number;
  properties?: Record<string, unknown> | null;
};

type VWorldSolarPanelLayerProps = {
  map: VWorldMapInstance | null;
  selectedBuildingFeature: VWorldSolarPanelBuildingFeature | null;
  selectedBuildingId: string | null;
  selectedAnalysisSessionId: string | null;
  panelSource: VWorldSolarPanelSource;
  selectedBuildingCentroid?: Coordinate | null;
  panelPolygons: PolygonCoordinates[];
  roofHeightM?: number;
  visible: boolean;
  onStatusChange: (status: VWorldSolarPanelLayerStatus) => void;
};

type AddedMapObject = {
  id: string;
  object: unknown;
  renderMethod: 'Cesium entities' | 'VWorld Feature layer';
};

type CesiumEntityLike = {
  id?: unknown;
};

type CesiumEntityCollectionLike = {
  add?: (entity: unknown) => unknown;
  remove?: (entity: unknown) => boolean;
  removeById?: (id: string) => boolean;
  values?: CesiumEntityLike[];
};

type CanvasLike = {
  clientWidth?: number;
  clientHeight?: number;
  width?: number;
  height?: number;
  isConnected?: boolean;
  getBoundingClientRect?: () => DOMRect;
};

type CesiumViewerLike = {
  canvas?: CanvasLike;
  entities?: CesiumEntityCollectionLike;
  scene?: {
    canvas?: CanvasLike;
    globe?: {
      depthTestAgainstTerrain?: boolean;
      getHeight?: (cartographic: unknown) => number | undefined;
    };
    requestRender?: () => void;
  };
};

const DEFAULT_ROOF_HEIGHT_M = 20;
const PANEL_ROOF_CLEARANCE_M = 2;
const DEBUG_PANEL_HEIGHT_OFFSET_M = 80;
const DEBUG_ENTITY_HEIGHT_OFFSET_M = 20;
const DEBUG_PANEL_LIFT_M = 20;
const PANEL_DEBUG_NOTE = '지형 높이 미확인 시 디버그 높이로 패널을 표시합니다.';
const SHOW_PANEL_DEBUG_ENTITY = import.meta.env.VITE_SHOW_PANEL_DEBUG_ENTITY === 'true';
const LIFT_SOLAR_PANELS_FOR_DEBUG = import.meta.env.VITE_LIFT_SOLAR_PANELS_DEBUG === 'true';
const CONSTRUCTOR_ERROR_MESSAGE =
  '태양광 패널을 지도 좌표 객체로 표시하려면 VWorld 또는 Cesium polygon 객체 연결이 필요합니다.';
const DEFAULT_HEIGHT_MESSAGE = '건물 높이 정보가 없어 기본 높이로 패널을 표시합니다.';
const PANEL_ENTITY_PREFIXES = [
  'solarmate-self-panel-',
  'solarmate-panel-',
  'solarmate-panel-debug-',
];

function getPanelEntityPrefix(panelSource: VWorldSolarPanelSource) {
  if (panelSource === 'climate-live') {
    return 'solarmate-backend-panel';
  }

  if (panelSource === 'static-poc') {
    return 'solarmate-poc-panel';
  }

  return 'solarmate-self-panel';
}

function sanitizeEntityIdPart(value: string | null | undefined, fallback: string) {
  const raw = value?.trim() || fallback;

  return raw.replace(/[^A-Za-z0-9_-]/g, '_');
}

function createPanelEntityId({
  panelSource,
  selectedBuildingId,
  selectedAnalysisSessionId,
  index,
}: {
  panelSource: VWorldSolarPanelSource;
  selectedBuildingId: string;
  selectedAnalysisSessionId: string | null;
  index: number | 'debug';
}) {
  const prefix = getPanelEntityPrefix(panelSource);
  const safeBuildingId = sanitizeEntityIdPart(selectedBuildingId, 'selected');
  const safeSessionId = sanitizeEntityIdPart(selectedAnalysisSessionId, 'self');

  if (panelSource === 'climate-live') {
    return `${prefix}-${safeBuildingId}-${safeSessionId}-${index}`;
  }

  return `${prefix}-${safeBuildingId}-${index}`;
}

function createEmptyStatus(
  state: VWorldSolarPanelLayerStatus['state'],
  message: string,
  panelPolygons: PolygonCoordinates[],
  roofHeightM: number,
  renderMethod = '-',
  heightMessage?: string,
  diagnostics: Partial<
    Pick<
      VWorldSolarPanelLayerStatus,
      | 'entityCountBefore'
      | 'entityCountAfter'
      | 'panelEntityCount'
      | 'terrainHeightM'
      | 'finalPanelHeightM'
      | 'renderMode'
      | 'depthTestAgainstTerrain'
      | 'viewerCanvasSize'
      | 'viewerEntityCount'
      | 'viewerDebugId'
      | 'debugEntityAdded'
      | 'debugLiftApplied'
    >
  > = {},
  identity: Pick<
    VWorldSolarPanelLayerStatus,
    'selectedBuildingId' | 'selectedAnalysisSessionId' | 'panelSource'
  > = {},
): VWorldSolarPanelLayerStatus {
  return {
    state,
    message,
    panelPolygonCount: panelPolygons.length,
    panelEntityCount: 0,
    firstPanelCoordinates: panelPolygons[0] ?? null,
    entityCountBefore: null,
    entityCountAfter: null,
    terrainHeightM: null,
    roofHeightM,
    finalPanelHeightM: null,
    renderMethod,
    renderMode: renderMethod,
    depthTestAgainstTerrain: null,
    viewerCanvasSize: null,
    viewerEntityCount: null,
    viewerDebugId: null,
    debugEntityAdded: false,
    debugLiftApplied: false,
    heightMessage,
    ...identity,
    ...diagnostics,
  };
}

function readNumberProperty(properties: Record<string, unknown> | null | undefined, keys: string[]) {
  for (const key of keys) {
    const value = properties?.[key];

    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value.replace(/[^0-9.]/g, ''));

      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }

  return null;
}

export function deriveRoofHeightMFromFeature(feature: VWorldSolarPanelBuildingFeature | null) {
  const properties = feature?.properties ?? null;
  const explicitHeight = readNumberProperty(properties, [
    'height_m',
    'height',
    'Height',
    'HEIGHT',
    'bld_height',
    'building_height',
    'BULD_HG',
  ]);

  if (explicitHeight) {
    return {
      roofHeightM: explicitHeight,
      heightMessage: `건물 높이 속성 기준 ${explicitHeight.toLocaleString('ko-KR')}m로 패널을 표시합니다.`,
      usedDefault: false,
    };
  }

  const floors = readNumberProperty(properties, [
    'floors_above',
    'floor_count',
    'floors',
    'ground_floor_count',
    'grnd_flr',
    'GRND_FLR',
    'BULD_FLOOR',
  ]);

  if (floors) {
    const roofHeightM = floors * 3;

    return {
      roofHeightM,
      heightMessage: `층수 속성 기준 추정 높이 ${roofHeightM.toLocaleString('ko-KR')}m로 패널을 표시합니다.`,
      usedDefault: false,
    };
  }

  return {
    roofHeightM: DEFAULT_ROOF_HEIGHT_M,
    heightMessage: DEFAULT_HEIGHT_MESSAGE,
    usedDefault: true,
  };
}

function getResolvedRoofHeightM(
  selectedBuildingFeature: VWorldSolarPanelBuildingFeature | null,
  roofHeightM?: number,
) {
  const featureHeightEstimate = deriveRoofHeightMFromFeature(selectedBuildingFeature);

  if (typeof roofHeightM === 'number' && Number.isFinite(roofHeightM) && roofHeightM > 0) {
    return {
      roofHeightM,
      heightMessage:
        Math.abs(featureHeightEstimate.roofHeightM - roofHeightM) < 0.01
          ? featureHeightEstimate.heightMessage
          : undefined,
      usedDefault: featureHeightEstimate.usedDefault && Math.abs(featureHeightEstimate.roofHeightM - roofHeightM) < 0.01,
    };
  }

  return featureHeightEstimate;
}

function getSafeSelectedBuildingId(selectedBuildingId: string | null, selectedBuildingFeature: VWorldSolarPanelBuildingFeature | null) {
  const fallbackId = selectedBuildingFeature?.id;

  return selectedBuildingId || (typeof fallbackId === 'string' || typeof fallbackId === 'number' ? String(fallbackId) : 'selected');
}

function getPanelHeightCoordinate(panelPolygons: PolygonCoordinates[], selectedBuildingCentroid?: Coordinate | null) {
  if (selectedBuildingCentroid) {
    return selectedBuildingCentroid;
  }

  const firstPanelPolygon = panelPolygons[0];

  if (!firstPanelPolygon || firstPanelPolygon.length === 0) {
    return null;
  }

  return getPolygonCentroid(firstPanelPolygon);
}

function getCesiumSdk() {
  const cesium = window.Cesium;

  return cesium && typeof cesium === 'object' ? (cesium as Record<string, any>) : null;
}

function getTerrainHeightM(viewer: CesiumViewerLike | null, coordinate: Coordinate | null) {
  const cesium = getCesiumSdk();

  let getHeight: ((cartographic: unknown) => number | undefined) | undefined;

  try {
    getHeight = viewer?.scene?.globe?.getHeight;
  } catch {
    getHeight = undefined;
  }

  if (!getHeight || !coordinate || !cesium?.Cartographic?.fromDegrees) {
    return null;
  }

  try {
    const cartographic = cesium.Cartographic.fromDegrees(coordinate[0], coordinate[1]);
    const terrainHeightM = getHeight.call(viewer?.scene?.globe, cartographic);

    return typeof terrainHeightM === 'number' && Number.isFinite(terrainHeightM) ? terrainHeightM : null;
  } catch {
    return null;
  }
}

function getPanelHeightDiagnostics({
  viewer,
  coordinate,
  roofHeightM,
  heightMessage,
}: {
  viewer: CesiumViewerLike | null;
  coordinate: Coordinate | null;
  roofHeightM: number;
  heightMessage?: string;
}) {
  const terrainHeightM = getTerrainHeightM(viewer, coordinate);
  const finalPanelHeightM =
    typeof terrainHeightM === 'number'
      ? terrainHeightM + roofHeightM + PANEL_ROOF_CLEARANCE_M
      : roofHeightM + DEBUG_PANEL_HEIGHT_OFFSET_M;
  const debugLiftM = LIFT_SOLAR_PANELS_FOR_DEBUG ? DEBUG_PANEL_LIFT_M : 0;
  const resolvedHeightMessage =
    [
      typeof terrainHeightM === 'number' ? heightMessage : [heightMessage, PANEL_DEBUG_NOTE].filter(Boolean).join(' '),
      LIFT_SOLAR_PANELS_FOR_DEBUG ? `패널 디버그 리프트 +${DEBUG_PANEL_LIFT_M}m 적용 중입니다.` : undefined,
    ]
      .filter(Boolean)
      .join(' ');

  return {
    terrainHeightM,
    finalPanelHeightM: finalPanelHeightM + debugLiftM,
    heightMessage: resolvedHeightMessage || undefined,
    debugLiftApplied: LIFT_SOLAR_PANELS_FOR_DEBUG,
  };
}

function hasCesiumEntityCollection(value: unknown): value is CesiumViewerLike {
  if (!value || typeof value !== 'object') {
    return false;
  }

  try {
    const record = value as Record<string, unknown>;

    return Boolean((record.entities as CesiumViewerLike['entities'])?.add);
  } catch {
    return false;
  }
}

function pushUniqueViewerCandidate(candidates: CesiumViewerLike[], value: unknown) {
  if (!hasCesiumEntityCollection(value) || candidates.includes(value)) {
    return;
  }

  candidates.push(value);
}

function readObjectValue(record: Record<string, unknown>, key: string) {
  try {
    return record[key];
  } catch {
    return undefined;
  }
}

function getCesiumViewerCandidates(value: unknown): CesiumViewerLike[] {
  const candidates: CesiumViewerLike[] = [];

  if (!value || typeof value !== 'object') {
    return candidates;
  }

  const record = value as Record<string, unknown>;

  pushUniqueViewerCandidate(candidates, value);

  for (const key of ['viewer', '_viewer', 'cesiumViewer', '_cesiumViewer', 'sceneViewer', 'mapViewer']) {
    const candidate = readObjectValue(record, key);

    pushUniqueViewerCandidate(candidates, candidate);
  }

  for (const key of ['getViewer', 'getCesiumViewer', 'getCesium', 'getMap']) {
    const method = readObjectValue(record, key);

    if (typeof method !== 'function') {
      continue;
    }

    try {
      const candidate = method.call(value);

      pushUniqueViewerCandidate(candidates, candidate);
    } catch {
      // VWorld builds expose different internals; keep looking for a safe viewer candidate.
    }
  }

  return candidates;
}

function getViewerCanvas(viewer: CesiumViewerLike): CanvasLike | null {
  try {
    return viewer.scene?.canvas ?? viewer.canvas ?? null;
  } catch {
    return null;
  }
}

function getViewerCanvasSize(viewer: CesiumViewerLike): VWorldSolarPanelLayerStatus['viewerCanvasSize'] {
  const canvas = getViewerCanvas(viewer);

  if (!canvas) {
    return null;
  }

  const rect = canvas.getBoundingClientRect?.();
  const width = Math.round(rect?.width || canvas.clientWidth || canvas.width || 0);
  const height = Math.round(rect?.height || canvas.clientHeight || canvas.height || 0);

  return width > 0 && height > 0 ? { width, height } : null;
}

function isViewerCanvasVisible(viewer: CesiumViewerLike) {
  const canvas = getViewerCanvas(viewer);
  const size = getViewerCanvasSize(viewer);

  if (!canvas || !size) {
    return false;
  }

  if (canvas.isConnected === false) {
    return false;
  }

  if (canvas instanceof HTMLElement) {
    const style = window.getComputedStyle(canvas);

    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
  }

  return true;
}

function findCesiumViewer(map: VWorldMapInstance | null): CesiumViewerLike | null {
  const candidates = [map, window.ws3d, window.VW, window.vw].flatMap(getCesiumViewerCandidates);
  const uniqueCandidates = candidates.filter((candidate, index) => candidates.indexOf(candidate) === index);

  if (uniqueCandidates.length === 0) {
    return null;
  }

  return uniqueCandidates.sort((left, right) => {
    const rightVisible = isViewerCanvasVisible(right) ? 1 : 0;
    const leftVisible = isViewerCanvasVisible(left) ? 1 : 0;
    const rightSize = getViewerCanvasSize(right);
    const leftSize = getViewerCanvasSize(left);
    const rightArea = (rightSize?.width ?? 0) * (rightSize?.height ?? 0);
    const leftArea = (leftSize?.width ?? 0) * (leftSize?.height ?? 0);

    return rightVisible - leftVisible || rightArea - leftArea;
  })[0];
}

function getCesiumEntityValues(viewer: CesiumViewerLike): CesiumEntityLike[] {
  const entities = viewer.entities as (CesiumEntityCollectionLike & Record<string, unknown>) | undefined;

  if (Array.isArray(entities?.values)) {
    return entities.values;
  }

  const privateEntities = entities?._entities as Record<string, unknown> | undefined;
  const privateArray = privateEntities?._array;

  if (Array.isArray(privateArray)) {
    return privateArray as CesiumEntityLike[];
  }

  return [];
}

function getCesiumEntityCount(viewer: CesiumViewerLike) {
  const values = getCesiumEntityValues(viewer);

  return values.length;
}

function isSolarPanelEntityId(id: unknown) {
  return typeof id === 'string' && PANEL_ENTITY_PREFIXES.some((prefix) => id.startsWith(prefix));
}

function removeSolarPanelEntities(viewer: CesiumViewerLike) {
  const entities = viewer.entities;
  const values = getCesiumEntityValues(viewer);

  values.forEach((entity) => {
    const id = entity.id;

    if (!isSolarPanelEntityId(id)) {
      return;
    }

    if (typeof id === 'string') {
      try {
        entities?.removeById?.(id);
        return;
      } catch {
        // Fall back to object removal below.
      }
    }

    try {
      entities?.remove?.(entity);
    } catch {
      // Cleanup is best-effort across Cesium/VWorld builds.
    }
  });
}

function createLonLatHeightArray(polygon: PolygonCoordinates, heightM: number) {
  return polygon.flatMap(([longitude, latitude]) => [longitude, latitude, heightM]);
}

function createDebugPolygonAtCentroid(centroid: Coordinate, sizeM = 24): PolygonCoordinates {
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon = metersPerDegreeLat * Math.cos((centroid[1] * Math.PI) / 180);
  const halfHeightDegrees = sizeM / 2 / metersPerDegreeLat;
  const halfWidthDegrees = sizeM / 2 / metersPerDegreeLon;

  return [
    [centroid[0] - halfWidthDegrees, centroid[1] - halfHeightDegrees],
    [centroid[0] + halfWidthDegrees, centroid[1] - halfHeightDegrees],
    [centroid[0] + halfWidthDegrees, centroid[1] + halfHeightDegrees],
    [centroid[0] - halfWidthDegrees, centroid[1] + halfHeightDegrees],
    [centroid[0] - halfWidthDegrees, centroid[1] - halfHeightDegrees],
  ];
}

function addPanelEntitiesWithCesium({
  viewer,
  selectedBuildingId,
  selectedAnalysisSessionId,
  panelSource,
  selectedBuildingCentroid,
  panelPolygons,
  finalPanelHeightM,
}: {
  viewer: CesiumViewerLike;
  selectedBuildingId: string;
  selectedAnalysisSessionId: string | null;
  panelSource: VWorldSolarPanelSource;
  selectedBuildingCentroid: Coordinate | null;
  panelPolygons: PolygonCoordinates[];
  finalPanelHeightM: number;
}) {
  const cesium = getCesiumSdk();
  const entities = viewer.entities;

  if (!cesium?.Cartesian3?.fromDegreesArrayHeights || !entities?.add) {
    return null;
  }

  const entityCountBefore = getCesiumEntityCount(viewer);
  const previousDepthTestAgainstTerrain =
    typeof viewer.scene?.globe?.depthTestAgainstTerrain === 'boolean'
      ? viewer.scene.globe.depthTestAgainstTerrain
      : null;

  if (viewer.scene?.globe) {
    viewer.scene.globe.depthTestAgainstTerrain = false;
  }

  removeSolarPanelEntities(viewer);

  const addEntity = entities.add.bind(entities);
  const addedObjects: AddedMapObject[] = [];
  const fillMaterial =
    cesium.Color?.fromCssColorString?.('#06145f')?.withAlpha?.(0.94) ??
    cesium.Color?.BLUE?.withAlpha?.(0.94) ??
    cesium.Color?.fromCssColorString?.('#06145f');
  const outlineMaterial =
    cesium.Color?.fromCssColorString?.('#22d3ee')?.withAlpha?.(1) ??
    cesium.Color?.CYAN ??
    cesium.Color?.fromCssColorString?.('#22d3ee');
  const heightReferenceNone = cesium.HeightReference?.NONE;

  let panelEntityCount = 0;

  panelPolygons.forEach((panelPolygon, index) => {
    const id = createPanelEntityId({
      panelSource,
      selectedBuildingId,
      selectedAnalysisSessionId,
      index,
    });
    const outlineId = `${id}-outline`;
    const flatDegreesWithHeight = createLonLatHeightArray(panelPolygon, finalPanelHeightM);
    const polygonPositions = cesium.Cartesian3.fromDegreesArrayHeights(flatDegreesWithHeight);
    const hierarchy = cesium.PolygonHierarchy ? new cesium.PolygonHierarchy(polygonPositions) : polygonPositions;

    entities.removeById?.(id);
    entities.removeById?.(outlineId);

    const panelEntity = addEntity({
      id,
      polygon: {
        hierarchy,
        perPositionHeight: true,
        material: fillMaterial,
        outline: true,
        outlineColor: outlineMaterial,
        ...(heightReferenceNone !== undefined ? { heightReference: heightReferenceNone } : {}),
      },
    });
    const outlineEntity = addEntity({
      id: outlineId,
      polyline: {
        positions: polygonPositions,
        width: 2.2,
        material:
          cesium.Color?.fromCssColorString?.('#f8fdff')?.withAlpha?.(1) ??
          cesium.Color?.WHITE ??
          outlineMaterial,
        clampToGround: false,
        depthFailMaterial: outlineMaterial,
      },
    });

    if (panelEntity) {
      panelEntityCount += 1;
      addedObjects.push({ id, object: panelEntity, renderMethod: 'Cesium entities' });
    }

    if (outlineEntity) {
      addedObjects.push({ id: outlineId, object: outlineEntity, renderMethod: 'Cesium entities' });
    }
  });

  let debugEntityAdded = false;

  if (SHOW_PANEL_DEBUG_ENTITY && selectedBuildingCentroid) {
    const debugId = createPanelEntityId({
      panelSource,
      selectedBuildingId,
      selectedAnalysisSessionId,
      index: 'debug',
    });
    const debugPolygon = createDebugPolygonAtCentroid(selectedBuildingCentroid);
    const debugPositions = cesium.Cartesian3.fromDegreesArrayHeights(
      createLonLatHeightArray(debugPolygon, finalPanelHeightM + DEBUG_ENTITY_HEIGHT_OFFSET_M),
    );
    const debugHierarchy = cesium.PolygonHierarchy ? new cesium.PolygonHierarchy(debugPositions) : debugPositions;

    entities.removeById?.(debugId);

    const debugEntity = addEntity({
      id: debugId,
      polygon: {
        hierarchy: debugHierarchy,
        perPositionHeight: true,
        material: fillMaterial,
        outline: true,
        outlineColor: outlineMaterial,
        ...(heightReferenceNone !== undefined ? { heightReference: heightReferenceNone } : {}),
      },
    });

    if (debugEntity) {
      debugEntityAdded = true;
      addedObjects.push({ id: debugId, object: debugEntity, renderMethod: 'Cesium entities' });
    }
  }

  viewer.scene?.requestRender?.();

  const entityCountAfter = getCesiumEntityCount(viewer);
  const depthTestAgainstTerrain =
    typeof viewer.scene?.globe?.depthTestAgainstTerrain === 'boolean'
      ? viewer.scene.globe.depthTestAgainstTerrain
      : null;
  const viewerCanvasSize = getViewerCanvasSize(viewer);

  return {
    addedCount: panelEntityCount,
    debugEntityAdded,
    depthTestAgainstTerrain,
    entityCountBefore,
    entityCountAfter,
    renderMethod: 'Cesium entities',
    renderMode: 'Cesium entities / fromDegreesArrayHeights / perPositionHeight',
    viewerCanvasSize,
    viewerEntityCount: entityCountAfter,
    viewerDebugId: getViewerDebugId(viewer),
    cleanup: () => {
      addedObjects.forEach((addedObject) => {
        try {
          entities.remove?.(addedObject.object);
        } catch {
          // Keep cleanup best-effort across Cesium/VWorld builds.
        }

        try {
          viewer.entities?.removeById?.(addedObject.id);
        } catch {
          // Keep cleanup best-effort.
        }
      });

      if (viewer.scene?.globe && previousDepthTestAgainstTerrain !== null) {
        viewer.scene.globe.depthTestAgainstTerrain = previousDepthTestAgainstTerrain;
      }

      viewer.scene?.requestRender?.();
    },
  };
}

function createVWorldPolygonGeometry(polygon: PolygonCoordinates, heightM: number) {
  const vw = window.vw;

  if (!vw?.geom?.Polygon || !vw.Coord) {
    throw new Error(CONSTRUCTOR_ERROR_MESSAGE);
  }

  const coordinateObjects =
    vw.CoordZ && Number.isFinite(heightM)
      ? polygon.map(([longitude, latitude]) => new vw.CoordZ(longitude, latitude, heightM))
      : polygon.map(([longitude, latitude]) => new vw.Coord(longitude, latitude));

  try {
    return new vw.geom.Polygon(coordinateObjects);
  } catch {
    return new vw.geom.Polygon(polygon);
  }
}

function createVWorldPanelStyle() {
  const vw = window.vw;

  if (!vw?.style?.Style || !vw.style.Fill || !vw.style.Stroke) {
    return undefined;
  }

  const style = new vw.style.Style();
  const fill = new vw.style.Fill('rgba(6, 20, 95, 0.94)');
  const stroke = new vw.style.Stroke('#f8fdff');

  stroke.setWidth?.(2.2);
  fill.setStroke?.(stroke);
  style.fill = fill;
  style.stroke = stroke;

  return style;
}

function createVWorldPanelFeature(id: string, polygon: PolygonCoordinates, style: unknown, heightM: number) {
  const vw = window.vw;

  if (!vw?.Feature) {
    throw new Error(CONSTRUCTOR_ERROR_MESSAGE);
  }

  const feature = new vw.Feature();
  feature.setId?.(id);
  feature.setGeometry?.(createVWorldPolygonGeometry(polygon, heightM));
  feature.setStyle?.(style);

  return feature;
}

function addFeatureToMap(map: VWorldMapInstance, id: string, feature: unknown, style: unknown): AddedMapObject | null {
  const vw = window.vw;
  const featureLayer = vw?.layer?.Feature ? new vw.layer.Feature() : null;

  if (featureLayer?.setFeature) {
    featureLayer.setName?.(id);
    featureLayer.setFeature(feature);
    featureLayer.setStyle?.(style);

    try {
      map.addElement?.(featureLayer);

      return { id, object: featureLayer, renderMethod: 'VWorld Feature layer' };
    } catch {
      // Some VWorld 3D builds reject layer.Feature in addElement. Try the raw feature below.
    }
  }

  try {
    map.addElement?.(feature);

    return { id, object: feature, renderMethod: 'VWorld Feature layer' };
  } catch {
    return null;
  }
}

function removeVWorldObject(map: VWorldMapInstance, addedObject: AddedMapObject) {
  try {
    map.removeObject?.(addedObject.object);
  } catch {
    // VWorld object removal APIs differ by SDK build.
  }

  try {
    map.removeObjectById?.(addedObject.id);
  } catch {
    // Keep cleanup best-effort.
  }

  try {
    map.removeLayerElement?.(addedObject.id);
  } catch {
    // Keep cleanup best-effort.
  }
}

function addPanelFeaturesWithVWorld({
  map,
  selectedBuildingId,
  selectedAnalysisSessionId,
  panelSource,
  panelPolygons,
  heightM,
}: {
  map: VWorldMapInstance;
  selectedBuildingId: string;
  selectedAnalysisSessionId: string | null;
  panelSource: VWorldSolarPanelSource;
  panelPolygons: PolygonCoordinates[];
  heightM: number;
}) {
  const style = createVWorldPanelStyle();
  const addedObjects = panelPolygons.flatMap((panelPolygon, index) => {
    const id = createPanelEntityId({
      panelSource,
      selectedBuildingId,
      selectedAnalysisSessionId,
      index,
    });

    try {
      map.removeObjectById?.(id);
      map.removeObjectById?.(`${id}-layer`);
      map.removeLayerElement?.(`${id}-layer`);
    } catch {
      // Keep duplicate prevention best-effort across SDK builds.
    }

    const feature = createVWorldPanelFeature(id, panelPolygon, style, heightM);
    const addedObject = addFeatureToMap(map, `${id}-layer`, feature, style);

    return addedObject ? [addedObject] : [];
  });

  return {
    addedCount: addedObjects.length,
    debugEntityAdded: false,
    depthTestAgainstTerrain: null,
    entityCountBefore: null,
    entityCountAfter: null,
    renderMethod: 'VWorld Feature layer',
    renderMode: 'VWorld Feature layer / CoordZ absolute height',
    viewerCanvasSize: null,
    viewerEntityCount: null,
    viewerDebugId: null,
    cleanup: () => {
      addedObjects.forEach((addedObject) => removeVWorldObject(map, addedObject));
      panelPolygons.forEach((_, index) => {
        const id = createPanelEntityId({
          panelSource,
          selectedBuildingId,
          selectedAnalysisSessionId,
          index,
        });

        try {
          map.removeObjectById?.(id);
          map.removeObjectById?.(`${id}-layer`);
          map.removeLayerElement?.(`${id}-layer`);
        } catch {
          // Cleanup should not break React rendering.
        }
      });
    },
  };
}

function VWorldSolarPanelLayer({
  map,
  selectedBuildingFeature,
  selectedBuildingId,
  selectedAnalysisSessionId,
  panelSource,
  selectedBuildingCentroid,
  panelPolygons,
  roofHeightM,
  visible,
  onStatusChange,
}: VWorldSolarPanelLayerProps) {
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    const cleanupViewer = map ? findCesiumViewer(map) : null;

    if (cleanupViewer) {
      removeSolarPanelEntities(cleanupViewer);
    }

    const heightEstimate = getResolvedRoofHeightM(selectedBuildingFeature, roofHeightM);
    const stableBuildingId = getSafeSelectedBuildingId(selectedBuildingId, selectedBuildingFeature);
    const layerIdentity = {
      selectedBuildingId: stableBuildingId,
      selectedAnalysisSessionId,
      panelSource,
    };
    const heightCoordinate = getPanelHeightCoordinate(panelPolygons, selectedBuildingCentroid);
    const fallbackHeightDiagnostics = getPanelHeightDiagnostics({
      viewer: null,
      coordinate: heightCoordinate,
      roofHeightM: heightEstimate.roofHeightM,
      heightMessage: heightEstimate.heightMessage,
    });

    if (!visible) {
      onStatusChange(
        createEmptyStatus(
          'idle',
          '태양광 패널 지도 레이어가 꺼져 있습니다.',
          panelPolygons,
          heightEstimate.roofHeightM,
          '-',
          fallbackHeightDiagnostics.heightMessage,
          {
            terrainHeightM: fallbackHeightDiagnostics.terrainHeightM,
            finalPanelHeightM: fallbackHeightDiagnostics.finalPanelHeightM,
            debugLiftApplied: fallbackHeightDiagnostics.debugLiftApplied,
          },
          layerIdentity,
        ),
      );
      return undefined;
    }

    if (panelPolygons.length === 0) {
      onStatusChange(
        createEmptyStatus(
          'fallback',
          '선택 건물에서 배치 가능한 패널을 계산하지 못했습니다.',
          panelPolygons,
          heightEstimate.roofHeightM,
          '-',
          fallbackHeightDiagnostics.heightMessage,
          {
            terrainHeightM: fallbackHeightDiagnostics.terrainHeightM,
            finalPanelHeightM: fallbackHeightDiagnostics.finalPanelHeightM,
            debugLiftApplied: fallbackHeightDiagnostics.debugLiftApplied,
          },
          layerIdentity,
        ),
      );
      return undefined;
    }

    if (!map) {
      onStatusChange(
        createEmptyStatus(
          'fallback',
          '지도가 준비되면 태양광 패널을 좌표 기반 지도 객체로 표시합니다.',
          panelPolygons,
          heightEstimate.roofHeightM,
          '-',
          fallbackHeightDiagnostics.heightMessage,
          {
            terrainHeightM: fallbackHeightDiagnostics.terrainHeightM,
            finalPanelHeightM: fallbackHeightDiagnostics.finalPanelHeightM,
            debugLiftApplied: fallbackHeightDiagnostics.debugLiftApplied,
          },
          layerIdentity,
        ),
      );
      return undefined;
    }

    try {
      const cesiumViewer = findCesiumViewer(map);
      const heightDiagnostics = getPanelHeightDiagnostics({
        viewer: cesiumViewer,
        coordinate: heightCoordinate,
        roofHeightM: heightEstimate.roofHeightM,
        heightMessage: heightEstimate.heightMessage,
      });
      const cesiumResult = cesiumViewer
        ? addPanelEntitiesWithCesium({
            viewer: cesiumViewer,
            selectedBuildingId: stableBuildingId,
            selectedAnalysisSessionId,
            panelSource,
            selectedBuildingCentroid: selectedBuildingCentroid ?? heightCoordinate,
            panelPolygons,
            finalPanelHeightM: heightDiagnostics.finalPanelHeightM,
          })
        : null;
      if (cesiumResult && cesiumResult.addedCount === 0) {
        cesiumResult.cleanup();
      }
      const vworldResult =
        cesiumResult && cesiumResult.addedCount > 0
          ? null
          : addPanelFeaturesWithVWorld({
              map,
              selectedBuildingId: stableBuildingId,
              selectedAnalysisSessionId,
              panelSource,
              panelPolygons,
              heightM: heightDiagnostics.finalPanelHeightM,
            });
      const renderResult = cesiumResult && cesiumResult.addedCount > 0 ? cesiumResult : vworldResult;
      const renderMethod = renderResult?.renderMethod ?? '-';
      const renderMode = renderResult?.renderMode ?? renderMethod;

      if (!renderResult || renderResult.addedCount === 0) {
        onStatusChange(
          createEmptyStatus(
            'fallback',
            CONSTRUCTOR_ERROR_MESSAGE,
            panelPolygons,
            heightEstimate.roofHeightM,
            '-',
            heightDiagnostics.heightMessage,
            {
              entityCountBefore: cesiumResult?.entityCountBefore ?? null,
              entityCountAfter: cesiumResult?.entityCountAfter ?? null,
              terrainHeightM: heightDiagnostics.terrainHeightM,
              finalPanelHeightM: heightDiagnostics.finalPanelHeightM,
              depthTestAgainstTerrain: cesiumResult?.depthTestAgainstTerrain ?? null,
              viewerCanvasSize: cesiumResult?.viewerCanvasSize ?? getViewerCanvasSize(cesiumViewer ?? {}),
              viewerEntityCount: cesiumResult?.viewerEntityCount ?? null,
              viewerDebugId: cesiumResult?.viewerDebugId ?? null,
              debugEntityAdded: cesiumResult?.debugEntityAdded ?? false,
              debugLiftApplied: heightDiagnostics.debugLiftApplied,
            },
            layerIdentity,
          ),
        );
        return undefined;
      }

      const cleanup = renderResult.cleanup;
      cleanupRef.current = cleanup;
      onStatusChange({
        state: 'rendered',
        message: `${renderMethod} 방식으로 패널 polygon ${renderResult.addedCount.toLocaleString('ko-KR')}개를 지도 좌표에 고정해 표시했습니다.${
          heightEstimate.usedDefault ? ` ${DEFAULT_HEIGHT_MESSAGE}` : ''
        }`,
        panelPolygonCount: panelPolygons.length,
        panelEntityCount: renderResult.addedCount,
        firstPanelCoordinates: panelPolygons[0] ?? null,
        entityCountBefore: renderResult.entityCountBefore,
        entityCountAfter: renderResult.entityCountAfter,
        terrainHeightM: heightDiagnostics.terrainHeightM,
        roofHeightM: heightEstimate.roofHeightM,
        finalPanelHeightM: heightDiagnostics.finalPanelHeightM,
        renderMethod,
        renderMode,
        depthTestAgainstTerrain: renderResult.depthTestAgainstTerrain,
        viewerCanvasSize: renderResult.viewerCanvasSize,
        viewerEntityCount: renderResult.viewerEntityCount,
        viewerDebugId: renderResult.viewerDebugId,
        debugEntityAdded: renderResult.debugEntityAdded,
        debugLiftApplied: heightDiagnostics.debugLiftApplied,
        heightMessage: heightDiagnostics.heightMessage,
        ...layerIdentity,
      });

      return () => {
        cleanup();
        if (cleanupRef.current === cleanup) {
          cleanupRef.current = null;
        }
      };
    } catch {
      onStatusChange(
        createEmptyStatus(
          'error',
          CONSTRUCTOR_ERROR_MESSAGE,
          panelPolygons,
          heightEstimate.roofHeightM,
          '-',
          fallbackHeightDiagnostics.heightMessage,
          {
            terrainHeightM: fallbackHeightDiagnostics.terrainHeightM,
            finalPanelHeightM: fallbackHeightDiagnostics.finalPanelHeightM,
            debugLiftApplied: fallbackHeightDiagnostics.debugLiftApplied,
          },
          layerIdentity,
        ),
      );
      return undefined;
    }
  }, [
    map,
    onStatusChange,
    panelPolygons,
    panelSource,
    roofHeightM,
    selectedAnalysisSessionId,
    selectedBuildingCentroid,
    selectedBuildingFeature,
    selectedBuildingId,
    visible,
  ]);

  return null;
}

export default VWorldSolarPanelLayer;
