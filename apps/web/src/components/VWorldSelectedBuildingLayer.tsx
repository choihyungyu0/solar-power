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

export type VWorldSelectedBuildingLayerStatus = {
  state: 'idle' | 'rendered' | 'fallback' | 'error';
  message: string;
  selectedBuildingEntityStatus: '대기' | '지도 표시 완료' | '지도 표시 실패';
  renderMethod: string;
  viewerDebugId: string | null;
  viewerEntityCount: number | null;
};

type VWorldSelectedBuildingLayerProps = {
  map: VWorldMapInstance | null;
  isActive: boolean;
  polygon: PolygonCoordinates | null;
  roofHeightM?: number;
  onStatusChange: (status: VWorldSelectedBuildingLayerStatus) => void;
};

type AddedVWorldObject = {
  id: string;
  object: unknown;
};

type CesiumSelectionResult = {
  addedCount: number;
  renderMethod: string;
  viewerDebugId: string | null;
  viewerEntityCount: number | null;
  cleanup: () => void;
};

const SELECTED_BUILDING_ENTITY_PREFIX = 'solarmate-selected-building-';
const SELECTED_BUILDING_FILL_ID = `${SELECTED_BUILDING_ENTITY_PREFIX}fill`;
const SELECTED_BUILDING_OUTLINE_ID = `${SELECTED_BUILDING_ENTITY_PREFIX}outline`;
const SELECTED_BUILDING_LABEL_ID = `${SELECTED_BUILDING_ENTITY_PREFIX}label`;
const LEGACY_SELECTED_BUILDING_IDS = ['solarmate-click-selected-building', 'solarmate-click-selected-building-layer'];
const DEFAULT_SELECTED_ROOF_HEIGHT_M = 20;
const SELECTED_BUILDING_ROOF_OFFSET_M = 10;
const SELECTED_BUILDING_DEBUG_HEIGHT_OFFSET_M = 130;
const SELECTED_BUILDING_FILL_ALPHA = 0.6;
const SELECTED_BUILDING_OUTLINE_WIDTH = 7;
const CONSTRUCTOR_ERROR_MESSAGE =
  '선택 건물 polygon을 VWorld 또는 Cesium 지도 객체로 표시하지 못했습니다.';

function createStatus(
  state: VWorldSelectedBuildingLayerStatus['state'],
  message: string,
  selectedBuildingEntityStatus: VWorldSelectedBuildingLayerStatus['selectedBuildingEntityStatus'],
  renderMethod = '-',
  diagnostics: Partial<Pick<VWorldSelectedBuildingLayerStatus, 'viewerDebugId' | 'viewerEntityCount'>> = {},
): VWorldSelectedBuildingLayerStatus {
  return {
    state,
    message,
    selectedBuildingEntityStatus,
    renderMethod,
    viewerDebugId: null,
    viewerEntityCount: null,
    ...diagnostics,
  };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isValidPolygon(polygon: PolygonCoordinates | null | undefined): polygon is PolygonCoordinates {
  return (
    Array.isArray(polygon) &&
    polygon.length >= 3 &&
    polygon.every(
      (coordinate) =>
        Array.isArray(coordinate) &&
        coordinate.length >= 2 &&
        Number.isFinite(coordinate[0]) &&
        Number.isFinite(coordinate[1]),
    )
  );
}

function getSelectedBuildingHeightM(viewer: CesiumViewerLike, polygon: PolygonCoordinates, roofHeightM?: number) {
  const centroid = getPolygonCentroid(polygon);
  const terrainHeightM = getTerrainHeightM(viewer, centroid);
  const resolvedRoofHeightM =
    typeof roofHeightM === 'number' && Number.isFinite(roofHeightM) && roofHeightM > 0
      ? roofHeightM
      : DEFAULT_SELECTED_ROOF_HEIGHT_M;

  return typeof terrainHeightM === 'number'
    ? terrainHeightM + resolvedRoofHeightM + SELECTED_BUILDING_ROOF_OFFSET_M
    : resolvedRoofHeightM + SELECTED_BUILDING_DEBUG_HEIGHT_OFFSET_M;
}

function addSelectedPolygonWithCesium({
  viewer,
  polygon,
  roofHeightM,
}: {
  viewer: CesiumViewerLike;
  polygon: PolygonCoordinates;
  roofHeightM?: number;
}): CesiumSelectionResult | null {
  const cesium = getCesiumSdk();
  const entities = viewer.entities;

  if (!isValidPolygon(polygon) || !cesium?.Cartesian3?.fromDegreesArrayHeights || !cesium?.Cartesian3?.fromDegrees || !entities?.add) {
    return null;
  }

  const addedObjects: unknown[] = [];

  try {
    removeCesiumEntitiesByIdPrefix(viewer, [SELECTED_BUILDING_ENTITY_PREFIX]);
    LEGACY_SELECTED_BUILDING_IDS.forEach((id) => entities.removeById?.(id));

    const closedPolygon = closePolygon(polygon);
    const centroid = getPolygonCentroid(closedPolygon);
    const heightM = getSelectedBuildingHeightM(viewer, closedPolygon, roofHeightM);
    const hierarchyPositions = cesium.Cartesian3.fromDegreesArrayHeights(createLonLatHeightArray(closedPolygon, heightM));
    const hierarchy = cesium.PolygonHierarchy ? new cesium.PolygonHierarchy(hierarchyPositions) : hierarchyPositions;
    const outlinePositions = cesium.Cartesian3.fromDegreesArrayHeights(createLonLatHeightArray(closedPolygon, heightM + 0.6));
    const fillMaterial =
      cesium.Color?.fromCssColorString?.('#ff1f3d')?.withAlpha?.(SELECTED_BUILDING_FILL_ALPHA) ??
      cesium.Color?.RED?.withAlpha?.(SELECTED_BUILDING_FILL_ALPHA) ??
      cesium.Color?.fromCssColorString?.('#ff1f3d');
    const outlineMaterial = cesium.Color?.fromCssColorString?.('#ff002b') ?? cesium.Color?.RED;
    const labelBackground = cesium.Color?.fromCssColorString?.('#b91c1c')?.withAlpha?.(0.82) ?? cesium.Color?.RED;
    const labelFill = cesium.Color?.WHITE;
    const addEntity = entities.add.bind(entities);
    const heightReferenceNone = cesium.HeightReference?.NONE;

    const fillEntity = addEntity({
      id: SELECTED_BUILDING_FILL_ID,
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
      id: SELECTED_BUILDING_OUTLINE_ID,
      polyline: {
        positions: outlinePositions,
        width: SELECTED_BUILDING_OUTLINE_WIDTH,
        material: outlineMaterial,
        clampToGround: false,
        ...(outlineMaterial ? { depthFailMaterial: outlineMaterial } : {}),
        ...(heightReferenceNone !== undefined ? { heightReference: heightReferenceNone } : {}),
      },
    });
    const labelEntity = addEntity({
      id: SELECTED_BUILDING_LABEL_ID,
      position: cesium.Cartesian3.fromDegrees(centroid[0], centroid[1], heightM + 14),
      label: {
        text: '선택 건물',
        fillColor: labelFill,
        showBackground: true,
        backgroundColor: labelBackground,
        font: '700 13px sans-serif',
        pixelOffset: cesium.Cartesian2 ? new cesium.Cartesian2(0, -16) : undefined,
        horizontalOrigin: cesium.HorizontalOrigin?.CENTER,
        verticalOrigin: cesium.VerticalOrigin?.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        ...(heightReferenceNone !== undefined ? { heightReference: heightReferenceNone } : {}),
      },
    });

    [fillEntity, outlineEntity, labelEntity].forEach((entity) => {
      if (entity) {
        addedObjects.push(entity);
      }
    });
  } catch {
    addedObjects.forEach((entity) => {
      try {
        entities.remove?.(entity);
      } catch {
        // Cleanup is best-effort across Cesium/VWorld builds.
      }
    });
    removeCesiumEntitiesByIdPrefix(viewer, [SELECTED_BUILDING_ENTITY_PREFIX]);
    viewer.scene?.requestRender?.();

    return null;
  }

  viewer.scene?.requestRender?.();

  return {
    addedCount: addedObjects.length,
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
      removeCesiumEntitiesByIdPrefix(viewer, [SELECTED_BUILDING_ENTITY_PREFIX]);
      viewer.scene?.requestRender?.();
    },
  };
}

function createVWorldPolygonGeometry(polygon: PolygonCoordinates) {
  const vw = window.vw;

  if (!isValidPolygon(polygon) || !vw?.geom?.Polygon || !vw.Coord) {
    return null;
  }

  const coordinateObjects = polygon.map(([longitude, latitude]) => new vw.Coord(longitude, latitude));

  try {
    return new vw.geom.Polygon(coordinateObjects);
  } catch {
    try {
      return new vw.geom.Polygon([coordinateObjects]);
    } catch {
      try {
        return new vw.geom.Polygon([polygon]);
      } catch {
        return null;
      }
    }
  }
}

function createVWorldStyle() {
  const vw = window.vw;

  if (!vw?.style?.Style || !vw.style.Fill || !vw.style.Stroke) {
    return undefined;
  }

  try {
    const style = new vw.style.Style();
    const fill = new vw.style.Fill('rgba(239, 68, 68, 0.42)');
    const stroke = new vw.style.Stroke('#dc2626');

    stroke.setWidth?.(5);
    fill.setStroke?.(stroke);
    style.fill = fill;
    style.stroke = stroke;

    return style;
  } catch {
    return undefined;
  }
}

function addSelectedPolygonToMap(map: VWorldMapInstance, polygon: PolygonCoordinates) {
  const vw = window.vw;
  const geometry = createVWorldPolygonGeometry(polygon);

  if (!vw?.Feature || !geometry) {
    return undefined;
  }

  const style = createVWorldStyle();
  const feature = new vw.Feature();
  const featureLayer = vw?.layer?.Feature ? new vw.layer.Feature() : null;

  try {
    feature.setId?.('solarmate-click-selected-building');
    feature.setGeometry?.(geometry);
    feature.setStyle?.(style);
  } catch {
    return undefined;
  }

  if (featureLayer?.setFeature) {
    try {
      featureLayer.setName?.('solarmate-click-selected-building-layer');
      featureLayer.setFeature(feature);
      featureLayer.setStyle?.(style);
      map.addElement?.(featureLayer);

      return {
        id: 'solarmate-click-selected-building-layer',
        object: featureLayer,
      };
    } catch {
      // Some VWorld 3D builds reject layer.Feature in addElement. Try the raw feature below.
    }
  }

  try {
    map.addElement?.(feature);

    return {
      id: 'solarmate-click-selected-building',
      object: feature,
    };
  } catch {
    return undefined;
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

function VWorldSelectedBuildingLayer({
  map,
  isActive,
  polygon,
  roofHeightM,
  onStatusChange,
}: VWorldSelectedBuildingLayerProps) {
  useEffect(() => {
    if (!isActive || !polygon) {
      onStatusChange(createStatus('idle', '건물 polygon을 선택하면 선택 건물을 지도에 강조 표시합니다.', '대기'));
      return undefined;
    }

    if (!isValidPolygon(polygon)) {
      onStatusChange(createStatus('fallback', '선택 건물 polygon 좌표가 유효하지 않아 지도 표시를 건너뜁니다.', '지도 표시 실패'));
      return undefined;
    }

    if (!map) {
      onStatusChange(createStatus('fallback', '지도가 준비되면 선택 건물 polygon을 표시합니다.', '지도 표시 실패'));
      return undefined;
    }

    let cesiumResult: CesiumSelectionResult | null = null;
    let addedObject: AddedVWorldObject | undefined;
    let renderErrorMessage = '';

    try {
      const cesiumViewer = findVisibleCesiumViewer(map);
      cesiumResult = cesiumViewer
        ? addSelectedPolygonWithCesium({
            viewer: cesiumViewer,
            polygon,
            roofHeightM,
          })
        : null;
      addedObject = cesiumResult ? undefined : addSelectedPolygonToMap(map, polygon);
    } catch (error) {
      renderErrorMessage = getErrorMessage(error);
      cesiumResult?.cleanup();
      addedObject = undefined;
    }

    if (cesiumResult?.addedCount) {
      onStatusChange(
        createStatus(
          'rendered',
          '선택 건물 polygon을 붉은 fill, 강한 외곽선, 라벨로 표시했습니다.',
          '지도 표시 완료',
          cesiumResult.renderMethod,
          {
            viewerDebugId: cesiumResult.viewerDebugId,
            viewerEntityCount: cesiumResult.viewerEntityCount,
          },
        ),
      );
    } else if (addedObject) {
      onStatusChange(
        createStatus(
          'rendered',
          '선택 건물 polygon을 VWorld feature layer로 표시했습니다.',
          '지도 표시 완료',
          'VWorld Feature layer',
        ),
      );
    } else {
      onStatusChange(
        createStatus(
          'fallback',
          renderErrorMessage ? `${CONSTRUCTOR_ERROR_MESSAGE} (${renderErrorMessage})` : CONSTRUCTOR_ERROR_MESSAGE,
          '지도 표시 실패',
        ),
      );
      return undefined;
    }

    return () => {
      cesiumResult?.cleanup();

      if (addedObject) {
        removeVWorldObject(map, addedObject);
      }

      try {
        map.removeObjectById?.('solarmate-click-selected-building');
        map.removeObjectById?.('solarmate-click-selected-building-layer');
      } catch {
        // Cleanup should not break React rendering.
      }
    };
  }, [isActive, map, onStatusChange, polygon, roofHeightM]);

  return null;
}

export default VWorldSelectedBuildingLayer;
