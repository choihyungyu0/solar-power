import { useEffect } from 'react';
import { getPolygonCentroid, type PolygonCoordinates } from '../lib/roofGeometry';

export type VWorldSolarLayerStatus = {
  state: 'idle' | 'rendered' | 'fallback' | 'error';
  message: string;
  viewMoved?: boolean;
  viewMoveMethod?: string;
};

type VWorldSolarRoofLayerProps = {
  map: VWorldMapInstance | null;
  isActive: boolean;
  buildingPolygon: PolygonCoordinates | null;
  roofPolygon: PolygonCoordinates | null;
  panelPolygons: PolygonCoordinates[];
  estimatedCapacityKw: number;
  onStatusChange: (status: VWorldSolarLayerStatus) => void;
};

type AddedVWorldObject = {
  id: string;
  object: unknown;
};

const CONSTRUCTOR_ERROR_MESSAGE =
  '건물 도형은 조회되었지만 브이월드 지도 객체로 패널을 그리는 생성자 연결이 필요합니다.';
const CAMERA_MOVE_FALLBACK_MESSAGE =
  '선택 도형은 표시했지만 옥상 시점 이동은 브이월드 카메라 메서드 연결이 필요합니다.';

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

function createVWorldStyle(fillColor: string, strokeColor: string, strokeWidth: number) {
  const vw = window.vw;

  if (!vw?.style?.Style || !vw.style.Fill || !vw.style.Stroke) {
    return undefined;
  }

  const style = new vw.style.Style();
  const fill = new vw.style.Fill(fillColor);
  const stroke = new vw.style.Stroke(strokeColor);

  stroke.setWidth?.(strokeWidth);
  fill.setStroke?.(stroke);
  style.fill = fill;
  style.stroke = stroke;

  return style;
}

function createRoofCameraObjects(polygon: PolygonCoordinates) {
  const centroid = getPolygonCentroid(polygon);
  const vw = window.vw;

  if (!vw?.CoordZ) {
    return {
      centroid,
      coordZ: undefined,
      cameraPosition: undefined,
    };
  }

  const coordZ = new vw.CoordZ(centroid[0], centroid[1], 520);
  const direction = vw.Direction ? new vw.Direction(0, -58, 0) : undefined;
  const cameraPosition = vw.CameraPosition && direction ? new vw.CameraPosition(coordZ, direction) : undefined;

  return {
    centroid,
    coordZ,
    cameraPosition,
  };
}

function invokeMapMethod(map: VWorldMapInstance, methodName: string, argument: unknown) {
  const method = (map as unknown as Record<string, unknown>)[methodName];

  if (typeof method !== 'function') {
    return false;
  }

  method.call(map, argument);
  return true;
}

function moveMapViewToRoof(map: VWorldMapInstance, roofPolygon: PolygonCoordinates) {
  const { centroid, coordZ, cameraPosition } = createRoofCameraObjects(roofPolygon);
  const candidates = [
    { method: 'moveTo', argument: cameraPosition },
    { method: 'setCameraPosition', argument: cameraPosition },
    { method: 'moveCamera', argument: cameraPosition },
    { method: 'flyTo', argument: cameraPosition },
    { method: 'moveTo', argument: coordZ },
    { method: 'flyTo', argument: coordZ },
    { method: 'setCenter', argument: centroid },
  ].filter((candidate): candidate is { method: string; argument: unknown } => Boolean(candidate.argument));

  for (const candidate of candidates) {
    try {
      if (invokeMapMethod(map, candidate.method, candidate.argument)) {
        return {
          moved: true,
          method: candidate.method,
        };
      }
    } catch {
      // VWorld camera method signatures differ by sample/version, so try the next safe candidate.
    }
  }

  try {
    const getView = (map as unknown as Record<string, unknown>).getView;

    if (typeof getView === 'function') {
      const view = getView.call(map) as Record<string, unknown>;
      const setCenter = view.setCenter;
      const setZoom = view.setZoom;

      if (typeof setCenter === 'function') {
        setCenter.call(view, centroid);
        if (typeof setZoom === 'function') {
          setZoom.call(view, 18);
        }

        return {
          moved: true,
          method: 'getView().setCenter',
        };
      }
    }
  } catch {
    // Keep the selected roof highlight even if the camera API is not available.
  }

  try {
    if (cameraPosition) {
      map.setInitPosition?.(cameraPosition);

      return {
        moved: true,
        method: 'setInitPosition',
      };
    }
  } catch {
    // The selection highlight still communicates which building was selected.
  }

  return {
    moved: false,
    method: '',
  };
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

function addSolarPanelsToVWorldMap({
  map,
  buildingPolygon,
  roofPolygon,
  panelPolygons,
  estimatedCapacityKw,
}: {
  map: VWorldMapInstance;
  buildingPolygon: PolygonCoordinates | null;
  roofPolygon: PolygonCoordinates;
  panelPolygons: PolygonCoordinates[];
  estimatedCapacityKw: number;
}) {
  const addedObjects: AddedVWorldObject[] = [];
  const buildingStyle = createVWorldStyle('rgba(239, 68, 68, 0.16)', '#ef4444', 4);
  const roofStyle = createVWorldStyle('rgba(248, 113, 113, 0.48)', '#dc2626', 5);
  const panelStyle = createVWorldStyle('rgba(30, 64, 175, 0.86)', '#a5f3fc', 1);

  if (buildingPolygon) {
    const buildingFeature = createFeature('solarmate-selected-building', buildingPolygon, buildingStyle);
    const addedBuilding = addFeatureToMap(map, 'solarmate-selected-building-layer', buildingFeature, buildingStyle);

    if (addedBuilding) {
      addedObjects.push(addedBuilding);
    }
  }

  const roofFeature = createFeature('solarmate-selected-roof', roofPolygon, roofStyle);
  const addedRoof = addFeatureToMap(map, 'solarmate-selected-roof-layer', roofFeature, roofStyle);

  if (addedRoof) {
    addedObjects.push(addedRoof);
  }

  panelPolygons.forEach((panelPolygon, index) => {
    const panelFeature = createFeature(`solarmate-panel-${index}`, panelPolygon, panelStyle);
    const addedPanel = addFeatureToMap(map, `solarmate-panel-layer-${index}`, panelFeature, panelStyle);

    if (addedPanel) {
      addedObjects.push(addedPanel);
    }
  });

  const centroid = getPolygonCentroid(roofPolygon);
  const label = `선택 옥상\n태양광 가상 설치\n예상 ${estimatedCapacityKw.toLocaleString('ko-KR')}kW`;

  try {
    map.createMarker?.('solarmate-solar-label', new window.vw.CoordZ(centroid[0], centroid[1], 80), label);
  } catch {
    // Label constructors differ across VWorld samples. Roof and panel geometry still remain map-coordinate based.
  }

  return {
    focusResult: moveMapViewToRoof(map, roofPolygon),
    cleanup: () => {
      addedObjects.forEach((addedObject) => removeVWorldObject(map, addedObject));
      try {
        map.removeObjectById?.('solarmate-solar-label');
        map.removeObjectById?.('solarmate-selected-building');
        map.removeObjectById?.('solarmate-selected-roof');
      } catch {
        // Cleanup should not break React rendering.
      }
    },
  };
}

function VWorldSolarRoofLayer({
  map,
  isActive,
  buildingPolygon,
  roofPolygon,
  panelPolygons,
  estimatedCapacityKw,
  onStatusChange,
}: VWorldSolarRoofLayerProps) {
  useEffect(() => {
    if (!isActive) {
      onStatusChange({ state: 'idle', message: '태양광 지도 레이어가 꺼져 있습니다.' });
      return undefined;
    }

    if (!map || !roofPolygon || panelPolygons.length === 0) {
      onStatusChange({
        state: 'fallback',
        message: '실제 건물 도형을 찾지 못해 화면 기준 예시 배치를 표시합니다.',
      });
      return undefined;
    }

    try {
      const { cleanup, focusResult } = addSolarPanelsToVWorldMap({
        map,
        buildingPolygon,
        roofPolygon,
        panelPolygons,
        estimatedCapacityKw,
      });

      onStatusChange({
        state: 'rendered',
        message: focusResult.moved
          ? '선택 건물의 옥상 후보를 빨간색으로 표시하고 해당 위치로 시점 이동을 시도했습니다.'
          : CAMERA_MOVE_FALLBACK_MESSAGE,
        viewMoved: focusResult.moved,
        viewMoveMethod: focusResult.method,
      });

      return cleanup;
    } catch {
      onStatusChange({
        state: 'fallback',
        message: CONSTRUCTOR_ERROR_MESSAGE,
      });
      return undefined;
    }
  }, [buildingPolygon, estimatedCapacityKw, isActive, map, onStatusChange, panelPolygons, roofPolygon]);

  return null;
}

export default VWorldSolarRoofLayer;
