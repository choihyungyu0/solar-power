import { useEffect, useMemo, useRef } from 'react';
import {
  closePolygon,
  createLonLatHeightArray,
  findVisibleCesiumViewer,
  getCesiumEntityCount,
  getCesiumSdk,
  getTerrainHeightM,
  getViewerDebugId,
  removeCesiumEntitiesByIdPrefix,
  type CesiumViewerLike,
} from '../lib/vworldCesiumViewer';
import { getPolygonCentroid, type Coordinate, type PolygonCoordinates } from '../lib/roofGeometry';
import type { ClimatePanelsGeoJson } from '../types/climateBundle';

type ClimatePanelTone = 'good' | 'medium' | 'high';

type ClimatePanelPolygon = {
  polygon: PolygonCoordinates;
  shadingScore: number;
  tone: ClimatePanelTone;
};

export type ClimatePanelLayerStatus = {
  state: 'idle' | 'loaded' | 'rendered' | 'fallback' | 'error';
  message: string;
  climatePanelFeatureCount: number;
  climatePanelEntityCount: number;
  firstPanelCoordinates: PolygonCoordinates | null;
  climatePanelRenderStatus: string;
  renderMethod: string;
  viewerDebugId: string | null;
  viewerEntityCount: number | null;
  selectedBuildingId?: string | null;
  selectedAnalysisSessionId?: string | null;
};

type ClimatePanelLayerSource = 'climate-live' | 'static-poc';

type ClimatePanelLayerProps = {
  map: VWorldMapInstance | null;
  panelsGeojson: ClimatePanelsGeoJson | null;
  pocId: string;
  panelSource: ClimatePanelLayerSource;
  selectedBuildingId?: string | null;
  selectedAnalysisSessionId?: string | null;
  roofHeightM?: number | null;
  visible: boolean;
  onStatusChange: (status: ClimatePanelLayerStatus) => void;
};

type AddedVWorldObject = {
  id: string;
  object: unknown;
};

const CLIMATE_PANEL_ENTITY_PREFIX = 'solarmate-climate-panel-';
const STATIC_POC_PANEL_ENTITY_PREFIX = 'solarmate-poc-panel-';
const CLIMATE_PANEL_ENTITY_PREFIXES = [CLIMATE_PANEL_ENTITY_PREFIX, STATIC_POC_PANEL_ENTITY_PREFIX];
const DEFAULT_ROOF_HEIGHT_M = 40;
const PANEL_CLEARANCE_M = 2;
const FALLBACK_PANEL_HEIGHT_M = 120;
const CONSTRUCTOR_ERROR_MESSAGE =
  'climate.gg POC 패널을 지도 좌표 객체로 표시하려면 VWorld 또는 Cesium polygon 객체 연결이 필요합니다.';

export const CLIMATE_PANEL_LEGEND_ITEMS = [
  { tone: 'good', label: '음영 양호', scoreText: '3.0 이상', color: '#16a34a' },
  { tone: 'medium', label: '보통', scoreText: '1.5 이상', color: '#facc15' },
  { tone: 'high', label: '음영 높음', scoreText: '1.5 미만', color: '#ef4444' },
] as const;

const PANEL_TONE_STYLE: Record<ClimatePanelTone, { fill: string; stroke: string }> = {
  good: { fill: '#16a34a', stroke: '#dcfce7' },
  medium: { fill: '#facc15', stroke: '#fef9c3' },
  high: { fill: '#ef4444', stroke: '#fee2e2' },
};

function createStatus(
  state: ClimatePanelLayerStatus['state'],
  message: string,
  panelPolygons: ClimatePanelPolygon[],
  diagnostics: Partial<
    Pick<
      ClimatePanelLayerStatus,
      'climatePanelEntityCount' | 'climatePanelRenderStatus' | 'renderMethod' | 'viewerDebugId' | 'viewerEntityCount'
    >
  > = {},
  identity: Pick<ClimatePanelLayerStatus, 'selectedBuildingId' | 'selectedAnalysisSessionId'> = {},
): ClimatePanelLayerStatus {
  return {
    state,
    message,
    climatePanelFeatureCount: panelPolygons.length,
    climatePanelEntityCount: 0,
    firstPanelCoordinates: panelPolygons[0]?.polygon ?? null,
    climatePanelRenderStatus: state,
    renderMethod: '-',
    viewerDebugId: null,
    viewerEntityCount: null,
    ...identity,
    ...diagnostics,
  };
}

function sanitizeEntityIdPart(value: string | null | undefined, fallback: string) {
  const raw = value?.trim() || fallback;

  return raw.replace(/[^A-Za-z0-9_-]/g, '_');
}

function getClimatePanelEntityPrefix(panelSource: ClimatePanelLayerSource) {
  return panelSource === 'climate-live' ? CLIMATE_PANEL_ENTITY_PREFIX : STATIC_POC_PANEL_ENTITY_PREFIX;
}

function createClimatePanelEntityId({
  panelSource,
  pocId,
  selectedBuildingId,
  selectedAnalysisSessionId,
  index,
}: {
  panelSource: ClimatePanelLayerSource;
  pocId: string;
  selectedBuildingId?: string | null;
  selectedAnalysisSessionId?: string | null;
  index: number;
}) {
  if (panelSource === 'climate-live') {
    return `${CLIMATE_PANEL_ENTITY_PREFIX}${sanitizeEntityIdPart(
      selectedBuildingId,
      'selected',
    )}-${sanitizeEntityIdPart(selectedAnalysisSessionId, 'session')}-${index}`;
  }

  return `${STATIC_POC_PANEL_ENTITY_PREFIX}${sanitizeEntityIdPart(pocId, 'sample')}-${index}`;
}

function isCoordinate(value: unknown): value is Coordinate {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

function getPanelTone(shadingScore: number): ClimatePanelTone {
  if (shadingScore >= 3) {
    return 'good';
  }

  if (shadingScore >= 1.5) {
    return 'medium';
  }

  return 'high';
}

function normalizeClimatePanels(panelsGeojson: ClimatePanelsGeoJson | null): ClimatePanelPolygon[] {
  return (
    panelsGeojson?.features.flatMap((feature) => {
      const ring = feature.geometry.coordinates[0];
      const polygon = Array.isArray(ring) ? ring.filter(isCoordinate).map(([lon, lat]) => [lon, lat] as Coordinate) : [];

      if (polygon.length < 4) {
        return [];
      }

      const shadingScore =
        typeof feature.properties.shading_score === 'number' && Number.isFinite(feature.properties.shading_score)
          ? feature.properties.shading_score
          : 0;

      return [
        {
          polygon: closePolygon(polygon),
          shadingScore,
          tone: getPanelTone(shadingScore),
        },
      ];
    }) ?? []
  );
}

function getPanelHeightM(viewer: CesiumViewerLike | null, panelPolygons: ClimatePanelPolygon[], roofHeightM?: number | null) {
  const resolvedRoofHeight =
    typeof roofHeightM === 'number' && Number.isFinite(roofHeightM) && roofHeightM > 0 ? roofHeightM : DEFAULT_ROOF_HEIGHT_M;
  const firstPolygon = panelPolygons[0]?.polygon ?? null;
  const centroid = firstPolygon ? getPolygonCentroid(firstPolygon) : null;
  const terrainHeightM = getTerrainHeightM(viewer, centroid);

  return typeof terrainHeightM === 'number'
    ? terrainHeightM + resolvedRoofHeight + PANEL_CLEARANCE_M
    : Math.max(FALLBACK_PANEL_HEIGHT_M, resolvedRoofHeight + PANEL_CLEARANCE_M);
}

function createCesiumColor(color: string, alpha: number) {
  const cesium = getCesiumSdk();
  const cssColor = cesium?.Color?.fromCssColorString?.(color);

  return cssColor?.withAlpha?.(alpha) ?? cssColor ?? cesium?.Color?.WHITE;
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace('#', '');
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function addClimatePanelsWithCesium({
  viewer,
  panelPolygons,
  heightM,
  pocId,
  panelSource,
  selectedBuildingId,
  selectedAnalysisSessionId,
}: {
  viewer: CesiumViewerLike;
  panelPolygons: ClimatePanelPolygon[];
  heightM: number;
  pocId: string;
  panelSource: ClimatePanelLayerSource;
  selectedBuildingId?: string | null;
  selectedAnalysisSessionId?: string | null;
}) {
  const cesium = getCesiumSdk();
  const entities = viewer.entities;

  if (!cesium?.Cartesian3?.fromDegreesArrayHeights || !entities?.add) {
    return null;
  }

  removeCesiumEntitiesByIdPrefix(viewer, CLIMATE_PANEL_ENTITY_PREFIXES);

  const addEntity = entities.add.bind(entities);
  const addedEntities: unknown[] = [];
  const heightReferenceNone = cesium.HeightReference?.NONE;

  panelPolygons.forEach((panel, index) => {
    const id = createClimatePanelEntityId({
      panelSource,
      pocId,
      selectedBuildingId,
      selectedAnalysisSessionId,
      index,
    });
    const outlineId = `${id}-outline`;
    const positions = cesium.Cartesian3.fromDegreesArrayHeights(createLonLatHeightArray(panel.polygon, heightM));
    const hierarchy = cesium.PolygonHierarchy ? new cesium.PolygonHierarchy(positions) : positions;
    const style = PANEL_TONE_STYLE[panel.tone];

    entities.removeById?.(id);
    entities.removeById?.(outlineId);

    const panelEntity = addEntity({
      id,
      properties: {
        shadingScore: panel.shadingScore,
      },
      polygon: {
        hierarchy,
        perPositionHeight: true,
        material: createCesiumColor(style.fill, 0.88),
        outline: true,
        outlineColor: createCesiumColor(style.stroke, 1),
        ...(heightReferenceNone !== undefined ? { heightReference: heightReferenceNone } : {}),
      },
    });
    const outlineEntity = addEntity({
      id: outlineId,
      polyline: {
        positions,
        width: 1.4,
        material: createCesiumColor(style.stroke, 1),
        clampToGround: false,
        depthFailMaterial: createCesiumColor(style.stroke, 1),
      },
    });

    if (panelEntity) {
      addedEntities.push(panelEntity);
    }

    if (outlineEntity) {
      addedEntities.push(outlineEntity);
    }
  });

  viewer.scene?.requestRender?.();

  return {
    addedCount: panelPolygons.length,
    renderMethod: 'Cesium entities',
    viewerDebugId: getViewerDebugId(viewer),
    viewerEntityCount: getCesiumEntityCount(viewer),
    cleanup: () => {
      addedEntities.forEach((entity) => {
        try {
          entities.remove?.(entity);
        } catch {
          // Cleanup is best-effort across VWorld/Cesium builds.
        }
      });
      removeCesiumEntitiesByIdPrefix(viewer, CLIMATE_PANEL_ENTITY_PREFIXES);
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

function createVWorldStyle(tone: ClimatePanelTone) {
  const vw = window.vw;

  if (!vw?.style?.Style || !vw.style.Fill || !vw.style.Stroke) {
    return undefined;
  }

  const style = new vw.style.Style();
  const panelStyle = PANEL_TONE_STYLE[tone];
  const fill = new vw.style.Fill(hexToRgba(panelStyle.fill, 0.85));
  const stroke = new vw.style.Stroke(panelStyle.stroke);

  stroke.setWidth?.(1.4);
  fill.setStroke?.(stroke);
  style.fill = fill;
  style.stroke = stroke;

  return style;
}

function createVWorldFeature(id: string, panel: ClimatePanelPolygon, heightM: number) {
  const vw = window.vw;

  if (!vw?.Feature) {
    throw new Error(CONSTRUCTOR_ERROR_MESSAGE);
  }

  const style = createVWorldStyle(panel.tone);
  const feature = new vw.Feature();

  feature.setId?.(id);
  feature.setGeometry?.(createVWorldPolygonGeometry(panel.polygon, heightM));
  feature.setStyle?.(style);

  return { feature, style };
}

function addFeatureToMap(map: VWorldMapInstance, id: string, feature: unknown, style: unknown): AddedVWorldObject | null {
  const vw = window.vw;
  const featureLayer = vw?.layer?.Feature ? new vw.layer.Feature() : null;

  if (featureLayer?.setFeature) {
    featureLayer.setName?.(id);
    featureLayer.setFeature(feature);
    featureLayer.setStyle?.(style);

    try {
      map.addElement?.(featureLayer);

      return { id, object: featureLayer };
    } catch {
      // Some VWorld builds reject layer.Feature in addElement, so try the raw feature below.
    }
  }

  try {
    map.addElement?.(feature);

    return { id, object: feature };
  } catch {
    return null;
  }
}

function removeVWorldObject(map: VWorldMapInstance, addedObject: AddedVWorldObject) {
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

function addClimatePanelsWithVWorld({
  map,
  panelPolygons,
  heightM,
  pocId,
  panelSource,
  selectedBuildingId,
  selectedAnalysisSessionId,
}: {
  map: VWorldMapInstance;
  panelPolygons: ClimatePanelPolygon[];
  heightM: number;
  pocId: string;
  panelSource: ClimatePanelLayerSource;
  selectedBuildingId?: string | null;
  selectedAnalysisSessionId?: string | null;
}) {
  const addedObjects = panelPolygons.flatMap((panel, index) => {
    const id = createClimatePanelEntityId({
      panelSource,
      pocId,
      selectedBuildingId,
      selectedAnalysisSessionId,
      index,
    });

    try {
      map.removeObjectById?.(id);
      map.removeObjectById?.(`${id}-layer`);
      map.removeLayerElement?.(`${id}-layer`);
    } catch {
      // Duplicate prevention is best-effort across SDK builds.
    }

    const { feature, style } = createVWorldFeature(id, panel, heightM);
    const addedObject = addFeatureToMap(map, `${id}-layer`, feature, style);

    return addedObject ? [addedObject] : [];
  });

  return {
    addedCount: addedObjects.length,
    renderMethod: 'VWorld Feature layer',
    viewerDebugId: null,
    viewerEntityCount: null,
    cleanup: () => {
      addedObjects.forEach((addedObject) => removeVWorldObject(map, addedObject));
      panelPolygons.forEach((_, index) => {
        const id = createClimatePanelEntityId({
          panelSource,
          pocId,
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

function ClimatePanelLayer({
  map,
  panelsGeojson,
  pocId,
  panelSource,
  selectedBuildingId,
  selectedAnalysisSessionId,
  roofHeightM,
  visible,
  onStatusChange,
}: ClimatePanelLayerProps) {
  const cleanupRef = useRef<(() => void) | null>(null);
  const panelPolygons = useMemo(() => normalizeClimatePanels(panelsGeojson), [panelsGeojson]);

  useEffect(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    const identity = { selectedBuildingId: selectedBuildingId ?? null, selectedAnalysisSessionId: selectedAnalysisSessionId ?? null };
    const cleanupViewer = map ? findVisibleCesiumViewer(map) : null;

    if (cleanupViewer) {
      removeCesiumEntitiesByIdPrefix(cleanupViewer, CLIMATE_PANEL_ENTITY_PREFIXES);
    }

    if (!visible) {
      onStatusChange(createStatus('idle', 'climate.gg POC 패널 레이어가 꺼져 있습니다.', panelPolygons, {}, identity));
      return undefined;
    }

    if (panelPolygons.length === 0) {
      onStatusChange(
        createStatus('fallback', 'climate.gg POC 패널 GeoJSON에서 표시 가능한 Polygon feature가 없습니다.', [], {}, identity),
      );
      return undefined;
    }

    if (!map) {
      onStatusChange(
        createStatus(
          'loaded',
          '지도가 준비되면 climate.gg POC 패널을 지도 좌표 객체로 표시합니다.',
          panelPolygons,
          {
            climatePanelRenderStatus: 'loaded',
          },
          identity,
        ),
      );
      return undefined;
    }

    try {
      const cesiumViewer = findVisibleCesiumViewer(map);
      const heightM = getPanelHeightM(cesiumViewer, panelPolygons, roofHeightM);
      const cesiumResult = cesiumViewer
        ? addClimatePanelsWithCesium({
            viewer: cesiumViewer,
            panelPolygons,
            heightM,
            pocId,
            panelSource,
            selectedBuildingId,
            selectedAnalysisSessionId,
          })
        : null;
      const vworldResult =
        cesiumResult && cesiumResult.addedCount > 0
          ? null
          : addClimatePanelsWithVWorld({
              map,
              panelPolygons,
              heightM,
              pocId,
              panelSource,
              selectedBuildingId,
              selectedAnalysisSessionId,
            });
      const renderResult = cesiumResult && cesiumResult.addedCount > 0 ? cesiumResult : vworldResult;

      if (!renderResult || renderResult.addedCount === 0) {
        onStatusChange(createStatus('fallback', CONSTRUCTOR_ERROR_MESSAGE, panelPolygons, {}, identity));
        return undefined;
      }

      const cleanup = renderResult.cleanup;
      cleanupRef.current = cleanup;
      onStatusChange({
        state: 'rendered',
        message: `climate.gg POC 패널 ${renderResult.addedCount.toLocaleString('ko-KR')}개를 ${renderResult.renderMethod} 방식으로 표시했습니다.`,
        climatePanelFeatureCount: panelPolygons.length,
        climatePanelEntityCount: renderResult.addedCount,
        firstPanelCoordinates: panelPolygons[0]?.polygon ?? null,
        climatePanelRenderStatus: 'rendered',
        renderMethod: renderResult.renderMethod,
        viewerDebugId: renderResult.viewerDebugId,
        viewerEntityCount: renderResult.viewerEntityCount,
        ...identity,
      });

      return () => {
        cleanup();
        if (cleanupRef.current === cleanup) {
          cleanupRef.current = null;
        }
      };
    } catch {
      onStatusChange(createStatus('error', CONSTRUCTOR_ERROR_MESSAGE, panelPolygons, {}, identity));
      return undefined;
    }
  }, [
    map,
    onStatusChange,
    panelPolygons,
    panelSource,
    pocId,
    roofHeightM,
    selectedAnalysisSessionId,
    selectedBuildingId,
    visible,
  ]);

  return null;
}

export default ClimatePanelLayer;
