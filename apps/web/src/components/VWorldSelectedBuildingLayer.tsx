import { useEffect } from 'react';
import type { PolygonCoordinates } from '../lib/roofGeometry';

type VWorldSelectedBuildingLayerProps = {
  map: VWorldMapInstance | null;
  isActive: boolean;
  polygon: PolygonCoordinates | null;
};

type AddedVWorldObject = {
  id: string;
  object: unknown;
};

function createVWorldPolygonGeometry(polygon: PolygonCoordinates) {
  const vw = window.vw;

  if (!vw?.geom?.Polygon || !vw.Coord) {
    return null;
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
  const fill = new vw.style.Fill('rgba(239, 68, 68, 0.42)');
  const stroke = new vw.style.Stroke('#dc2626');

  stroke.setWidth?.(5);
  fill.setStroke?.(stroke);
  style.fill = fill;
  style.stroke = stroke;

  return style;
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

  feature.setId?.('solarmate-click-selected-building');
  feature.setGeometry?.(geometry);
  feature.setStyle?.(style);

  if (featureLayer?.setFeature) {
    featureLayer.setName?.('solarmate-click-selected-building-layer');
    featureLayer.setFeature(feature);
    featureLayer.setStyle?.(style);

    try {
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

function VWorldSelectedBuildingLayer({ map, isActive, polygon }: VWorldSelectedBuildingLayerProps) {
  useEffect(() => {
    if (!map || !isActive || !polygon) {
      return undefined;
    }

    const addedObject = addSelectedPolygonToMap(map, polygon);

    return () => {
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
  }, [isActive, map, polygon]);

  return null;
}

export default VWorldSelectedBuildingLayer;
