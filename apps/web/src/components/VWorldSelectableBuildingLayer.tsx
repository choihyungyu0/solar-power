import { useEffect } from 'react';
import type { PolygonCoordinates } from '../lib/roofGeometry';

export type VWorldSelectableBuildingLayerStatus = {
  state: 'idle' | 'rendered' | 'fallback';
  message: string;
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
  const fill = new vw.style.Fill('rgba(14, 165, 233, 0.12)');
  const stroke = new vw.style.Stroke('#22d3ee');

  stroke.setWidth?.(3);
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
      onStatusChange({ state: 'idle', message: '건물에 가까이 접근하거나 건물을 선택하면 주변 건물 테두리를 표시합니다.' });
      return undefined;
    }

    if (!map) {
      onStatusChange({ state: 'fallback', message: '지도가 준비되면 주변 건물 테두리를 지도 좌표에 맞춰 표시합니다.' });
      return undefined;
    }

    try {
      const { addedCount, cleanup } = addSelectableOutlinesToVWorldMap(map, polygons);

      if (addedCount === 0) {
        onStatusChange({ state: 'fallback', message: CONSTRUCTOR_ERROR_MESSAGE });
        return undefined;
      }

      onStatusChange({
        state: 'rendered',
        message: `근접 후보 건물 ${addedCount.toLocaleString('ko-KR')}개를 지도 좌표 테두리로 표시했습니다.`,
      });

      return cleanup;
    } catch {
      onStatusChange({ state: 'fallback', message: CONSTRUCTOR_ERROR_MESSAGE });
      return undefined;
    }
  }, [isActive, map, onStatusChange, polygons]);

  return null;
}

export default VWorldSelectableBuildingLayer;
