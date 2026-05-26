import { useEffect } from 'react';
import { getPolygonCentroid, type PolygonCoordinates } from '../lib/roofGeometry';
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

export type VWorldSelectableBuildingLayerStatus = {
  state: 'idle' | 'rendered' | 'fallback';
  message: string;
  candidateEntityCount: number;
  renderMethod: string;
  viewerDebugId: string | null;
  viewerEntityCount: number | null;
};

type VWorldSelectableBuildingLayerProps = {
  map: VWorldMapInstance | null;
  isActive: boolean;
  polygons: PolygonCoordinates[];
  onStatusChange: (status: VWorldSelectableBuildingLayerStatus) => void;
};

type AddedVWorldObject = {
  id: string;
  object: unknown;
};

const CONSTRUCTOR_ERROR_MESSAGE =
  '선택 가능한 건물 테두리를 지도 좌표 레이어로 표시하려면 VWorld polygon 객체 생성 연결이 필요합니다.';
const CANDIDATE_BUILDING_ENTITY_PREFIX = 'solarmate-candidate-building-';
const CANDIDATE_HEIGHT_ABOVE_TERRAIN_M = 35;
const CANDIDATE_DEBUG_HEIGHT_M = 120;

function createStatus(
  state: VWorldSelectableBuildingLayerStatus['state'],
  message: string,
  candidateEntityCount = 0,
  renderMethod = '-',
  diagnostics: Partial<Pick<VWorldSelectableBuildingLayerStatus, 'viewerDebugId' | 'viewerEntityCount'>> = {},
): VWorldSelectableBuildingLayerStatus {
  return {
    state,
    message,
    candidateEntityCount,
    renderMethod,
    viewerDebugId: null,
    viewerEntityCount: null,
    ...diagnostics,
  };
}

function getCandidateHeightM(viewer: CesiumViewerLike, polygon: PolygonCoordinates) {
  const terrainHeightM = getTerrainHeightM(viewer, getPolygonCentroid(polygon));

  return typeof terrainHeightM === 'number' ? terrainHeightM + CANDIDATE_HEIGHT_ABOVE_TERRAIN_M : CANDIDATE_DEBUG_HEIGHT_M;
}

function addSelectableOutlinesWithCesium(viewer: CesiumViewerLike, polygons: PolygonCoordinates[]) {
  const cesium = getCesiumSdk();
  const entities = viewer.entities;

  if (!cesium?.Cartesian3?.fromDegreesArrayHeights || !entities?.add) {
    return null;
  }

  removeCesiumEntitiesByIdPrefix(viewer, [CANDIDATE_BUILDING_ENTITY_PREFIX]);

  const fillMaterial =
    cesium.Color?.fromCssColorString?.('#67e8f9')?.withAlpha?.(0.07) ??
    cesium.Color?.CYAN?.withAlpha?.(0.07) ??
    cesium.Color?.CYAN;
  const outlineMaterial =
    cesium.Color?.fromCssColorString?.('#67e8f9')?.withAlpha?.(0.46) ??
    cesium.Color?.CYAN?.withAlpha?.(0.46) ??
    cesium.Color?.CYAN;
  const heightReferenceNone = cesium.HeightReference?.NONE;
  const addEntity = entities.add.bind(entities);
  const addedObjects: unknown[] = [];
  let candidateEntityCount = 0;

  polygons.forEach((polygon, index) => {
    const id = `${CANDIDATE_BUILDING_ENTITY_PREFIX}${index}`;
    const outlineId = `${id}-outline`;
    const closedPolygon = closePolygon(polygon);
    const heightM = getCandidateHeightM(viewer, closedPolygon);
    const positions = cesium.Cartesian3.fromDegreesArrayHeights(createLonLatHeightArray(closedPolygon, heightM));
    const hierarchy = cesium.PolygonHierarchy ? new cesium.PolygonHierarchy(positions) : positions;

    entities.removeById?.(id);
    entities.removeById?.(outlineId);

    const fillEntity = addEntity({
      id,
      polygon: {
        hierarchy,
        perPositionHeight: true,
        material: fillMaterial,
        outline: false,
        ...(heightReferenceNone !== undefined ? { heightReference: heightReferenceNone } : {}),
      },
    });
    const outlineEntity = addEntity({
      id: outlineId,
      polyline: {
        positions,
        width: 1.5,
        material: outlineMaterial,
        clampToGround: false,
        ...(outlineMaterial ? { depthFailMaterial: outlineMaterial } : {}),
      },
    });

    if (fillEntity) {
      candidateEntityCount += 1;
      addedObjects.push(fillEntity);
    }

    if (outlineEntity) {
      addedObjects.push(outlineEntity);
    }
  });

  viewer.scene?.requestRender?.();

  return {
    addedCount: candidateEntityCount,
    renderMethod: 'Cesium entities',
    viewerDebugId: getViewerDebugId(viewer),
    viewerEntityCount: getCesiumEntityCount(viewer),
    cleanup: () => {
      addedObjects.forEach((entity) => {
        try {
          entities.remove?.(entity);
        } catch {
          // Keep cleanup best-effort across Cesium/VWorld builds.
        }
      });
      removeCesiumEntitiesByIdPrefix(viewer, [CANDIDATE_BUILDING_ENTITY_PREFIX]);
      viewer.scene?.requestRender?.();
    },
  };
}

function createVWorldPolygonGeometry(polygon: PolygonCoordinates) {
  const vw = window.vw;

  if (!vw?.geom?.Polygon || !vw.Coord) {
    throw new Error(CONSTRUCTOR_ERROR_MESSAGE);
  }

  const coordinateObjects = polygon.map(([longitude, latitude]) => new vw.Coord(longitude, latitude));

  try {
    return new vw.geom.Polygon(coordinateObjects);
  } catch {
    return new vw.geom.Polygon(polygon);
  }
}

function createVWorldStyle() {
  const vw = window.vw;

  if (!vw?.style?.Style || !vw.style.Fill || !vw.style.Stroke) {
    return undefined;
  }

  const style = new vw.style.Style();
  const fill = new vw.style.Fill('rgba(103, 232, 249, 0.06)');
  const stroke = new vw.style.Stroke('rgba(103, 232, 249, 0.48)');

  stroke.setWidth?.(2);
  fill.setStroke?.(stroke);
  style.fill = fill;
  style.stroke = stroke;

  return style;
}

function createFeature(id: string, polygon: PolygonCoordinates, style: unknown) {
  const vw = window.vw;

  if (!vw?.Feature) {
    throw new Error(CONSTRUCTOR_ERROR_MESSAGE);
  }

  const feature = new vw.Feature();
  feature.setId?.(id);
  feature.setGeometry?.(createVWorldPolygonGeometry(polygon));
  feature.setStyle?.(style);

  return feature;
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
      // Some VWorld 3D builds reject layer.Feature in addElement. Try the raw feature below.
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

function addSelectableOutlinesToVWorldMap(map: VWorldMapInstance, polygons: PolygonCoordinates[]) {
  const style = createVWorldStyle();
  const addedObjects = polygons.flatMap((polygon, index) => {
    const id = `solarmate-selectable-building-${index}`;
    const feature = createFeature(id, polygon, style);
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
      polygons.forEach((_, index) => {
        try {
          map.removeObjectById?.(`solarmate-selectable-building-${index}`);
          map.removeObjectById?.(`solarmate-selectable-building-${index}-layer`);
        } catch {
          // Cleanup should not break React rendering.
        }
      });
    },
  };
}

function VWorldSelectableBuildingLayer({
  map,
  isActive,
  polygons,
  onStatusChange,
}: VWorldSelectableBuildingLayerProps) {
  useEffect(() => {
    if (!isActive || polygons.length === 0) {
      onStatusChange(createStatus('idle', '건물에 가까이 접근하거나 건물을 선택하면 주변 건물 테두리를 표시합니다.'));
      return undefined;
    }

    if (!map) {
      onStatusChange(createStatus('fallback', '지도가 준비되면 주변 건물 테두리를 지도 좌표에 맞춰 표시합니다.'));
      return undefined;
    }

    try {
      const cesiumViewer = findVisibleCesiumViewer(map);
      const cesiumResult = cesiumViewer ? addSelectableOutlinesWithCesium(cesiumViewer, polygons) : null;
      const vworldResult = cesiumResult?.addedCount ? null : addSelectableOutlinesToVWorldMap(map, polygons);
      const renderResult = cesiumResult?.addedCount ? cesiumResult : vworldResult;

      if (!renderResult || renderResult.addedCount === 0) {
        onStatusChange(createStatus('fallback', CONSTRUCTOR_ERROR_MESSAGE));
        return undefined;
      }

      onStatusChange({
        state: 'rendered',
        message: `근접 후보 건물 ${renderResult.addedCount.toLocaleString('ko-KR')}개를 옅은 cyan 지도 객체로 표시했습니다.`,
        candidateEntityCount: renderResult.addedCount,
        renderMethod: renderResult.renderMethod,
        viewerDebugId: renderResult.viewerDebugId,
        viewerEntityCount: renderResult.viewerEntityCount,
      });

      return renderResult.cleanup;
    } catch {
      onStatusChange(createStatus('fallback', CONSTRUCTOR_ERROR_MESSAGE));
      return undefined;
    }
  }, [isActive, map, onStatusChange, polygons]);

  return null;
}

export default VWorldSelectableBuildingLayer;
