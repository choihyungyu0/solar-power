import type { Coordinate, PolygonCoordinates } from './roofGeometry';

export type ViewerCanvasSize = {
  width: number;
  height: number;
};

export type CesiumEntityLike = {
  id?: unknown;
};

export type CesiumEntityCollectionLike = {
  add?: (entity: unknown) => unknown;
  remove?: (entity: unknown) => boolean;
  removeById?: (id: string) => boolean;
  values?: CesiumEntityLike[];
};

export type CanvasLike = {
  clientWidth?: number;
  clientHeight?: number;
  width?: number;
  height?: number;
  isConnected?: boolean;
  getBoundingClientRect?: () => DOMRect;
};

export type CesiumViewerLike = {
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

type ViewerIdWindow = Window &
  typeof globalThis & {
    __solarMateCesiumViewerCounter?: number;
    __solarMateCesiumViewerIds?: WeakMap<object, string>;
  };

export function getCesiumSdk() {
  const cesium = window.Cesium;

  return cesium && typeof cesium === 'object' ? (cesium as Record<string, any>) : null;
}

export function getViewerCanvas(viewer: CesiumViewerLike): CanvasLike | null {
  return viewer.scene?.canvas ?? viewer.canvas ?? null;
}

export function getViewerCanvasSize(viewer: CesiumViewerLike): ViewerCanvasSize | null {
  const canvas = getViewerCanvas(viewer);

  if (!canvas) {
    return null;
  }

  const rect = canvas.getBoundingClientRect?.();
  const width = Math.round(rect?.width || canvas.clientWidth || canvas.width || 0);
  const height = Math.round(rect?.height || canvas.clientHeight || canvas.height || 0);

  return width > 0 && height > 0 ? { width, height } : null;
}

export function isViewerCanvasVisible(viewer: CesiumViewerLike) {
  const canvas = getViewerCanvas(viewer);
  const size = getViewerCanvasSize(viewer);

  if (!canvas || !size || canvas.isConnected === false) {
    return false;
  }

  if (canvas instanceof HTMLElement) {
    const style = window.getComputedStyle(canvas);

    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
  }

  return true;
}

function hasCesiumEntityCollection(value: unknown): value is CesiumViewerLike {
  return Boolean(value && typeof value === 'object' && ((value as CesiumViewerLike).entities?.add));
}

function pushUniqueViewerCandidate(candidates: CesiumViewerLike[], value: unknown) {
  if (!hasCesiumEntityCollection(value) || candidates.includes(value)) {
    return;
  }

  candidates.push(value);
}

function getCesiumViewerCandidates(value: unknown): CesiumViewerLike[] {
  const candidates: CesiumViewerLike[] = [];

  if (!value || typeof value !== 'object') {
    return candidates;
  }

  const record = value as Record<string, unknown>;

  pushUniqueViewerCandidate(candidates, value);

  for (const key of ['viewer', '_viewer', 'cesiumViewer', '_cesiumViewer', 'sceneViewer', 'mapViewer']) {
    pushUniqueViewerCandidate(candidates, record[key]);
  }

  for (const key of ['getViewer', 'getCesiumViewer', 'getCesium', 'getMap']) {
    const method = record[key];

    if (typeof method !== 'function') {
      continue;
    }

    try {
      pushUniqueViewerCandidate(candidates, method.call(value));
    } catch {
      // VWorld builds expose different internals; keep looking for a safe viewer candidate.
    }
  }

  return candidates;
}

export function findVisibleCesiumViewer(map: VWorldMapInstance | null): CesiumViewerLike | null {
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

export function getViewerDebugId(viewer: CesiumViewerLike | null) {
  if (!viewer) {
    return null;
  }

  const globalWindow = window as ViewerIdWindow;

  if (!globalWindow.__solarMateCesiumViewerIds) {
    globalWindow.__solarMateCesiumViewerIds = new WeakMap<object, string>();
    globalWindow.__solarMateCesiumViewerCounter = 0;
  }

  const viewerObject = viewer as object;
  const existingId = globalWindow.__solarMateCesiumViewerIds.get(viewerObject);

  if (existingId) {
    return existingId;
  }

  const nextId = `viewer-${(globalWindow.__solarMateCesiumViewerCounter ?? 0) + 1}`;
  globalWindow.__solarMateCesiumViewerCounter = (globalWindow.__solarMateCesiumViewerCounter ?? 0) + 1;
  globalWindow.__solarMateCesiumViewerIds.set(viewerObject, nextId);

  return nextId;
}

export function getCesiumEntityValues(viewer: CesiumViewerLike): CesiumEntityLike[] {
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

export function getCesiumEntityCount(viewer: CesiumViewerLike | null) {
  return viewer ? getCesiumEntityValues(viewer).length : null;
}

export function removeCesiumEntitiesByIdPrefix(viewer: CesiumViewerLike, prefixes: string[]) {
  const entities = viewer.entities;

  getCesiumEntityValues(viewer).forEach((entity) => {
    const id = entity.id;

    if (typeof id !== 'string' || !prefixes.some((prefix) => id.startsWith(prefix))) {
      return;
    }

    try {
      entities?.removeById?.(id);
      return;
    } catch {
      // Fall back to object removal below.
    }

    try {
      entities?.remove?.(entity);
    } catch {
      // Cleanup is best-effort across Cesium/VWorld builds.
    }
  });
}

export function createLonLatHeightArray(polygon: PolygonCoordinates, heightM: number) {
  return polygon.flatMap(([longitude, latitude]) => [longitude, latitude, heightM]);
}

export function closePolygon(polygon: PolygonCoordinates): PolygonCoordinates {
  if (polygon.length === 0) {
    return polygon;
  }

  const first = polygon[0];
  const last = polygon[polygon.length - 1];

  return first[0] === last[0] && first[1] === last[1] ? polygon : [...polygon, first];
}

export function getTerrainHeightM(viewer: CesiumViewerLike | null, coordinate: Coordinate | null) {
  const cesium = getCesiumSdk();

  if (!viewer?.scene?.globe?.getHeight || !coordinate || !cesium?.Cartographic?.fromDegrees) {
    return null;
  }

  try {
    const cartographic = cesium.Cartographic.fromDegrees(coordinate[0], coordinate[1]);
    const terrainHeightM = viewer.scene.globe.getHeight(cartographic);

    return typeof terrainHeightM === 'number' && Number.isFinite(terrainHeightM) ? terrainHeightM : null;
  } catch {
    return null;
  }
}
