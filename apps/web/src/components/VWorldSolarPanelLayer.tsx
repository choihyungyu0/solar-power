import { useEffect, useRef } from 'react';
import type { PolygonCoordinates } from '../lib/roofGeometry';

export type VWorldSolarPanelLayerStatus = {
  state: 'idle' | 'rendered' | 'fallback' | 'error';
  message: string;
  panelPolygonCount: number;
  firstPanelCoordinates: PolygonCoordinates | null;
  roofHeightM: number;
  renderMethod: string;
  heightMessage?: string;
};

export type VWorldSolarPanelBuildingFeature = {
  id?: string | number;
  properties?: Record<string, unknown> | null;
};

type VWorldSolarPanelLayerProps = {
  map: VWorldMapInstance | null;
  selectedBuildingFeature: VWorldSolarPanelBuildingFeature | null;
  selectedBuildingId: string | null;
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

type CesiumViewerLike = {
  entities?: {
    add?: (entity: unknown) => unknown;
    remove?: (entity: unknown) => boolean;
    removeById?: (id: string) => boolean;
  };
};

const DEFAULT_ROOF_HEIGHT_M = 20;
const PANEL_Z_OFFSET_M = 0.5;
const CONSTRUCTOR_ERROR_MESSAGE =
  '태양광 패널을 지도 좌표 객체로 표시하려면 VWorld 또는 Cesium polygon 객체 연결이 필요합니다.';
const DEFAULT_HEIGHT_MESSAGE = '건물 높이 정보가 없어 기본 높이로 패널을 표시합니다.';

function createEmptyStatus(
  state: VWorldSolarPanelLayerStatus['state'],
  message: string,
  panelPolygons: PolygonCoordinates[],
  roofHeightM: number,
  renderMethod = '-',
  heightMessage?: string,
): VWorldSolarPanelLayerStatus {
  return {
    state,
    message,
    panelPolygonCount: panelPolygons.length,
    firstPanelCoordinates: panelPolygons[0] ?? null,
    roofHeightM,
    renderMethod,
    heightMessage,
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

function getPanelHeightM(roofHeightM: number) {
  return roofHeightM + PANEL_Z_OFFSET_M;
}

function getSafeSelectedBuildingId(selectedBuildingId: string | null, selectedBuildingFeature: VWorldSolarPanelBuildingFeature | null) {
  const fallbackId = selectedBuildingFeature?.id;

  return selectedBuildingId || (typeof fallbackId === 'string' || typeof fallbackId === 'number' ? String(fallbackId) : 'selected');
}

function getCesiumViewerCandidate(value: unknown): CesiumViewerLike | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;

  if ((record.entities as CesiumViewerLike['entities'])?.add) {
    return value as CesiumViewerLike;
  }

  for (const key of ['viewer', '_viewer', 'cesiumViewer', '_cesiumViewer', 'sceneViewer', 'mapViewer']) {
    const candidate = record[key];

    if (candidate && typeof candidate === 'object' && ((candidate as CesiumViewerLike).entities?.add)) {
      return candidate as CesiumViewerLike;
    }
  }

  for (const key of ['getViewer', 'getCesiumViewer', 'getCesium', 'getMap']) {
    const method = record[key];

    if (typeof method !== 'function') {
      continue;
    }

    try {
      const candidate = method.call(value);

      if (candidate && typeof candidate === 'object' && ((candidate as CesiumViewerLike).entities?.add)) {
        return candidate as CesiumViewerLike;
      }
    } catch {
      // VWorld builds expose different internals; keep looking for a safe viewer candidate.
    }
  }

  return null;
}

function findCesiumViewer(map: VWorldMapInstance | null): CesiumViewerLike | null {
  return (
    getCesiumViewerCandidate(map) ??
    getCesiumViewerCandidate(window.ws3d) ??
    getCesiumViewerCandidate(window.VW) ??
    getCesiumViewerCandidate(window.vw) ??
    null
  );
}

function getCesiumSdk() {
  const cesium = window.Cesium;

  return cesium && typeof cesium === 'object' ? (cesium as Record<string, any>) : null;
}

function addPanelEntitiesWithCesium({
  viewer,
  selectedBuildingId,
  panelPolygons,
  heightM,
}: {
  viewer: CesiumViewerLike;
  selectedBuildingId: string;
  panelPolygons: PolygonCoordinates[];
  heightM: number;
}) {
  const cesium = getCesiumSdk();
  const entities = viewer.entities;

  if (!cesium?.Cartesian3 || !entities?.add) {
    return null;
  }

  const addEntity = entities.add.bind(entities);
  const addedObjects: AddedMapObject[] = [];
  const fillMaterial = cesium.Color?.fromCssColorString
    ? cesium.Color.fromCssColorString('#1e3a8a').withAlpha?.(0.78) ?? cesium.Color.fromCssColorString('#1e3a8a')
    : undefined;
  const outlineMaterial = cesium.Color?.fromCssColorString
    ? cesium.Color.fromCssColorString('#67e8f9').withAlpha?.(0.98) ?? cesium.Color.fromCssColorString('#67e8f9')
    : undefined;

  let panelEntityCount = 0;

  panelPolygons.forEach((panelPolygon, index) => {
    const id = `solarmate-panel-${selectedBuildingId}-${index}`;
    const outlineId = `${id}-outline`;
    const flatDegrees = panelPolygon.flatMap(([longitude, latitude]) => [longitude, latitude]);
    const flatDegreesWithHeight = panelPolygon.flatMap(([longitude, latitude]) => [longitude, latitude, heightM]);
    const polygonPositions = cesium.Cartesian3.fromDegreesArray(flatDegrees);
    const outlinePositions = cesium.Cartesian3.fromDegreesArrayHeights(flatDegreesWithHeight);
    const hierarchy = cesium.PolygonHierarchy ? new cesium.PolygonHierarchy(polygonPositions) : polygonPositions;

    entities.removeById?.(id);
    entities.removeById?.(outlineId);

    const panelEntity = addEntity({
      id,
      polygon: {
        hierarchy,
        material: fillMaterial,
        outline: true,
        outlineColor: outlineMaterial,
        height: heightM,
      },
    });
    const outlineEntity = addEntity({
      id: outlineId,
      polyline: {
        positions: outlinePositions,
        width: 2,
        material: outlineMaterial,
        clampToGround: false,
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

  return {
    addedCount: panelEntityCount,
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
  const fill = new vw.style.Fill('rgba(30, 58, 138, 0.78)');
  const stroke = new vw.style.Stroke('#67e8f9');

  stroke.setWidth?.(2);
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
  panelPolygons,
  heightM,
}: {
  map: VWorldMapInstance;
  selectedBuildingId: string;
  panelPolygons: PolygonCoordinates[];
  heightM: number;
}) {
  const style = createVWorldPanelStyle();
  const addedObjects = panelPolygons.flatMap((panelPolygon, index) => {
    const id = `solarmate-panel-${selectedBuildingId}-${index}`;

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
    cleanup: () => {
      addedObjects.forEach((addedObject) => removeVWorldObject(map, addedObject));
      panelPolygons.forEach((_, index) => {
        const id = `solarmate-panel-${selectedBuildingId}-${index}`;

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
  panelPolygons,
  roofHeightM,
  visible,
  onStatusChange,
}: VWorldSolarPanelLayerProps) {
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;

    const heightEstimate = getResolvedRoofHeightM(selectedBuildingFeature, roofHeightM);
    const panelHeightM = getPanelHeightM(heightEstimate.roofHeightM);
    const stableBuildingId = getSafeSelectedBuildingId(selectedBuildingId, selectedBuildingFeature);

    if (!visible) {
      onStatusChange(
        createEmptyStatus(
          'idle',
          '태양광 패널 지도 레이어가 꺼져 있습니다.',
          panelPolygons,
          heightEstimate.roofHeightM,
          '-',
          heightEstimate.heightMessage,
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
          heightEstimate.heightMessage,
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
          heightEstimate.heightMessage,
        ),
      );
      return undefined;
    }

    try {
      const cesiumViewer = findCesiumViewer(map);
      const cesiumResult = cesiumViewer
        ? addPanelEntitiesWithCesium({
            viewer: cesiumViewer,
            selectedBuildingId: stableBuildingId,
            panelPolygons,
            heightM: panelHeightM,
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
              panelPolygons,
              heightM: panelHeightM,
            });
      const renderResult = cesiumResult && cesiumResult.addedCount > 0 ? cesiumResult : vworldResult;
      const renderMethod = cesiumResult && cesiumResult.addedCount > 0 ? 'Cesium entities' : 'VWorld Feature layer';

      if (!renderResult || renderResult.addedCount === 0) {
        onStatusChange(
          createEmptyStatus(
            'fallback',
            CONSTRUCTOR_ERROR_MESSAGE,
            panelPolygons,
            heightEstimate.roofHeightM,
            '-',
            heightEstimate.heightMessage,
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
        firstPanelCoordinates: panelPolygons[0] ?? null,
        roofHeightM: heightEstimate.roofHeightM,
        renderMethod,
        heightMessage: heightEstimate.heightMessage,
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
          heightEstimate.heightMessage,
        ),
      );
      return undefined;
    }
  }, [map, onStatusChange, panelPolygons, roofHeightM, selectedBuildingFeature, selectedBuildingId, visible]);

  return null;
}

export default VWorldSolarPanelLayer;
